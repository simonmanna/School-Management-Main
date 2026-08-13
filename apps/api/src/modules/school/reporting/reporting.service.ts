import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/**
 * ReportingService — aggregation queries that power the four school dashboards:
 *   - Admin (student count, revenue, outstanding fees, attendance, performance)
 *   - Academic (pass rate, subject performance, top 10, at-risk)
 *   - Finance (collections this month / term, revenue vs budget, outstanding by class)
 *   - Operational (staff count, teacher workload, enrollment trend)
 *
 * All queries are org-scoped via the tenancy extension.
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Single call that powers the admin dashboard tile. */
  async adminDashboard() {
    const [students, staff, campuses, classes, sections] = await Promise.all([
      this.prisma.client.studentProfile.count({ where: { status: 'active' } }),
      this.prisma.client.staffProfile.count({ where: { status: 'active' } }),
      this.prisma.client.campus.count({ where: { isActive: true } }),
      this.prisma.client.schoolClass.count(),
      this.prisma.client.section.count(),
    ]);
    const outstanding = await this.outstandingFeesTotal();
    return { students, staff, campuses, classes, sections, outstandingFees: outstanding };
  }

  async academicDashboard() {
    const totalGrades = await this.prisma.client.gradeEntry.count({ where: { status: 'approved' } });
    const passed = await this.prisma.client.gradeEntry.count({
      where: { status: 'approved', gradePoint: { gte: 2.0 } },
    });
    const passRate = totalGrades > 0 ? Math.round((passed / totalGrades) * 100) : 0;
    return { totalGrades, passed, passRate };
  }

  async financeDashboard() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [collectionsThisMonth, outstanding] = await Promise.all([
      this.prisma.client.payment.aggregate({
        where: { direction: 'inbound', paymentDate: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.outstandingFeesTotal(),
    ]);
    return {
      collectionsThisMonth: Number(collectionsThisMonth._sum.amount ?? 0),
      outstanding,
    };
  }

  async operationalDashboard() {
    const [staff, totalAssignments] = await Promise.all([
      this.prisma.client.staffProfile.count({ where: { status: 'active' } }),
      this.prisma.client.teacherAssignment.count(),
    ]);
    const avgPeriods = totalAssignments > 0
      ? (await this.prisma.client.teacherAssignment.aggregate({ _avg: { periodsPerWeek: true } }))._avg.periodsPerWeek ?? 0
      : 0;
    return { staff, teacherAssignments: totalAssignments, avgPeriodsPerWeek: Math.round(Number(avgPeriods) * 100) / 100 };
  }

  // Every school-sourced AR document a student still owes on. The old filter was
  // paymentStatus in ['partial','paid'], which excluded 'not_paid' — i.e. a
  // freshly-billed, entirely-unpaid invoice (the largest arrears) was dropped
  // and 'paid' (zero residual) added nothing. The open set is
  // ['not_paid','partial'] with a positive residual.
  private static readonly OPEN_FEE_WHERE: Prisma.DocumentWhereInput = {
    sourceType: { in: ['school_fee', 'school_penalty', 'library_fine'] },
    paymentStatus: { in: ['not_paid', 'partial'] },
    amountResidual: { gt: 0 },
  };

  /** Total outstanding across all open fee invoices. */
  async outstandingFeesTotal(): Promise<number> {
    const docs = await this.prisma.client.document.findMany({
      where: ReportingService.OPEN_FEE_WHERE,
      select: { amountResidual: true },
    });
    return docs.reduce((s, d) => s + Number(d.amountResidual), 0);
  }

  /** Outstanding fees grouped by class. */
  async outstandingByClass() {
    const docs = await this.prisma.client.document.findMany({
      where: ReportingService.OPEN_FEE_WHERE,
      select: { partnerId: true, amountResidual: true },
    });
    if (docs.length === 0) return [];

    // Resolve partner → class in one query instead of two per document.
    const partnerIds = [...new Set(docs.map((d) => d.partnerId).filter(Boolean) as string[])];
    const students = await this.prisma.client.studentProfile.findMany({
      where: { partnerId: { in: partnerIds } },
      include: { currentClass: { include: { gradeLevel: true } } },
    });
    const classByPartner = new Map(students.map((s) => [s.partnerId, s.currentClass]));

    const byClass: Record<string, { className: string; outstanding: number; studentCount: number }> = {};
    for (const d of docs) {
      const c = d.partnerId ? classByPartner.get(d.partnerId) : null;
      if (!c) continue;
      if (!byClass[c.id]) byClass[c.id] = { className: c.name, outstanding: 0, studentCount: 0 };
      byClass[c.id].outstanding += Number(d.amountResidual);
    }

    const counts = await this.prisma.client.studentProfile.groupBy({
      by: ['currentClassId'],
      where: { currentClassId: { in: Object.keys(byClass) }, status: 'active' },
      _count: true,
    });
    for (const gc of counts) {
      if (gc.currentClassId && byClass[gc.currentClassId]) byClass[gc.currentClassId].studentCount = gc._count;
    }
    return Object.entries(byClass).map(([id, v]) => ({ classId: id, ...v }));
  }

  /** Attendance summary (today) for the admin dashboard. */
  async attendanceToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const counts = await this.prisma.client.studentAttendance.groupBy({
      by: ['status'],
      where: { date: { gte: today, lt: tomorrow } },
      _count: true,
    });
    return counts.reduce(
      (acc, c) => ({ ...acc, [c.status]: c._count }),
      { present: 0, absent: 0, late: 0, excused: 0 } as Record<string, number>,
    );
  }

  /** Top performers (by GPA in current term). */
  async topPerformers(limit = 10) {
    const currentTerm = await this.prisma.client.term.findFirst({ where: { isCurrent: true } });
    if (!currentTerm) return [];
    const entries = await this.prisma.client.gradeEntry.findMany({
      where: { examSchedule: { exam: { termId: currentTerm.id } }, status: 'approved' },
      include: { studentProfile: true, examSchedule: { include: { exam: { include: { examType: true } } } } },
    });
    const byStudent: Record<string, { id: string; admissionNo: string; gpa: number; count: number }> = {};
    for (const e of entries) {
      const sid = e.studentProfileId;
      if (!byStudent[sid]) byStudent[sid] = { id: sid, admissionNo: e.studentProfile.admissionNo, gpa: 0, count: 0 };
      byStudent[sid].gpa += Number(e.gradePoint ?? 0);
      byStudent[sid].count += 1;
    }
    return Object.values(byStudent)
      .map((s) => ({ ...s, gpa: s.count > 0 ? Math.round((s.gpa / s.count) * 100) / 100 : 0 }))
      .sort((a, b) => b.gpa - a.gpa)
      .slice(0, limit);
  }

  /** Daily collections — last 30 days. */
  async dailyCollections(days = 30) {
    const from = new Date();
    from.setDate(from.getDate() - days);
    const payments = await this.prisma.client.payment.findMany({
      where: { direction: 'inbound', paymentDate: { gte: from } },
      select: { paymentDate: true, amount: true },
    });
    const byDate: Record<string, number> = {};
    for (const p of payments) {
      const k = p.paymentDate.toISOString().slice(0, 10);
      byDate[k] = (byDate[k] ?? 0) + Number(p.amount);
    }
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date, total }));
  }
}