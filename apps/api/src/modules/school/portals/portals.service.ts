import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AttendanceStatusConfigService } from '../attendance/attendance-status-config.service';
import { POSTED_FEE_WHERE } from '../fees/fee-document.constants';

/**
 * PortalsService — composes existing services to build role-specific dashboards.
 *
 * Parent: children, attendance, grades, fees, announcements.
 * Student: timetable, attendance, grades, assignments, announcements.
 * Teacher: classes, attendance, grade entry, assignments, schedule.
 *
 * These are pure read-side aggregations — no new tables, no new state.
 */
@Injectable()
export class PortalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly statusConfig: AttendanceStatusConfigService,
  ) {}

  /**
   * Parent portal — given a parent's contact id (from auth context in production),
   * return their children's overview.
   */
  async parentDashboard(studentProfileIds: string[]) {
    const students = await this.prisma.client.studentProfile.findMany({
      where: { id: { in: studentProfileIds } },
      include: {
        currentClass: { include: { gradeLevel: true } },
        currentSection: true,
      },
    });

    // For each student, fetch latest attendance, grades, fees.
    const result = [];
    for (const s of students) {
      const [attendance, fees, announcements] = await Promise.all([
        this.recentAttendance(s.id),
        this.feeBalance(s.partnerId),
        this.recentAnnouncements(s.currentClassId),
      ]);
      result.push({ student: s, attendance, fees, announcements });
    }
    return result;
  }

  async studentDashboard(studentProfileId: string) {
    const profile = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId },
      include: { currentClass: { include: { gradeLevel: true } } },
    });
    if (!profile) return null;

    const [timetable, attendance, grades, assignments, announcements, publishedResults, certificates] = await Promise.all([
      this.studentTimetable(profile.currentClassId, profile.id),
      this.recentAttendance(studentProfileId),
      this.recentGrades(studentProfileId),
      this.studentAssignments(studentProfileId),
      this.recentAnnouncements(profile.currentClassId),
      this.publishedResults(studentProfileId),
      this.studentCertificates(studentProfileId),
    ]);
    // A8: published results + certificates read the result spine, not raw marks.
    return { profile, timetable, attendance, grades, assignments, announcements, publishedResults, certificates };
  }

  async teacherDashboard(teacherPartnerId: string) {
    const classes = await this.prisma.client.teacherAssignment.findMany({
      where: { teacherPartnerId },
      include: { subject: true, schoolClass: { include: { gradeLevel: true } }, section: true },
    });

    // Today's schedule
    const today = new Date();
    const dayOfWeek = ((today.getDay() + 6) % 7) + 1; // JS Sun=0 → ISO Mon=1
    const todaySchedule = await this.prisma.client.timetableSlot.findMany({
      where: {
        teacherPartnerId,
        dayOfWeek,
      },
      include: { subject: true, schoolClass: true, period: true },
      orderBy: { period: { order: 'asc' } } as any,
    });

    // Pending grade submissions, off the spine rather than the legacy row —
    // and off `Assessment.teacherPartnerId`, since `GradeEntry.enteredById` is
    // a User id and was never going to match a StaffProfile id.
    const pendingGrades = await this.prisma.client.studentAssessment.count({
      where: { approvalStatus: 'draft', assessment: { teacherPartnerId, deletedAt: null } },
    });

    // A8: spine-side marking queue — assessments this teacher entered awaiting
    // approval, plus any open amendment requests to review.
    // `enteredById` is a USER id; `teacherPartnerId` is a StaffProfile id.
    // Filtering one by the other matched nothing, so these counters have read
    // zero since they were written. `Assessment.teacherPartnerId` is the column
    // that actually holds the teacher.
    const pendingApprovals = await this.prisma.client.studentAssessment.count({
      where: { approvalStatus: 'submitted', assessment: { teacherPartnerId } },
    });
    const draftMarks = await this.prisma.client.studentAssessment.count({
      where: { approvalStatus: 'draft', assessment: { teacherPartnerId } },
    });

    return { classes, todaySchedule, pendingGrades, marking: { pendingApprovals, draftMarks } };
  }

  /**
   * The teacher workspace (P5) — one screen that finds the teacher's work
   * instead of making them pick a class/term/subject to discover it. Every
   * panel is a live query the deep-links point back at.
   *
   * Assessments are scoped to the (class, subject) pairs the teacher is
   * assigned. That proxy becomes an exact `Assessment.teacherPartnerId` filter
   * once P4 lands the column; nothing here changes shape when it does.
   */
  async teacherOverview(teacherPartnerId: string) {
    const assignments = await this.prisma.client.teacherAssignment.findMany({
      where: { teacherPartnerId },
      include: { subject: true, schoolClass: { include: { gradeLevel: true } } },
    });
    const staff = await this.prisma.client.staffProfile.findFirst({
      where: { id: teacherPartnerId },
      include: { partner: true },
    });

    const classIds = [...new Set(assignments.map((a) => a.classId))];
    const subjectIds = [...new Set(assignments.map((a) => a.subjectId))];
    const scope = classIds.length
      ? { classId: { in: classIds }, subjectId: { in: subjectIds }, deletedAt: null }
      : { id: 'none' }; // no assignments → empty everywhere

    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000);

    const [needsMarking, dueSoon, awaitingApproval, returnedToMe, examCoverage, lessonPlanCounts] = await Promise.all([
      // Submitted work with no mark yet, grouped by assessment.
      this.prisma.client.studentAssessment.groupBy({
        by: ['assessmentId'],
        where: {
          status: { in: ['submitted', 'resubmitted'] },
          markEntries: { none: {} },
          assessment: scope,
        },
        _count: { _all: true },
      }),
      // Assessments due within a week, still open.
      this.prisma.client.assessment.findMany({
        where: { ...scope, status: { in: ['published', 'open'] }, dueAt: { gte: new Date(now.getTime() - 7 * 86_400_000), lte: weekAhead } },
        orderBy: { dueAt: 'asc' },
        take: 20,
      }),
      // Marks I entered that are awaiting someone else's approval — SoD means I
      // can't approve my own, so this is a "waiting on approver" list.
      this.prisma.client.studentAssessment.count({
        where: { approvalStatus: 'submitted', assessment: { teacherPartnerId } },
      }),
      // Marks sent back to me to redo.
      this.prisma.client.studentAssessment.findMany({
        where: { approvalStatus: 'rejected', assessment: { teacherPartnerId } },
        include: { assessment: true },
        take: 20,
      }),
      // Exam papers for my classes with marks still to enter.
      this.examPapersToEnter(classIds, subjectIds),
      this.lessonPlanCounts(teacherPartnerId),
    ]);

    // Assessment.subjectId is FK-less in the spine, so subject names are resolved
    // in one batch rather than a per-row join.
    const allSubjectIds = [
      ...new Set([
        ...subjectIds,
        ...dueSoon.map((a) => a.subjectId),
        ...returnedToMe.map((sa) => sa.assessment?.subjectId).filter(Boolean) as string[],
      ]),
    ];
    const subjectRows = allSubjectIds.length
      ? await this.prisma.client.subject.findMany({ where: { id: { in: allSubjectIds } }, select: { id: true, name: true } })
      : [];
    const subjectName = new Map(subjectRows.map((s) => [s.id, s.name]));

    // Enrich needs-marking with the assessment title + class/subject.
    const markAssessmentIds = needsMarking.map((g) => g.assessmentId);
    const markAssessments = markAssessmentIds.length
      ? await this.prisma.client.assessment.findMany({ where: { id: { in: markAssessmentIds } } })
      : [];
    const needsMarkingRows = needsMarking
      .map((g) => {
        const a = markAssessments.find((x) => x.id === g.assessmentId);
        return a ? { assessmentId: a.id, title: a.title, subject: subjectName.get(a.subjectId) ?? '', classId: a.classId, count: g._count._all } : null;
      })
      .filter(Boolean);

    return {
      teacher: staff ? { id: staff.id, name: staff.partner?.name ?? staff.employeeNo } : null,
      classes: assignments.map((a) => ({
        classId: a.classId,
        className: a.schoolClass?.name ?? '',
        subjectId: a.subjectId,
        subjectName: a.subject?.name ?? '',
      })),
      needsMarking: needsMarkingRows,
      dueSoon: dueSoon.map((a) => ({
        assessmentId: a.id, title: a.title, subject: subjectName.get(a.subjectId) ?? '', classId: a.classId,
        dueAt: a.dueAt, overdue: a.dueAt != null && a.dueAt < now,
      })),
      awaitingApproval,
      returnedToMe: returnedToMe.map((sa) => ({
        studentAssessmentId: sa.id, assessmentId: sa.assessmentId,
        title: sa.assessment?.title ?? '', subject: sa.assessment ? subjectName.get(sa.assessment.subjectId) ?? '' : '',
      })),
      examPapers: examCoverage,
      lessonPlans: lessonPlanCounts,
    };
  }

  /** Exam papers (schedules) for these classes with fewer marks than students. */
  private async examPapersToEnter(classIds: string[], subjectIds: string[]) {
    if (classIds.length === 0) return [];
    const schedules = await this.prisma.client.examSchedule.findMany({
      // Locked papers are not work to do. The assessment's lock is authoritative;
      // the schedule column is the legacy mirror.
      where: { classId: { in: classIds }, subjectId: { in: subjectIds }, marksLockedAt: null },
      include: { subject: true, exam: true },
      take: 40,
    });
    if (schedules.length === 0) return [];

    const sizes = await this.prisma.client.studentProfile.groupBy({
      by: ['currentClassId'],
      where: { currentClassId: { in: classIds }, status: 'active' },
      _count: { _all: true },
    });
    const sizeByClass = new Map(sizes.map((s) => [s.currentClassId as string, s._count._all]));

    const entered = await this.prisma.client.gradeEntry.groupBy({
      by: ['examScheduleId'],
      where: { examScheduleId: { in: schedules.map((s) => s.id) }, marksObtained: { not: null } },
      _count: { _all: true },
    });
    const enteredBy = new Map(entered.map((e) => [e.examScheduleId, e._count._all]));

    return schedules
      .map((s) => {
        const size = sizeByClass.get(s.classId) ?? 0;
        const done = enteredBy.get(s.id) ?? 0;
        return { examScheduleId: s.id, examName: s.exam?.name ?? '', subject: s.subject?.name ?? '', classId: s.classId, entered: done, total: size };
      })
      .filter((p) => p.total > 0 && p.entered < p.total);
  }

  private async lessonPlanCounts(teacherPartnerId: string) {
    const [draft, submitted, approved] = await Promise.all([
      this.prisma.client.lessonPlan.count({ where: { teacherPartnerId, workflowStatus: 'draft' } }).catch(() => 0),
      this.prisma.client.lessonPlan.count({ where: { teacherPartnerId, workflowStatus: 'submitted' } }).catch(() => 0),
      this.prisma.client.lessonPlan.count({ where: { teacherPartnerId, workflowStatus: 'approved' } }).catch(() => 0),
    ]);
    return { draft, submitted, approved };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async recentAttendance(studentProfileId: string) {
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const [rows, cfg] = await Promise.all([
      this.prisma.client.studentAttendance.findMany({
        where: { studentProfileId, date: { gte: from } },
        orderBy: { date: 'desc' },
        take: 30,
      }),
      // P-att-status: rate maths uses the org's configured present/late flags.
      this.statusConfig.catalogByCode(),
    ]);
    const total = rows.length;
    const present = rows.filter((r) => cfg[r.status]?.isPresent).length;
    const late = rows.filter((r) => cfg[r.status]?.isLate).length;
    const absent = rows.filter((r) => cfg[r.status]?.isAbsent).length;
    return { total, present, late, absent, rate: total > 0 ? Math.round(((present + late * 0.5) / total) * 100) : 0 };
  }

  /**
   * Outstanding fee balance for one student's Partner.
   *
   * P0-1/P0-7 fix. The previous query was wrong twice over:
   *
   *  1. `paymentStatus: { in: ['partial', 'paid'] }` excluded `not_paid`, so a
   *     freshly-billed student who had paid nothing — the largest debtor there
   *     is — showed a balance of ZERO to their own parent. `ReportingService`
   *     had already found and documented this exact bug; the portal copy was
   *     never updated.
   *  2. `sourceType: 'school_fee'` dropped penalties, library fines and meal
   *     charges, so the figure disagreed with the bursar's statement.
   *
   * It also applied no `status` filter, letting draft and cancelled documents
   * into the total. All three are now handled by the shared constant.
   *
   * Scoped to POSTED_FEE_WHERE (financially active) rather than OPEN_FEE_WHERE
   * so `total` means "billed" and matches the bursar statement's billed figure.
   * Fully-settled invoices carry a zero residual, so they add nothing to the
   * balance while still counting as billed.
   *
   * Aggregated in the database rather than summed in JS — the old version
   * loaded every matching document row to add up two columns.
   *
   * NOTE (P0-4, fixed in A1): `paid` is still derived as billed − balance, so it
   * counts waived and credited amounts as if they were money received. The
   * honest figure comes from PaymentAllocation, which arrives with
   * SchoolFinanceQueryService; this method then delegates to it.
   */
  private async feeBalance(partnerId: string) {
    const where = { ...POSTED_FEE_WHERE, partnerId };
    const [agg, invoiceCount] = await Promise.all([
      this.prisma.client.document.aggregate({
        where,
        _sum: { totalAmount: true, amountResidual: true },
      }),
      this.prisma.client.document.count({ where }),
    ]);
    const total = Number(agg._sum.totalAmount ?? 0);
    const balance = Number(agg._sum.amountResidual ?? 0);
    return { total, paid: total - balance, balance, invoiceCount };
  }

  private async recentAnnouncements(classId: string | null | undefined) {
    return this.prisma.client.announcement.findMany({
      where: {
        publishedAt: { not: null },
        OR: [{ scope: 'school' }, ...(classId ? [{ classId }] : [])],
      },
      orderBy: { publishedAt: 'desc' },
      take: 5,
    });
  }

  private async studentTimetable(classId: string | null | undefined, studentProfileId: string) {
    if (!classId) return [];
    const profile = await this.prisma.client.studentProfile.findFirst({ where: { id: studentProfileId } });
    const slots = await this.prisma.client.timetableSlot.findMany({
      where: { classId, sectionId: profile?.currentSectionId ?? null },
      include: { subject: true, period: true },
      orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }] as any,
    });
    return slots;
  }

  private async recentGrades(studentProfileId: string) {
    return this.prisma.client.gradeEntry.findMany({
      where: { studentProfileId },
      orderBy: { enteredAt: 'desc' },
      take: 10,
      include: { examSchedule: { include: { subject: true, exam: true } } },
    });
  }

  private async studentAssignments(studentProfileId: string) {
    const profile = await this.prisma.client.studentProfile.findFirst({ where: { id: studentProfileId } });
    if (!profile?.currentClassId) return [];
    const assignments = await this.prisma.client.homeworkAssignment.findMany({
      where: { classId: profile.currentClassId },
      orderBy: { dueDate: 'asc' },
      include: { subject: true, submissions: { where: { studentProfileId } } },
    });
    return assignments;
  }

  /** A8: the student's published term results from the A3 result spine. */
  private async publishedResults(studentProfileId: string) {
    const terms = await this.prisma.client.studentTermResult.findMany({
      where: { studentProfileId, resultSet: { status: 'published' } },
      include: { resultSet: true },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    return terms.map((t) => ({
      termId: t.termId,
      resultSetRevision: t.resultSet.revision,
      gpa: t.gpa != null ? String(t.gpa) : null,
      aggregate: t.aggregate,
      division: t.division,
      meanPercent: t.meanPercent != null ? String(t.meanPercent) : null,
      classRank: t.classRank,
      promotionRecommendation: t.promotionRecommendation,
    }));
  }

  /** A8: issued certificates for the student (A6). */
  private async studentCertificates(studentProfileId: string) {
    return this.prisma.client.certificate.findMany({
      where: { studentProfileId, status: 'issued' },
      select: { id: true, type: true, title: true, serialNumber: true, verificationCode: true, issuedAt: true },
      orderBy: { issuedAt: 'desc' },
    });
  }
}