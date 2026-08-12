import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

function dayStart(d: Date | string): Date {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

/**
 * HrReportsService — dashboard KPIs and the cross-vertical reports that pull
 * attendance, timesheets and payroll together (attendance register, payroll
 * register, performance-review metrics).
 */
@Injectable()
export class HrReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Landing dashboard: headcount, today's attendance, open leave, last run. */
  async dashboard() {
    const orgId = this.tenant.organizationId;
    const today = dayStart(new Date());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      headcount,
      activeCount,
      todayAttendance,
      presentToday,
      lateToday,
      absentToday,
      pendingLeave,
      openPeriods,
      lastRun,
      deptCount,
    ] = await Promise.all([
      this.prisma.client.hrEmployee.count({ where: { organizationId: orgId } }),
      this.prisma.client.hrEmployee.count({
        where: { organizationId: orgId, isActive: true },
      }),
      this.prisma.client.hrAttendance.count({
        where: { organizationId: orgId, date: { gte: today, lt: tomorrow } },
      }),
      this.prisma.client.hrAttendance.count({
        where: {
          organizationId: orgId,
          date: { gte: today, lt: tomorrow },
          checkInAt: { not: null },
        },
      }),
      this.prisma.client.hrAttendance.count({
        where: {
          organizationId: orgId,
          date: { gte: today, lt: tomorrow },
          status: 'LATE',
        },
      }),
      this.prisma.client.hrAttendance.count({
        where: {
          organizationId: orgId,
          date: { gte: today, lt: tomorrow },
          status: 'ABSENT',
        },
      }),
      this.prisma.client.hrLeaveRequest.count({
        where: { organizationId: orgId, status: 'PENDING' },
      }),
      this.prisma.client.hrPayrollPeriod.count({
        where: { organizationId: orgId, status: 'OPEN' },
      }),
      this.prisma.client.hrPayrollRun.findFirst({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        include: { period: true },
      }),
      this.prisma.client.hrDepartment.count({ where: { organizationId: orgId } }),
    ]);
    return {
      headcount,
      activeCount,
      departments: deptCount,
      today: {
        attendanceRecords: todayAttendance,
        present: presentToday,
        late: lateToday,
        absent: absentToday,
      },
      pendingLeave,
      openPeriods,
      lastRun,
    };
  }

  /** Monthly headcount movement (hires per month, last 6 months). */
  async headcountTrend(months = 6) {
    const orgId = this.tenant.organizationId;
    const rows = await this.prisma.client.hrEmployee.groupBy({
      by: ['hireDate'],
      where: { organizationId: orgId, hireDate: { not: null } },
      _count: { _all: true },
    });
    const buckets: Array<{ month: string; hires: number }> = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        hires: 0,
      });
    }
    for (const r of rows) {
      if (!r.hireDate) continue;
      const key = `${r.hireDate.getFullYear()}-${String(r.hireDate.getMonth() + 1).padStart(2, '0')}`;
      const bucket = buckets.find((b) => b.month === key);
      if (bucket) bucket.hires += r._count._all;
    }
    return buckets;
  }

  /** Payroll register — one row per employee for a run, with allowances/deductions. */
  async payrollRegister(runId: string) {
    const orgId = this.tenant.organizationId;
    const run = await this.prisma.client.hrPayrollRun.findFirst({
      where: { id: runId, organizationId: orgId },
      include: {
        period: true,
        items: {
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                employeeCode: true,
                departmentId: true,
                positionId: true,
              },
            },
            allowances: true,
            deductions: true,
            payslip: true,
          },
          orderBy: [{ employee: { employeeCode: 'asc' } }],
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    const deptIds = [...new Set(run.items.map((i: any) => i.employee?.departmentId).filter(Boolean))];
    const departments = await this.prisma.client.hrDepartment.findMany({
      where: { id: { in: deptIds } },
      select: { id: true, name: true },
    });
    const deptName = new Map(departments.map((d: any) => [d.id, d.name]));
    return {
      run,
      register: run.items.map((i: any) => ({
        ...i,
        department: i.employee ? deptName.get(i.employee.departmentId) ?? null : null,
      })),
    };
  }

  /** Attendance register for a date range — compact rows for export. */
  async attendanceRegister(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const from = dayStart(query.from ?? new Date());
    from.setDate(from.getDate() - 6);
    const to = dayStart(query.to ?? new Date());
    to.setDate(to.getDate() + 1);
    const rows = await this.prisma.client.hrAttendance.findMany({
      where: {
        organizationId: orgId,
        date: { gte: from, lt: to },
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      },
      orderBy: [{ date: 'asc' }, { employee: { employeeCode: 'asc' } }],
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true, departmentId: true },
        },
      },
    });
    return { from, to, rows };
  }

  /** Annual leave overview: balance, used, remaining per employee per type. */
  async leaveOverview(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const year = Number(query.year ?? new Date().getFullYear());
    const where: any = { organizationId: orgId, year };
    if (query.employeeId) where.employeeId = query.employeeId;
    const balances = await this.prisma.client.hrLeaveBalance.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        leaveType: true,
      },
      orderBy: [{ employee: { employeeCode: 'asc' } }, { leaveType: { name: 'asc' } }],
    });
    return {
      year,
      rows: balances.map((b: any) => ({
        employeeId: b.employeeId,
        employeeCode: b.employee.employeeCode,
        name: `${b.employee.firstName}${b.employee.lastName ? ' ' + b.employee.lastName : ''}`,
        leaveType: b.leaveType.name,
        accrued: b.accruedDays,
        adjusted: b.adjustedDays,
        used: b.usedDays,
        remaining: Number(b.accruedDays) + Number(b.adjustedDays) - Number(b.usedDays),
      })),
    };
  }

  // ── Performance reviews ──────────────────────────────────────────────────

  async listReviews(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.employeeId) where.employeeId = query.employeeId;
    const [rows, total] = await Promise.all([
      this.prisma.client.hrPerformanceReview.findMany({
        where,
        orderBy: [{ reviewDate: 'desc' }],
        take: Math.min(Number(query.take ?? 50), 200),
        skip: Number(query.skip ?? 0),
        include: {
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
      }),
      this.prisma.client.hrPerformanceReview.count({ where }),
    ]);
    return { rows, total };
  }

  async createReview(dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    if (!dto.employeeId) throw new NotFoundException('employeeId is required');
    return this.prisma.client.hrPerformanceReview.create({
      data: {
        organizationId: orgId,
        employeeId: dto.employeeId,
        reviewDate: dto.reviewDate ? new Date(dto.reviewDate) : new Date(),
        periodStart: dto.periodStart ? new Date(dto.periodStart) : null,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : null,
        attendanceRate: dto.attendanceRate ?? null,
        lateRate: dto.lateRate ?? null,
        absenteeismDays: dto.absenteeismDays ?? null,
        jobsCompleted: dto.jobsCompleted ?? null,
        billableHours: dto.billableHours ?? null,
        overtimeHours: dto.overtimeHours ?? null,
        kpiScore: dto.kpiScore ?? null,
        rating: dto.rating ?? null,
        notes: dto.notes ?? null,
        status: dto.status ?? 'DRAFT',
        reviewerId: userId,
        createdBy: userId,
      },
    });
  }

  async updateReview(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrPerformanceReview.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Review not found');
    const data: any = {};
    for (const f of [
      'reviewDate', 'periodStart', 'periodEnd', 'attendanceRate', 'lateRate',
      'absenteeismDays', 'jobsCompleted', 'billableHours', 'overtimeHours',
      'kpiScore', 'rating', 'notes', 'status',
    ]) {
      if (dto[f] !== undefined) {
        data[f] = f.startsWith('period') || f === 'reviewDate' ? (dto[f] ? new Date(dto[f]) : null) : dto[f];
      }
    }
    data.updatedBy = userId;
    return this.prisma.client.hrPerformanceReview.update({ where: { id }, data });
  }

  async deleteReview(id: string) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrPerformanceReview.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Review not found');
    return this.prisma.client.hrPerformanceReview.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
  }
}
