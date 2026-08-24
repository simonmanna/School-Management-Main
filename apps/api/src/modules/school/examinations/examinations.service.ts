import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Exam, ExamSchedule, ExamType, GradeEntry, GradingScale } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { AuditService } from '../../../kernel/audit/audit.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import { GradingService } from './grading.service';
import { ReportCardTemplateService } from './report-card-template.service';
import { MarkingService } from '../assessment/marking.service';
import { AssessmentMintService } from '../assessment/assessment-mint.service';
import { ResultRunService } from '../assessment/result-run.service';
import type {
  BulkGradeEntryDto,
  CreateExamDto,
  CreateExamScheduleDto,
  CreateExamTypeDto,
  CreateGradingScaleDto,
  GenerateReportCardDto,
  GradeEntryUpdateDto,
  UpdateExamDto,
  UpdateExamScheduleDto,
  UpdateExamTypeDto,
  UpdateGradingScaleDto,
  UpdateReportCardCommentDto,
} from './dto.types';

@Injectable()
export class ExamTypeService extends BaseCrudService<ExamType, CreateExamTypeDto, UpdateExamTypeDto> {
  protected readonly entityName = 'ExamType';
  protected readonly searchFields = ['name'];
  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.examType as unknown as CrudDelegate);
  }
}

@Injectable()
export class ExamService extends BaseCrudService<Exam, CreateExamDto, UpdateExamDto> {
  protected readonly entityName = 'Exam';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { examType: true, term: true, schedules: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
  ) {
    super(prisma.client.exam as unknown as CrudDelegate);
  }

  async schedule(dto: CreateExamDto): Promise<Exam> {
    // JSON bodies arrive as date-only strings; Prisma's DateTime fields reject
    // them, so coerce to Date before the write (same fix as Term/AcademicYear).
    const payload = {
      ...dto,
      classes: dto.classes as any,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
    } as any;
    const row = await super.create(payload);
    this.events.publish(EVENTS.SchoolExamScheduled, {
      organizationId: this.tenant.organizationId,
      examId: row.id,
      termId: row.termId,
    });
    return row;
  }

  async publish(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.exam.updateMany({ where: { id }, data: { status: 'published' } });
      if (res.count === 0) throw new NotFoundException(`Exam ${id} not found`);
      const row = await tx.exam.findFirst({ where: { id } });
      this.events.publish(EVENTS.SchoolExamPublished, {
        organizationId: this.tenant.organizationId,
        examId: id,
      });
      return row;
    });
  }

  async close(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.exam.updateMany({ where: { id }, data: { status: 'closed' } });
      if (res.count === 0) throw new NotFoundException(`Exam ${id} not found`);
      const row = await tx.exam.findFirst({ where: { id } });
      this.events.publish(EVENTS.SchoolExamClosed, {
        organizationId: this.tenant.organizationId,
        examId: id,
      });
      return row;
    });
  }
}

@Injectable()
export class ExamScheduleService extends BaseCrudService<ExamSchedule, CreateExamScheduleDto, UpdateExamScheduleDto> {
  protected readonly entityName = 'ExamSchedule';
  protected readonly searchFields: string[] = [];
  protected readonly defaultInclude = { subject: true, schoolClass: true };

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.examSchedule as unknown as CrudDelegate);
  }

  /**
   * A4: refuse to create a sitting that double-books a venue or invigilator at
   * the same date + start time. Returns structured conflicts as a 400 body.
   */
  async create(dto: CreateExamScheduleDto): Promise<ExamSchedule> {
    const d = dto as CreateExamScheduleDto & { venueId?: string; invigilatorId?: string; date: string; startTime: string };
    if (d.venueId || d.invigilatorId) {
      const day = new Date(d.date);
      const start = new Date(day); start.setHours(0, 0, 0, 0);
      const end = new Date(day); end.setHours(23, 59, 59, 999);
      const sameSlot = await this.prisma.client.examSchedule.findMany({
        where: { date: { gte: start, lte: end }, startTime: d.startTime },
      });
      const conflicts: Array<{ code: string; detail: string }> = [];
      for (const s of sameSlot) {
        if (d.venueId && s.venueId === d.venueId) conflicts.push({ code: 'VENUE_CLASH', detail: `venue booked at ${d.startTime}` });
        if (d.invigilatorId && s.invigilatorId === d.invigilatorId) conflicts.push({ code: 'INVIGILATOR_CLASH', detail: `invigilator busy at ${d.startTime}` });
      }
      if (conflicts.length > 0) throw new BadRequestException({ message: 'Exam scheduling clash', conflicts });
    }
    // JSON bodies send date-only strings; coerce to Date for Prisma's DateTime.
    const schedulePayload = { ...dto, date: dto.date ? new Date(dto.date) : undefined } as any;
    return super.create(schedulePayload);
  }
}

