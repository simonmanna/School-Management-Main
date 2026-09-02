import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
      if (before.publishedAt) throw new BadRequestException('Published policies are immutable. Fork a new revision.');
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
    matches.sort((a, b) => specificity(b) - specificity(a) || Number(!!b.publishedAt) - Number(!!a.publishedAt) || b.revision - a.revision);
    return matches[0] as AssessmentPolicy & { components: AssessmentComponent[] };
  }

  async publish(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT id FROM "AssessmentPolicy" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE', id, this.tenant.organizationId);
      const p = await tx.assessmentPolicy.findFirst({ where: { id }, include: { components: true } });
      if (!p) throw new NotFoundException('Policy not found');
      if (p.publishedAt) return p;
      const total = p.components.reduce((n: Prisma.Decimal, c: any) => n.add(c.weight), new Prisma.Decimal(0));
      if (!p.components.length || !total.equals(100)) throw new BadRequestException('Policy components must total exactly 100% before publication');
      await tx.assessmentPolicy.updateMany({ where: { id, publishedAt: null }, data: { publishedAt: new Date(), version: { increment: 1 } } });
      await this.audit.recordInTx(tx, { entity: 'AssessmentPolicy', entityId: id, action: 'update', newValues: { action: 'publish', revision: p.revision } });
      return tx.assessmentPolicy.findFirst({ where: { id }, include: { components: true } });
    });
  }

  async fork(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT id FROM "AssessmentPolicy" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE', id, this.tenant.organizationId);
      const p = await tx.assessmentPolicy.findFirst({ where: { id }, include: { components: true } });
      if (!p) throw new NotFoundException('Policy not found');
      if (!p.publishedAt) throw new BadRequestException('Publish this revision before forking it');
      const existing = await tx.assessmentPolicy.findFirst({ where: { supersedesId: id, publishedAt: null } });
      if (existing) return existing;
      const { id: _id, components, createdAt, updatedAt, createdBy, updatedBy, version, publishedAt, deletedAt, ...fields } = p;
      const next = await tx.assessmentPolicy.create({ data: { ...fields, revision: p.revision + 1, supersedesId: id, createdBy: this.tenant.userId } });
      for (const c of components) {
        const { id: _componentId, policyId, createdAt: _created, updatedAt: _updated, version: _version, deletedAt: _deleted, ...data } = c;
        await tx.assessmentComponent.create({ data: { ...data, policyId: next.id } });
      }
      await this.audit.recordInTx(tx, { entity: 'AssessmentPolicy', entityId: next.id, action: 'create', newValues: { supersedesId: id, revision: next.revision } });
      return next;
    });
  }

  async remove(id: string): Promise<void> {
    const p = await this.prisma.client.assessmentPolicy.findFirst({ where: { id } });
    if (p?.publishedAt) throw new BadRequestException('Published policy revisions cannot be deleted');
    return super.remove(id);
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
      if (policy.publishedAt) throw new BadRequestException('Published policy components are immutable. Fork the policy first.');
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
      const policy = await tx.assessmentPolicy.findFirst({ where: { id: before.policyId } });
      if (policy?.publishedAt) throw new BadRequestException('Published policy components are immutable. Fork the policy first.');
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

  async remove(id: string): Promise<void> {
    const c = await this.prisma.client.assessmentComponent.findFirst({ where: { id }, include: { policy: true } });
    if (c?.policy.publishedAt) throw new BadRequestException('Published policy components cannot be deleted');
    return super.remove(id);
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
