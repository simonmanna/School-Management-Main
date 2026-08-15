import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import type { BulkMarkAttendanceDto } from './dto.types';

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
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };

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
        counts[e.status]++;
      }
    });

    this.events.publish(EVENTS.SchoolAttendanceMarked, {
      organizationId,
      date: date.toISOString(),
      classId: dto.classId,
      present: counts.present,
      absent: counts.absent,
      late: counts.late,
    });
    return counts;
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
      byDate[key] ??= { present: 0, absent: 0, late: 0, excused: 0 };
      byDate[key][r.status]++;
    }
    return { from: start, to: end, byDate };
  }

  /** Per-student summary: attendance % over a date range. */
  async byStudent(studentProfileId: string, from: Date | string, to: Date | string) {
    const rows = await this.prisma.client.studentAttendance.findMany({
      where: { studentProfileId, date: { gte: new Date(from), lte: new Date(to) } },
    });
    const total = rows.length;
    const present = rows.filter((r) => r.status === 'present').length;
    const late = rows.filter((r) => r.status === 'late').length;
    const absent = rows.filter((r) => r.status === 'absent').length;
    const rate = total > 0 ? ((present + late * 0.5) / total) * 100 : 0;
    return { total, present, late, absent, attendanceRate: Math.round(rate * 100) / 100 };
  }
}