interface GradeBand { min: number; max: number; grade: string; gpa: number; remark?: string }

/**
 * GradeEntryService + GradingService.
 * Bulk-grade a class for a single exam schedule, then grade-approval workflow.
 * GradingService applies the GradingScale to compute grade letter + grade point,
 * and RankingService computes class rank + overall rank.
 */
/** `GradeEntry` records a non-scoring outcome in free-text `remarks`. */
const NON_SCORING_REMARKS = new Set(['absent', 'exempt', 'excused', 'malpractice', 'special_consideration']);

@Injectable()
export class GradeEntryService extends BaseCrudService<GradeEntry, { examScheduleId: string; studentProfileId: string; marksObtained: number; maxMarks: number }, GradeEntryUpdateDto> {
  protected readonly entityName = 'GradeEntry';
  protected readonly searchFields: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly grading: GradingService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly marking: MarkingService,
    private readonly mint: AssessmentMintService,
  ) {
    super(prisma.client.gradeEntry as unknown as CrudDelegate);
  }

  /**
   * Bulk-upsert grades for a class × exam. After save, recompute letter grade
   * + grade point from the active GradingScale.
   *
   * A0 hardening:
   *   - marks are validated `0 ≤ marksObtained ≤ maxMarks` (a DB CHECK backs this);
   *   - the grade is resolved under the school's own grading system, not a
   *     hard-coded default;
   *   - each write is audited inside the transaction;
   *   - `SchoolGradePosted` is emitted (it was declared but never fired);
   *   - an optimistic-concurrency `version` guard stops two markers silently
   *     overwriting each other.
   */
  /**
   * Bulk-upsert grades for a class × exam.
   *
   * B6 — the spine (Assessment → StudentAssessment → MarkEntry) is the ONLY mark
   * store. `GradeEntry` is now structurally unwritable (a DB trigger blocks every
   * INSERT/UPDATE/DELETE, and this method no longer touches it). Marks are written
   * by the one writer, `MarkingService.postMark`. The legacy `GradeEntry` rows
   * that already exist are frozen historic evidence; we re-read them only to keep
   * the response shape stable for any caller that still inspects it.
   *
   * A0 hardening carried over from the original:
   *   - marks are validated `0 ≤ marksObtained ≤ maxMarks`;
   *   - the grade is resolved under the school's own grading system;
   *   - `SchoolGradePosted` is emitted per entered mark;
   *   - approval / optimistic-concurrency guards live inside `postMark`.
   */
  async bulkUpsert(dto: BulkGradeEntryDto) {
    const organizationId = this.tenant.organizationId;
    const profile = await this.prisma.client.schoolProfile.findFirst({
      where: { organizationId },
      select: { gradingSystem: true },
    });
    const system = profile?.gradingSystem ?? undefined;

    return this.prisma.client.$transaction(async (tx: any) => {
      // Validate every entry up front so a bad row can't half-apply.
      for (const e of dto.entries) {
        const maxMarks = e.maxMarks ?? 100;
        if (e.marksObtained < 0 || maxMarks <= 0 || e.marksObtained > maxMarks) {
          throw new BadRequestException(
            `Student ${e.studentProfileId}: marks ${e.marksObtained} out of range [0, ${maxMarks}]`,
          );
        }
        await this.grading.bandFor(e.marksObtained, maxMarks, system);
      }

      // THE FLIP (B6: permanent). Write the spine directly, by the one writer.
      // Deriving the spine by reading GradeEntry back (the retired projection)
      // is what made two stores possible: it put the truth in whichever store
      // was written last.
      const assessment = await this.mint.forExamSchedule(tx, dto.examScheduleId);
      if (assessment) {
        const schedule = await tx.examSchedule.findFirst({
          where: { id: dto.examScheduleId },
          include: { exam: true },
        });
        for (const e of dto.entries) {
          await this.marking.postMark(tx, {
            assessmentId: assessment.id,
            studentProfileId: e.studentProfileId,
            score: e.marksObtained,
            source: 'exam',
            markerId: this.tenant.userId ?? null,
            snapshot: { classId: schedule?.classId, termId: schedule?.exam?.termId },
            writeHistory: false,
          });
          this.events.publish(EVENTS.SchoolGradePosted, {
            organizationId,
            examScheduleId: dto.examScheduleId,
            studentProfileId: e.studentProfileId,
          });
        }
      }

      // Re-read the frozen GradeEntry rows for callers that still expect the
      // legacy shape. They are NEVER written here.
      const results = await tx.gradeEntry.findMany({
        where: {
          examScheduleId: dto.examScheduleId,
          studentProfileId: { in: dto.entries.map((e: any) => e.studentProfileId) },
        },
      });
      return { count: results.length, results };
    });
  }

  /**
   * Clear one student's mark, or record a non-scoring outcome (absent, exempt,
   * excused, malpractice).
   *
   * B6 — `GradeEntry` is structurally unwritable, so clearing acts ONLY on the
   * spine: `postMark(score: null)` removes the mark, and the non-scoring outcome
   * is recorded as `participation` (so `countsAbsentAsZero` still fires). The
   * legacy `GradeEntry` row is frozen historic evidence and is never touched.
   */
  async clearEntry(dto: { examScheduleId: string; studentProfileId: string; remarks?: string | null }) {
    const organizationId = this.tenant.organizationId;

    return this.prisma.client.$transaction(async (tx: any) => {
      const assessment = await this.mint.forExamSchedule(tx, dto.examScheduleId);
      if (!assessment) return { cleared: true, examScheduleId: dto.examScheduleId, row: null };

      // An approved mark goes back through reject -> resubmit, it is not silently
      // erased. Enforced on the spine now.
      const saChk = await tx.studentAssessment.findFirst({
        where: { assessmentId: assessment.id, studentProfileId: dto.studentProfileId },
      });
      if (saChk && saChk.approvalStatus === 'approved') {
        throw new ConflictException(
          `Grade for student ${dto.studentProfileId} is approved; reject it before clearing marks`,
        );
      }

      const remark = String(dto.remarks ?? '').trim().toLowerCase();
      const participation = NON_SCORING_REMARKS.has(remark) ? remark : 'present';
      const written = await this.marking.postMark(tx, {
        assessmentId: assessment.id,
        studentProfileId: dto.studentProfileId,
        score: null,
        source: 'exam',
        markerId: this.tenant.userId ?? null,
        writeHistory: false,
      });
      await tx.studentAssessment.updateMany({
        where: { id: written.id },
        data: { participation: participation as any },
      });

      // Re-read the frozen GradeEntry only to return the legacy shape. Never written.
      const row = await tx.gradeEntry.findFirst({
        where: { examScheduleId: dto.examScheduleId, studentProfileId: dto.studentProfileId },
      });
      return { cleared: true, examScheduleId: dto.examScheduleId, row };
    });
  }

  /**
   * Submit all draft marks for a paper. B6 — operates on the spine (the only mark
   * store). `GradeEntry` is structurally unwritable, so this drives the canonical
   * StudentAssessment.approvalStatus via `syncApproval` and never touches the
   * legacy mirror.
   */
  async submit(examScheduleId: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const assessment = await tx.assessment.findFirst({
        where: { organizationId: this.tenant.organizationId, sourceType: 'exam_session', sourceRef: examScheduleId },
        select: { id: true },
      });
      if (!assessment) return { updated: 0 };
      const res = await tx.studentAssessment.updateMany({
        where: { assessmentId: assessment.id, approvalStatus: 'draft' },
        data: { approvalStatus: 'submitted', enteredAt: new Date(), rejectionReason: null },
      });
      if (res.count > 0) {
        await this.audit.recordInTx(tx, {
          entity: 'Assessment',
          entityId: assessment.id,
          action: 'update',
          newValues: { action: 'submit', examScheduleId, count: res.count },
        });
      }
      return { updated: res.count };
    });
  }

  /**
   * Approve a submitted paper. Segregation of duty: whoever entered a mark cannot
   * approve it — checked against the spine's `enteredById`, since GradeEntry is
   * now read-only historic evidence.
   */
  async approve(examScheduleId: string) {
    const organizationId = this.tenant.organizationId;
    const approverId = this.tenant.userId ?? null;
    return this.prisma.client.$transaction(async (tx: any) => {
      const assessment = await tx.assessment.findFirst({
        where: { organizationId, sourceType: 'exam_session', sourceRef: examScheduleId },
        select: { id: true },
      });
      if (!assessment) return { updated: 0 };
      const pending = await tx.studentAssessment.findMany({
        where: { assessmentId: assessment.id, approvalStatus: 'submitted' },
        select: { id: true, enteredById: true },
      });
      if (pending.length === 0) return { updated: 0 };

      const selfEntered = pending.some((g: any) => g.enteredById && g.enteredById === approverId);
      if (selfEntered) {
        throw new BadRequestException(
          'You entered one or more of these marks and cannot approve your own entries (segregation of duty).',
        );
      }

      const res = await tx.studentAssessment.updateMany({
        where: { assessmentId: assessment.id, approvalStatus: 'submitted' },
        data: { approvalStatus: 'approved', approvedById: approverId, approvedAt: new Date() },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Assessment',
        entityId: assessment.id,
        action: 'approve',
        newValues: { examScheduleId, approvedById: approverId, count: res.count },
      });
      this.events.publish(EVENTS.SchoolGradeApproved, {
        organizationId,
        examScheduleId,
        approvedById: approverId ?? '',
      });
      return { updated: res.count };
    });
  }

  /**
   * A0: reject submitted marks back to `rejected` with a reason, making the
   * previously-unreachable `rejected` state reachable via the API. From
   * `rejected` the enterer can `resubmit`.
   */
  async reject(examScheduleId: string, reason: string) {
    const organizationId = this.tenant.organizationId;
    const rejectedById = this.tenant.userId ?? null;
    return this.prisma.client.$transaction(async (tx: any) => {
      const assessment = await tx.assessment.findFirst({
        where: { organizationId, sourceType: 'exam_session', sourceRef: examScheduleId },
        select: { id: true },
      });
      if (!assessment) throw new NotFoundException(`No assessment for schedule ${examScheduleId}`);
      const res = await tx.studentAssessment.updateMany({
        where: { assessmentId: assessment.id, approvalStatus: 'submitted' },
        data: { approvalStatus: 'rejected', rejectionReason: reason },
      });
      if (res.count === 0) {
        throw new NotFoundException(`No submitted grades to reject for schedule ${examScheduleId}`);
      }
      await this.audit.recordInTx(tx, {
        entity: 'Assessment',
        entityId: assessment.id,
        action: 'reject',
        newValues: { examScheduleId, rejectedById, reason, count: res.count },
      });
      this.events.publish(EVENTS.SchoolGradeRejected, {
        organizationId,
        examScheduleId,
        rejectedById: rejectedById ?? '',
        reason,
      });
      return { updated: res.count };
    });
  }

  /**
   * Carry an approval decision onto the spine. Retained for any caller that still
   * decides at the GradeEntry level (legacy bridge); the exam endpoints above now
   * write the spine directly.
   */


   *
   * The two workflows used to be mirrored the other way round — GradeEntry
   * decided, and the spine was updated to match. The spine is the record now,
   * so the exam endpoints write their own row and then bring the canonical one
   * with them. The direction is the whole difference between "two stores that
   * agree" and "one store with a legacy view".
   *
   * `approvedAt` / `rejectionReason` are set here rather than left to a later
   * recompute: an approval that does not say WHEN, or a rejection that does not
   * say WHY, is not an audit trail.
   */
  private async syncApproval(
    tx: any,
    examScheduleId: string,
    status: 'submitted' | 'approved' | 'rejected',
    approvedById?: string | null,
    reason?: string | null,
  ): Promise<void> {
    const assessment = await tx.assessment.findFirst({
      where: {
        organizationId: this.tenant.organizationId,
        sourceType: 'exam_session',
        sourceRef: examScheduleId,
      },
      select: { id: true },
    });
    if (!assessment) return;

    await tx.studentAssessment.updateMany({
      where: { assessmentId: assessment.id },
      data: {
        approvalStatus: status,
        ...(status === 'submitted' ? { enteredAt: new Date(), rejectionReason: null } : {}),
        ...(status === 'approved' ? { approvedById: approvedById ?? null, approvedAt: new Date() } : {}),
        ...(status === 'rejected' ? { rejectionReason: reason ?? null } : {}),
      },
    });
  }

  async byClass(examScheduleId: string) {
    return this.prisma.client.gradeEntry.findMany({
      where: { examScheduleId },
      orderBy: { marksObtained: 'desc' },
      include: { studentProfile: { include: { partner: true } } },
    });
  }
}

