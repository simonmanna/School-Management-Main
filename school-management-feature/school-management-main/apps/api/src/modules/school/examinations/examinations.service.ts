import { Injectable, NotFoundException } from '@nestjs/common';
import type { Exam, ExamSchedule, ExamType, GradeEntry, GradingScale } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import { GradingService } from './grading.service';
import { ReportCardTemplateService } from './report-card-template.service';
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
    const row = await super.create({
      ...dto,
      classes: dto.classes as any,
    });
    this.events.publish(EVENTS.ExamScheduled, {
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
      this.events.publish(EVENTS.ExamPublished, {
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
      this.events.publish(EVENTS.ExamClosed, {
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
  ) {
    super(prisma.client.gradeEntry as unknown as CrudDelegate);
  }

  /**
   * Bulk-upsert grades for a class × exam. After save, recompute letter grade
   * + grade point from the active GradingScale.
   */
  async bulkUpsert(dto: BulkGradeEntryDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const results: any[] = [];
      for (const e of dto.entries) {
        const band = await this.grading.bandFor(e.marksObtained, e.maxMarks ?? 100);
        const row = await tx.gradeEntry.upsert({
          where: {
            examScheduleId_studentProfileId: {
              examScheduleId: dto.examScheduleId,
              studentProfileId: e.studentProfileId,
            } as any,
          },
          create: {
            organizationId,
            examScheduleId: dto.examScheduleId,
            studentProfileId: e.studentProfileId,
            marksObtained: e.marksObtained,
            maxMarks: e.maxMarks ?? 100,
            grade: band?.grade ?? null,
            gradePoint: band?.gpa ?? null,
            remarks: e.remarks ?? null,
            status: 'draft',
            enteredById: this.tenant.userId ?? null,
            enteredAt: new Date(),
          },
          update: {
            marksObtained: e.marksObtained,
            maxMarks: e.maxMarks ?? 100,
            grade: band?.grade ?? null,
            gradePoint: band?.gpa ?? null,
            remarks: e.remarks ?? null,
            enteredById: this.tenant.userId ?? null,
            enteredAt: new Date(),
          },
        });
        results.push(row);
      }
      return { count: results.length, results };
    });
  }

  async submit(examScheduleId: string) {
    const res = await this.prisma.client.gradeEntry.updateMany({
      where: { examScheduleId, status: 'draft' },
      data: { status: 'submitted' },
    });
    return { updated: res.count };
  }

  async approve(examScheduleId: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.gradeEntry.updateMany({
        where: { examScheduleId, status: 'submitted' },
        data: { status: 'approved', approvedById: this.tenant.userId ?? null, approvedAt: new Date() },
      });
      this.events.publish(EVENTS.GradeApproved, {
        organizationId,
        examScheduleId,
        approvedById: this.tenant.userId ?? '',
      });
      return { updated: res.count };
    });
  }

  async byClass(examScheduleId: string) {
    return this.prisma.client.gradeEntry.findMany({
      where: { examScheduleId },
      orderBy: { marksObtained: 'desc' },
      include: { studentProfile: true },
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
  ) {}

  async generate(dto: GenerateReportCardDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const term = await tx.term.findFirst({ where: { id: dto.termId } });
      if (!term) throw new NotFoundException(`Term ${dto.termId} not found`);

      const { gpa, rank, meanPercent, totalMarks } = await this.grading.computeTermGpa(dto.studentProfileId, dto.termId);

      // Build the templated layout (sections + summary + eligibility).
      const layout = await this.templates.buildLayout(dto.studentProfileId, dto.termId);

      const payload = {
        system: layout.system,
        term: { id: term.id, name: term.name },
        gpa,
        rank,
        meanPercent,
        totalMarks,
        sections: layout.sections,
        summary: layout.summary,
        eligible: layout.eligible,
        footer: layout.footer,
        columnHeaders: layout.columnHeaders,
        generatedAt: new Date().toISOString(),
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
        },
        update: { payload: payload as any },
      });
      this.events.publish(EVENTS.ReportCardGenerated, {
        organizationId,
        reportCardId: upserted.id,
        studentProfileId: dto.studentProfileId,
        termId: dto.termId,
      });
      return upserted;
    });
  }
}