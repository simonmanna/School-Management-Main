import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Assessment } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type { CreateAssessmentDto, UpdateAssessmentDto } from './dto.types';

/** action → { allowed from-states, resulting state }. */
const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  schedule: { from: ['draft'], to: 'scheduled' },
  publish: { from: ['draft', 'scheduled'], to: 'published' },
  open: { from: ['published'], to: 'open' },
  close: { from: ['published', 'open'], to: 'closed' },
  grade: { from: ['closed', 'grading'], to: 'graded' },
  archive: { from: ['graded', 'closed'], to: 'archived' },
};

/**
 * Assessment — the concrete assessment instance. CRUD plus an explicit
 * lifecycle FSM (draft → scheduled → published → open → closed → graded →
 * archived). Every transition is audited and announced.
 */
@Injectable()
export class AssessmentService extends BaseCrudService<Assessment, CreateAssessmentDto, UpdateAssessmentDto> {
  protected readonly entityName = 'Assessment';
  protected readonly searchFields = ['title'];
  protected readonly defaultInclude = { component: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {
    super(prisma.client.assessment as unknown as CrudDelegate);
  }

  async create(dto: CreateAssessmentDto): Promise<Assessment> {
    return this.prisma.client.$transaction(async (tx: any) => {
      if (dto.componentId) {
        const component = await tx.assessmentComponent.findFirst({ where: { id: dto.componentId } });
        if (!component) throw new NotFoundException(`AssessmentComponent ${dto.componentId} not found`);
      }
      const row = await tx.assessment.create({
        data: {
          ...dto,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
          createdBy: this.tenant.userId ?? null,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Assessment',
        entityId: row.id,
        action: 'create',
        newValues: { title: row.title, subjectId: row.subjectId, classId: row.classId, termId: row.termId },
      });
      return row;
    });
  }

  async update(id: string, dto: UpdateAssessmentDto): Promise<Assessment> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.assessment.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`Assessment ${id} not found`);
      // Once graded/archived, structural edits are refused — the marks depend on it.
      if (['graded', 'archived'].includes(before.status)) {
        throw new BadRequestException(`Assessment ${id} is ${before.status} and cannot be edited`);
      }
      const { version, dueAt, ...rest } = dto;
      const res = await tx.assessment.updateMany({
        where: version === undefined ? { id } : { id, version },
        data: {
          ...rest,
          ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
          updatedBy: this.tenant.userId ?? null,
          version: { increment: 1 },
        },
      });
      if (res.count === 0) {
        throw new NotFoundException(
          `Assessment ${id} not found or modified concurrently (expected version ${version})`,
        );
      }
      await this.audit.recordInTx(tx, { entity: 'Assessment', entityId: id, action: 'update', newValues: rest });
      return tx.assessment.findFirst({ where: { id }, include: { component: true } });
    });
  }

  /** Apply a lifecycle transition, guarded by the allowed from-states. */
  async transition(id: string, action: string): Promise<Assessment> {
    const t = TRANSITIONS[action];
    if (!t) throw new BadRequestException(`Unknown assessment action '${action}'`);
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.assessment.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`Assessment ${id} not found`);
      if (!t.from.includes(before.status)) {
        throw new BadRequestException(
          `Cannot ${action} an assessment in '${before.status}' (allowed from: ${t.from.join(', ')})`,
        );
      }
      await tx.assessment.updateMany({
        where: { id },
        data: { status: t.to, version: { increment: 1 } },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Assessment',
        entityId: id,
        action: 'update',
        oldValues: { status: before.status },
        newValues: { status: t.to, action },
      });
      this.events.publish(EVENTS.SchoolAssessmentStatusChanged, { organizationId, assessmentId: id, status: t.to });
      return tx.assessment.findFirst({ where: { id }, include: { component: true } });
    });
  }

  async byClassTerm(classId: string, termId: string): Promise<Assessment[]> {
    return this.prisma.client.assessment.findMany({
      where: { classId, termId },
      include: { component: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
