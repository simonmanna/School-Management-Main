import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AssessmentComponent, AssessmentPolicy } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import type {
  CreateAssessmentComponentDto,
  CreateAssessmentPolicyDto,
  UpdateAssessmentComponentDto,
  UpdateAssessmentPolicyDto,
} from './dto.types';

export interface PolicyScope {
  subjectId?: string | null;
  classId?: string | null;
  gradeLevelId?: string | null;
  termId?: string | null;
}

/**
 * AssessmentPolicy — the weighting scheme for a scope. The resolver picks the
 * most-specific active policy whose non-null scope fields all match the query;
 * a policy that pins a dimension the query doesn't match is excluded.
 */
@Injectable()
export class AssessmentPolicyService extends BaseCrudService<
  AssessmentPolicy,
  CreateAssessmentPolicyDto,
  UpdateAssessmentPolicyDto
> {
  protected readonly entityName = 'AssessmentPolicy';
  protected readonly searchFields = ['name'];
  protected readonly defaultInclude = { components: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {
    super(prisma.client.assessmentPolicy as unknown as CrudDelegate);
  }

  async create(dto: CreateAssessmentPolicyDto): Promise<AssessmentPolicy> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.assessmentPolicy.create({ data: { ...dto, createdBy: this.tenant.userId ?? null } });
      await this.audit.recordInTx(tx, {
        entity: 'AssessmentPolicy',
        entityId: row.id,
        action: 'create',
        newValues: { name: row.name, subjectId: row.subjectId, classId: row.classId, termId: row.termId },
      });
      return row;
    });
  }

  async update(id: string, dto: UpdateAssessmentPolicyDto): Promise<AssessmentPolicy> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.assessmentPolicy.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`AssessmentPolicy ${id} not found`);
      const { version, ...rest } = dto;
      const res = await tx.assessmentPolicy.updateMany({
        where: version === undefined ? { id } : { id, version },
        data: { ...rest, updatedBy: this.tenant.userId ?? null, version: { increment: 1 } },
      });
      if (res.count === 0) {
        throw new NotFoundException(
          `AssessmentPolicy ${id} not found or modified concurrently (expected version ${version})`,
        );
      }
      await this.audit.recordInTx(tx, {
        entity: 'AssessmentPolicy',
        entityId: id,
        action: 'update',
        oldValues: { name: before.name, isActive: before.isActive },
        newValues: rest,
      });
      return tx.assessmentPolicy.findFirst({ where: { id }, include: { components: true } });
    });
  }

  /**
   * Resolve the governing policy for a scope, most-specific-first.
   * Specificity weights: subject(8) > class(4) > gradeLevel(2) > term(1).
   */
  async resolve(scope: PolicyScope): Promise<(AssessmentPolicy & { components: AssessmentComponent[] }) | null> {
    const policies = await this.prisma.client.assessmentPolicy.findMany({
      where: { isActive: true },
      include: { components: true },
    });
    const matches = policies.filter(
      (p) =>
        (p.subjectId == null || p.subjectId === scope.subjectId) &&
        (p.classId == null || p.classId === scope.classId) &&
        (p.gradeLevelId == null || p.gradeLevelId === scope.gradeLevelId) &&
        (p.termId == null || p.termId === scope.termId),
    );
    if (matches.length === 0) return null;
    const specificity = (p: AssessmentPolicy) =>
      (p.subjectId ? 8 : 0) + (p.classId ? 4 : 0) + (p.gradeLevelId ? 2 : 0) + (p.termId ? 1 : 0);
    matches.sort((a, b) => specificity(b) - specificity(a));
    return matches[0] as AssessmentPolicy & { components: AssessmentComponent[] };
  }
}

/**
 * AssessmentComponent — weighted buckets within a policy. Per-component writes
 * only validate the weight is in [0,100]; the sum-to-100 invariant is checked
 * by `validateWeights` (surfaced to the UI and enforced at result-compute in
 * A3), because requiring the sum on every incremental edit would make building
 * a policy impossible.
 */
@Injectable()
export class AssessmentComponentService extends BaseCrudService<
  AssessmentComponent,
  CreateAssessmentComponentDto,
  UpdateAssessmentComponentDto
> {
  protected readonly entityName = 'AssessmentComponent';
  protected readonly searchFields = ['name'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {
    super(prisma.client.assessmentComponent as unknown as CrudDelegate);
  }

  async create(dto: CreateAssessmentComponentDto): Promise<AssessmentComponent> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const policy = await tx.assessmentPolicy.findFirst({ where: { id: dto.policyId } });
      if (!policy) throw new NotFoundException(`AssessmentPolicy ${dto.policyId} not found`);
      const row = await tx.assessmentComponent.create({ data: { ...dto } });
      await this.audit.recordInTx(tx, {
        entity: 'AssessmentComponent',
        entityId: row.id,
        action: 'create',
        newValues: { policyId: row.policyId, kind: row.kind, weight: String(row.weight) },
      });
      return row;
    });
  }

  async update(id: string, dto: UpdateAssessmentComponentDto): Promise<AssessmentComponent> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.assessmentComponent.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`AssessmentComponent ${id} not found`);
      const { version, ...rest } = dto;
      const res = await tx.assessmentComponent.updateMany({
        where: version === undefined ? { id } : { id, version },
        data: { ...rest, version: { increment: 1 } },
      });
      if (res.count === 0) {
        throw new NotFoundException(
          `AssessmentComponent ${id} not found or modified concurrently (expected version ${version})`,
        );
      }
      await this.audit.recordInTx(tx, {
        entity: 'AssessmentComponent',
        entityId: id,
        action: 'update',
        newValues: rest,
      });
      return tx.assessmentComponent.findFirst({ where: { id } });
    });
  }

  async byPolicy(policyId: string): Promise<AssessmentComponent[]> {
    return this.prisma.client.assessmentComponent.findMany({
      where: { policyId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Do the components under a policy sum to 100? Returns the exact Decimal sum
   * and the per-component breakdown so the UI (and the A3 publish gate) can show
   * *why* a policy is or isn't valid.
   */
  async validateWeights(policyId: string): Promise<{
    ok: boolean;
    sum: string;
    componentCount: number;
    components: Array<{ id: string; name: string; weight: string }>;
  }> {
    const components = await this.byPolicy(policyId);
    const sum = components.reduce((acc, c) => acc.add(new Prisma.Decimal(c.weight)), new Prisma.Decimal(0));
    return {
      ok: sum.equals(100),
      sum: sum.toString(),
      componentCount: components.length,
      components: components.map((c) => ({ id: c.id, name: c.name, weight: String(c.weight) })),
    };
  }
}
