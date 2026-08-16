import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import type { BulkMarkAttendanceDto, CorrectAttendanceDto } from './dto.types';

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
  ) {}

  async mark(dto: BulkMarkAttendanceDto) {
    const organizationId = this.tenant.organizationId;
    const date = new Date(dto.date);
    const periodId = dto.periodId ?? null;
    const counts: Record<string, number> = { present: 0, absent: 0, late: 0, excused: 0, early_departure: 0, unexcused: 0 };

    // P5: periodId is nullable, so the (student, date, periodId) key can't be a
    // Prisma compound-unique upsert (null keys aren't upsertable). Find-then-
    // create/update instead; the DB partial unique indexes are the safety net.
    await this.prisma.client.$transaction(async (tx: any) => {
      for (const e of dto.entries) {
        const existing = await tx.studentAttendance.findFirst({
          where: { organizationId, studentProfileId: e.studentProfileId, date, periodId },
          select: { id: true },
        });
        const data = {
          classId: dto.classId,
          sectionId: dto.sectionId ?? null,
          status: e.status,
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
      present: counts.present,
      absent: counts.absent,
      late: counts.late,
      // Per-entry detail so the notifications subscriber can alert guardians.
      entries: dto.entries.map((e) => ({
        studentProfileId: e.studentProfileId,
        status: e.status,
        minutesLate: e.minutesLate ?? 0,
        earlyDepartureMinutes: e.earlyDepartureMinutes ?? null,
      })),
    });
    return counts;
  }

  /** Correct a single attendance record (audit-logged). */
  async correct(id: string, dto: CorrectAttendanceDto) {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.client.studentAttendance.findFirst({ where: { id, organizationId } });
    if (!existing) throw new NotFoundException(`Attendance ${id} not found`);
    const updated = await this.prisma.client.studentAttendance.update({
      where: { id },
      data: {
        status: dto.status,
        minutesLate: dto.minutesLate ?? 0,
        earlyDepartureMinutes: dto.earlyDepartureMinutes ?? null,
        reason: dto.reason ?? existing.reason,
        markedById: this.tenant.userId ?? null,
      },
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
      include: { studentProfile: { include: { partner: true } } },
      orderBy: { studentProfile: { admissionNo: 'asc' } } as any,
    });
  }

  /** Reports: weekly summary (Mon..Sun) for a class. */
  async weekly(classId: string, weekStart: Date | string) {
    const start = new Date(weekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const rows = await this.prisma.client.studentAttendance.findMany({
      where: { classId, date: { gte: start, lt: end } },
    });
    // Bucket by date for the UI grid.
    const byDate: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      const key = r.date.toISOString().slice(0, 10);
      byDate[key] ??= { present: 0, absent: 0, late: 0, excused: 0, early_departure: 0, unexcused: 0 };
      byDate[key][r.status] = (byDate[key][r.status] ?? 0) + 1;
    }
    return { from: start, to: end, byDate };
  }

  /** Per-student summary: attendance % over a date range. */
  async byStudent(studentProfileId: string, from: Date | string, to: Date | string) {
    const start = from ? new Date(from) : new Date(Date.now() - 90 * 86400000);
    const end = to ? new Date(to) : new Date();
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid from/to date');
    }
    const rows = await this.prisma.client.studentAttendance.findMany({
      where: { studentProfileId, date: { gte: start, lte: end } },
    });
    const total = rows.length;
    const present = rows.filter((r) => r.status === 'present').length;
    const late = rows.filter((r) => r.status === 'late').length;
    const absent = rows.filter((r) => r.status === 'absent' || r.status === 'unexcused').length;
    const rate = total > 0 ? ((present + late * 0.5) / total) * 100 : 0;
    return { total, present, late, absent, attendanceRate: Math.round(rate * 100) / 100 };
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
    const agg: Record<string, { total: number; good: number }> = {};
    for (const r of rows) {
      agg[r.studentProfileId] ??= { total: 0, good: 0 };
      agg[r.studentProfileId].total++;
      if (r.status === 'present' || r.status === 'late') agg[r.studentProfileId].good++;
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
