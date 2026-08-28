import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import type { MarkStaffAttendanceDto } from './dto.types';

/**
 * Staff attendance — school-facing API over the CANONICAL `HrAttendance` store.
 *
 * There used to be two staff-attendance tables at the same grain
 * (`@@unique([organizationId, <person>, date])`): this module's
 * `StaffAttendance` and HR's `HrAttendance`. `HrAttendance` is a strict
 * superset — shift link, worked/overtime/late/early minutes, source, GPS, soft
 * delete, and per-event logs — and, decisively, it is the one payroll reads.
 * The school copy could never feed a pay run, so a school marking attendance
 * produced numbers payroll ignored.
 *
 * Phase 6 makes `HrAttendance` the single store. This service keeps its
 * existing routes and DTO so the frontend is unaffected.
 *
 * ── Transition ──────────────────────────────────────────────────────────────
 * A write lands in `HrAttendance` as soon as the staff member is bridged to an
 * `HrEmployee` (Phase 2). Staff who are not bridged yet still write to the
 * legacy table, because refusing would break attendance-taking for an org
 * mid-reconciliation. Reads merge both, newest store winning, so the screen is
 * correct throughout. Once the reconciliation screen reports zero `schoolOnly`
 * staff, the legacy table stops receiving rows and can be dropped.
 */

/** `StaffAttendance.status` (free string) → `HrAttendanceStatus` (enum). */
const STATUS_TO_HR: Record<string, string> = {
  present: 'PRESENT',
  absent: 'ABSENT',
  late: 'LATE',
  leave: 'ON_LEAVE',
  off_duty: 'OFF_DAY',
};
/** The inverse, for presenting HR rows through the school-shaped API. */
const STATUS_FROM_HR: Record<string, string> = {
  PRESENT: 'present',
  ABSENT: 'absent',
  LATE: 'late',
  EARLY_LEAVE: 'late',
  ON_LEAVE: 'leave',
  OFF_DAY: 'off_duty',
};

