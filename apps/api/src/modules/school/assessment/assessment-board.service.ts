import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AssessmentPolicyService } from './assessment-config.service';
import { MarkingService } from './marking.service';
import { AssessmentWorkflowService, hasOutcome, RESOLVED_WITHOUT_SCORE } from './assessment-workflow.service';
import { kindOf } from './assessment-math';
import type { AssessmentBoardQuery, CreateUnifiedAssessmentDto } from './assessment-board.dto';

/** Participation values that mean "resolved, but no numeric mark". */
const NON_SCORING = new Set(RESOLVED_WITHOUT_SCORE);

/**
 * AssessmentBoardService — the one list a teacher starts from, and the one form
 * they create from.
 *
 * The system used to present three mental models for the same act. A teacher
 * wanting to assess a class chose between an exam wizard, a gradebook column, and
 * a homework screen, each with its own nouns, its own create form and its own
 * marking grid — when what they were doing was the same thing every time. Kind
 * (CAT, homework, project, practical, exam, oral) is a PROPERTY of an
 * assessment, not a different system, and this service is what lets the UI treat
 * it that way.
 *
 * Nothing here is a new store. Rows are `Assessment` + `StudentAssessment`, the
 * same spine the gradebook and the result run read; creating an exam still
 * creates an `ExamSchedule`; other delivery uses the canonical `Assignment`.
 */
