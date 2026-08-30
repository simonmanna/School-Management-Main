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
    const [students, staff, teachers, campuses, classes, sections] = await Promise.all([
      this.prisma.client.studentProfile.count({ where: { status: 'active' } }),
      this.prisma.client.staffProfile.count({ where: { status: 'active' } }),
      // The teaching subset. A "teacher : pupil ratio" computed against all
      // active staff counts cooks, drivers and the bursary, which flatters the
      // number badly in a boarding school.
      this.prisma.client.staffProfile.count({ where: { status: 'active', staffCategory: 'teaching' } }),
      this.prisma.client.campus.count({ where: { isActive: true } }),
      this.prisma.client.schoolClass.count(),
      this.prisma.client.section.count(),
    ]);
    const outstanding = await this.outstandingFeesTotal();
    return { students, staff, teachers, campuses, classes, sections, outstandingFees: outstanding };
  }

  /**
   * Academic headline for the current term.
   *
   * Reads the assessment spine. It used to count `GradeEntry`, which the B6
   * migration sealed read-only — so from the cutover onward the pass rate was
   * frozen at whatever the legacy table happened to hold and could never move
   * again, however many marks were entered.
   *
   * Also returns the work actually outstanding, because a headteacher opening
   * the dashboard needs to know what is waiting on someone, not only what has
   * already been signed off.
   */
  async academicDashboard() {
    const currentTerm = await this.prisma.client.term.findFirst({ where: { isCurrent: true } });
    const termId = currentTerm?.id;

    const scope = termId ? { termId, deletedAt: null, assessment: { deletedAt: null } } : null;
    if (!scope) {
      return {
        termId: null, termName: null,
        totalMarks: 0, approved: 0, passed: 0, passRate: 0,
        awaitingApproval: 0, draft: 0, rejected: 0,
      };
    }

    const [totalMarks, approved, passed, awaitingApproval, draft, rejected] = await Promise.all([
      this.prisma.client.studentAssessment.count({ where: { ...scope, effectiveScore: { not: null } } }),
      this.prisma.client.studentAssessment.count({ where: { ...scope, approvalStatus: 'approved' } }),
      this.prisma.client.studentAssessment.count({
        where: { ...scope, approvalStatus: 'approved', percentage: { gte: 50 } },
      }),
      this.prisma.client.studentAssessment.count({ where: { ...scope, approvalStatus: 'submitted' } }),
      this.prisma.client.studentAssessment.count({
        where: { ...scope, approvalStatus: 'draft', effectiveScore: { not: null } },
      }),
      this.prisma.client.studentAssessment.count({ where: { ...scope, approvalStatus: 'rejected' } }),
    ]);

    return {
      termId,
      termName: currentTerm?.name ?? null,
      totalMarks,
      approved,
      passed,
      passRate: approved > 0 ? Math.round((passed / approved) * 100) : 0,
      awaitingApproval,
      draft,
      rejected,
    };
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
    sourceType: { in: ['school_fee', 'school_penalty', 'library_fine', 'school_meal'] },
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

  /**
   * Top performers this term, from a PUBLISHED result set.
   *
   * Two changes from the version this replaces. It read `GradeEntry`, sealed
   * read-only since B6, so it could only ever surface pre-cutover pupils. And
   * it ranked on a mean of raw grade points, which is not the school's own
   * ranking — `StudentTermResult` already carries the rank the result run
   * computed under the school's grading policy, so use that rather than
   * inventing a second answer to "who came first".
   */
  async topPerformers(limit = 10) {
    const currentTerm = await this.prisma.client.term.findFirst({ where: { isCurrent: true } });
    if (!currentTerm) return [];

    const rows = await this.prisma.client.studentTermResult.findMany({
      where: { termId: currentTerm.id, resultSet: { status: 'published' } },
      include: { resultSet: true },
      orderBy: [{ resultSet: { revision: 'desc' } }],
    });

    // One row per pupil — the newest published revision wins.
    const seen = new Set<string>();
    const latest = rows
      .filter((r: any) => {
        if (seen.has(r.studentProfileId)) return false;
        seen.add(r.studentProfileId);
        return true;
      })
      .filter((r: any) => r.classRank != null)
      .sort((a: any, b: any) => Number(a.classRank) - Number(b.classRank))
      .slice(0, limit);

    // StudentTermResult carries no relation to the pupil (it is keyed by id), so
    // the names come from a second, bounded lookup.
    const profiles = latest.length
      ? await this.prisma.client.studentProfile.findMany({
          where: { id: { in: latest.map((r: any) => r.studentProfileId) } },
          include: { partner: true, currentClass: true },
        })
      : [];
    const byId = new Map(profiles.map((p: any) => [p.id, p]));

    return latest.map((r: any) => {
      const p: any = byId.get(r.studentProfileId);
      return {
        id: r.studentProfileId,
        admissionNo: p?.admissionNo ?? '',
        name: p?.partner?.name ?? null,
        className: p?.currentClass?.name ?? null,
        classRank: r.classRank != null ? Number(r.classRank) : null,
        gpa: r.gpa != null ? Number(r.gpa) : null,
        meanPercent: r.meanPercent != null ? Number(r.meanPercent) : null,
        division: r.division ?? null,
      };
    });
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