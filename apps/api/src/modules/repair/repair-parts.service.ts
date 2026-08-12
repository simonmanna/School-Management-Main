import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { StockService } from '../inventory/stock.service';
import { NotificationsService } from '../../kernel/notifications/notifications.service';

/**
 * RepairPartsService — spare-part reservation and issue against a repair
 * order. Issuing a part calls the inventory StockService.issue engine (COGS
 * + inventory relief at issue-time) and records the RepairPart row. The
 * repair invoice line for the same part carries repairOrderLineId so the POS
 * invoice path never re-issues it (see pos-invoice.service.ts).
 */
@Injectable()
export class RepairPartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly stock: StockService,
    private readonly notifications: NotificationsService,
  ) {}

  async listParts(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.status) where.status = query.status;
    if (query.repairOrderId) where.repairOrderId = query.repairOrderId;
    if (query.jobId) where.jobId = query.jobId;
    if (query.productId) where.productId = query.productId;
    return this.prisma.client.repairPart.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: Math.min(Number(query.take ?? 50), 200),
      skip: Number(query.skip ?? 0),
    });
  }

  /** Reserve a part (no inventory movement yet). */
  async reservePart(repairOrderId: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const order = await this.prisma.client.repairOrder.findFirst({ where: { id: repairOrderId, organizationId: orgId } });
    if (!order) throw new NotFoundException('Repair order not found');
    const product = await this.prisma.client.product.findFirst({ where: { id: dto.productId, organizationId: orgId } });
    if (!product) throw new NotFoundException('Product not found');
    const quantity = Number(dto.quantity ?? 1);
    if (!(quantity > 0)) throw new BadRequestException('Quantity must be positive');
    const unitCost = Number(dto.unitCost ?? product.costPrice ?? 0) || 0;

    return this.prisma.client.repairPart.create({
      data: {
        organizationId: orgId,
        repairOrderId,
        jobId: dto.jobId ?? null,
        productId: dto.productId,
        locationId: dto.locationId ?? null,
        quantity,
        unitCost,
        totalCost: Math.round(quantity * unitCost * 100) / 100,
        status: 'reserved',
        notes: dto.notes ?? null,
      },
    });
  }

  /**
   * Issue a reserved part: calls StockService.issue (COGS + relief) and flips
   * the RepairPart row to `issued`.
   */
  async issuePart(id: string, dto: any = {}) {
    const orgId = this.tenant.organizationId;
    const part = await this.prisma.client.repairPart.findFirst({ where: { id, organizationId: orgId } });
    if (!part) throw new NotFoundException('Repair part not found');
    if (part.status === 'issued') throw new BadRequestException('Part already issued');

    const order = await this.prisma.client.repairOrder.findFirst({ where: { id: part.repairOrderId, organizationId: orgId } });
    const locationId = dto.locationId ?? part.locationId;
    if (!locationId) throw new BadRequestException('A source location is required to issue a part');
    if (!part.productId) throw new BadRequestException('Part has no linked product — stock cannot be relieved');

    await this.stock.issue(
      {
        productId: part.productId as string,
        locationId,
        quantity: Number(part.quantity),
        moveType: 'issue',
        sourceType: 'repair_part_issue',
        sourceId: part.repairOrderId,
        reference: `Repair ${order?.repairNumber ?? part.repairOrderId}`,
        notes: dto.notes ?? null,
      },
      undefined,
    );

    const updated = await this.prisma.client.repairPart.update({
      where: { id },
      data: {
        status: 'issued',
        issuedAt: new Date(),
        locationId,
        unitCost: dto.unitCost ?? part.unitCost,
        totalCost: dto.unitCost
          ? Math.round(Number(part.quantity) * Number(dto.unitCost) * 100) / 100
          : part.totalCost,
      },
    });

    await this.notifications.send({
      organizationId: orgId,
      channel: 'in_app',
      category: 'repair',
      title: 'Part issued',
      body: `${part.quantity} × ${part.productId} on ${order?.repairNumber ?? part.repairOrderId}`,
      payload: { repairOrderId: part.repairOrderId, partId: part.id },
    });
    return updated;
  }

  async deletePart(id: string) {
    const orgId = this.tenant.organizationId;
    const part = await this.prisma.client.repairPart.findFirst({ where: { id, organizationId: orgId } });
    if (!part) throw new NotFoundException('Repair part not found');
    if (part.status === 'issued') throw new BadRequestException('Issued parts cannot be deleted — reverse via stock adjustment');
    return this.prisma.client.repairPart.deleteMany({ where: { id, organizationId: orgId } });
  }
}
