import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { GradeEntryService } from './examinations.service';
import { AssessmentMintService } from '../assessment/assessment-mint.service';
import { GradingService } from './grading.service';
import type { ApplyClassesDto, LockMarksDto, PaperRefDto, RemoveClassDto, SaveMarkDto } from './marks-workspace.dto';
import { AcademicRosterService } from '../assessment/roster.service';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';
import { MarkingService } from '../assessment/marking.service';
import { Prisma } from '@prisma/client';
import { bandFor as kernelBand, divisionPLE, isDescriptorSystem } from '../assessment/result-computation';
import { resolveScale } from '../assessment/grade-bands';
import { reportingPolicy } from '../assessment/reporting-policy';

/** Participation values that mean "resolved, but no numeric mark". */
const NON_SCORING = new Set(['absent', 'exempt', 'excused', 'malpractice']);
/** Outcomes that settle a learner's place on a paper without a number. */
const RESOLVED_WITHOUT_MARK = new Set(['absent', 'exempt', 'excused', 'malpractice', 'withdrawn', 'not_enrolled', 'special_consideration']);

type StudentRow = {
  studentProfileId: string;
  name: string;
  admissionNo: string;
  sectionId: string | null;
  sectionName: string | null;
};

/**
 * MarksWorkspaceService — the flat, task-shaped read/write surface behind the
 * exam workspace UI.
 *
 * The domain underneath is deliberately rich (exam → schedule → grade entry,
 * projected into the assessment spine). Front-office users do not think in
 * those nouns: they think "make an exam, say which classes sit it, type the
 * marks, look at the results, lock it". Every method here answers one of those
 * five questions in a single round trip, over the SAME rows the rest of the
 * system already writes — no parallel store, no migration of existing marks.
 *
 * The one rule that shapes this file: a marksheet is derived from the CLASS
 * ROSTER, never from the rows that happen to exist. A student with no mark yet
 * must still appear, with an empty box, or the teacher cannot enter their mark.
 */
