import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { dec } from '../../kernel/common/money';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { ProductionService } from './production.service';
import { AddPlanLinesDto, CreateProductionPlanDto } from './dto/request.dto';

/**
 * ProductionPlan — consolidates open request lines into fewer, bigger lines
 * (five 20-cake requests → one 100-cake line) and, on confirm, generates DRAFT
 * production orders. Never auto-starts: a plan is a proposal a supervisor
 * confirms line by line.
 */
@Injectable()
export class ProductionPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly production: ProductionService,
  ) {}

  private get org(): string {
    return this.tenant.organizationId;
  }

  async create(dto: CreateProductionPlanDto) {
    const planNumber = await this.seq.next('production_plan', { prefix: 'PLN-', padding: 5 });
    const consolidated = dto.fromOpenRequests ? await this.consolidateOpenRequests() : [];

    return this.prisma.client.$transaction(async (tx: any) => {
      const plan = await tx.productionPlan.create({
        data: {
          organizationId: this.org,
          planNumber,
          name: dto.name ?? null,
          dateFrom: dto.dateFrom ? new Date(dto.dateFrom) : null,
          dateTo: dto.dateTo ? new Date(dto.dateTo) : null,
          locationId: dto.locationId ?? null,
          status: 'draft',
          notes: dto.notes ?? null,
          createdBy: this.tenant.userId ?? null,
          lines: {
            create: consolidated.map((c, i) => ({
              organizationId: this.org,
              productId: c.productId,
              variantId: c.variantId,
              bomId: c.bomId,
              targetQty: c.targetQty,
              uomId: c.uomId,
              lineNumber: i,
            })),
          },
        },
        include: { lines: true },
      });

      // Mark the source request lines as consolidated into this plan.
      for (const c of consolidated) {
        if (c.requestLineIds.length) {
          await tx.productionRequestLine.updateMany({
            where: { id: { in: c.requestLineIds } },
            data: { plannedLineId: plan.id },
          });
        }
      }
      return plan;
    });
  }

  async addLines(id: string, dto: AddPlanLinesDto) {
    const plan = await this.getOrThrow(id);
    if (plan.status !== 'draft') throw new BadRequestException('Only a draft plan can be edited.');
    const existing = plan.lines.length;
    await this.prisma.client.productionPlanLine.createMany({
      data: dto.lines.map((l, i) => ({
        organizationId: this.org,
        planId: id,
        productId: l.productId,
        variantId: l.variantId ?? null,
        bomId: l.bomId ?? null,
        targetQty: dec(l.targetQty),
        scheduledDate: l.scheduledDate ? new Date(l.scheduledDate) : null,
        notes: l.notes ?? null,
        lineNumber: existing + i,
      })),
    });
    return this.getOrThrow(id);
  }

  /**
   * Confirm the plan: spin each line into a DRAFT production order. Idempotent
   * per line via generatedOrderId, so a partial failure can be retried.
   */
  async confirm(id: string) {
    const plan = await this.getOrThrow(id);
    if (plan.status === 'confirmed') return plan;
    if (plan.status !== 'draft') throw new BadRequestException(`Cannot confirm a ${plan.status} plan.`);

    for (const line of plan.lines) {
      if (line.generatedOrderId) continue;
      const order = await this.production.createOrder({
        bomId: line.bomId ?? undefined,
        outputProductId: line.productId,
        outputVariantId: line.variantId ?? undefined,
        plannedQty: Number(line.targetQty),
        locationId: plan.locationId ?? undefined,
        scheduledFor: line.scheduledDate ? line.scheduledDate.toISOString() : undefined,
        notes: `Plan ${plan.planNumber}`,
      } as any);
      await this.prisma.client.productionPlanLine.update({
        where: { id: line.id },
        data: { generatedOrderId: order.id },
      });
      await this.prisma.client.productionOrder.update({
        where: { id: order.id },
        data: { planId: plan.id },
      });
    }

    // Mark the consolidated requests as planned.
    await this.prisma.client.productionRequest.updateMany({
      where: { lines: { some: { plannedLineId: plan.id } }, status: { in: ['submitted', 'approved'] } },
      data: { status: 'planned' },
    });

    return this.prisma.client.productionPlan.update({
      where: { id },
      data: { status: 'confirmed', updatedBy: this.tenant.userId ?? null },
      include: { lines: true },
    });
  }

  async cancel(id: string) {
    const plan = await this.getOrThrow(id);
    if (plan.status === 'cancelled') return plan;
    return this.prisma.client.productionPlan.update({
      where: { id },
      data: { status: 'cancelled', updatedBy: this.tenant.userId ?? null },
      include: { lines: true },
    });
  }

  list(params: { status?: string } = {}) {
    return this.prisma.client.productionPlan.findMany({
      where: { status: params.status ? (params.status as any) : undefined },
      orderBy: { createdAt: 'desc' },
      include: { lines: true },
    });
  }

  get(id: string) {
    return this.getOrThrow(id);
  }

  // ---- internals ----

  private async getOrThrow(id: string) {
    const plan = await this.prisma.client.productionPlan.findFirst({
      where: { id },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  /** Group open (submitted/approved), not-yet-consolidated request lines by
   *  product into one plan line each, summing quantities. */
  private async consolidateOpenRequests() {
    const lines = await this.prisma.client.productionRequestLine.findMany({
      where: {
        plannedLineId: null,
        request: { status: { in: ['submitted', 'approved'] } },
      },
      include: { request: { select: { status: true } } },
    });

    const groups = new Map<string, {
      productId: string;
      variantId: string | null;
      bomId: string | null;
      uomId: string | null;
      targetQty: ReturnType<typeof dec>;
      requestLineIds: string[];
    }>();
    for (const l of lines) {
      const key = `${l.productId}::${l.variantId ?? ''}`;
      const g = groups.get(key);
      if (g) {
        g.targetQty = g.targetQty.plus(dec(l.quantity));
        g.bomId = g.bomId ?? l.bomId;
        g.requestLineIds.push(l.id);
      } else {
        groups.set(key, {
          productId: l.productId,
          variantId: l.variantId,
          bomId: l.bomId,
          uomId: l.uomId,
          targetQty: dec(l.quantity),
          requestLineIds: [l.id],
        });
      }
    }
    return [...groups.values()];
  }
}
