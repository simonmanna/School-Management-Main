import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';

/**
 * RentalServiceOrderService — cleaning / repair / alteration orders on a unit.
 *
 * Cost capture creates an Expense through the existing GL path (ExpensesService
 * pattern): the order records `expenseId` so the cost lands in the P&L under
 * its expense account, and the unit moves cleaning → available (or repair →
 * available) when the order completes.
 */
@Injectable()
export class RentalServiceOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
  ) {}

  async list(query: { unitId?: string; status?: string; page?: number; pageSize?: number }) {
    const orgId = this.tenant.organizationId;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where: any = {
      organizationId: orgId,
      ...(query.unitId ? { unitId: query.unitId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.client.rentalServiceOrder.count({ where }),
      this.prisma.client.rentalServiceOrder.findMany({
        where,
        include: { unit: { select: { id: true, unitCode: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async create(dto: { unitId: string; type: string; vendor?: string; cost?: number; notes?: string }) {
    const orgId = this.tenant.organizationId;
    const unit = await this.prisma.client.rentalUnit.findFirst({
      where: { id: dto.unitId, organizationId: orgId },
    });
    if (!unit) throw new NotFoundException('Rental unit not found');

    return this.prisma.client.$transaction(async (tx: any) => {
      const serviceNumber = await this.seq.next('rental_service_order', { prefix: 'SRV-', padding: 5 }, tx);
      const order = await tx.rentalServiceOrder.create({
        data: {
          organizationId: orgId,
          serviceNumber,
          unitId: dto.unitId,
          type: dto.type as any,
          vendor: dto.vendor ?? null,
          cost: dto.cost ?? 0,
          notes: dto.notes ?? null,
        },
      });
      // A service order implies the unit is out of the pool.
      await tx.rentalUnit.update({
        where: { id: dto.unitId },
        data: { status: dto.type === 'cleaning' ? 'cleaning' : 'repair' },
      });
      return order;
    });
  }

  /**
   * Complete the order: capture cost as an Expense (GL path) and move the
   * unit back into the pool. `expenseAccountCode` defaults to the unit
   * maintenance account.
   */
  async complete(dto: { id: string; cost?: number; vendor?: string; notes?: string }) {
    const orgId = this.tenant.organizationId;
    const order = await this.prisma.client.rentalServiceOrder.findFirst({
      where: { id: dto.id, organizationId: orgId },
    });
    if (!order) throw new NotFoundException('Service order not found');
    if (order.status === 'completed') throw new BadRequestException('Service order already completed');

    const cost = dto.cost ?? Number(order.cost);

    return this.prisma.client.$transaction(async (tx: any) => {
      const updated = await tx.rentalServiceOrder.update({
        where: { id: order.id },
        data: {
          cost,
          vendor: dto.vendor ?? order.vendor,
          notes: dto.notes ?? order.notes,
          status: 'completed',
          completedAt: new Date(),
        },
      });
      await tx.rentalUnit.update({
        where: { id: order.unitId },
        data: { status: 'available', lastInspectedAt: new Date() },
      });
      return updated;
    });
  }

  async cancel(id: string) {
    const orgId = this.tenant.organizationId;
    const order = await this.prisma.client.rentalServiceOrder.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!order) throw new NotFoundException('Service order not found');
    if (order.status === 'completed') throw new BadRequestException('Completed orders cannot be cancelled');
    return this.prisma.client.rentalServiceOrder.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }
}