@Injectable()
export class MarksWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly grades: GradeEntryService,
    private readonly grading: GradingService,
    private readonly mint: AssessmentMintService,
    private readonly placements: PlacementLookupService,
    private readonly marking: MarkingService,
    private readonly rosters: AcademicRosterService,
  ) {}

  /* ─────────────────────────── Step 1: exams ─────────────────────────── */

  /**
   * Exams for a term, each with a one-glance progress roll-up so the exam
   * office can see "Term 1 Mid-Term: 6 classes, 412/900 marks in" without
   * opening anything.
   */
  async exams(params: { termId?: string; academicYearId?: string }) {
    const where: any = {};
    if (params.termId) where.termId = params.termId;
    else if (params.academicYearId) {
      const terms = await this.prisma.client.term.findMany({
        where: { academicYearId: params.academicYearId },
        select: { id: true },
      });
      where.termId = { in: terms.map((t) => t.id) };
    }

    const exams = await this.prisma.client.exam.findMany({
      where,
      include: { examType: true, term: true },
      orderBy: [{ startDate: 'desc' }],
    });
    if (exams.length === 0) return [];

    const examIds = exams.map((e) => e.id);
    const schedules = await this.prisma.client.examSchedule.findMany({
      where: { examId: { in: examIds } },
      select: { id: true, examId: true, classId: true, subjectId: true, marksLockedAt: true },
    });
    const enteredBySchedule = await this.markedPerPaper(schedules.map((s) => s.id));
    const approvalBySchedule = await this.approvalPerPaper(schedules.map((s) => s.id));

    // Class sizes, so "expected marks" is a real number rather than a guess.
    const classIds = [...new Set(schedules.map((s) => s.classId))];
    const sizes = await this.classSizes(classIds);

    return exams.map((exam) => {
      const own = schedules.filter((s) => s.examId === exam.id);
      const classes = new Set(own.map((s) => s.classId));
      let expected = 0;
      let done = 0;
      for (const s of own) {
        expected += sizes.get(s.classId) ?? 0;
        done += enteredBySchedule.get(s.id) ?? 0;
      }
      return {
        id: exam.id,
        name: exam.name,
        status: exam.status,
        startDate: exam.startDate,
        endDate: exam.endDate,
        termId: exam.termId,
        termName: exam.term?.name ?? null,
        examTypeId: exam.examTypeId,
        examTypeName: exam.examType?.name ?? null,
        weight: exam.examType ? Number(exam.examType.weight) : null,
        isFinal: exam.examType?.isFinal ?? false,
        classCount: classes.size,
        paperCount: own.length,
        // Which class/subject papers exist, so a form can offer only the exams
        // that can still take this course's paper.
        papers: own.map((p) => ({ classId: p.classId, subjectId: p.subjectId })),
        lockedPaperCount: own.filter((s) => s.marksLockedAt != null).length,
        submittedPaperCount: own.filter((s) => approvalBySchedule.get(s.id) === 'submitted').length,
        approvedPaperCount: own.filter((s) => approvalBySchedule.get(s.id) === 'approved').length,
        // The Run-an-Examination state, so the two screens never disagree
        // about where an exam is.
        lifecycleState: exam.lifecycleState,
        marksExpected: expected,
        marksEntered: done,
      };
    });
  }

  /** Each paper's approval roll-up (weakest wins), keyed by schedule id. */
  private async approvalPerPaper(scheduleIds: string[]): Promise<Map<string, string>> {
    if (scheduleIds.length === 0) return new Map();
    const assessments = await this.prisma.client.assessment.findMany({
      where: { organizationId: this.tenant.organizationId, sourceType: 'exam_session', sourceRef: { in: scheduleIds }, deletedAt: null },
      select: { id: true, sourceRef: true },
    });
    if (assessments.length === 0) return new Map();
    const groups = await this.prisma.client.studentAssessment.groupBy({
      by: ['assessmentId', 'approvalStatus'],
      where: { assessmentId: { in: assessments.map((a) => a.id) }, deletedAt: null },
      _count: { _all: true },
    });
    const out = new Map<string, string>();
    for (const a of assessments) {
      const statuses = groups.filter((g: any) => g.assessmentId === a.id).map((g: any) => String(g.approvalStatus));
      if (a.sourceRef) out.set(a.sourceRef, this.rollupStatus(statuses));
    }
    return out;
  }

  /* ────────────────── Step 2: which classes sit this exam ────────────────── */

  /**
   * The class × exam matrix. One row per class: is it applied, how many papers,
   * how far along is entry, is it locked. This is the screen that replaces
   * hand-creating an exam schedule per subject per class.
   */
  async coverage(examId: string) {
    const exam = await this.prisma.client.exam.findFirst({
      where: { id: examId },
      include: { examType: true, term: true },
    });
    if (!exam) throw new NotFoundException(`Exam ${examId} not found`);

    const [classes, schedules] = await Promise.all([
      this.prisma.client.schoolClass.findMany({
        include: { gradeLevel: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.client.examSchedule.findMany({
        where: { examId },
        include: { subject: true },
      }),
    ]);

    const sizes = await this.classSizes(classes.map((c) => c.id));
    const enteredBySchedule = await this.markedPerPaper(schedules.map((s) => s.id));

    const rows = classes.map((c) => {
      const own = schedules.filter((s) => s.classId === c.id);
      const size = sizes.get(c.id) ?? 0;
      const done = own.reduce((n, s) => n + (enteredBySchedule.get(s.id) ?? 0), 0);
      return {
        classId: c.id,
        className: c.name,
        gradeLevelName: c.gradeLevel?.name ?? null,
        studentCount: size,
        applied: own.length > 0,
        paperCount: own.length,
        lockedPaperCount: own.filter((s) => s.marksLockedAt != null).length,
        marksExpected: own.length * size,
        marksEntered: done,
        subjects: own
          .map((s) => ({
            examScheduleId: s.id,
            subjectId: s.subjectId,
            subjectName: s.subject?.name ?? '',
            subjectCode: s.subject?.code ?? '',
            maxMarks: Number(s.maxMarks),
            locked: s.marksLockedAt != null,
            marksEntered: enteredBySchedule.get(s.id) ?? 0,
            marksExpected: size,
          }))
          .sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
      };
    });

    return {
      exam: {
        id: exam.id,
        name: exam.name,
        termId: exam.termId,
        termName: exam.term?.name ?? null,
        examTypeName: exam.examType?.name ?? null,
        status: exam.status,
        startDate: exam.startDate,
      },
      classes: rows,
    };
  }

  /**
   * Add an exam to one or more classes: one ExamSchedule per (class, subject).
   * Idempotent — re-running only fills the gaps, so a school can add a subject
   * later and press the same button.
   */
  async applyClasses(dto: ApplyClassesDto) {
    const organizationId = this.tenant.organizationId;
    const exam = await this.prisma.client.exam.findFirst({ where: { id: dto.examId } });
    if (!exam) throw new NotFoundException(`Exam ${dto.examId} not found`);

    const existing = await this.prisma.client.examSchedule.findMany({
      where: { examId: dto.examId, classId: { in: dto.classIds } },
      select: { classId: true, subjectId: true },
    });
    const have = new Set(existing.map((s) => `${s.classId}:${s.subjectId}`));

    const data: any[] = [];
    for (const classId of dto.classIds) {
      const subjectIds = dto.subjectIds?.length
        ? dto.subjectIds
        : (await this.subjectsForClass(classId)).map((s) => s.id);
      for (const subjectId of subjectIds) {
        if (have.has(`${classId}:${subjectId}`)) continue;
        data.push({
          organizationId,
          examId: dto.examId,
          classId,
          subjectId,
          date: exam.startDate,
          startTime: '09:00',
          durationMinutes: 120,
          maxMarks: dto.maxMarks ?? 100,
        });
      }
    }
    if (data.length === 0) {
      // Even with nothing new to create, older papers may predate the minting
      // rule below — give them their column now rather than on first mark.
      const minted = await this.mintForExam(dto.examId, dto.classIds);
      return { created: 0, skipped: have.size, columnsMinted: minted };
    }

    const res = await this.prisma.client.examSchedule.createMany({ data, skipDuplicates: true });
    // Every paper becomes a gradebook column the moment it is applied. Before
    // this, the column appeared only once someone typed a mark, so a teacher
    // opening the gradebook saw no sign of an exam the office had already
    // scheduled.
    const minted = await this.mintForExam(dto.examId, dto.classIds);
    await this.audit.record({
      entity: 'ExamSchedule',
      entityId: dto.examId,
      action: 'create',
      newValues: { action: 'apply_classes', examId: dto.examId, classIds: dto.classIds, created: res.count },
    });
    return { created: res.count, skipped: have.size, columnsMinted: minted };
  }

  /**
   * Take a class off an exam. Refused once any mark exists — removing it would
   * cascade-delete real marks, which is never what "untick a box" should mean.
   */
  async removeClass(dto: RemoveClassDto) {
    const schedules = await this.prisma.client.examSchedule.findMany({
      where: { examId: dto.examId, classId: dto.classId },
      select: { id: true },
    });
    if (schedules.length === 0) return { removed: 0 };

    // Guard on BOTH stores. Counting only GradeEntry would let a class be
    // dropped when its marks arrived through the spine, cascading real marks
    // away on what the user experienced as unticking a box.
    const scheduleIds = schedules.map((s) => s.id);
    const [legacyMarks, spineMarks] = await Promise.all([
      this.prisma.client.gradeEntry.count({ where: { examScheduleId: { in: scheduleIds } } }),
      this.prisma.client.studentAssessment.count({
        where: {
          deletedAt: null,
          assessment: {
            organizationId: this.tenant.organizationId,
            sourceType: 'exam_session',
            sourceRef: { in: scheduleIds },
          },
        },
      }),
    ]);
    const marks = Math.max(legacyMarks, spineMarks);
    if (marks > 0) {
      throw new ConflictException(
        `This class already has ${marks} mark(s) for this exam. Delete the marks first, or leave the class on the exam.`,
      );
    }

    const res = await this.prisma.client.examSchedule.deleteMany({
      where: { examId: dto.examId, classId: dto.classId },
    });
    await this.audit.record({
      entity: 'ExamSchedule',
      entityId: dto.examId,
      action: 'delete',
      newValues: { action: 'remove_class', examId: dto.examId, classId: dto.classId, removed: res.count },
    });
    return { removed: res.count };
  }

  /* ─────────────────────────── Step 3: marksheet ─────────────────────────── */

  /**
   * The marksheet for one paper — EVERY student in the class (optionally one
   * stream), each with their mark if one exists. Students without a GradeEntry
   * come back with `marks: null`, which is the whole point: you cannot type a
   * mark for a student the screen does not show.
   */
  async sheet(params: { examId: string; classId: string; subjectId: string; sectionId?: string }) {
    const [exam, klass, subject] = await Promise.all([
      this.prisma.client.exam.findFirst({ where: { id: params.examId }, include: { term: true, examType: true } }),
      this.prisma.client.schoolClass.findFirst({ where: { id: params.classId } }),
      this.prisma.client.subject.findFirst({ where: { id: params.subjectId } }),
    ]);
    if (!exam) throw new NotFoundException(`Exam ${params.examId} not found`);
    if (!klass) throw new NotFoundException(`Class ${params.classId} not found`);
    if (!subject) throw new NotFoundException(`Subject ${params.subjectId} not found`);

    const schedule = await this.prisma.client.examSchedule.findFirst({
      where: { examId: params.examId, classId: params.classId, subjectId: params.subjectId },
    });

    const students = await this.studentsOfClass(params.classId, params.sectionId);

    // The assessment IS the paper now. Its `lockedAt` is the lock that bites
    // (postMark enforces it everywhere); the schedule column is the legacy
    // mirror, still read so a paper locked before the cutover stays locked.
    const spine = schedule
      ? await this.prisma.client.assessment.findFirst({
          where: { organizationId: this.tenant.organizationId, sourceType: 'exam_session', sourceRef: schedule.id },
          include: { studentAssessments: { where: { deletedAt: null } } },
        })
      : null;
    const locked = spine?.lockedAt ?? schedule?.marksLockedAt ?? null;

    // Marks come off the spine, and the legacy row supplies only what the spine
    // does not carry: the letter grade frozen under the scale in force when the
    // mark was entered. Reading `marksObtained` here was the last place the two
    // stores could disagree on screen.
    const entries = schedule
      ? await this.prisma.client.gradeEntry.findMany({ where: { examScheduleId: schedule.id } })
      : [];
    const legacyByStudent = new Map(entries.map((g) => [g.studentProfileId, g]));
    const spineByStudent = new Map((spine?.studentAssessments ?? []).map((r: any) => [r.studentProfileId, r]));

    const maxMarks = schedule ? Number(schedule.maxMarks) : 100;
    const gradeOf = await this.gradeOfForClass(params.classId, exam.term?.academicYearId ?? null);
    const rows = students.map((s, i) => {
      const sa: any = spineByStudent.get(s.studentProfileId);
      const g = legacyByStudent.get(s.studentProfileId);
      return {
        index: i + 1,
        ...s,
        gradeEntryId: g?.id ?? null,
        studentAssessmentId: sa?.id ?? null,
        // `effectiveScore` is post-moderation — the mark that actually counts,
        // which is what a marksheet should show.
        marks: sa?.effectiveScore != null ? Number(sa.effectiveScore) : null,
        // Graded under the CLASS's profile, exactly as the merit list grades
        // it. The frozen legacy letter is only a fallback for a row the spine
        // has no score for.
        grade: sa?.effectiveScore != null ? gradeOf(Number(sa.effectiveScore), maxMarks) : g?.grade ?? null,
        remarks: g?.remarks ?? null,
        participation: String(sa?.participation ?? 'present'),
        status: String(sa?.approvalStatus ?? g?.status ?? 'draft'),
        rejectionReason: (sa?.rejectionReason as string | null | undefined) ?? null,
        // The version `postMark` compares against is the SPINE row's. This used
        // to return the frozen GradeEntry's version, so any mark saved since the
        // B6 flip reloaded with a version the server would never accept and
        // every edit of it bounced as a 409 "changed by someone else".
        version: sa?.version ?? 0,
      };
    });

    const entered = rows.filter((r) => r.marks != null || NON_SCORING.has(r.participation)).length;

    return {
      exam: {
        id: exam.id,
        name: exam.name,
        termId: exam.termId,
        termName: exam.term?.name ?? null,
        examTypeName: exam.examType?.name ?? null,
      },
      class: { id: klass.id, name: klass.name },
      subject: { id: subject.id, name: subject.name, code: subject.code },
      examScheduleId: schedule?.id ?? null,
      applied: schedule != null,
      maxMarks,
      locked: locked != null,
      lockedAt: locked,
      approvalStatus: this.rollupStatus(rows.map((r) => r.status)),
      total: rows.length,
      entered,
      students: rows,
    };
  }

  /**
   * Save one cell. Creates the exam schedule on demand, so a teacher who picked
   * a subject the office forgot to apply is not blocked — the paper is created
   * the moment a mark is typed into it.
   */
  async saveMark(dto: SaveMarkDto) {
    // The route admits `school:read`; ownership is decided here so a teacher
    // holding `school:grades:own` can enter their own papers (and only those).
    await this.marking.assertMayEnterExamPaper(dto.classId, dto.subjectId);
    await this.assertExamOpen(dto.examId);
    const schedule = await this.ensureSchedule(dto.examId, dto.classId, dto.subjectId, dto.maxMarks);
    const spineLock = await this.prisma.client.assessment.findFirst({
      where: { organizationId: this.tenant.organizationId, sourceType: 'exam_session', sourceRef: schedule.id },
      select: { lockedAt: true },
    });
    if (spineLock?.lockedAt ?? schedule.marksLockedAt) {
      throw new ConflictException('Mark entry is locked for this paper. Unlock it to make changes.');
    }

    const student = await this.prisma.client.studentProfile.findFirst({
      where: { id: dto.studentProfileId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

    const maxMarks = Number(schedule.maxMarks);
    const clearing = dto.marks === null || dto.marks === undefined;

    if (clearing) {
      // Clearing a cell (or marking a non-scoring outcome) must not leave a
      // stale numeric mark behind — in EITHER store. This used to write
      // `gradeEntry` here directly and return, with no projection, so the spine
      // kept the old score and the gradebook, the result run and the report card
      // all went on counting a mark the teacher had erased.
      const remarks = dto.participation && dto.participation !== 'present' ? dto.participation : null;
      const res = await this.grades.clearEntry({
        examScheduleId: schedule.id,
        studentProfileId: dto.studentProfileId,
        remarks,
      });
      if (!res.row) return { cleared: true };
      return { cleared: true, examScheduleId: schedule.id, participation: dto.participation ?? null };
    }

    if (dto.marks! < 0 || dto.marks! > maxMarks) {
      throw new BadRequestException(`Mark must be between 0 and ${maxMarks}`);
    }

    // Reuse the hardened bulk path: range check, grading-scale band lookup,
    // audit, event, and the atomic projection into the assessment spine.
    const res = await this.grades.bulkUpsert({
      examScheduleId: schedule.id,
      entries: [
        {
          studentProfileId: dto.studentProfileId,
          marksObtained: dto.marks!,
          maxMarks,
          remarks: dto.participation && dto.participation !== 'present' ? dto.participation : undefined,
          // `bulkUpsert` already forwards this to postMark; it was simply never
          // populated from this route, so mark entry had no concurrency guard.
          version: dto.expectedVersion,
        },
      ],
    });

    // Read the SPINE back, not `res.results`. That array is a re-read of the
    // frozen GradeEntry table, which the B6 flip stopped writing — so it is
    // always empty and this method returned `marks: null` for every successful
    // save, blanking the mark in the workspace the instant a teacher entered it.
    void res;
    const assessment = await this.prisma.client.assessment.findFirst({
      where: { organizationId: this.tenant.organizationId, sourceType: 'exam_session', sourceRef: schedule.id },
      select: { id: true },
    });
    const row = assessment
      ? await this.prisma.client.studentAssessment.findFirst({
          where: { assessmentId: assessment.id, studentProfileId: dto.studentProfileId },
          select: { id: true, effectiveScore: true, percentage: true, version: true },
        })
      : null;
    let grade: string | null = null;
    if (row?.effectiveScore != null) {
      const term = await this.prisma.client.exam.findFirst({ where: { id: dto.examId }, select: { term: { select: { academicYearId: true } } } });
      grade = (await this.gradeOfForClass(dto.classId, term?.term?.academicYearId ?? null))(Number(row.effectiveScore), maxMarks);
    }
    return {
      examScheduleId: schedule.id,
      studentAssessmentId: row?.id ?? null,
      marks: row?.effectiveScore != null ? Number(row.effectiveScore) : null,
      grade,
      version: row?.version ?? 0,
    };
  }

  /**
   * Send one paper (exam × class × subject) for approval.
   *
   * Exam papers are minted without a class list, and the approval workflow
   * needs one: "every learner has a mark or a reason" means nothing until it
   * is fixed WHO the learners are. So the first submission captures the
   * paper's own class list — from the same placement history every other
   * roster is derived from — freezes it, and binds it to the paper. It is a
   * paper-scoped list (`scopeType: subject`), deliberately NOT the class's
   * term list: freezing that here would shut out a pupil admitted later in
   * the term from the whole term's results, on the say-so of one mid-term
   * paper. The term list stays the Term Board's to lock — and once it IS
   * locked, papers bind to it rather than to a capture of their own.
   *
   * Every learner on the list needs a mark or a recorded reason (absent,
   * exempt, excused, malpractice) before the paper can go. Returned rows and
   * never-sent rows go together, so a corrected paper is sent whole.
   */
  async submitPaper(dto: PaperRefDto) {
    await this.marking.assertMayEnterExamPaper(dto.classId, dto.subjectId);
    await this.assertExamOpen(dto.examId);
    const schedule = await this.prisma.client.examSchedule.findFirst({
      where: { examId: dto.examId, classId: dto.classId, subjectId: dto.subjectId },
      include: { exam: { select: { termId: true } } },
    });
    if (!schedule) throw new NotFoundException('This class does not sit this paper. Add the class to the exam first.');

    const assessment = await this.prisma.client.$transaction((tx: any) => this.mint.forExamSchedule(tx, schedule.id));
    if (!assessment) throw new NotFoundException('This paper has no mark sheet yet.');
    const rosterId: string = assessment.rosterId ?? (await this.bindPaperRoster(assessment.id, schedule));

    const [members, rows] = await Promise.all([
      this.prisma.client.academicRosterMember.findMany({ where: { rosterId }, select: { studentProfileId: true } }),
      this.prisma.client.studentAssessment.findMany({
        where: { assessmentId: assessment.id, deletedAt: null },
        select: { studentProfileId: true, effectiveScore: true, participation: true, approvalStatus: true },
      }),
    ]);
    const byStudent = new Map(rows.map((r) => [r.studentProfileId, r]));
    const missingIds = members
      .map((m) => m.studentProfileId)
      .filter((id) => {
        const r = byStudent.get(id);
        return !r || (r.effectiveScore == null && !RESOLVED_WITHOUT_MARK.has(String(r.participation)));
      });
    if (missingIds.length > 0) {
      const names = await this.namesOf(missingIds.slice(0, 5));
      throw new BadRequestException({
        code: 'PAPER_INCOMPLETE',
        message:
          `${missingIds.length} pupil(s) have no mark or reason yet: ${names.join(', ')}` +
          `${missingIds.length > 5 ? ` and ${missingIds.length - 5} more` : ''}. Enter a mark, or choose why it is not marked.`,
        missing: missingIds,
      });
    }

    const pending = rows.filter((r) => r.approvalStatus === 'draft' || r.approvalStatus === 'rejected');
    if (pending.length === 0) {
      const waiting = rows.some((r) => r.approvalStatus === 'submitted');
      throw new ConflictException(waiting ? 'This paper is already waiting for approval.' : 'This paper is already approved.');
    }
    const res = await this.marking.markingApproval(
      { assessmentId: assessment.id, action: rows.some((r) => r.approvalStatus === 'rejected') ? 'resubmit' : 'submit' } as any,
      { entryAuthorised: true },
    );
    return { assessmentId: assessment.id, rosterId, submitted: (res as { updated: number }).updated };
  }

  /** A closed or archived exam takes no more marks, whichever screen they come from. */
  private async assertExamOpen(examId: string) {
    const exam = await this.prisma.client.exam.findFirst({ where: { id: examId }, select: { lifecycleState: true } });
    if (exam && ['closed', 'archived'].includes(String(exam.lifecycleState))) {
      throw new ConflictException(`This exam is ${exam.lifecycleState}. Its marks can no longer be changed.`);
    }
  }

  /**
   * Bind the paper to its class list. Concurrency-safe: the first binder wins.
   *
   * Once the Term Board has locked the class's term list, THAT is the list —
   * the result run reads it, so a paper bound to a fresher capture could ask
   * for marks the term result will never count (a pupil placed after the
   * lock), or let one go missing. Only before the lock does a paper capture
   * and freeze its own list.
   */
  private async bindPaperRoster(
    assessmentId: string,
    schedule: { classId: string; subjectId: string; exam: { termId: string } },
  ): Promise<string> {
    const termList = await this.prisma.client.academicRoster.findFirst({
      where: {
        termId: schedule.exam.termId, scopeType: 'class', classId: schedule.classId,
        sectionId: null, subjectId: null, frozenAt: { not: null }, deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (termList) {
      const bound = await this.prisma.client.assessment.updateMany({
        where: { id: assessmentId, rosterId: null },
        data: { rosterId: termList.id, version: { increment: 1 } },
      });
      if (bound.count === 0) {
        const winner = await this.prisma.client.assessment.findFirst({ where: { id: assessmentId }, select: { rosterId: true } });
        return winner!.rosterId!;
      }
      await this.audit.record({
        entity: 'Assessment',
        entityId: assessmentId,
        action: 'update',
        newValues: { action: 'bind_term_class_list', rosterId: termList.id },
      });
      return termList.id;
    }

    const captured: any = await this.rosters.capture({
      termId: schedule.exam.termId,
      scopeType: 'subject',
      classId: schedule.classId,
      subjectId: schedule.subjectId,
      name: 'Exam paper class list',
    } as any);
    if (!captured?.members?.length) {
      await this.prisma.client.academicRoster.updateMany({ where: { id: captured.id }, data: { deletedAt: new Date() } });
      throw new BadRequestException('No pupils are placed in this class, so there is nothing to submit.');
    }
    await this.rosters.freeze(captured.id);
    const bound = await this.prisma.client.assessment.updateMany({
      where: { id: assessmentId, rosterId: null },
      data: { rosterId: captured.id, version: { increment: 1 } },
    });
    if (bound.count === 0) {
      // Someone else bound a list first — use theirs, retire ours.
      await this.prisma.client.academicRoster.updateMany({ where: { id: captured.id }, data: { deletedAt: new Date() } });
      const winner = await this.prisma.client.assessment.findFirst({ where: { id: assessmentId }, select: { rosterId: true } });
      return winner!.rosterId!;
    }
    await this.audit.record({
      entity: 'Assessment',
      entityId: assessmentId,
      action: 'update',
      newValues: { action: 'bind_paper_roster', rosterId: captured.id, members: captured.members.length },
    });
    return captured.id as string;
  }

  private async namesOf(studentIds: string[]) {
    const rows = await this.prisma.client.studentProfile.findMany({
      where: { id: { in: studentIds } },
      select: { admissionNo: true, partner: { select: { name: true } } },
    });
    return rows.map((r: any) => r.partner?.name ?? r.admissionNo);
  }

  /* ─────────────────────────── Step 4: results ─────────────────────────── */

  /**
   * The results grid for one exam × class: students down, subjects across,
   * with total / average / grade / position. This is the sheet a head teacher
   * actually reads, and it is computed from the same marks that were typed —
   * no separate "compute" step to forget.
   */
  async grid(params: { examId: string; classId: string; sectionId?: string }) {
    const exam = await this.prisma.client.exam.findFirst({
      where: { id: params.examId },
      include: { term: true, examType: true },
    });
    if (!exam) throw new NotFoundException(`Exam ${params.examId} not found`);

    const schedules = await this.prisma.client.examSchedule.findMany({
      where: { examId: params.examId, classId: params.classId },
      include: { subject: true },
    });
    const subjects = schedules
      .map((s) => ({
        examScheduleId: s.id,
        subjectId: s.subjectId,
        name: s.subject?.name ?? '',
        code: s.subject?.code ?? '',
        maxMarks: Number(s.maxMarks),
        locked: s.marksLockedAt != null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const students = await this.studentsOfClass(params.classId, params.sectionId);

    // Off the spine, keyed back to the paper it came from. The grid stays RAW —
    // one column per paper, no weighting — because it answers "how did the
    // class do in this exam", which is a different question from "what is the
    // term mark". The weighted view already exists twice, as the gradebook and
    // as a published ResultSet; running `computeSubject` over one exam's
    // assessments would divide by weights that do not sum to 100 and quietly
    // under-report every student.
    const scheduleIds = schedules.map((s) => s.id);
    const spineAssessments = scheduleIds.length
      ? await this.prisma.client.assessment.findMany({
          where: {
            organizationId: this.tenant.organizationId,
            sourceType: 'exam_session',
            sourceRef: { in: scheduleIds },
            deletedAt: null,
          },
          include: { studentAssessments: { where: { deletedAt: null } } },
        })
      : [];
    const legacyGrades = scheduleIds.length
      ? await this.prisma.client.gradeEntry.findMany({ where: { examScheduleId: { in: scheduleIds } } })
      : [];

    const scheduleSubject = new Map(schedules.map((s) => [s.id, s.subjectId]));
    // Where each paper stands in the approval workflow. Everything on this
    // sheet is provisional until its paper is approved, and anything that
    // leaves the building (results SMS) waits for that.
    const paperApproval = new Map<string, string>();
    for (const a of spineAssessments) {
      if (a.sourceRef) paperApproval.set(a.sourceRef, this.rollupStatus((a.studentAssessments as any[]).map((sa) => String(sa.approvalStatus))));
    }
    for (const sub of subjects as any[]) sub.approvalStatus = paperApproval.get(sub.examScheduleId) ?? 'draft';
    const bySubject = new Map<string, Map<string, any>>();
    for (const s of subjects) bySubject.set(s.subjectId, new Map());
    for (const a of spineAssessments) {
      const subjectId = a.sourceRef ? scheduleSubject.get(a.sourceRef) : null;
      if (!subjectId) continue;
      for (const sa of a.studentAssessments as any[]) {
        bySubject.get(subjectId)?.set(sa.studentProfileId, {
          marksObtained: sa.effectiveScore,
          participation: String(sa.participation ?? 'present'),
          grade: null,
        });
      }
    }
    // The letter grade is the one fact the spine does not carry — it was frozen
    // under the scale in force when the mark was entered. Fold it in.
    for (const g of legacyGrades) {
      const subjectId = scheduleSubject.get(g.examScheduleId);
      const cell = subjectId ? bySubject.get(subjectId)?.get(g.studentProfileId) : null;
      if (cell) cell.grade = g.grade ?? null;
    }

    // The merit list a Ugandan DOS prints after BOT/MOT/EOT (review A10): each
    // paper's grade and points, then the aggregate over the class's four
    // aggregate subjects and its division, ranked by aggregate (ties broken on
    // total marks). The class's grading profile decides - the same
    // reportingPolicy a result run uses - so a P2 sheet shows grades with no
    // division, and a nursery sheet descriptors with no position.
    const reporting = await this.reportingForClass(params.classId, exam.term?.academicYearId ?? null);
    const scale = await resolveScale(this.prisma.client, reporting.gradingSystem).catch(() => null);
    const descriptor = isDescriptorSystem(reporting.gradingSystem);
    const aggregateIds = new Set(reporting.aggregateSubjectIds);
    const hasAggregate = aggregateIds.size > 0 && reporting.gradingSystem === 'PLE';
    const bandOf = (pct: number) => (scale ? kernelBand(new Prisma.Decimal(pct), scale.bands, scale.rounding) : null);

    const rows = students.map((s) => {
      const cells: Record<string, { marks: number | null; grade: string | null; points: number | null; participation: string }> = {};
      let total = 0;
      let counted = 0;
      let maxTotal = 0;
      let aggregate = 0;
      let aggregateSat = 0;
      for (const sub of subjects) {
        const g = bySubject.get(sub.subjectId)?.get(s.studentProfileId);
        const marks = g?.marksObtained != null ? Number(g.marksObtained) : null;
        const band = marks != null && sub.maxMarks > 0 ? bandOf((marks / sub.maxMarks) * 100) : null;
        const points = band?.points ?? null;
        cells[sub.subjectId] = {
          marks,
          grade: band?.grade ?? g?.grade ?? null,
          points,
          participation: g?.participation ?? 'present',
        };
        if (marks != null) {
          total += marks;
          maxTotal += sub.maxMarks;
          counted += 1;
          if (aggregateIds.has(sub.subjectId) && points != null) {
            aggregate += points;
            aggregateSat += 1;
          }
        }
      }
      const average = counted > 0 ? total / counted : null;
      const percentage = maxTotal > 0 ? (total / maxTotal) * 100 : null;
      const complete = hasAggregate && aggregateSat === aggregateIds.size;
      // An overall grade off the average is not how a Ugandan primary sheet
      // reads; it is kept only where there is no aggregate to state.
      const overall = !hasAggregate && percentage != null ? bandOf(percentage) : null;
      return {
        ...s,
        cells,
        subjectsMarked: counted,
        total: counted > 0 ? Number(total.toFixed(2)) : null,
        average: average != null ? Number(average.toFixed(2)) : null,
        percentage: percentage != null ? Number(percentage.toFixed(2)) : null,
        grade: overall?.grade ?? null,
        aggregate: complete ? aggregate : null,
        division: hasAggregate && counted > 0 ? divisionPLE(aggregate, complete) : null,
        position: 0 as number | null,
      };
    });

    // Positions: by aggregate (lower is better), ties broken on total; or on
    // total where the class has no aggregate. Competition ranking - a full tie
    // shares a position and the next skips. A nursery sheet has no positions.
    // The class's ranking rule is the result run's (`reportingPolicy.rankOn`):
    // a lower-primary or nursery class, or any programme that switched
    // ranking off, gets no positions here either. This sheet used to rank
    // every non-nursery class, so P1–P3 parents were texted positions the
    // school had decided not to give.
    if (descriptor || reporting.rankOn === 'none') {
      for (const r of rows) r.position = null;
    } else {
      const byMean = reporting.rankOn === 'meanPercent';
      const ranked = rows
        .filter((r) => (hasAggregate ? r.aggregate != null : byMean ? r.percentage != null : r.total != null))
        .sort((a, b) =>
          (hasAggregate ? (a.aggregate ?? 0) - (b.aggregate ?? 0) : 0) ||
          (byMean ? (b.percentage ?? 0) - (a.percentage ?? 0) : 0) ||
          (b.total ?? 0) - (a.total ?? 0));
      let prevA: number | null = null;
      let prevT: number | null = null;
      let pos = 0;
      ranked.forEach((r, i) => {
        if (i === 0 || prevA !== r.aggregate || prevT !== r.total) {
          pos = i + 1;
          prevA = r.aggregate;
          prevT = r.total;
        }
        r.position = pos;
      });
      const inRank = new Set(ranked);
      for (const r of rows) if (!inRank.has(r)) r.position = null;
    }
    const divisionSummary: Record<string, number> = {};
    for (const r of rows) if (r.division) divisionSummary[r.division] = (divisionSummary[r.division] ?? 0) + 1;

    const expected = students.length * subjects.length;
    const done = spineAssessments.reduce(
      (n, a) => n + (a.studentAssessments as any[]).filter((sa) => sa.effectiveScore != null).length,
      0,
    );
    return {
      exam: {
        id: exam.id,
        name: exam.name,
        termId: exam.termId,
        termName: exam.term?.name ?? null,
        examTypeName: exam.examType?.name ?? null,
      },
      subjects,
      reporting: {
        gradingSystem: reporting.gradingSystem,
        rankOn: reporting.rankOn,
        aggregateSubjectIds: [...aggregateIds],
        hasAggregate,
        descriptor,
      },
      divisionSummary,
      students: rows.sort((a, b) => a.name.localeCompare(b.name)),
      classSize: students.length,
      marksExpected: expected,
      marksEntered: done,
      complete: expected > 0 && done >= expected,
      lockedPaperCount: subjects.filter((s) => s.locked).length,
      approvedPaperCount: subjects.filter((s: any) => s.approvalStatus === 'approved').length,
      /** Every paper approved — nothing on this sheet can still change. */
      approved: subjects.length > 0 && subjects.every((s: any) => s.approvalStatus === 'approved'),
      paperCount: subjects.length,
    };
  }

  /* ─────────────────────────── Lock / unlock ─────────────────────────── */

  async setLock(dto: LockMarksDto) {
    const where: any = { examId: dto.examId, classId: dto.classId };
    if (dto.subjectId) where.subjectId = dto.subjectId;

    const schedules = await this.prisma.client.examSchedule.findMany({ where, select: { id: true } });
    if (schedules.length === 0) {
      throw new NotFoundException('No papers found for this exam and class.');
    }

    const at = dto.locked ? new Date() : null;
    const by = dto.locked ? (this.tenant.userId ?? null) : null;
    const ids = schedules.map((s) => s.id);

    // `Assessment.lockedAt` is the lock that BITES — `postMark` enforces it, so
    // it stops the gradebook cell, the LMS bridge and the CBT bridge too.
    // `ExamSchedule.marksLockedAt` was only ever checked by this one service,
    // which meant a "locked" paper stayed writable through every other door.
    // Both are written until the legacy column is dropped.
    const res = await this.prisma.client.$transaction(async (tx: any) => {
      const updated = await tx.examSchedule.updateMany({
        where: { id: { in: ids } },
        data: { marksLockedAt: at, marksLockedById: by },
      });
      await this.mint.forExamSchedules(tx, ids);
      await tx.assessment.updateMany({
        where: { organizationId: this.tenant.organizationId, sourceType: 'exam_session', sourceRef: { in: ids } },
        data: { lockedAt: at, lockedById: by },
      });
      return updated;
    });
    await this.audit.record({
      entity: 'ExamSchedule',
      entityId: dto.examId,
      action: 'update',
      newValues: {
        action: dto.locked ? 'lock_marks' : 'unlock_marks',
        examId: dto.examId,
        classId: dto.classId,
        subjectId: dto.subjectId ?? null,
        count: res.count,
      },
    });
    return { updated: res.count, locked: dto.locked };
  }

  /* ─────────────────────────── Helpers ─────────────────────────── */

  /**
   * Subjects a class actually takes. Derived from who is timetabled/assigned to
   * teach it; a school that has not set either up yet falls back to the full
   * subject list rather than showing an empty screen.
   */
  async subjectsForClass(classId: string) {
    const [assignments, slots] = await Promise.all([
      this.prisma.client.teacherAssignment.findMany({ where: { classId }, select: { subjectId: true } }),
      this.prisma.client.timetableSlot.findMany({
        where: { classId, type: 'lesson' },
        select: { subjectId: true },
      }),
    ]);
    const ids = [...new Set([...assignments, ...slots].map((r) => r.subjectId))];
    const subjects = await this.prisma.client.subject.findMany({
      where: ids.length > 0 ? { id: { in: ids } } : {},
      orderBy: { name: 'asc' },
    });
    return subjects.map((s) => ({ id: s.id, name: s.name, code: s.code, isCore: s.isCore }));
  }

  /** Active students of a class, optionally one stream, ordered by name — from placement history. */
  private async studentsOfClass(classId: string, sectionId?: string): Promise<StudentRow[]> {
    const roster = await this.placements.roster({
      classIds: [classId],
      ...(sectionId ? { sectionIds: [sectionId] } : {}),
    });
    return roster
      .map((r) => ({
        studentProfileId: r.student.id,
        name: r.student.partner?.name ?? r.student.admissionNo,
        admissionNo: r.student.admissionNo,
        sectionId: r.sectionId,
        sectionName: r.sectionName,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Active learners per class, placed or (during the compat window) projected. */
  private async classSizes(classIds: string[]): Promise<Map<string, number>> {
    return this.placements.classSizes(classIds);
  }

  /** Find the paper, creating it if a mark is being entered for a missing one. */
  private async ensureSchedule(examId: string, classId: string, subjectId: string, maxMarks?: number) {
    const existing = await this.prisma.client.examSchedule.findFirst({
      where: { examId, classId, subjectId },
    });
    if (existing) return existing;

    const exam = await this.prisma.client.exam.findFirst({ where: { id: examId } });
    if (!exam) throw new NotFoundException(`Exam ${examId} not found`);
    return this.prisma.client.examSchedule.create({
      data: {
        organizationId: this.tenant.organizationId,
        examId,
        classId,
        subjectId,
        date: exam.startDate,
        startTime: '09:00',
        durationMinutes: 120,
        maxMarks: maxMarks ?? 100,
      },
    });
  }

  /** `remarks` doubles as the non-scoring outcome marker on the legacy row. */
  /**
   * How many students have a resolved outcome on each paper.
   *
   * Counted off the spine, and a non-scoring outcome COUNTS: a student marked
   * absent is done, not outstanding, and showing them as unmarked sends a
   * teacher looking for a mark that is never coming.
   *
   * (`participationOf` used to sit here, deriving participation by string-
   * matching free-text `remarks`. It is gone: participation is a real enum on
   * the spine now, so a teacher typing "absent" as a comment can no longer flip
   * it by accident.)
   */
  private async markedPerPaper(scheduleIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (scheduleIds.length === 0) return out;

    const assessments = await this.prisma.client.assessment.findMany({
      where: {
        organizationId: this.tenant.organizationId,
        sourceType: 'exam_session',
        sourceRef: { in: scheduleIds },
        deletedAt: null,
      },
      include: {
        studentAssessments: {
          where: { deletedAt: null },
          select: { effectiveScore: true, participation: true },
        },
      },
    });
    for (const a of assessments) {
      if (!a.sourceRef) continue;
      const n = (a.studentAssessments as any[]).filter(
        (sa) => sa.effectiveScore != null || NON_SCORING.has(String(sa.participation)),
      ).length;
      out.set(a.sourceRef, n);
    }
    return out;
  }

  /** Give every paper of this exam, in these classes, its gradebook column. */
  private async mintForExam(examId: string, classIds: string[]): Promise<number> {
    const schedules = await this.prisma.client.examSchedule.findMany({
      where: { examId, classId: { in: classIds } },
      select: { id: true },
    });
    if (schedules.length === 0) return 0;
    return this.prisma.client.$transaction((tx: any) =>
      this.mint.forExamSchedules(tx, schedules.map((s) => s.id)),
    );
  }

  /** Weakest status wins, so "partly approved" never reads as approved. */
  private rollupStatus(statuses: string[]): string {
    if (statuses.length === 0) return 'draft';
    if (statuses.includes('rejected')) return 'rejected';
    if (statuses.includes('draft')) return 'draft';
    if (statuses.includes('submitted')) return 'submitted';
    return 'approved';
  }

  /**
   * The class's grading profile for the exam's year, resolved exactly as a
   * result run resolves it: the class cohort's programme, else the grade's
   * default programme; aggregate subject codes resolved to ids.
   */
  private async reportingForClass(classId: string, academicYearId: string | null) {
    const db = this.prisma.client as any;
    const cohort = academicYearId
      ? await db.classCohort.findFirst({
          where: { classId, academicYearId },
          select: { programme: { select: { stage: true, config: true } } },
        })
      : null;
    const programme =
      cohort?.programme ??
      (await db.schoolClass.findFirst({
        where: { id: classId },
        select: { gradeLevel: { select: { academicLevel: { select: { defaultProgramme: { select: { stage: true, config: true } } } } } } },
      }))?.gradeLevel?.academicLevel?.defaultProgramme ??
      null;
    const policy = reportingPolicy(programme, (await this.gradingSystem()) ?? 'PLE');
    const codes = policy.aggregateSubjectCodes;
    const byCode = codes.length
      ? await db.subject.findMany({ where: { code: { in: codes }, deletedAt: null }, select: { id: true } })
      : [];
    return {
      gradingSystem: policy.gradingSystem,
      rankOn: policy.rankOn,
      aggregateSubjectIds: [...new Set([...policy.aggregateSubjectIds, ...byCode.map((s: any) => s.id)])] as string[],
    };
  }

  /**
   * One grading rule for a class, shared by the mark sheet, the autosave reply
   * and the merit list: the class's programme profile, its scale, and the
   * scale's rounding. Enter-marks used to grade under the school-wide system
   * while the merit list used the class's, so one mark showed two grades.
   */
  private async gradeOfForClass(classId: string, academicYearId: string | null) {
    const reporting = await this.reportingForClass(classId, academicYearId);
    const scale = await resolveScale(this.prisma.client, reporting.gradingSystem).catch(() => null);
    return (marks: number, maxMarks: number): string | null => {
      if (!scale || !(maxMarks > 0)) return null;
      return kernelBand(new Prisma.Decimal((marks / maxMarks) * 100), scale.bands, scale.rounding)?.grade ?? null;
    };
  }

  private async gradingSystem() {
    const profile = await this.prisma.client.schoolProfile.findFirst({
      where: { organizationId: this.tenant.organizationId },
      select: { gradingSystem: true },
    });
    return profile?.gradingSystem ?? undefined;
  }
}
