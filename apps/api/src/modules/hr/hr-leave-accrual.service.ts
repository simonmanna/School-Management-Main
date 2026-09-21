import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { dec, ZERO, type Money } from '../../kernel/common/money';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MS_PER_DAY = 86_400_000;
const MONTHS_PER_YEAR = 12;

/**
 * HrLeaveAccrualService — how leave days come into existence.
 *
 * Before this existed, a balance row was created on first use with the whole
 * year's entitlement already in it. That is wrong in the two places it matters
 * most: someone who joins in October is granted a full year of leave, and
 * someone who resigns in March is settled as though they had earned one. Both
 * are cash.
 *
 * The design has one rule: **the ledger is the truth, the balance is a cache.**
 * Every grant, carry-forward and expiry writes an `HrLeaveAccrual` row keyed by
 * `(employee, leaveType, periodKey)`. `accruedDays` on the balance is then the
 * sum of those rows. That is what makes the job safe to run on a cron, twice,
 * after a crash, or by an administrator pressing a button — September can only
 * ever be granted once.
 *
 * Nothing here touches `usedDays`; consuming leave stays with HrLeaveService.
 */
@Injectable()
export class HrLeaveAccrualService {
  private readonly logger = new Logger('HrLeaveAccrual');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private get db(): Record<string, any> {
    return this.prisma.client as unknown as Record<string, any>;
  }

  // ── Accrual run ────────────────────────────────────────────────────────────

