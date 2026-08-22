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
import { AssessmentProjectionService } from '../assessment/assessment-projection.service';
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
    private readonly projection: AssessmentProjectionService,
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
  async bulkUpsert(dto: BulkGradeEntryDto) {
    const organizationId = this.tenant.organizationId;
    // Resolve the school's grading system once so every band lookup in this
    // batch uses the same scale.
    const profile = await this.prisma.client.schoolProfile.findFirst({
      where: { organizationId },
      select: { gradingSystem: true },
    });
    const system = profile?.gradingSystem ?? undefined;

    return this.prisma.client.$transaction(async (tx: any) => {
      const results: any[] = [];
      for (const e of dto.entries) {
        const maxMarks = e.maxMarks ?? 100;
        // A0: reject impossible marks rather than store them and compute a
        // nonsense percentage/grade downstream.
        if (e.marksObtained < 0 || maxMarks <= 0 || e.marksObtained > maxMarks) {
          throw new BadRequestException(
            `Student ${e.studentProfileId}: marks ${e.marksObtained} out of range [0, ${maxMarks}]`,
          );
        }
        const band = await this.grading.bandFor(e.marksObtained, maxMarks, system);

        const existing = await tx.gradeEntry.findFirst({
          where: { examScheduleId: dto.examScheduleId, studentProfileId: e.studentProfileId },
        });

        // A0: approved marks are not silently re-writable by a re-upsert; they
        // must go back through reject → resubmit.
        if (existing && existing.status === 'approved') {
          throw new ConflictException(
            `Grade for student ${e.studentProfileId} is approved; reject it before re-entering marks`,
          );
        }
        // A0: optimistic concurrency — if the caller carries a stale version,
        // refuse rather than clobber a concurrent edit.
        if (existing && e.version !== undefined && existing.version !== e.version) {
          throw new ConflictException(
            `Grade for student ${e.studentProfileId} was modified concurrently ` +
              `(expected version ${e.version}, current ${existing.version}). Re-read and retry.`,
          );
        }

        const common = {
          marksObtained: e.marksObtained,
          maxMarks,
          grade: band?.grade ?? null,
          gradePoint: band?.gpa ?? null,
          remarks: e.remarks ?? null,
          enteredById: this.tenant.userId ?? null,
          enteredAt: new Date(),
        };

        let row: any;
        if (existing) {
          await tx.gradeEntry.updateMany({
            where: { id: existing.id },
            // Re-entering a mark returns it to draft and bumps the version.
            data: { ...common, status: 'draft', version: { increment: 1 } },
          });
          row = await tx.gradeEntry.findFirst({ where: { id: existing.id } });
        } else {
          row = await tx.gradeEntry.create({
            data: {
              organizationId,
              examScheduleId: dto.examScheduleId,
              studentProfileId: e.studentProfileId,
              status: 'draft',
              ...common,
            },
          });
        }

        await this.audit.recordInTx(tx, {
          entity: 'GradeEntry',
          entityId: row.id,
          action: existing ? 'update' : 'create',
          newValues: { marksObtained: e.marksObtained, maxMarks, grade: row.grade, status: 'draft' },
        });
        // Fire the previously-dead "grade posted" event for each entered mark.
        this.events.publish(EVENTS.SchoolGradePosted, {
          organizationId,
          examScheduleId: dto.examScheduleId,
          studentProfileId: e.studentProfileId,
        });
        results.push(row);
      }
      // A1: project the just-written marks into the assessment spine, atomically.
      await this.projection.projectExamSchedule(tx, dto.examScheduleId);
      return { count: results.length, results };
    });
  }

  async submit(examScheduleId: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.gradeEntry.updateMany({
        where: { examScheduleId, status: 'draft' },
        data: { status: 'submitted' },
      });
      if (res.count > 0) {
        await this.audit.recordInTx(tx, {
          entity: 'GradeEntry',
          entityId: examScheduleId,
          action: 'update',
          newValues: { action: 'submit', examScheduleId, count: res.count },
        });
        await this.projection.mirrorApprovalStatus(tx, examScheduleId, 'submitted');
      }
      return { updated: res.count };
    });
  }

  async approve(examScheduleId: string) {
    const organizationId = this.tenant.organizationId;
    const approverId = this.tenant.userId ?? null;
    return this.prisma.client.$transaction(async (tx: any) => {
      const pending = await tx.gradeEntry.findMany({
        where: { examScheduleId, status: 'submitted' },
        select: { id: true, enteredById: true },
      });
      if (pending.length === 0) return { updated: 0 };

      // A0 segregation of duty: whoever entered a mark must not approve it.
      // Approving a batch that contains any self-entered mark is refused.
      const selfEntered = pending.some((g: any) => g.enteredById && g.enteredById === approverId);
      if (selfEntered) {
        throw new BadRequestException(
          'You entered one or more of these marks and cannot approve your own entries (segregation of duty).',
        );
      }

      const res = await tx.gradeEntry.updateMany({
        where: { examScheduleId, status: 'submitted' },
        data: { status: 'approved', approvedById: approverId, approvedAt: new Date() },
      });
      await this.audit.recordInTx(tx, {
        entity: 'GradeEntry',
        entityId: examScheduleId,
        action: 'approve',
        newValues: { examScheduleId, approvedById: approverId, count: res.count },
      });
      await this.projection.mirrorApprovalStatus(tx, examScheduleId, 'approved', approverId);
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
   * `rejected` the enterer can `resubmit` (see the grade_entry workflow).
   */
  async reject(examScheduleId: string, reason: string) {
    const organizationId = this.tenant.organizationId;
    const rejectedById = this.tenant.userId ?? null;
    return this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.gradeEntry.updateMany({
        where: { examScheduleId, status: 'submitted' },
        data: { status: 'rejected', rejectionReason: reason },
      });
      if (res.count === 0) {
        throw new NotFoundException(`No submitted grades to reject for schedule ${examScheduleId}`);
      }
      await this.audit.recordInTx(tx, {
        entity: 'GradeEntry',
        entityId: examScheduleId,
        action: 'reject',
        newValues: { examScheduleId, rejectedById, reason, count: res.count },
      });
      await this.projection.mirrorApprovalStatus(tx, examScheduleId, 'rejected');
      this.events.publish(EVENTS.SchoolGradeRejected, {
        organizationId,
        examScheduleId,
        rejectedById: rejectedById ?? '',
        reason,
      });
      return { updated: res.count };
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