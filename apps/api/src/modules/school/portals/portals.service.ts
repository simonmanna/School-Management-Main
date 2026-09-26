import { Injectable } from '@nestjs/common';
import { releasedResultSetWhere } from '../assessment/result-status';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { PortalIdentityService } from '../../../kernel/auth/portal-identity.service';
import { EmployeeIdentityService } from '../../../kernel/auth/employee-identity.service';
import { AttendanceStatusConfigService } from '../attendance/attendance-status-config.service';
import { SchoolFinanceQueryService } from '../fees/school-finance-query.service';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';

/** What the portal app needs on boot to know who it is talking to. */
export interface PortalContext {
  kind: 'student' | 'guardian' | 'staff';
  students: Array<{
    studentProfileId: string;
    name: string;
    admissionNo: string | null;
    classId: string | null;
    className: string | null;
  }>;
  teacher: { staffProfileId: string; partnerId: string | null; name: string } | null;
  defaultLanding: 'student' | 'parent' | 'teacher' | null;
}

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
    private readonly portalIdentity: PortalIdentityService,
    private readonly employeeIdentity: EmployeeIdentityService,
    private readonly statusConfig: AttendanceStatusConfigService,
    // D1: the ONE canonical fee calculation. The portal must not compute a
    // balance of its own, or it will disagree with the bursar.
    private readonly finance: SchoolFinanceQueryService,
    private readonly placements: PlacementLookupService,
  ) {}

  /**
   * Who is calling, and what may they open — resolved entirely from the verified
   * token.
   *
   * Every other portal route makes the caller name their own subject in the URL,
   * which means the client has to learn its own `studentProfileId` from somewhere
   * before it can ask its first question. This is that somewhere. It is the single
   * call the portal app makes on boot; everything after it keys off the result.
   *
   * Nothing here reads request input, so there is no id for a caller to edit.
   */
  async myContext(): Promise<PortalContext> {
    const principal = this.portalIdentity.principal();
    const studentIds = await this.portalIdentity.accessibleStudents();
    const students = await this.describeStudents(studentIds);

    // A staff account may also be a teacher; a guardian never is. Only look when
    // it could matter, so a parent's boot costs one query, not two.
    const employee = principal.kind === 'staff' ? await this.employeeIdentity.forUser() : null;
    let teacher: PortalContext['teacher'] = null;
    if (employee?.staffProfileId) {
      const partner = employee.partnerId
        ? await this.prisma.client.partner.findFirst({
            where: { id: employee.partnerId },
            select: { name: true },
          })
        : null;
      teacher = {
        staffProfileId: employee.staffProfileId,
        partnerId: employee.partnerId,
        name: partner?.name ?? 'Teacher',
      };
    }

    const defaultLanding: PortalContext['defaultLanding'] =
      principal.kind === 'student' ? 'student'
      : principal.kind === 'guardian' ? 'parent'
      : teacher ? 'teacher'
      : null;

    return { kind: principal.kind, students, teacher, defaultLanding };
  }

  /**
   * Attach where each pupil sits, from placement history (ADR-027), plus the
   * class and section rows the portal renders.
   *
   * `currentClass` / `currentSection` keep their names because they are the
   * portal's response contract (`row.student.currentClass.name`). What changed
   * is where they come from: the learner's placement, not the StudentProfile
   * projection. A parent sees the class their child actually sits in.
   */
  private async withPlacementClass<T extends { id: string }>(students: T[]) {
    const placed = await this.placements.attach(students);
    const classIds = [...new Set(placed.map((s) => s.placement?.classId).filter(Boolean) as string[])];
    const sectionIds = [...new Set(placed.map((s) => s.placement?.sectionId).filter(Boolean) as string[])];
    const [classes, sections] = await Promise.all([
      classIds.length
        ? this.prisma.client.schoolClass.findMany({ where: { id: { in: classIds } }, include: { gradeLevel: true } })
        : Promise.resolve([] as any[]),
      sectionIds.length
        ? this.prisma.client.section.findMany({ where: { id: { in: sectionIds } } })
        : Promise.resolve([] as any[]),
    ]);
    const classById = new Map<string, any>(classes.map((c: any) => [c.id, c]));
    const sectionById = new Map<string, any>(sections.map((x: any) => [x.id, x]));
    return placed.map((s) => ({
      ...s,
      currentClass: s.placement ? (classById.get(s.placement.classId) ?? null) : null,
      placedClassName: (s.placement ? classById.get(s.placement.classId)?.name : null) ?? null,
      currentSection: s.placement?.sectionId ? (sectionById.get(s.placement.sectionId) ?? null) : null,
    }));
  }

  /** Names and classes for a set of pupils, for pickers and headers. */
  private async describeStudents(ids: string[]): Promise<PortalContext['students']> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.client.studentProfile.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, admissionNo: true, partner: { select: { name: true } } },
    });
    const placed = await this.withPlacementClass(rows);
    return placed.map((r) => ({
      studentProfileId: r.id,
      name: r.partner?.name ?? r.admissionNo ?? 'Student',
      admissionNo: r.admissionNo ?? null,
      classId: r.placement?.classId ?? null,
      className: r.placedClassName,
    }));
  }

  /**
   * Parent portal — given a parent's contact id (from auth context in production),
   * return their children's overview.
   */
  async parentDashboard(studentProfileIds: string[]) {
    const students = await this.withPlacementClass(
      await this.prisma.client.studentProfile.findMany({ where: { id: { in: studentProfileIds } } }),
    );

    // For each student, fetch latest attendance, grades, fees.
    const result = [];
    for (const s of students) {
      const [attendance, fees, announcements] = await Promise.all([
        this.recentAttendance(s.id),
        this.feeBalance(s.partnerId, s.id),
        this.recentAnnouncements(s.placement?.classId),
      ]);
      result.push({ student: s, attendance, fees, announcements });
    }
    return result;
  }

  async studentDashboard(studentProfileId: string) {
    const found = await this.prisma.client.studentProfile.findFirst({ where: { id: studentProfileId } });
    if (!found) return null;
    const [profile] = await this.withPlacementClass([found]);

    const [timetable, attendance, grades, assignments, announcements, publishedResults, certificates] = await Promise.all([
      this.studentTimetable(profile.placement?.classId, profile.placement?.sectionId ?? null),
      this.recentAttendance(studentProfileId),
      this.recentGrades(studentProfileId),
      this.studentAssignments(studentProfileId),
      this.recentAnnouncements(profile.placement?.classId),
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

    // If teacher doesn't exist, return empty workspace instead of 500
    if (!staff) {
      return {
        teacher: null,
        classes: [],
        needsMarking: [],
        dueSoon: [],
        awaitingApproval: 0,
        returnedToMe: [],
        examPapers: [],
        lessonPlans: { draft: 0, submitted: 0, approved: 0 },
      };
    }

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
        ...dueSoon.map((a) => a.subjectId).filter((id): id is string => !!id),
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
        return a ? { assessmentId: a.id, title: a.title, subject: subjectName.get(a.subjectId ?? '') ?? '', classId: a.classId, count: g._count._all } : null;
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
        assessmentId: a.id, title: a.title, subject: subjectName.get(a.subjectId ?? '') ?? '', classId: a.classId,
        dueAt: a.dueAt, overdue: a.dueAt != null && a.dueAt < now,
      })),
      awaitingApproval,
      returnedToMe: returnedToMe.map((sa) => ({
        studentAssessmentId: sa.id, assessmentId: sa.assessmentId,
        title: sa.assessment?.title ?? '', subject: sa.assessment ? subjectName.get(sa.assessment.subjectId ?? '') ?? '' : '',
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

    const sizeByClass = await this.placements.classSizes(classIds);

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
   * D1: `paid` used to be derived as `billed − balance`. Waivers, credit
   * applications and credit adjustments all reduce `amountResidual`, so every
   * shilling the school FORGAVE was reported to the parent as money they had
   * paid. A bursary pupil whose fees were waived saw "paid: 400,000" against a
   * family that had handed over nothing.
   *
   * The docstring here previously claimed this method "then delegates to"
   * SchoolFinanceQueryService. It did not — the delegation was described and
   * never carried out. It is now real, so the portal, the bursar statement and
   * the ledger cannot disagree (FINANCIAL_INVARIANTS §Terminology: amountPaid
   * is realized payment consideration and EXCLUDES waivers, credits,
   * write-offs and adjustments).
   *
   * `collected` is SUM(PaymentAllocation) — money actually received. The
   * reductions are reported alongside it as their own figures, because a
   * parent is entitled to see that a balance fell because it was forgiven
   * rather than because someone paid.
   */
  private async feeBalance(partnerId: string, studentProfileId: string) {
    const b = await this.finance.studentBalance(studentProfileId);
    return {
      total: b.billed,
      collected: b.collected,
      waived: b.waived,
      credited: b.credited,
      adjusted: b.adjusted,
      balance: b.balance,
      invoiceCount: b.invoiceCount,
    };
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

  private async studentTimetable(classId: string | null | undefined, sectionId: string | null) {
    if (!classId) return [];
    const slots = await this.prisma.client.timetableSlot.findMany({
      where: { classId, sectionId },
      include: { subject: true, period: true },
      orderBy: [{ dayOfWeek: 'asc' }, { period: { order: 'asc' } }] as any,
    });
    return slots;
  }

  /**
   * Recent marks, from the assessment spine and only once approved.
   *
   * Two bugs in one, both of which reached a family's screen:
   *
   * 1. This read the legacy `GradeEntry` table while `publishedResults()` below
   *    reads the `StudentAssessment` spine. The spine is the primary mark store
   *    (`MARKS_SOURCE`); `GradeEntry` is now written only as a mirror. Two
   *    sources on one dashboard eventually disagree, and the parent is the one
   *    who notices.
   *
   * 2. It applied no approval filter at all, so a mark that had been entered but
   *    not yet approved — or had been rejected and sent back — was shown to the
   *    pupil and their guardian as if it were their result. `approvalStatus` is
   *    the school's decision that a mark may leave the staffroom, and it is not
   *    optional on a family-facing surface.
   *
   * `effectiveScore` rather than `originalScore`: adjustments are part of the
   * mark, and showing the pre-adjustment figure would contradict the report card.
   */
  private async recentGrades(studentProfileId: string) {
    const rows = await this.prisma.client.studentAssessment.findMany({
      where: {
        studentProfileId,
        deletedAt: null,
        approvalStatus: 'approved',
        effectiveScore: { not: null },
        assessment: { hiddenFromStudents: false, marksReleaseAt: { lte: new Date() } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: { assessment: true },
    });
    if (rows.length === 0) return [];

    // `Assessment.subjectId` is a plain column, not a Prisma relation, so the
    // names come back in one extra query rather than a join.
    const subjectIds = [...new Set(rows.map((r) => r.assessment?.subjectId).filter(Boolean) as string[])];
    const subjects = subjectIds.length
      ? await this.prisma.client.subject.findMany({
          where: { id: { in: subjectIds } },
          select: { id: true, name: true },
        })
      : [];
    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));

    return rows.map((r) => ({
      id: r.id,
      score: r.effectiveScore != null ? String(r.effectiveScore) : null,
      maxScore: String(r.maxScore),
      percentage: r.percentage != null ? String(r.percentage) : null,
      termId: r.termId,
      recordedAt: r.approvedAt ?? r.updatedAt,
      subject: r.assessment ? { name: subjectName.get(r.assessment.subjectId ?? '') ?? 'Learning activity' } : null,
      assessment: r.assessment ? { id: r.assessment.id, title: r.assessment.title } : null,
    }));
  }

  private async studentAssignments(studentProfileId: string) {
    const now = new Date();
    const rows = await this.prisma.client.studentAssessment.findMany({
      where: { studentProfileId, assessment: { status: { notIn: ['draft', 'scheduled'] }, assignment: { isNot: null } } },
      include: { assessment: { include: { courseOffering: { include: { subject: true } }, assignment: true } }, assignmentSubmissions: { orderBy: { attemptNo: 'desc' } } },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    return rows.map((row) => {
      const a = row.assessment;
      const feedbackReleased = !!a.feedbackReleaseAt && a.feedbackReleaseAt <= now && row.approvalStatus === 'approved';
      const marksReleased = !!a.marksReleaseAt && a.marksReleaseAt <= now && !a.hiddenFromStudents && row.approvalStatus === 'approved';
      return { id: a.assignment!.id, assessmentId: a.id, title: a.title, description: a.assignment!.instructions,
        dueDate: a.dueAt, openAt: a.openAt, closeAt: a.closeAt, subject: a.courseOffering?.subject ?? null, maxScore: a.maxScore,
        submissions: row.assignmentSubmissions.map((s) => ({ id: s.id, attemptNo: s.attemptNo, content: s.content, attachments: s.attachments, submittedAt: s.submittedAt, status: row.status,
          score: marksReleased ? row.effectiveScore : null, feedback: feedbackReleased ? row.feedback : null })) };
    });
  }

  /** A8: the student's published term results from the A3 result spine. */
  private async publishedResults(studentProfileId: string) {
    const terms = await this.prisma.client.studentTermResult.findMany({
      where: { studentProfileId, resultSet: releasedResultSetWhere() },
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

  /**
   * Phase 6: the notice history for whoever is calling.
   *
   * A parent who was told by SMS that fees are due, or that results are out,
   * has no way to look that message up again once the phone deletes it. The
   * school's own record is the only durable copy, so the portal shows it.
   *
   * Scoped to the token's user id and nothing else. `payload` is deliberately
   * NOT returned: it carries the internal ids a notification was built from,
   * which are the school's plumbing rather than the family's business.
   */
  async myNotifications(limit = 50) {
    const userId = this.tenant.userId;
    if (!userId) return [];
    // `limit` arrives as a query string, so a caller can send `?limit=abc` and
    // hand this a NaN. Prisma rejects a NaN `take` with a 500; clamp to the
    // default instead.
    const take = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 200) : 50;
    const rows = await this.prisma.client.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, channel: true, category: true, title: true, body: true,
        status: true, readAt: true, sentAt: true, createdAt: true,
      },
    });
    return rows;
  }

  /**
   * Acknowledge one notice.
   *
   * `updateMany` with the user id in the WHERE is the point: an `update` by id
   * would let a caller mark — and so confirm the existence of — another
   * family's notification.
   */
  async markNotificationRead(notificationId: string) {
    const userId = this.tenant.userId;
    if (!userId) return { updated: 0 };
    const res = await this.prisma.client.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
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