@Injectable()
export class AssessmentBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly policies: AssessmentPolicyService,
    private readonly marking: MarkingService,
    private readonly workflow: AssessmentWorkflowService,
  ) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /* ─────────────────────────────── The board ─────────────────────────────── */

  /**
   * Every assessment for a term (optionally narrowed), each with the progress
   * and status the row needs, plus the weighting policy in force.
   *
   * One round trip on purpose: the previous screens each fetched their own
   * slice, so "how much of my marking is left" could not be answered without
   * visiting four of them.
   */
  async board(q: AssessmentBoardQuery) {
    if (q.courseOfferingId) {
      const course = await this.prisma.client.courseOffering.findFirst({ where: { id: q.courseOfferingId } });
      if (!course) throw new NotFoundException('Course offering not found');
      q = { ...q, termId: course.termId, classId: course.classId ?? undefined, subjectId: course.subjectId ?? undefined };
    }
    const where: any = {
      ...(await this.marking.readScope()),
      organizationId: this.org,
      termId: q.termId,
      deletedAt: null,
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.subjectId ? { subjectId: q.subjectId } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.teacherPartnerId ? { teacherPartnerId: q.teacherPartnerId } : {}),
      ...(q.courseOfferingId ? { courseOfferingId: q.courseOfferingId } : {}),
      ...(q.sectionId ? { sectionId: q.sectionId } : {}),
    };

    const assessments = await this.prisma.client.assessment.findMany({
      where,
      include: { component: true, courseOffering: { select: { id: true, name: true } }, roster: { select: { frozenAt: true, _count: { select: { members: true } } } } },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (assessments.length === 0) {
      return { rows: [], policy: await this.policyFor(q), subjects: [], counts: this.emptyCounts() };
    }

    const ids = assessments.map((a) => a.id);
    const [marks, subjects, classes] = await Promise.all([
      this.prisma.client.studentAssessment.findMany({
        where: { assessmentId: { in: ids }, deletedAt: null },
        select: { assessmentId: true, effectiveScore: true, participation: true, approvalStatus: true },
      }),
      this.namesOf('subject', [...new Set(assessments.map((a) => a.subjectId))]),
      this.namesOf('schoolClass', [...new Set(assessments.map((a) => a.classId))]),
    ]);

    // Frozen roster members are the denominator: a marksheet is derived from the ROSTER,
    // never from the rows that happen to exist, or a student with no mark yet
    // silently drops out of "how many are left".

    const byAssessment = new Map<string, typeof marks>();
    for (const m of marks) {
      const list = byAssessment.get(m.assessmentId) ?? [];
      list.push(m);
      byAssessment.set(m.assessmentId, list);
    }

    const rows = assessments.map((a) => {
      const mine = byAssessment.get(a.id) ?? [];
      const marked = mine.filter(
        (m) => m.effectiveScore !== null || NON_SCORING.has(String(m.participation)),
      ).length;
      const total = a.roster?._count.members ?? mine.length;
      return {
        assessmentId: a.id,
        title: a.title,
        kind: kindOf(a),
        sequence: a.sequence ?? 1,
        subject: { id: a.subjectId ?? '', name: subjects.get(a.subjectId ?? '') ?? '' },
        class: { id: a.classId ?? '', name: classes.get(a.classId ?? '') ?? '' },
        component: a.component
          ? { id: a.component.id, name: a.component.name, weight: Number(a.component.weight) }
          : null,
        maxScore: Number(a.maxScore),
        dueAt: a.dueAt,
        status: a.status,
        approvalStatus: this.rollup(mine.map((m) => String(m.approvalStatus))),
        locked: a.lockedAt != null,
        sourceType: a.sourceType,
        courseOffering: a.courseOffering,
        rosterId: a.rosterId,
        rosterFrozen: !!a.roster?.frozenAt,
        version: a.version,
        feedbackReleaseAt: a.feedbackReleaseAt,
        marksReleaseAt: a.marksReleaseAt,
        marked,
        total,
      };
    });

    const filtered = q.status ? rows.filter((r) => this.stage(r) === q.status) : rows;
    return {
      rows: filtered,
      policy: await this.policyFor(q),
      subjects: [...subjects.entries()].map(([id, name]) => ({ id, name })),
      counts: this.countsOf(rows),
    };
  }

  /**
   * The single status a row shows, collapsing the assessment lifecycle and the
   * marking-approval workflow into the five words a teacher actually uses.
   */
  private stage(r: { marked: number; total: number; approvalStatus: string; status: string }): string {
    if (r.approvalStatus === 'approved') return 'approved';
    if (r.approvalStatus === 'submitted') return 'submitted';
    if (r.approvalStatus === 'rejected') return 'returned';
    if (r.marked > 0) return 'marking';
    if (r.status === 'draft') return 'draft';
    return 'open';
  }

  private emptyCounts() {
    return { all: 0, draft: 0, open: 0, marking: 0, submitted: 0, approved: 0, returned: 0 };
  }

  private countsOf(rows: any[]) {
    const c = this.emptyCounts();
    c.all = rows.length;
    for (const r of rows) (c as any)[this.stage(r)] += 1;
    return c;
  }

  /** Weakest status wins, so "partly approved" never reads as approved. */
  private rollup(statuses: string[]): string {
    if (statuses.length === 0) return 'draft';
    if (statuses.includes('rejected')) return 'rejected';
    if (statuses.includes('draft')) return 'draft';
    if (statuses.includes('submitted')) return 'submitted';
    return 'approved';
  }

  private async policyFor(q: AssessmentBoardQuery) {
    if (!q.classId || !q.subjectId) return null;
    const klass = await this.prisma.client.schoolClass.findFirst({ where: { id: q.classId } });
    const policy = await this.policies.resolve({
      subjectId: q.subjectId,
      classId: q.classId,
      gradeLevelId: klass?.gradeLevelId ?? undefined,
      termId: q.termId,
    });
    if (!policy) return null;
    const components = (policy.components ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      weight: Number(c.weight),
    }));
    const total = components.reduce((s: number, c: any) => s + c.weight, 0);
    return { id: policy.id, components, totalWeight: total, valid: Math.abs(total - 100) < 0.001 };
  }

  private async namesOf(model: 'subject' | 'schoolClass', ids: Array<string | null>) {
    if (ids.length === 0) return new Map<string, string>();
    const rows = await (this.prisma.client as any)[model].findMany({
      where: { id: { in: ids.filter(Boolean) } },
      select: { id: true, name: true },
    });
    return new Map<string, string>(rows.map((r: any) => [r.id, r.name]));
  }

  /* ──────────────────────────── One create form ──────────────────────────── */

  /**
   * Create an assessment of any kind.
   *
   * The kind decides only the TAIL of the work: an exam also gets its
   * `ExamSchedule` rows (one per class), homework also gets its
   * `Assignment`. Everything else is identical, which is the whole point
   * — a teacher answers the same five questions whatever they are setting.
   */
  async createUnified(dto: CreateUnifiedAssessmentDto) {
    return this.workflow.create(dto);
  }


  /* ──────────────────────────── One marksheet ──────────────────────────── */

  /**
   * The marksheet for one assessment, whatever kind it is.
   *
   * Derived from the class ROSTER, never from the rows that happen to exist: a
   * student with no mark yet must still appear, with an empty box, or the
   * teacher cannot enter their mark. That rule is why this does not simply
   * return `StudentAssessment` rows.
   */
  async sheet(assessmentId: string) {
    await this.marking.assertMayViewAssessment(assessmentId);
    const assessment = await this.prisma.client.assessment.findFirst({
      where: { id: assessmentId, deletedAt: null },
      include: { component: true, courseOffering: true, roster: { include: { members: true } }, assignment: true, outcomes: true },
    });
    if (!assessment) throw new NotFoundException(`Assessment ${assessmentId} not found`);

    const marks = await this.prisma.client.studentAssessment.findMany({ where: { assessmentId, deletedAt: null }, include: { markEntries: true } });
    const learnerIds = assessment.roster ? assessment.roster.members.map((m) => m.studentProfileId) : marks.map((m) => m.studentProfileId);
    const [roster, subject, klass] = await Promise.all([
      this.prisma.client.studentProfile.findMany({ where: { id: { in: learnerIds } }, include: { partner: true } }),
      assessment.subjectId ? this.prisma.client.subject.findFirst({ where: { id: assessment.subjectId }, select: { name: true } }) : null,
      assessment.classId ? this.prisma.client.schoolClass.findFirst({ where: { id: assessment.classId }, select: { name: true } }) : null,
    ]);

    const byStudent = new Map(marks.map((m) => [m.studentProfileId, m]));
    const students = roster
      .map((s) => {
        const m = byStudent.get(s.id);
        return {
          studentProfileId: s.id,
          name: s.partner?.name ?? s.admissionNo,
          admissionNo: s.admissionNo,
          studentAssessmentId: m?.id ?? null,
          marks: m?.effectiveScore != null ? Number(m.effectiveScore) : null,
          percentage: m?.percentage != null ? Number(m.percentage) : null,
          participation: String(m?.participation ?? 'present'),
          approvalStatus: String(m?.approvalStatus ?? 'draft'),
          version: m?.version ?? 0,
          comment: m?.feedback ?? m?.markEntries.find((entry) => entry.round === 'first')?.comment ?? '',
          rejectionReason: m?.rejectionReason ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const marked = students.filter(
      (s) => s.marks !== null || NON_SCORING.has(s.participation),
    ).length;

    return {
      assessment: {
        id: assessment.id,
        title: assessment.title,
        kind: kindOf(assessment),
        maxScore: Number(assessment.maxScore),
        dueAt: assessment.dueAt,
        locked: assessment.lockedAt != null,
        status: assessment.status,
        version: assessment.version,
        courseOfferingId: assessment.courseOfferingId,
        courseName: assessment.courseOffering?.name ?? null,
        rosterId: assessment.rosterId,
        rosterFrozen: !!assessment.roster?.frozenAt,
        assignmentId: assessment.assignment?.id ?? null,
        gradingMode: assessment.assignment?.gradingMode ?? 'points',
        feedbackReleaseAt: assessment.feedbackReleaseAt,
        marksReleaseAt: assessment.marksReleaseAt,
        subject: { id: assessment.subjectId ?? '', name: subject?.name ?? '' },
        class: { id: assessment.classId ?? '', name: klass?.name ?? '' },
        component: assessment.component
          ? { id: assessment.component.id, name: assessment.component.name, weight: Number(assessment.component.weight) }
          : null,
      },
      approvalStatus: this.rollup(marks.map((m) => String(m.approvalStatus))),
      students,
      marked,
      total: students.length,
    };
  }

  /**
   * Save one cell.
   *
   * Straight onto `postMark`, the one writer — which is where the lock check,
   * the range check, the ledger write and the recompute all live. A non-scoring
   * outcome CLEARS the mark first: leaving the number behind is exactly how a
   * stale score survives an absence.
   */
  async saveMark(dto: {
    assessmentId: string;
    studentProfileId: string;
    marks: number | null;
    participation?: string;
    expectedVersion?: number;
    comment?: string;
  }) {
    await this.marking.assertMayMarkAssessment(dto.assessmentId);
    const assessment = await this.prisma.client.assessment.findFirst({
      where: { id: dto.assessmentId, deletedAt: null },
    });
    if (!assessment) throw new NotFoundException(`Assessment ${dto.assessmentId} not found`);

    const participation = dto.participation ?? 'present';
    const clearing = dto.marks === null || dto.marks === undefined || NON_SCORING.has(participation);

    return this.prisma.client.$transaction(async (tx: any) => {
      const sa = await this.marking.postMark(tx, {
        assessmentId: dto.assessmentId,
        studentProfileId: dto.studentProfileId,
        score: clearing ? null : dto.marks,
        source: 'manual',
        snapshot: {
          classId: assessment.classId ?? undefined,
          sectionId: assessment.sectionId ?? undefined,
          termId: assessment.termId,
        },
        // Refuse a stale write rather than letting the later save win.
        expectedVersion: dto.expectedVersion,
        comment: dto.comment,
      });
      await tx.studentAssessment.updateMany({
        where: { id: sa.id },
        data: { participation: participation as any },
      });
      return {
        studentAssessmentId: sa.id,
        marks: sa.effectiveScore != null ? Number(sa.effectiveScore) : null,
        percentage: sa.percentage != null ? Number(sa.percentage) : null,
        participation,
        version: sa.version,
      };
    });
  }

  /* ─────────────────────────── Submit / approve ─────────────────────────── */

  /** What an approver needs to decide, without opening the marksheet. */
  async approvalQueue(termId: string, classId?: string) {
    const assessments = await this.prisma.client.assessment.findMany({
      where: {
        organizationId: this.org,
        termId,
        deletedAt: null,
        ...(classId ? { classId } : {}),
        studentAssessments: { some: { approvalStatus: 'submitted' } },
      },
      include: { component: true },
    });
    if (assessments.length === 0) return { rows: [] };

    const ids = assessments.map((a) => a.id);
    const [rows, subjects, classes, staff] = await Promise.all([
      this.prisma.client.studentAssessment.findMany({
        where: { assessmentId: { in: ids }, deletedAt: null },
        select: {
          assessmentId: true, effectiveScore: true, percentage: true,
          participation: true, approvalStatus: true, enteredById: true,
        },
      }),
      this.namesOf('subject', [...new Set(assessments.map((a) => a.subjectId))]),
      this.namesOf('schoolClass', [...new Set(assessments.map((a) => a.classId))]),
      this.teacherNames(assessments.map((a) => a.teacherPartnerId).filter(Boolean) as string[]),
    ]);

    return {
      rows: assessments.map((a) => {
        const mine = rows.filter((r) => r.assessmentId === a.id);
        const scored = mine.filter((r) => r.percentage !== null);
        const average = scored.length
          ? scored.reduce((s, r) => s + Number(r.percentage), 0) / scored.length
          : null;
        const missing = mine.filter(
          (r) => r.effectiveScore === null && !NON_SCORING.has(String(r.participation)),
        ).length;
        return {
          assessmentId: a.id,
          title: a.title,
          kind: kindOf(a),
          subject: subjects.get(a.subjectId ?? '') ?? '',
          class: classes.get(a.classId ?? '') ?? '',
          submittedBy: a.teacherPartnerId ? staff.get(a.teacherPartnerId) ?? null : null,
          students: mine.length,
          average: average === null ? null : Math.round(average * 10) / 10,
          missing,
          maxScore: Number(a.maxScore),
        };
      }),
    };
  }

  private async teacherNames(ids: string[]) {
    if (ids.length === 0) return new Map<string, string>();
    const rows = await this.prisma.client.staffProfile.findMany({
      where: { id: { in: ids } },
      include: { partner: true },
    });
    return new Map<string, string>(rows.map((r: any) => [r.id, r.partner?.name ?? r.employeeNo]));
  }

  /** Submit / approve / reject, straight onto the one approval workflow. */
  async transitionMarks(
    assessmentId: string,
    action: 'submit' | 'resubmit' | 'approve' | 'reject',
    reason?: string,
  ) {
    const sheet = await this.sheet(assessmentId);
    if (action === 'reject' && !reason?.trim()) throw new BadRequestException('A reason is required when returning marks');
    if (action === 'submit' || action === 'resubmit') {
      if (!sheet.assessment.rosterFrozen) throw new BadRequestException('A frozen assessment roster is required');
      if (!sheet.students.length || sheet.students.some((s) => !hasOutcome(s))) throw new BadRequestException('Every learner needs a score or a resolved participation outcome before submission');
      if (sheet.students.some((s) => s.approvalStatus === 'rejected')) action = 'resubmit';
    }
    return this.marking.markingApproval({ assessmentId, action, reason } as any);
  }
}