  /**
   * Bring every employee's leave up to date as at `asOf` (default: today).
   *
   * Idempotent by construction — it grants only the accrual periods that have
   * closed and have no ledger row yet. Running it daily, monthly, or twice in a
   * row all give the same balances.
   */
  async runAccrual(dto: { asOf?: string; leaveTypeId?: string; employeeId?: string; dryRun?: boolean } = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const asOf = dto.asOf ? new Date(dto.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException('asOf is not a valid date');
    const year = asOf.getUTCFullYear();

    const leaveTypes = await this.db.hrLeaveType.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        isActive: true,
        accrualMethod: { not: 'NONE' },
        ...(dto.leaveTypeId ? { id: dto.leaveTypeId } : {}),
      },
    });
    if (leaveTypes.length === 0) {
      return { asOf, year, granted: [], employeesTouched: 0, daysGranted: 0, dryRun: !!dto.dryRun };
    }

    const employees = await this.db.hrEmployee.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        isActive: true,
        ...(dto.employeeId ? { id: dto.employeeId } : {}),
      },
      select: { id: true, employeeCode: true, firstName: true, lastName: true, hireDate: true },
      orderBy: { employeeCode: 'asc' },
    });

    // The ledger rows that already exist for this year, so the loop below is
    // pure arithmetic against one fetch rather than a lookup per employee.
    const existing = await this.db.hrLeaveAccrual.findMany({
      where: { organizationId: orgId, year, ...(dto.leaveTypeId ? { leaveTypeId: dto.leaveTypeId } : {}) },
      select: { employeeId: true, leaveTypeId: true, periodKey: true },
    });
    const seen = new Set(existing.map((a: any) => `${a.employeeId}|${a.leaveTypeId}|${a.periodKey}`));

    const pending: Array<{
      employeeId: string; employeeName: string; leaveTypeId: string; leaveTypeName: string;
      periodKey: string; days: Money; reason: string;
    }> = [];

    for (const type of leaveTypes) {
      const perYear = dec(type.daysPerYear ?? 0);
      if (!perYear.greaterThan(ZERO)) continue;

      for (const emp of employees) {
        const hire = emp.hireDate ? startOfUtcDay(emp.hireDate) : null;
        // Accrual cannot start before the probation bar the leave type sets.
        const accrualStart = hire ? addUtcMonths(hire, type.accrualStartsAfterMonths ?? 0) : null;
        if (accrualStart && accrualStart > asOf) continue;

        for (const slot of this.periodsToGrant(type, year, asOf, accrualStart)) {
          const key = `${emp.id}|${type.id}|${slot.periodKey}`;
          if (seen.has(key)) continue;
          const days = slot.fraction.times(perYear).toDecimalPlaces(2);
          if (!days.greaterThan(ZERO)) continue;
          pending.push({
            employeeId: emp.id,
            employeeName: `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() || emp.employeeCode,
            leaveTypeId: type.id,
            leaveTypeName: type.name,
            periodKey: slot.periodKey,
            days,
            reason: slot.reason,
          });
          seen.add(key);
        }
      }
    }

    if (dto.dryRun) {
      return {
        asOf,
        year,
        dryRun: true,
        granted: pending.map((p) => ({ ...p, days: Number(p.days) })),
        employeesTouched: new Set(pending.map((p) => p.employeeId)).size,
        daysGranted: Number(pending.reduce((a, p) => a.plus(p.days), ZERO)),
      };
    }

    const applied = await this.applyAccruals(pending, year, userId);
    return {
      asOf,
      year,
      dryRun: false,
      granted: applied.map((p) => ({ ...p, days: Number(p.days) })),
      employeesTouched: new Set(applied.map((p) => p.employeeId)).size,
      daysGranted: Number(applied.reduce((a, p) => a.plus(p.days), ZERO)),
    };
  }

  /**
   * Which accrual slots are closed as at `asOf` and how much of each is earned.
   *
   * A MONTHLY type earns one twelfth per completed month, and the joining month
   * is pro-rated by the days actually served in it. A month is only granted once
   * it has ENDED — accruing the current month early is how an employee takes
   * leave they have not yet earned and then leaves.
   */
  private periodsToGrant(
    type: any,
    year: number,
    asOf: Date,
    accrualStart: Date | null,
  ): Array<{ periodKey: string; fraction: Money; reason: string }> {
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31));

    if (type.accrualMethod === 'ANNUAL_UPFRONT') {
      // Granted in full at the start of the year, or pro-rated from the day the
      // employee became eligible when that falls mid-year.
      const from = accrualStart && accrualStart > yearStart ? accrualStart : yearStart;
      if (from > yearEnd) return [];
      const daysInYear = dayCount(yearStart, yearEnd);
      const eligibleDays = dayCount(from, yearEnd);
      return [{
        periodKey: String(year),
        fraction: dec(eligibleDays).dividedBy(dec(daysInYear)),
        reason: 'ANNUAL_GRANT',
      }];
    }

    // MONTHLY.
    const slots: Array<{ periodKey: string; fraction: Money; reason: string }> = [];
    for (let month = 0; month < MONTHS_PER_YEAR; month += 1) {
      const monthStart = new Date(Date.UTC(year, month, 1));
      const monthEnd = new Date(Date.UTC(year, month + 1, 0));
      // Only closed months are earned.
      if (monthEnd > startOfUtcDay(asOf)) break;
      if (accrualStart && accrualStart > monthEnd) continue;

      const from = accrualStart && accrualStart > monthStart ? accrualStart : monthStart;
      const daysInMonth = dayCount(monthStart, monthEnd);
      const served = dayCount(from, monthEnd);
      slots.push({
        periodKey: `${year}-${String(month + 1).padStart(2, '0')}`,
        // One twelfth of the year, scaled by the share of the month served.
        fraction: dec(served).dividedBy(dec(daysInMonth)).dividedBy(dec(MONTHS_PER_YEAR)),
        reason: 'MONTHLY_ACCRUAL',
      });
    }
    return slots;
  }

  /**
   * Write the ledger rows and re-cache each affected balance.
   *
   * Chunked into transactions of one employee-year each rather than one giant
   * transaction: a school-wide monthly accrual touches every member of staff,
   * and holding that open long enough to write them all is how a payroll-sized
   * job times out. A partial run is safe here precisely because re-running
   * finishes the rest.
   */
  private async applyAccruals(
    pending: Array<{ employeeId: string; leaveTypeId: string; periodKey: string; days: Money; reason: string; employeeName: string; leaveTypeName: string }>,
    year: number,
    userId?: string,
  ) {
    const orgId = this.tenant.organizationId;
    const byBalance = new Map<string, typeof pending>();
    for (const p of pending) {
      const key = `${p.employeeId}|${p.leaveTypeId}`;
      const list = byBalance.get(key) ?? [];
      list.push(p);
      byBalance.set(key, list);
    }

    const applied: typeof pending = [];
    for (const [key, rows] of byBalance) {
      const [employeeId, leaveTypeId] = key.split('|');
      try {
        await this.prisma.client.$transaction(async (tx: any) => {
          for (const r of rows) {
            await tx.hrLeaveAccrual.create({
              data: {
                id: randomUUID(),
                organizationId: orgId,
                employeeId,
                leaveTypeId,
                year,
                periodKey: r.periodKey,
                days: r.days,
                reason: r.reason,
                createdBy: userId,
              },
            });
          }
          await this.recacheBalance(tx, employeeId, leaveTypeId, year, userId);
        });
        applied.push(...rows);
      } catch (err: any) {
        // A unique violation means a concurrent run got there first, which is
        // the idempotence key doing its job — not a failure worth aborting for.
        if (err?.code === 'P2002') {
          this.logger.debug(`accrual already granted for ${key} (${rows.map((r) => r.periodKey).join(',')})`);
          continue;
        }
        throw err;
      }
    }

    if (applied.length > 0) {
      await this.audit.record({
        entity: 'HrLeaveBalance',
        entityId: `accrual:${year}`,
        action: 'update',
        newValues: {
          event: 'leave_accrual',
          year,
          rows: applied.length,
          employees: new Set(applied.map((a) => a.employeeId)).size,
          days: Number(applied.reduce((a, p) => a.plus(p.days), ZERO)),
        },
      });
    }
    return applied;
  }

  /**
   * Recompute `accruedDays` as the sum of the ledger, honouring the type's
   * balance cap.
   *
   * Summing rather than incrementing is deliberate: an increment drifts the
   * moment one write is retried, and the balance is the number a manager reads
   * before approving leave.
   */
  private async recacheBalance(
    tx: any,
    employeeId: string,
    leaveTypeId: string,
    year: number,
    userId?: string,
  ) {
    const orgId = this.tenant.organizationId;
    const rows = await tx.hrLeaveAccrual.findMany({
      where: { organizationId: orgId, employeeId, leaveTypeId, year },
      select: { days: true },
    });
    let accrued = rows.reduce((a: Money, r: any) => a.plus(dec(r.days)), ZERO);

    const type = await tx.hrLeaveType.findUnique({ where: { id: leaveTypeId } });
    if (type?.maxBalanceDays != null) {
      const cap = dec(type.maxBalanceDays);
      if (accrued.greaterThan(cap)) accrued = cap;
    }

    const existing = await tx.hrLeaveBalance.findUnique({
      where: {
        organizationId_employeeId_leaveTypeId_year: { organizationId: orgId, employeeId, leaveTypeId, year },
      },
    });
    if (existing) {
      return tx.hrLeaveBalance.update({
        where: { id: existing.id },
        data: { accruedDays: accrued },
      });
    }
    return tx.hrLeaveBalance.create({
      data: {
        organizationId: orgId,
        employeeId,
        leaveTypeId,
        year,
        accruedDays: accrued,
        createdBy: userId,
      },
    });
  }

  // ── Year end ───────────────────────────────────────────────────────────────

  /**
   * Close a leave year: carry forward what the policy allows, forfeit the rest.
   *
   * Both halves are written to the ledger. Forfeiture especially — an employee
   * who loses eleven days at the year end is entitled to see that it happened
   * and when, rather than finding the number quietly smaller in January.
   */
  async runYearEndRollover(dto: { year?: number; dryRun?: boolean } = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const year = dto.year ?? new Date().getUTCFullYear() - 1;
    const nextYear = year + 1;

    const balances = await this.db.hrLeaveBalance.findMany({
      where: { organizationId: orgId, year, deletedAt: null },
      include: {
        leaveType: true,
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, isActive: true } },
      },
    });

    const movements: Array<{
      employeeId: string; employeeName: string; leaveTypeId: string; leaveTypeName: string;
      remaining: number; carried: number; forfeited: number;
    }> = [];

    for (const b of balances) {
      // A leaver carries nothing forward; their balance is settled by
      // offboarding, not rolled into a year they will not work.
      if (!b.employee?.isActive) continue;
      const type = b.leaveType;
      if (!type || type.deletedAt || !type.isActive) continue;

      const remaining = dec(b.accruedDays).plus(dec(b.adjustedDays)).minus(dec(b.usedDays));
      if (!remaining.greaterThan(ZERO)) continue;

      const cap = dec(type.carryForwardDays ?? 0);
      const carried = remaining.lessThan(cap) ? remaining : cap;
      const forfeited = remaining.minus(carried);

      movements.push({
        employeeId: b.employeeId,
        employeeName: `${b.employee.firstName ?? ''} ${b.employee.lastName ?? ''}`.trim() || b.employee.employeeCode,
        leaveTypeId: b.leaveTypeId,
        leaveTypeName: type.name,
        remaining: Number(remaining),
        carried: Number(carried),
        forfeited: Number(forfeited),
      });

      if (dto.dryRun) continue;

      await this.prisma.client.$transaction(async (tx: any) => {
        if (carried.greaterThan(ZERO)) {
          await tx.hrLeaveAccrual.upsert({
            where: {
              organizationId_employeeId_leaveTypeId_periodKey: {
                organizationId: orgId,
                employeeId: b.employeeId,
                leaveTypeId: b.leaveTypeId,
                periodKey: `${nextYear}-CF`,
              },
            },
            create: {
              id: randomUUID(),
              organizationId: orgId,
              employeeId: b.employeeId,
              leaveTypeId: b.leaveTypeId,
              year: nextYear,
              periodKey: `${nextYear}-CF`,
              days: carried,
              reason: 'CARRY_FORWARD',
              notes: `Carried from ${year}`,
              createdBy: userId,
            },
            update: { days: carried },
          });
        }
        if (forfeited.greaterThan(ZERO)) {
          await tx.hrLeaveAccrual.upsert({
            where: {
              organizationId_employeeId_leaveTypeId_periodKey: {
                organizationId: orgId,
                employeeId: b.employeeId,
                leaveTypeId: b.leaveTypeId,
                periodKey: `${year}-FORFEIT`,
              },
            },
            create: {
              id: randomUUID(),
              organizationId: orgId,
              employeeId: b.employeeId,
              leaveTypeId: b.leaveTypeId,
              year,
              periodKey: `${year}-FORFEIT`,
              // Negative: it reduces the closing year, it does not create days.
              days: forfeited.negated(),
              reason: 'FORFEITURE',
              notes: `Above the ${Number(cap)}-day carry-forward limit`,
              createdBy: userId,
            },
            update: { days: forfeited.negated() },
          });
        }
        await this.recacheBalance(tx, b.employeeId, b.leaveTypeId, nextYear, userId);
      });
    }

    if (!dto.dryRun && movements.length > 0) {
      await this.audit.record({
        entity: 'HrLeaveBalance',
        entityId: `rollover:${year}`,
        action: 'update',
        newValues: {
          event: 'leave_year_end_rollover',
          year,
          intoYear: nextYear,
          employees: new Set(movements.map((m) => m.employeeId)).size,
          carried: movements.reduce((a, m) => a + m.carried, 0),
          forfeited: movements.reduce((a, m) => a + m.forfeited, 0),
        },
      });
    }

    return {
      year,
      intoYear: nextYear,
      dryRun: !!dto.dryRun,
      movements,
      totalCarried: movements.reduce((a, m) => a + m.carried, 0),
      totalForfeited: movements.reduce((a, m) => a + m.forfeited, 0),
    };
  }

  /**
   * Expire carried-forward days that were not used by the policy deadline.
   *
   * Only what is LEFT of the carried days expires. Someone who carried 5 days
   * and has taken 3 loses 2, not 5 — days taken are taken against the carried
   * balance first, which is the reading that favours the employee and is what
   * every leave policy that bothers to say means.
   */
  async expireCarryForward(dto: { year?: number; asOf?: string; dryRun?: boolean } = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const year = dto.year ?? new Date().getUTCFullYear();
    const asOf = dto.asOf ? new Date(dto.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException('asOf is not a valid date');

    const carried = await this.db.hrLeaveAccrual.findMany({
      where: { organizationId: orgId, year, reason: 'CARRY_FORWARD' },
      include: { leaveType: true },
    });

    const expiries: Array<{
      employeeId: string; leaveTypeId: string; leaveTypeName: string;
      carried: number; expired: number; deadline: string;
    }> = [];

    for (const row of carried) {
      const months = row.leaveType?.carryForwardExpiryMonths;
      if (months == null) continue; // carried days that never expire
      const deadline = new Date(Date.UTC(year, months, 1)); // first day AFTER the window
      if (asOf < deadline) continue;

      const balance = await this.db.hrLeaveBalance.findUnique({
        where: {
          organizationId_employeeId_leaveTypeId_year: {
            organizationId: orgId,
            employeeId: row.employeeId,
            leaveTypeId: row.leaveTypeId,
            year,
          },
        },
      });
      if (!balance) continue;

      // Used days consume the carried block first, so only the unused remainder
      // of it can expire — and never more than what is actually left.
      const carriedDays = dec(row.days);
      const used = dec(balance.usedDays);
      const unusedCarried = carriedDays.minus(used);
      if (!unusedCarried.greaterThan(ZERO)) continue;
      const remaining = dec(balance.accruedDays).plus(dec(balance.adjustedDays)).minus(used);
      const expired = unusedCarried.lessThan(remaining) ? unusedCarried : remaining;
      if (!expired.greaterThan(ZERO)) continue;

      expiries.push({
        employeeId: row.employeeId,
        leaveTypeId: row.leaveTypeId,
        leaveTypeName: row.leaveType?.name ?? '',
        carried: Number(carriedDays),
        expired: Number(expired),
        deadline: deadline.toISOString().slice(0, 10),
      });

      if (dto.dryRun) continue;

      await this.prisma.client.$transaction(async (tx: any) => {
        await tx.hrLeaveAccrual.upsert({
          where: {
            organizationId_employeeId_leaveTypeId_periodKey: {
              organizationId: orgId,
              employeeId: row.employeeId,
              leaveTypeId: row.leaveTypeId,
              periodKey: `${year}-CF-EXPIRY`,
            },
          },
          create: {
            id: randomUUID(),
            organizationId: orgId,
            employeeId: row.employeeId,
            leaveTypeId: row.leaveTypeId,
            year,
            periodKey: `${year}-CF-EXPIRY`,
            days: expired.negated(),
            reason: 'CARRY_FORWARD_EXPIRY',
            notes: `Carried days unused by ${deadline.toISOString().slice(0, 10)}`,
            createdBy: userId,
          },
          update: { days: expired.negated() },
        });
        await this.recacheBalance(tx, row.employeeId, row.leaveTypeId, year, userId);
      });
    }

    return {
      year,
      asOf,
      dryRun: !!dto.dryRun,
      expiries,
      totalExpired: expiries.reduce((a, e) => a + e.expired, 0),
    };
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /** The accrual ledger behind one employee's balance. "Why do I have 14.5 days?" */
  async ledger(query: { employeeId?: string; leaveTypeId?: string; year?: number } = {}) {
    const orgId = this.tenant.organizationId;
    const rows = await this.db.hrLeaveAccrual.findMany({
      where: {
        organizationId: orgId,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.leaveTypeId ? { leaveTypeId: query.leaveTypeId } : {}),
        ...(query.year ? { year: Number(query.year) } : {}),
      },
      include: {
        leaveType: { select: { code: true, name: true } },
        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
      },
      orderBy: [{ year: 'asc' }, { periodKey: 'asc' }],
      take: 2_000,
    });
    return {
      rows,
      total: rows.length,
      netDays: Number(rows.reduce((a: Money, r: any) => a.plus(dec(r.days)), ZERO)),
    };
  }
}

// ── Calendar helpers ─────────────────────────────────────────────────────────
// Leave arithmetic is calendar arithmetic, so every date collapses to a UTC
// midnight first. Mixing a local-midnight and a UTC-midnight timestamp is how a
// month boundary comes out a day short.

function startOfUtcDay(d: Date | string): Date {
  const dt = d instanceof Date ? d : new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function addUtcMonths(d: Date, months: number): Date {
  const dt = startOfUtcDay(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + months, dt.getUTCDate()));
}

/** Calendar days from `from` to `to`, counting BOTH ends. */
function dayCount(from: Date, to: Date): number {
  const n = Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / MS_PER_DAY) + 1;
  return n > 0 ? n : 0;
}
