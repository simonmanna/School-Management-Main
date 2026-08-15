import { Injectable, NotFoundException } from '@nestjs/common';
import type { Rubric } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type { CreateRubricDto } from './dto.types';

/**
 * Rubric authoring — a rubric with weighted criteria, each carrying levels.
 * The per-student rubric scores are the CANONICAL relational grading data
 * (AssessmentRubricScore), written by the assignment grade flow; this service
 * owns the rubric definition itself.
 *
 * Rubrics are versioned: `fork` clones an active rubric into a new version and
 * marks the old one superseded, so work already graded under the old version
 * keeps pointing at the definition it was graded against.
 */
@Injectable()
export class RubricService extends BaseCrudService<Rubric, CreateRubricDto, never> {
  protected readonly entityName = 'Rubric';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { criteria: { include: { levels: true } } };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {
    super(prisma.client.rubric as unknown as CrudDelegate);
  }

  /** Create a rubric with its criteria + levels in one transaction. */
  async createFull(dto: CreateRubricDto): Promise<Rubric> {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const rubric = await tx.rubric.create({
        data: { organizationId, name: dto.name, description: dto.description ?? null },
      });
      for (const [ci, c] of (dto.criteria ?? []).entries()) {
        const criterion = await tx.rubricCriterion.create({
          data: {
            organizationId,
            rubricId: rubric.id,
            name: c.name,
            description: c.description ?? null,
            weight: c.weight ?? 1,
            maxScore: c.maxScore,
            order: c.order ?? ci,
          },
        });
        for (const [li, l] of (c.levels ?? []).entries()) {
          await tx.rubricLevel.create({
            data: {
              organizationId,
              criterionId: criterion.id,
              label: l.label,
              score: l.score,
              descriptor: l.descriptor ?? null,
              order: l.order ?? li,
            },
          });
        }
      }
      await this.audit.recordInTx(tx, {
        entity: 'Rubric',
        entityId: rubric.id,
        action: 'create',
        newValues: { name: rubric.name, criteria: (dto.criteria ?? []).length },
      });
      return tx.rubric.findFirst({
        where: { id: rubric.id },
        include: { criteria: { include: { levels: true } } },
      });
    });
  }

  /**
   * Fork an existing rubric into a new version: deep-clone criteria + levels,
   * bump version, and mark the source superseded. Returns the new rubric.
   */
  async fork(id: string): Promise<Rubric> {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const src = await tx.rubric.findFirst({
        where: { id },
        include: { criteria: { include: { levels: true } } },
      });
      if (!src) throw new NotFoundException(`Rubric ${id} not found`);

      const next = await tx.rubric.create({
        data: {
          organizationId,
          name: src.name,
          description: src.description,
          version: src.version + 1,
        },
      });
      for (const c of src.criteria) {
        const criterion = await tx.rubricCriterion.create({
          data: {
            organizationId,
            rubricId: next.id,
            name: c.name,
            description: c.description,
            weight: c.weight,
            maxScore: c.maxScore,
            order: c.order,
          },
        });
        if (c.levels.length > 0) {
          await tx.rubricLevel.createMany({
            data: c.levels.map((l: any) => ({
              organizationId,
              criterionId: criterion.id,
              label: l.label,
              score: l.score,
              descriptor: l.descriptor,
              order: l.order,
            })),
          });
        }
      }
      await tx.rubric.updateMany({ where: { id }, data: { supersededById: next.id, isActive: false } });
      await this.audit.recordInTx(tx, {
        entity: 'Rubric',
        entityId: next.id,
        action: 'create',
        newValues: { forkedFrom: id, version: next.version },
      });
      return tx.rubric.findFirst({
        where: { id: next.id },
        include: { criteria: { include: { levels: true } } },
      });
    });
  }
}
