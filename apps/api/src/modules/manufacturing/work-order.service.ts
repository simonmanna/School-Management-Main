import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { dec, ZERO } from '../../kernel/common/money';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AssignWorkOrderDto, CompleteWorkOrderDto } from './dto/phase4.dto';

/**
 * WorkOrder — one operation of a production order on the shop floor. Generated
 * from the BOM's routing; each carries its own status, assignee and labour
 * clock. Completing one with logged labour rolls a labour/machine cost into the
 * order's overhead, which the production complete leg then absorbs into WIP.
 */
@Injectable()
export class WorkOrderService {
  constructor(private readonly prisma: PrismaService, private readonly tenant: TenantContextService) {}

  private get org() {
    return this.tenant.organizationId;
  }

  /** Materialise work orders for a production order from its BOM's routing. */
  async generateForOrder(productionOrderId: string) {
    const order = await this.prisma.client.productionOrder.findFirst({
      where: { id: productionOrderId },
      select: { id: true, bomId: true, outputProductId: true },
    });
    if (!order) throw new NotFoundException('Production order not found');

    const existing = await this.prisma.client.workOrder.count({ where: { productionOrderId } });
    if (existing > 0) return this.list(productionOrderId); // idempotent

    // Routing: from the BOM's routingId, else one linked by bom/product.
    let routingId: string | null = null;
    if (order.bomId) {
      const bom = await this.prisma.client.bom.findFirst({ where: { id: order.bomId }, select: { routingId: true } });
      routingId = bom?.routingId ?? null;
    }
    let routing = routingId
      ? await this.prisma.client.routing.findFirst({ where: { id: routingId }, include: { operations: { orderBy: { sequence: 'asc' } } } })
      : null;
    if (!routing) {
      routing = await this.prisma.client.routing.findFirst({
        where: { OR: [{ bomId: order.bomId ?? undefined }, { productId: order.outputProductId }], isActive: true },
        include: { operations: { orderBy: { sequence: 'asc' } } },
      });
    }
    if (!routing || routing.operations.length === 0) {
      throw new BadRequestException('No routing with operations for this order. Create one first.');
    }

    await this.prisma.client.workOrder.createMany({
      data: routing.operations.map((op) => ({
        organizationId: this.org,
        productionOrderId,
        routingOperationId: op.id,
        operationSequence: op.sequence,
        name: op.name,
        workCenterId: op.workCenterId,
        plannedDurationMins: op.durationMins + op.setupMins,
        status: 'pending' as const,
        createdBy: this.tenant.userId ?? null,
      })),
    });
    return this.list(productionOrderId);
  }

  list(productionOrderId: string) {
    return this.prisma.client.workOrder.findMany({
      where: { productionOrderId },
      orderBy: { operationSequence: 'asc' },
      include: { workCenter: true, resource: true },
    });
  }

  async assign(id: string, dto: AssignWorkOrderDto) {
    await this.getOrThrow(id);
    return this.prisma.client.workOrder.update({
      where: { id },
      data: {
        resourceId: dto.resourceId ?? undefined,
        assignedToId: dto.assignedToId ?? undefined,
        workCenterId: dto.workCenterId ?? undefined,
        updatedBy: this.tenant.userId ?? null,
      },
    });
  }

  async start(id: string) {
    const wo = await this.getOrThrow(id);
    if (wo.status !== 'pending' && wo.status !== 'paused') {
      throw new BadRequestException(`Cannot start a ${wo.status} work order.`);
    }
    return this.prisma.client.workOrder.update({
      where: { id },
      data: { status: 'in_progress', startedAt: wo.startedAt ?? new Date(), pausedAt: null, updatedBy: this.tenant.userId ?? null },
    });
  }

  async pause(id: string) {
    const wo = await this.getOrThrow(id);
    if (wo.status !== 'in_progress') throw new BadRequestException('Only an in-progress work order can pause.');
    return this.prisma.client.workOrder.update({
      where: { id },
      data: { status: 'paused', pausedAt: new Date(), labourMins: wo.labourMins + this.elapsedMins(wo.startedAt), updatedBy: this.tenant.userId ?? null },
    });
  }

  async complete(id: string, dto: CompleteWorkOrderDto) {
    const wo = await this.getOrThrow(id);
    if (wo.status === 'completed' || wo.status === 'cancelled') {
      throw new BadRequestException(`Work order already ${wo.status}.`);
    }
    const labourMins = dto.labourMins ?? wo.labourMins + (wo.status === 'in_progress' ? this.elapsedMins(wo.startedAt) : 0);
    const resource = wo.resourceId
      ? await this.prisma.client.resource.findFirst({ where: { id: wo.resourceId }, select: { costPerHour: true, kind: true } })
      : null;
    const labourCost = dec(labourMins).div(60).mul(dec(resource?.costPerHour ?? 0));
    const kind = resource?.kind === 'machine' ? 'machine' : 'labour';

    return this.prisma.client.$transaction(async (tx: any) => {
      const updated = await tx.workOrder.update({
        where: { id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          labourMins,
          qtyGood: dto.qtyGood != null ? dec(dto.qtyGood) : wo.qtyGood,
          qtyScrap: dto.qtyScrap != null ? dec(dto.qtyScrap) : wo.qtyScrap,
          notes: dto.notes ?? wo.notes,
          updatedBy: this.tenant.userId ?? null,
        },
      });

      // Roll the labour/machine cost into the order's overhead so the production
      // complete leg absorbs it into WIP, and record the typed cost component.
      if (labourCost.gt(ZERO)) {
        await tx.productionOrder.update({
          where: { id: wo.productionOrderId },
          data: { overheadCost: { increment: labourCost } },
        });
        await tx.productionCostComponent.create({
          data: {
            organizationId: this.org,
            orderId: wo.productionOrderId,
            kind,
            amount: labourCost,
            sourceType: 'work_order',
            sourceId: wo.id,
            notes: `${labourMins} min · ${wo.name}`,
          },
        });
      }
      return updated;
    });
  }

  private elapsedMins(from: Date | null): number {
    if (!from) return 0;
    return Math.max(0, Math.round((Date.now() - from.getTime()) / 60000));
  }

  private async getOrThrow(id: string) {
    const wo = await this.prisma.client.workOrder.findFirst({ where: { id } });
    if (!wo) throw new NotFoundException('Work order not found');
    return wo;
  }
}