@Injectable()
export class StaffAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Map staff profile ids to their bridged HR employee ids, in one query.
   * Unbridged staff are simply absent from the map.
   */
  private async employeeIdsFor(staffProfileIds: string[]): Promise<Map<string, string>> {
    const organizationId = this.tenant.organizationId;
    if (staffProfileIds.length === 0) return new Map();

    const profiles = await this.prisma.client.staffProfile.findMany({
      where: { organizationId, id: { in: staffProfileIds }, deletedAt: null },
      select: { id: true, partnerId: true },
    });
    const partnerIds = profiles.map((p: any) => p.partnerId).filter(Boolean);
    if (partnerIds.length === 0) return new Map();

    const employees = await this.prisma.client.hrEmployee.findMany({
      where: { organizationId, partnerId: { in: partnerIds }, deletedAt: null },
      select: { id: true, partnerId: true },
    });
    const empByPartner = new Map(employees.map((e: any) => [e.partnerId, e.id]));

    const out = new Map<string, string>();
    for (const p of profiles as any[]) {
      const empId = p.partnerId ? empByPartner.get(p.partnerId) : undefined;
      if (empId) out.set(p.id, empId as string);
    }
    return out;
  }

  async mark(dto: MarkStaffAttendanceDto) {
    const organizationId = this.tenant.organizationId;
    const markedById = this.tenant.userId ?? null;
    const date = new Date(dto.date);
    const bridged = await this.employeeIdsFor(dto.entries.map((e) => e.staffProfileId));

    return this.prisma.client.$transaction(async (tx: any) => {
      const results: any[] = [];
      let legacy = 0;

      for (const e of dto.entries) {
        const employeeId = bridged.get(e.staffProfileId);
        const checkInAt = e.checkIn ? new Date(e.checkIn) : null;
        const checkOutAt = e.checkOut ? new Date(e.checkOut) : null;

        if (employeeId) {
          // Canonical store. Payroll reads this.
          const row = await tx.hrAttendance.upsert({
            where: {
              organizationId_employeeId_date: { organizationId, employeeId, date } as any,
            },
            create: {
              organizationId,
              employeeId,
              date,
              status: STATUS_TO_HR[e.status] ?? 'PRESENT',
              checkInAt,
              checkOutAt,
              source: 'MANUAL',
              notes: e.notes ?? null,
              createdBy: markedById,
            },
            update: {
              status: STATUS_TO_HR[e.status] ?? 'PRESENT',
              checkInAt,
              checkOutAt,
              notes: e.notes ?? null,
              updatedBy: markedById,
            },
          });
          results.push(row);
          continue;
        }

        // Not bridged yet — keep the legacy row so attendance-taking keeps
        // working during reconciliation.
        const row = await tx.staffAttendance.upsert({
          where: {
            organizationId_staffProfileId_date: {
              organizationId,
              staffProfileId: e.staffProfileId,
              date,
            } as any,
          },
          create: {
            organizationId,
            staffProfileId: e.staffProfileId,
            date,
            status: e.status,
            checkIn: checkInAt,
            checkOut: checkOutAt,
            notes: e.notes ?? null,
            markedById,
          },
          update: {
            status: e.status,
            checkIn: checkInAt,
            checkOut: checkOutAt,
            notes: e.notes ?? null,
            markedById,
          },
        });
        results.push(row);
        legacy++;
      }

      return {
        count: results.length,
        /** How many rows could not reach payroll because the person is unbridged. */
        unbridged: legacy,
        results,
      };
    });
  }

  /** One day's staff attendance, merged across the canonical and legacy stores. */
  async byDate(date: Date | string) {
    const organizationId = this.tenant.organizationId;
    const day = new Date(date);

    const profiles = await this.prisma.client.staffProfile.findMany({
      where: { organizationId, deletedAt: null },
      select: {
        id: true,
        employeeNo: true,
        partnerId: true,
        department: true,
        position: true,
        partner: { select: { name: true } },
      },
    });
    const byPartner = new Map(profiles.filter((p: any) => p.partnerId).map((p: any) => [p.partnerId, p]));

    const hrRows = await this.prisma.client.hrAttendance.findMany({
      where: { organizationId, date: day, deletedAt: null },
      include: { employee: { select: { id: true, employeeCode: true, partnerId: true } } },
    });

    const merged = hrRows.map((r: any) => {
      const profile = r.employee?.partnerId ? byPartner.get(r.employee.partnerId) : undefined;
      return {
        id: r.id,
        staffProfileId: profile?.id ?? null,
        date: r.date,
        status: STATUS_FROM_HR[r.status] ?? 'present',
        checkIn: r.checkInAt,
        checkOut: r.checkOutAt,
        notes: r.notes,
        source: 'hr',
        staff: profile ?? null,
      };
    });

    const legacyRows = await this.prisma.client.staffAttendance.findMany({
      where: { organizationId, date: day },
      include: { staff: { include: { department: true, position: true, partner: { select: { name: true } } } } },
    });
    const covered = new Set(merged.map((m: any) => m.staffProfileId).filter(Boolean));
    for (const r of legacyRows as any[]) {
      if (covered.has(r.staffProfileId)) continue; // canonical wins
      merged.push({
        id: r.id,
        staffProfileId: r.staffProfileId,
        date: r.date,
        status: r.status,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        notes: r.notes,
        source: 'legacy',
        staff: r.staff,
      });
    }

    return merged.sort((a: any, b: any) =>
      (a.staff?.employeeNo ?? '').localeCompare(b.staff?.employeeNo ?? ''),
    );
  }

  /** One staff member's attendance over a range, canonical first. */
  async byStaff(staffProfileId: string, from: Date, to: Date) {
    const organizationId = this.tenant.organizationId;
    const bridged = await this.employeeIdsFor([staffProfileId]);
    const employeeId = bridged.get(staffProfileId);

    if (employeeId) {
      const rows = await this.prisma.client.hrAttendance.findMany({
        where: { organizationId, employeeId, date: { gte: from, lte: to }, deletedAt: null },
        orderBy: { date: 'asc' },
      });
      if (rows.length > 0) {
        return rows.map((r: any) => ({
          id: r.id,
          staffProfileId,
          date: r.date,
          status: STATUS_FROM_HR[r.status] ?? 'present',
          checkIn: r.checkInAt,
          checkOut: r.checkOutAt,
          workedMinutes: r.workedMinutes,
          overtimeMinutes: r.overtimeMinutes,
          lateMinutes: r.lateMinutes,
          notes: r.notes,
          source: 'hr',
        }));
      }
    }

    const legacy = await this.prisma.client.staffAttendance.findMany({
      where: { organizationId, staffProfileId, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });
    return legacy.map((r: any) => ({ ...r, source: 'legacy' }));
  }
}
