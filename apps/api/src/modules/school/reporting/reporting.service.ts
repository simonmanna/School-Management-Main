import { Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { SchoolFinanceQueryService } from '../fees/school-finance-query.service';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';

/**
 * ReportingService — aggregation queries that power the four school dashboards:
 *   - Admin (student count, revenue, outstanding fees, attendance, performance)
 *   - Academic (pass rate, subject performance, top 10, at-risk)
 *   - Finance (collections this month / term, revenue vs budget, outstanding by class)
 *   - Operational (staff count, teacher workload, enrollment trend)
 *
 * All queries are org-scoped via the tenancy extension. Money figures are NOT
 * computed here — they delegate to SchoolFinanceQueryService, the single site of
 * the AR identity.
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    // Every money figure on these dashboards routes through the canonical query
    // service. Re-deriving one here is what let the dashboard and the statement
    // disagree (FINANCIAL_INVARIANTS.md, "cached projection, never an input").
    private readonly finance: SchoolFinanceQueryService,
    private readonly placements: PlacementLookupService,
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
    // The admin dashboard is open to every staff role; the fee total is not.
    const perms = this.tenant.permissions;
    const mayReadFees = perms.includes('*') || perms.includes(PERMISSIONS.school.readFees);
    const outstanding = mayReadFees ? await this.outstandingFeesTotal() : null;
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
    const [collectionsThisMonth, totals] = await Promise.all([
      // Collections = allocated money, not raw Payment rows. A `Payment` may be
      // cancelled, or sit unallocated; PaymentAllocation is the authoritative
      // record of value actually applied to a fee document.
      this.prisma.client.paymentAllocation.aggregate({
        where: {
          status: { not: 'reversed' },
          payment: { direction: 'inbound', status: { not: 'cancelled' }, paymentDate: { gte: startOfMonth } },
        },
        _sum: { amount: true },
      }),
      this.finance.outstandingTotal(),
    ]);
    return {
      collectionsThisMonth: Number(collectionsThisMonth._sum.amount ?? 0),
      outstanding: totals.outstanding,
      creditBalance: totals.creditBalance,
      billed: totals.billed,
      owingCount: totals.owingCount,
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

  /**
   * Total outstanding across the school.
   *
   * Delegates to SchoolFinanceQueryService. It used to sum
   * `Document.amountResidual` here directly, which FINANCIAL_INVARIANTS.md names
   * as a CACHED PROJECTION and never an independent input — the dashboard could
   * therefore print a different figure from the pupil's own statement whenever
   * the projection had drifted, which is precisely the failure
   * `reconcileCachedProjections()` exists to detect.
   *
   * The canonical identity is: billed − collected − waived − credited + adjusted.
   */
  async outstandingFeesTotal(): Promise<number> {
    const totals = await this.finance.outstandingTotal();
    return totals.outstanding;
  }

  /** Outstanding fees grouped by class, from the canonical per-pupil balance. */
  async outstandingByClass() {
    // Grouped by the class each pupil is placed in (ADR-027). A learner with no
    // class at all is left out, as before.
    const placedAll = await this.placements.attach(
      await this.prisma.client.studentProfile.findMany({
        where: { status: 'active', deletedAt: null },
        select: { id: true },
      }),
    );
    const students = placedAll.filter((s) => s.placement);
    if (students.length === 0) return [];
    const classIdsForNames = [...new Set(students.map((s) => s.placement!.classId))];
    const classNameById = new Map<string, string>(
      (
        await this.prisma.client.schoolClass.findMany({
          where: { id: { in: classIdsForNames } },
          select: { id: true, name: true },
        })
      ).map((c) => [c.id, c.name]),
    );

    const balances = await this.finance.studentBalances(students.map((s) => s.id));

    const byClass = new Map<string, { className: string; outstanding: number; studentCount: number; owingCount: number }>();
    for (const s of students) {
      const classId = s.placement!.classId;
      if (!byClass.has(classId)) {
        byClass.set(classId, {
          className: classNameById.get(classId) ?? classId,
          outstanding: 0,
          studentCount: 0,
          owingCount: 0,
        });
      }
      const bucket = byClass.get(classId)!;
      bucket.studentCount += 1;
      const balance = balances.get(s.id)?.balance ?? 0;
      // Only debit balances are "outstanding" — a pupil in credit must not pay
      // down a classmate's arrears in the total.
      if (balance > 0) {
        bucket.outstanding += balance;
        bucket.owingCount += 1;
      }
    }

    return [...byClass.entries()].map(([classId, v]) => ({
      classId,
      ...v,
      outstanding: Number(v.outstanding.toFixed(2)),
    }));
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
          include: { partner: true },
        })
      : [];
    const byId = new Map(profiles.map((p: any) => [p.id, p]));
    // A results figure names the class FROZEN on the result row — the class the
    // pupil sat the term in — never the class they have since moved to.
    const resultClassIds = [...new Set(latest.map((r: any) => r.classId).filter(Boolean))] as string[];
    const resultClassName = new Map<string, string>(
      resultClassIds.length
        ? (
            await this.prisma.client.schoolClass.findMany({
              where: { id: { in: resultClassIds } },
              select: { id: true, name: true },
            })
          ).map((c) => [c.id, c.name])
        : [],
    );

    return latest.map((r: any) => {
      const p: any = byId.get(r.studentProfileId);
      return {
        id: r.studentProfileId,
        admissionNo: p?.admissionNo ?? '',
        name: p?.partner?.name ?? null,
        className: r.classId ? (resultClassName.get(r.classId) ?? null) : null,
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