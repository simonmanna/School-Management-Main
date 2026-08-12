import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const EVENT_TYPES = ['CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END'];
const METHODS = ['PIN', 'RFID', 'QR', 'FACE', 'FINGERPRINT', 'MANUAL', 'APP'];

/** "HH:mm" → minutes since midnight. */
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** ISO date string → org-local midnight (uses device-local midnight). */
function dayStart(d: Date | string): Date {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

/**
 * HrAttendanceService — clock events, daily attendance records and the
 * summary numbers (worked/overtime/late/early-leave) that payroll consumes.
 *
 * One HrAttendance row per employee per day (unique on org+employee+date).
 * Raw clock events live in HrAttendanceLog and are replayed into the daily
 * row by clockIn/clockOut/breakStart/breakEnd.
 */
@Injectable()
export class HrAttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  // ── Clock events ─────────────────────────────────────────────────────────

  /** Register a clock event and replay it into the daily attendance row. */
  async clock(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.employeeId) throw new BadRequestException('employeeId is required');
    if (!dto.eventType || !EVENT_TYPES.includes(dto.eventType))
      throw new BadRequestException(`Invalid eventType: ${dto.eventType}`);
    if (dto.method && !METHODS.includes(dto.method))
      throw new BadRequestException(`Invalid method: ${dto.method}`);
    const timestamp = dto.timestamp ? new Date(dto.timestamp) : new Date();

    const employee = await this.prisma.client.hrEmployee.findFirst({
      where: { id: dto.employeeId, organizationId: orgId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    return this.prisma.client.$transaction(async (tx: any) => {
      const log = await tx.hrAttendanceLog.create({
        data: {
          organizationId: orgId,
          employeeId: dto.employeeId,
          eventType: dto.eventType,
          timestamp,
          method: dto.method ?? 'MANUAL',
          deviceId: dto.deviceId ?? null,
          ipAddress: dto.ipAddress ?? null,
          gpsLat: dto.gpsLat ?? null,
          gpsLng: dto.gpsLng ?? null,
          note: dto.note ?? null,
          createdBy: userId,
        },
      });

      // Find or create today's daily row (upsert by org+employee+date).
      const date = dayStart(timestamp);
      let attendance = await tx.hrAttendance.findUnique({
        where: {
          organizationId_employeeId_date: {
            organizationId: orgId,
            employeeId: dto.employeeId,
            date,
          },
        },
      });
      if (!attendance) {
        const assignment = await tx.hrShiftAssignment.findFirst({
          where: { organizationId: orgId, employeeId: dto.employeeId, isActive: true },
          include: { shift: true },
          orderBy: { effectiveFrom: 'desc' },
        });
        attendance = await tx.hrAttendance.create({
          data: {
            organizationId: orgId,
            employeeId: dto.employeeId,
            date,
            shiftId: assignment?.shiftId ?? null,
            createdBy: userId,
          },
        });
      }

      const data: any = { updatedBy: userId };
      switch (dto.eventType) {
        case 'CHECK_IN':
          if (attendance.checkInAt && attendance.checkInAt <= timestamp && !dto.force)
            throw new BadRequestException('Already checked in today');
          data.checkInAt = timestamp;
          data.source = dto.method ?? attendance.source;
          break;
        case 'BREAK_START':
          data.breakStartAt = timestamp;
          break;
        case 'BREAK_END': {
          if (!attendance.breakStartAt)
            throw new BadRequestException('No break start recorded yet');
          const breakMinutes = Math.round(
            (timestamp.getTime() - attendance.breakStartAt.getTime()) / 60000,
          );
          data.breakStartAt = null;
          data.breakEndAt = timestamp;
          data.totalBreakMinutes = attendance.totalBreakMinutes + Math.max(0, breakMinutes);
          break;
        }
        case 'CHECK_OUT':
          if (attendance.checkOutAt && !dto.force)
            throw new BadRequestException('Already checked out today');
          data.checkOutAt = timestamp;
          break;
      }

      const updated = await tx.hrAttendance.update({
        where: { id: attendance.id },
        data,
        include: { shift: true },
      });

      await this.recompute(tx, updated.id);
      await tx.hrAttendanceLog.update({
        where: { id: log.id },
        data: { attendanceId: updated.id },
      });
      return updated;
    });
  }

  /** Recompute worked/overtime/late/early-leave for a daily row. */
  private async recompute(tx: any, attendanceId: string) {
    const row = await tx.hrAttendance.findUnique({ where: { id: attendanceId } });
    if (!row) return;
    const shift = row.shiftId
      ? await tx.hrShift.findUnique({ where: { id: row.shiftId } })
      : null;

    let workedMinutes = 0;
    let overtimeMinutes = 0;
    let lateMinutes = 0;
    let earlyLeaveMinutes = 0;
    let status = row.status;

    if (row.checkInAt && row.checkOutAt) {
      const total = Math.round(
        (row.checkOutAt.getTime() - row.checkInAt.getTime()) / 60000,
      );
      workedMinutes = Math.max(0, total - row.totalBreakMinutes);

      if (shift) {
        const shiftStart = toMinutes(shift.startTime);
        const shiftEnd = toMinutes(shift.endTime);
        const shiftLength = shiftEnd > shiftStart ? shiftEnd - shiftStart : 24 * 60 - shiftStart + shiftEnd;
        const scheduleLen = Math.max(0, shiftLength - row.totalBreakMinutes);
        const checkInMin = row.checkInAt.getHours() * 60 + row.checkInAt.getMinutes();
        if (checkInMin > shiftStart + shift.graceMinutes) {
          lateMinutes = checkInMin - shiftStart;
          if (status === 'PRESENT') status = 'LATE';
        }
        const checkOutMin = row.checkOutAt.getHours() * 60 + row.checkOutAt.getMinutes();
        if (checkOutMin < shiftEnd - shift.graceMinutes) {
          earlyLeaveMinutes = shiftEnd - checkOutMin;
          if (status === 'PRESENT') status = 'EARLY_LEAVE';
        }
        if (workedMinutes > scheduleLen) {
          overtimeMinutes = workedMinutes - scheduleLen;
          if (shift.maxOvertimeMinutes && overtimeMinutes > shift.maxOvertimeMinutes)
            overtimeMinutes = shift.maxOvertimeMinutes;
          workedMinutes = scheduleLen;
        }
      }
    } else if (row.checkInAt && !row.checkOutAt) {
      // Still on shift — count only elapsed time.
      const now = new Date();
      const elapsed = Math.round((now.getTime() - row.checkInAt.getTime()) / 60000);
      workedMinutes = Math.max(0, elapsed - row.totalBreakMinutes);
    }

    const data: any = {
      workedMinutes,
      overtimeMinutes,
      lateMinutes,
      earlyLeaveMinutes,
      status,
      updatedAt: new Date(),
    };
    await tx.hrAttendance.update({ where: { id: attendanceId }, data });
  }

  /** Mark a day as an approved leave (called by leave approval) or holiday. */
  async markLeaveDay(
    tx: any,
    employeeId: string,
    date: Date,
    notes?: string,
  ): Promise<void> {
    const orgId = this.tenant.organizationId;
    const dateStart = dayStart(date);
    const existing = await tx.hrAttendance.findUnique({
      where: {
        organizationId_employeeId_date: {
          organizationId: orgId,
          employeeId,
          date: dateStart,
        },
      },
    });
    if (existing) {
      await tx.hrAttendance.update({
        where: { id: existing.id },
        data: { status: 'ON_LEAVE', notes: notes ?? existing.notes },
      });
      return;
    }
    await tx.hrAttendance.create({
      data: {
        organizationId: orgId,
        employeeId,
        date: dateStart,
        status: 'ON_LEAVE',
        notes: notes ?? null,
      },
    });
  }

  // ── Query ────────────────────────────────────────────────────────────────

  async listAttendance(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    if (query.from) {
      where.date = { ...(where.date ?? {}), gte: dayStart(query.from) };
    }
    if (query.to) {
      const to = dayStart(query.to);
      to.setDate(to.getDate() + 1);
      where.date = { ...(where.date ?? {}), lt: to };
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.hrAttendance.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: Math.min(Number(query.take ?? 50), 200),
        skip: Number(query.skip ?? 0),
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          shift: true,
        },
      }),
      this.prisma.client.hrAttendance.count({ where }),
    ]);
    return { rows, total };
  }

  async getAttendance(id: string) {
    const orgId = this.tenant.organizationId;
    const row = await this.prisma.client.hrAttendance.findFirst({
      where: { id, organizationId: orgId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        shift: true,
        logs: { orderBy: { timestamp: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException('Attendance record not found');
    return row;
  }

  async listLogs(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.eventType) where.eventType = query.eventType;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrAttendanceLog.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }],
        take: Math.min(Number(query.take ?? 50), 200),
        skip: Number(query.skip ?? 0),
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
      }),
      this.prisma.client.hrAttendanceLog.count({ where }),
    ]);
    return { rows, total };
  }

  /** Attendance summary for a date range, one row per employee. */
  async summary(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const from = dayStart(query.from ?? new Date());
    from.setDate(from.getDate() - 30);
    const to = dayStart(query.to ?? new Date());
    to.setDate(to.getDate() + 1);

    const rows = await this.prisma.client.hrAttendance.groupBy({
      by: ['employeeId'],
      where: {
        organizationId: orgId,
        date: { gte: from, lt: to },
        deletedAt: null,
      },
      _count: { _all: true },
      _sum: { workedMinutes: true, overtimeMinutes: true, lateMinutes: true },
    });
    const employees = await this.prisma.client.hrEmployee.findMany({
      where: { organizationId: orgId, deletedAt: null, isActive: true },
      select: { id: true, firstName: true, lastName: true, employeeCode: true, departmentId: true },
    });
    const deptIds = [...new Set(employees.map((e: any) => e.departmentId).filter(Boolean))];
    const departments = await this.prisma.client.hrDepartment.findMany({
      where: { id: { in: deptIds } },
      select: { id: true, name: true },
    });
    const deptName = new Map(departments.map((d: any) => [d.id, d.name]));

    return {
      from,
      to,
      employees: employees.map((e: any) => {
        const agg = rows.find((r: any) => r.employeeId === e.id);
        return {
          employeeId: e.id,
          employeeCode: e.employeeCode,
          name: `${e.firstName}${e.lastName ? ' ' + e.lastName : ''}`,
          department: deptName.get(e.departmentId) ?? null,
          daysPresent: agg?._count._all ?? 0,
          workedMinutes: agg?._sum.workedMinutes ?? 0,
          overtimeMinutes: agg?._sum.overtimeMinutes ?? 0,
          lateMinutes: agg?._sum.lateMinutes ?? 0,
        };
      }),
    };
  }

  /** Bulk create/edit a manual attendance day (admin fix-up). */
  async upsertManual(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.employeeId || !dto.date)
      throw new BadRequestException('employeeId and date are required');
    const date = dayStart(dto.date);
    const existing = await this.prisma.client.hrAttendance.findUnique({
      where: {
        organizationId_employeeId_date: {
          organizationId: orgId,
          employeeId: dto.employeeId,
          date,
        },
      },
    });
    if (existing) {
      return this.prisma.client.hrAttendance.update({
        where: { id: existing.id },
        data: {
          checkInAt: dto.checkInAt ? new Date(dto.checkInAt) : existing.checkInAt,
          checkOutAt: dto.checkOutAt ? new Date(dto.checkOutAt) : existing.checkOutAt,
          status: dto.status ?? existing.status,
          notes: dto.notes ?? existing.notes,
          updatedBy: userId,
        },
      });
    }
    return this.prisma.client.hrAttendance.create({
      data: {
        organizationId: orgId,
        employeeId: dto.employeeId,
        date,
        checkInAt: dto.checkInAt ? new Date(dto.checkInAt) : null,
        checkOutAt: dto.checkOutAt ? new Date(dto.checkOutAt) : null,
        status: dto.status ?? 'PRESENT',
        source: dto.source ?? 'MANUAL',
        notes: dto.notes ?? null,
        createdBy: userId,
      },
    });
  }
}
