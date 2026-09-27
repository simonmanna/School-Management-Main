import { assertDateWritable } from '../foundation/academic-year-guard';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS, PERMISSIONS } from '@erp/shared';
import type { BulkMarkAttendanceDto, CorrectAttendanceDto } from './dto.types';
import { AttendanceStatusConfigService } from './attendance-status-config.service';
import { EmployeeIdentityService } from '../../../kernel/auth/employee-identity.service';
import { DataScopeService } from '../../../kernel/auth/data-scope.service';
import { countCodes, loadAttendancePolicy, summarizeAttendance } from './attendance-rate';

/**
 * StudentAttendanceService — bulk-mark a class's daily attendance in one tx.
 * Unique constraint (studentProfileId, date) ensures idempotent upserts.
 * Returns event counts so the UI can show "X present, Y absent, Z late".
 */
@Injectable()
export class StudentAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly statusConfig: AttendanceStatusConfigService,
    private readonly employeeIdentity: EmployeeIdentityService,
    private readonly dataScope: DataScopeService,
  ) {}

  /**
   * May this caller take THIS class's register?
   *
   * `school:attendance:write` (org-wide) passes straight through. Otherwise the
   * caller must be within scope for this class — resolved by DataScopeService
   * (the single authority), which uses `TeacherAssignment` + the timetable so a
   * cover teacher standing in for an absent colleague is not locked out.
   */
  private async assertMayMarkClass(classId: string | null | undefined): Promise<void> {
    const perms: string[] = this.tenant.store?.permissions ?? [];
    if (perms.includes(PERMISSIONS.school.takeAttendance) || perms.includes('*')) return;
    // Reaching here means the caller holds only `school:attendance:own`, which
    // authorises nothing by itself — it is a claim that the class is theirs.
    // `assertTeachesClass` makes them prove it, rather than asking what their
    // role's data scope would have permitted.
    await this.dataScope.assertTeachesClass(classId ?? undefined);
  }

  /**
   * F10: every learner on a register must have been seated in this class (and
   * stream) on that day — not before they were admitted, not after they left
   * or moved, not in another school. One stranger fails the whole register.
   */
  private async assertEntriesBelongToRegister(tx: any, dto: BulkMarkAttendanceDto, date: Date): Promise<void> {
    const ids = dto.entries.map((e) => e.studentProfileId);
    const unique = [...new Set(ids)];
    if (unique.length !== ids.length) throw new BadRequestException('A learner appears on this register more than once.');
    if (!unique.length) return;
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const seated = await tx.enrollmentPlacement.findMany({
      where: {
        effectiveFrom: { lt: dayEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: dayStart } }],
        classCohort: { classId: dto.classId },
        ...(dto.sectionId ? { sectionId: dto.sectionId } : {}),
        enrollment: { studentProfileId: { in: unique }, status: { not: 'CANCELLED' } },
      },
      select: { enrollment: { select: { studentProfileId: true } } },
    });
    const present = new Set(seated.map((p: any) => p.enrollment.studentProfileId));
    const strangers = unique.filter((id) => !present.has(id));
    if (strangers.length) {
      throw new BadRequestException({
        code: 'NOT_ON_REGISTER',
        message: `${strangers.length} learner(s) on this register were not in this class${dto.sectionId ? ' and stream' : ''} on ${dayStart.toISOString().slice(0, 10)}. Nothing was saved.`,
        studentProfileIds: strangers,
      });
    }
  }

  async mark(dto: BulkMarkAttendanceDto) {
    await this.assertMayMarkClass(dto.classId);
    const organizationId = this.tenant.organizationId;
    const date = new Date(dto.date);
    const periodId = dto.periodId ?? null;

    // Resolve each entry's status config so we can store the FK + derive roll-up.
    const cfgByCode = await this.statusConfig.catalogByCode();
    const counts: Record<string, number> = {};

    // P5: periodId is nullable, so the (student, date, periodId) key can't be a
    // Prisma compound-unique upsert (null keys aren't upsertable). Find-then-
    // create/update instead; the DB partial unique indexes are the safety net.
    await this.prisma.client.$transaction(async (tx: any) => {
      // A closed year's registers are history (Wave 5 closed-year guard).
      await assertDateWritable(tx, organizationId, date);
      await this.assertEntriesBelongToRegister(tx, dto, date);
      for (const e of dto.entries) {
        const cfg = cfgByCode[e.status];
        const statusCfgId = cfg?.id ?? null;
        const existing = await tx.studentAttendance.findFirst({
          where: { organizationId, studentProfileId: e.studentProfileId, date, periodId },
          select: { id: true, classId: true },
        });
        // A re-submitted register updates its own rows. It never relabels a
        // record another class's register made — that is a correction (F10).
        if (existing && existing.classId && existing.classId !== dto.classId) {
          throw new BadRequestException(
            'A learner on this register already has attendance recorded under another class for this date. Correct that record instead.',
          );
        }
        const data = {
          classId: dto.classId,
          sectionId: dto.sectionId ?? null,
          status: e.status,
          statusCfgId,
          minutesLate: e.minutesLate ?? 0,
          earlyDepartureMinutes: e.earlyDepartureMinutes ?? null,
          reason: e.reason ?? null,
          markedById: this.tenant.userId ?? null,
        };
        if (existing) {
          await tx.studentAttendance.updateMany({ where: { id: existing.id }, data });
        } else {
          await tx.studentAttendance.create({
            data: { organizationId, studentProfileId: e.studentProfileId, date, periodId, ...data },
          });
        }
        counts[e.status] = (counts[e.status] ?? 0) + 1;
      }
    });

    this.events.publish(EVENTS.SchoolAttendanceMarked, {
      organizationId,
      date: date.toISOString(),
      classId: dto.classId,
      periodId,
      // Roll-up counts by configured bucket (isPresent / isLate / isAbsent) so the
      // notification subscriber can alert guardians without knowing each code.
      present: Object.entries(cfgByCode).filter(([, c]: any) => c.isPresent).reduce((n, [code]) => n + (counts[code] ?? 0), 0),
      absent: Object.entries(cfgByCode).filter(([, c]: any) => c.isAbsent).reduce((n, [code]) => n + (counts[code] ?? 0), 0),
      late: Object.entries(cfgByCode).filter(([, c]: any) => c.isLate).reduce((n, [code]) => n + (counts[code] ?? 0), 0),
      // Per-entry detail so the notifications subscriber can alert guardians.
      entries: dto.entries.map((e) => {
        const cfg = cfgByCode[e.status];
        return {
          studentProfileId: e.studentProfileId,
          status: e.status,
          isPresent: cfg?.isPresent ?? false,
          isLate: cfg?.isLate ?? false,
          isAbsent: cfg?.isAbsent ?? false,
          minutesLate: e.minutesLate ?? 0,
          earlyDepartureMinutes: e.earlyDepartureMinutes ?? null,
        };
      }),
    });
    return counts;
  }

  /** Correct a single attendance record (audit-logged). */
  async correct(id: string, dto: CorrectAttendanceDto) {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.client.studentAttendance.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException(`Attendance ${id} not found`);
    // Same rule as marking, resolved from the stored row rather than the request:
    // a teacher may fix their own register, and only their own. Every correction
    // is audit-logged either way.
    await this.assertMayMarkClass(existing.classId);
    // Re-audit #3 P1-14: marking a register refused a closed year, correcting
    // one did not — so a closed year's registers could still be rewritten.
    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      await assertDateWritable(tx, organizationId, new Date(existing.date));
      return tx.studentAttendance.update({
        where: { id },
        data: {
          status: dto.status,
          minutesLate: dto.minutesLate ?? 0,
          reason: dto.reason ?? existing.reason,
          markedById: this.tenant.userId ?? null,
        },
      });
    });
    this.events.publish(EVENTS.SchoolAttendanceCorrected, {
      organizationId,
      studentProfileId: existing.studentProfileId,
      attendanceId: id,
      fromStatus: existing.status,
      toStatus: dto.status,
      note: dto.correctionNote ?? null,
    });
    return updated;
  }

  /** Daily register for a class. */
  async dailyRegister(classId: string, date: Date | string, periodId?: string) {
    const d = new Date(date);
    return this.prisma.client.studentAttendance.findMany({
      // P5: null periodId → the daily register; a periodId → that period's register.
      where: { classId, date: d, periodId: periodId ?? null },
      include: { studentProfile: { include: { partner: true } }, statusConfig: true },
      orderBy: { studentProfile: { admissionNo: 'asc' } } as any,
    });
  }

  /** Reports: weekly summary (Mon..Sun) for a class, bucketed by configured code. */
  async weekly(classId: string, weekStart: Date | string) {
    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const rows = await this.prisma.client.studentAttendance.findMany({
      where: { classId, date: { gte: start, lt: end } },
    });
    // Bucket by date for the UI grid; counts are per configured status code.
    const byDate: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      const key = r.date.toISOString().slice(0, 10);
      byDate[key] ??= {};
      byDate[key][r.status] = (byDate[key][r.status] ?? 0) + 1;
    }
    return { from: start, to: end, byDate };
  }

  /** Per-student summary: attendance % over a date range, derived from config flags. */
  async byStudent(studentProfileId: string, from: Date | string, to: Date | string) {
    // A class teacher reads the attendance of pupils they teach, not the school's.
    await this.dataScope.assertMayReadStudent(studentProfileId);
    const start = from ? new Date(from) : new Date(Date.now() - 90 * 86400000);
    const end = to ? new Date(to) : new Date();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid from/to date');
    }
    const [rows, cfg, policy] = await Promise.all([
      this.prisma.client.studentAttendance.findMany({ where: { studentProfileId, date: { gte: start, lte: end } } }),
      this.statusConfig.catalogByCode(),
      loadAttendancePolicy(this.prisma.client),
    ]);
    // Audit F08: one bucket per session, the school's late policy, no clamp.
    const s = summarizeAttendance(countCodes(rows.map((r) => r.status)), cfg, policy);
    return {
      total: s.sessions,
      present: s.present,
      late: s.late,
      excused: s.excused,
      absent: s.absent,
      denominator: s.denominator,
      attendanceRate: s.rate,
      policyMissing: s.policyMissing,
    };
  }

  /**
   * P-att-status: org attendance summary across a date range — powers the
   * Attendance Report page. Returns per-day status counts (keyed by code) plus a
   * roll-up (`present`/`absent`/`late`) derived from the config flags, and the
   * status catalog so the UI can render labels/colours/columns dynamically.
   */
  async report(classId: string, startDate: Date | string, endDate: Date | string) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 86400000);
    const end = endDate ? new Date(endDate) : new Date();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid start/end date');
    }
    end.setHours(23, 59, 59, 999);

    const [rows, catalog, policy] = await Promise.all([
      this.prisma.client.studentAttendance.findMany({
        where: { classId, date: { gte: start, lte: end } },
        include: { statusConfig: true },
      }),
      this.statusConfig.list(),
      loadAttendancePolicy(this.prisma.client),
    ]);
    const cfgByCode = Object.fromEntries(catalog.map((c) => [c.code, c]));

    const byDate: Array<{ date: string; day: string; total: number; counts: Record<string, number> }> = [];
    const dailyMap = new Map<string, { total: number; counts: Record<string, number> }>();
    for (const r of rows) {
      const key = r.date.toISOString().slice(0, 10);
      if (!dailyMap.has(key)) dailyMap.set(key, { total: 0, counts: {} });
      const bucket = dailyMap.get(key)!;
      bucket.total++;
      bucket.counts[r.status] = (bucket.counts[r.status] ?? 0) + 1;
    }
    const s = summarizeAttendance(countCodes(rows.map((r) => r.status)), cfgByCode, policy);

    for (const [key, bucket] of [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      byDate.push({
        date: key,
        day: new Date(key).toLocaleDateString(undefined, { weekday: 'short' }),
        total: bucket.total,
        counts: bucket.counts,
      });
    }

    return {
      classId,
      start: start.toISOString(),
      end: end.toISOString(),
      statuses: catalog,
      /** The school's ADR-032 P1 policy, so every consumer computes the same rate. */
      policy,
      summary: {
        present: s.present,
        absent: s.absent,
        late: s.late,
        excused: s.excused,
        total: s.sessions,
        denominator: s.denominator,
        rate: s.rate,
        policyMissing: s.policyMissing,
      },
      byDate,
    };
  }

  /* ── Thresholds (P1) ─────────────────────────────────────────────────── */

  async getThreshold(classId?: string | null) {
    const organizationId = this.tenant.organizationId;
    if (classId) {
      const specific = await this.prisma.client.attendanceThreshold.findFirst({
        where: { organizationId, classId },
      });
      if (specific) return specific;
    }
    return this.prisma.client.attendanceThreshold.findFirst({
      where: { organizationId, classId: null },
    });
  }

  async upsertThreshold(dto: { classId?: string | null; minAttendancePct?: number; notifyAbsent?: boolean; notifyLate?: boolean; notifyEarly?: boolean; notifyBelowThreshold?: boolean }) {
    const organizationId = this.tenant.organizationId;
    const classId = dto.classId ?? null;
    const existing = await this.prisma.client.attendanceThreshold.findFirst({
      where: { organizationId, classId },
    });
    const data: any = {};
    if (dto.minAttendancePct !== undefined) data.minAttendancePct = dto.minAttendancePct;
    if (dto.notifyAbsent !== undefined) data.notifyAbsent = dto.notifyAbsent;
    if (dto.notifyLate !== undefined) data.notifyLate = dto.notifyLate;
    if (dto.notifyEarly !== undefined) data.notifyEarly = dto.notifyEarly;
    if (dto.notifyBelowThreshold !== undefined) data.notifyBelowThreshold = dto.notifyBelowThreshold;
    if (existing) {
      return this.prisma.client.attendanceThreshold.update({ where: { id: existing.id }, data });
    }
    return this.prisma.client.attendanceThreshold.create({
      data: { organizationId, classId, ...data },
    });
  }

  /**
   * P1: rolling below-threshold sweep. For every student in `classId` (or the
   * whole org when omitted) over the last `days`, compute attendance % and
   * return those below the active threshold. The subscriber calls this on a
   * schedule (or on demand) to fire guardian alerts.
   */
  async belowThresholdStudents(orgId: string, days = 30, classId?: string | null) {
    const start = new Date(Date.now() - days * 86400000);
    const threshold = await this.getThresholdFor(orgId, classId);
    const floor = threshold?.minAttendancePct ?? 75;
    const where: any = { organizationId: orgId, date: { gte: start } };
    if (classId) where.classId = classId;
    const rows = await this.prisma.client.studentAttendance.findMany({ where });
    // P-att-status: good attendance = configured isPresent / isLate.
    const cfgByCode = await this.statusConfig.catalogByCode();
    const agg: Record<string, { total: number; good: number }> = {};
    for (const r of rows) {
      agg[r.studentProfileId] ??= { total: 0, good: 0 };
      agg[r.studentProfileId].total++;
      const cfg = cfgByCode[r.status];
      if (cfg?.isPresent || cfg?.isLate) agg[r.studentProfileId].good++;
    }
    const flagged: Array<{ studentProfileId: string; pct: number }> = [];
    for (const [sid, v] of Object.entries(agg)) {
      const pct = v.total > 0 ? (v.good / v.total) * 100 : 100;
      if (pct < floor) flagged.push({ studentProfileId: sid, pct: Math.round(pct * 100) / 100 });
    }
    return { floor, flagged };
  }

  private async getThresholdFor(orgId: string, classId?: string | null) {
    if (classId) {
      const specific = await this.prisma.client.attendanceThreshold.findFirst({ where: { organizationId: orgId, classId } });
      if (specific) return specific;
    }
    return this.prisma.client.attendanceThreshold.findFirst({ where: { organizationId: orgId, classId: null } });
  }
}