@Injectable()
export class GradingScaleService extends BaseCrudService<GradingScale, CreateGradingScaleDto, UpdateGradingScaleDto> {
  protected readonly entityName = 'GradingScale';
  protected readonly searchFields = ['name'];

  constructor(private readonly prisma: PrismaService) {
    super(prisma.client.gradingScale as unknown as CrudDelegate);
  }

  async default(): Promise<GradingScale | null> {
    return this.prisma.client.gradingScale.findFirst({ where: { isDefault: true } });
  }
}
/**
 * ReportCardService — builds the JSON payload for a student's report card.
 *
 * Delegates subject bucketing + grade resolution + UCE/UACE aggregate
 * computation to `ReportCardTemplateService` so the layout matches the
 * school's grading system (UCE / UACE / CBC / generic).
 *
 * The payload is what the UI / PDF renderer consumes; we keep PDF rendering
 * to the web side (@react-pdf/renderer is suggested in the ADR-010 docs).
 */
@Injectable()
export class ReportCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly grading: GradingService,
    private readonly events: EventBus,
    private readonly templates: ReportCardTemplateService,
    private readonly audit: AuditService,
    private readonly results: ResultRunService,
  ) {}

  /** Report cards for a student, newest first. */
  async byStudent(studentProfileId: string) {
    return this.prisma.client.reportCard.findMany({
      where: { studentProfileId },
      orderBy: { generatedAt: 'desc' },
    });
  }

  /**
   * A0: release a generated report card to the portals. `ReportCard.publishedAt`
   * and the web `published` badge already existed but nothing ever set the
   * column — the badge was permanently unlit. This is the missing endpoint.
   */
  async publish(id: string) {
    return this.setPublished(id, true);
  }

  async unpublish(id: string) {
    return this.setPublished(id, false);
  }

  private async setPublished(id: string, publish: boolean) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const card = await tx.reportCard.findFirst({ where: { id } });
      if (!card) throw new NotFoundException(`ReportCard ${id} not found`);
      await tx.reportCard.updateMany({
        where: { id },
        data: { publishedAt: publish ? new Date() : null },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ReportCard',
        entityId: id,
        action: 'update',
        oldValues: { publishedAt: card.publishedAt },
        newValues: { action: publish ? 'publish' : 'unpublish', publishedAt: publish ? 'now' : null },
      });
      this.events.publish(EVENTS.SchoolReportCardPublished, {
        organizationId,
        reportCardId: id,
        studentProfileId: card.studentProfileId,
        termId: card.termId,
        published: publish,
      });
      return tx.reportCard.findFirst({ where: { id } });
    });
  }

  async generate(dto: GenerateReportCardDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const term = await tx.term.findFirst({ where: { id: dto.termId } });
      if (!term) throw new NotFoundException(`Term ${dto.termId} not found`);

      // A3: prefer the published result spine as the source of truth. The spine
      // is a versioned, immutable, reproducible snapshot; the legacy per-call
      // computeTermGpa remains only as the fallback for terms not yet run.
      const spine = await this.results.latestPublished(dto.termId, dto.studentProfileId);
      const legacy = await this.grading.computeTermGpa(dto.studentProfileId, dto.termId);

      // Build the templated layout (sections + summary + eligibility). Pass the
      // spine so the subject table is sourced from it too (P3), not just the
      // headline numbers — otherwise the body and header of one card disagree.
      const { layout, layoutSource } = await this.templates.buildLayout(dto.studentProfileId, dto.termId, spine);

      const provenance = spine
        ? {
            source: 'result_spine' as const,
            layoutSource,
            resultSetId: spine.resultSet.id,
            resultSetRevision: spine.resultSet.revision,
            calculationVersion: spine.resultSet.calculationVersion,
          }
        : { source: 'legacy_compute' as const, layoutSource };

      const gpa = spine?.term.gpa != null ? Number(spine.term.gpa) : legacy.gpa;
      const rank = spine?.term.classRank ?? legacy.rank;
      const meanPercent = spine?.term.meanPercent != null ? Number(spine.term.meanPercent) : legacy.meanPercent;
      const totalMarks = spine ? spine.term.subjectsCount : legacy.totalMarks;

      // P0-A: carry persisted teacher/principal comments + competency levels
      // (if a card for this student+term already holds them) into the payload.
      const prior = await tx.reportCard.findFirst({
        where: { studentProfileId: dto.studentProfileId, termId: dto.termId },
      });
      // A published card is a frozen, distributed record. Regenerating it would
      // silently rewrite what a parent has already seen — unpublish first.
      if (prior?.publishedAt) {
        throw new BadRequestException(
          'This report card is published. Unpublish it before regenerating, so the change is deliberate.',
        );
      }
      const classTeacherComment = prior?.classTeacherComment ?? null;
      const principalComment = prior?.principalComment ?? null;
      const competencyLevels = prior?.competencyLevels ?? {};

      const payload = {
        system: layout.system,
        term: { id: term.id, name: term.name },
        gpa,
        rank,
        meanPercent,
        totalMarks,
        division: spine?.term.division ?? null,
        promotionRecommendation: spine?.term.promotionRecommendation ?? null,
        sections: layout.sections,
        summary: layout.summary,
        eligible: spine ? spine.term.eligible : layout.eligible,
        footer: layout.footer,
        columnHeaders: layout.columnHeaders,
        provenance,
        generatedAt: new Date().toISOString(),
        classTeacherComment,
        principalComment,
        competencyLevels,
      };

      // Idempotent: the latest card per (student, term) wins. We do this by
      // upserting on a deterministic composite id derived from the two FKs.
      const deterministicId = `rc_${dto.studentProfileId.slice(0, 12)}_${dto.termId.slice(0, 12)}`.replace(/-/g, '');

      const upserted = await tx.reportCard.upsert({
        where: { id: deterministicId },
        create: {
          id: deterministicId,
          organizationId,
          studentProfileId: dto.studentProfileId,
          termId: dto.termId,
          payload: payload as any,
          classTeacherComment,
          principalComment,
          competencyLevels,
        },
        update: { payload: payload as any },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ReportCard',
        entityId: upserted.id,
        action: 'create',
        newValues: { studentProfileId: dto.studentProfileId, termId: dto.termId, gpa, rank },
      });
      this.events.publish(EVENTS.SchoolReportCardGenerated, {
        organizationId,
        reportCardId: upserted.id,
        studentProfileId: dto.studentProfileId,
        termId: dto.termId,
      });
      return upserted;
    });
  }

  /**
   * P0-A: capture/overwrite the free-text teacher & principal narratives and
   * competency levels for a student's report card. Either regenerates the
   * payload (so the new text appears on the PDF) or, if no card exists yet,
   * creates a lightweight card holding only the comments until generate runs.
   */
  async updateComment(dto: UpdateReportCardCommentDto) {
    const organizationId = this.tenant.organizationId;
    const deterministicId = `rc_${dto.studentProfileId.slice(0, 12)}_${dto.termId.slice(0, 12)}`.replace(/-/g, '');
    return this.prisma.client.$transaction(async (tx: any) => {
      const existing = await tx.reportCard.findFirst({ where: { id: deterministicId } });
      const payload = existing?.payload
        ? {
            ...existing.payload,
            classTeacherComment: dto.classTeacherComment ?? existing.payload.classTeacherComment ?? null,
            principalComment: dto.principalComment ?? existing.payload.principalComment ?? null,
            competencyLevels: dto.competencyLevels
              ? { ...(existing.payload.competencyLevels ?? {}), ...dto.competencyLevels }
              : existing.payload.competencyLevels ?? {},
          }
        : {
            classTeacherComment: dto.classTeacherComment ?? null,
            principalComment: dto.principalComment ?? null,
            competencyLevels: dto.competencyLevels ?? {},
          };
      const card = await tx.reportCard.upsert({
        where: { id: deterministicId },
        create: {
          id: deterministicId,
          organizationId,
          studentProfileId: dto.studentProfileId,
          termId: dto.termId,
          payload: payload as any,
          classTeacherComment: dto.classTeacherComment ?? null,
          principalComment: dto.principalComment ?? null,
          competencyLevels: (payload as any).competencyLevels ?? {},
        },
        update: {
          payload: payload as any,
          classTeacherComment: (payload as any).classTeacherComment,
          principalComment: (payload as any).principalComment,
          competencyLevels: (payload as any).competencyLevels ?? {},
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'ReportCard',
        entityId: card.id,
        action: 'update',
        newValues: { classTeacherComment: (payload as any).classTeacherComment, principalComment: (payload as any).principalComment },
      });
      return card;
    });
  }
}