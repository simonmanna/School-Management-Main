import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { NotificationsService } from '../../kernel/notifications/notifications.service';

/**
 * RepairWarrantyService — warranties issued with repairs (or tracked for an
 * asset) and the claim workflow against them. A claim on a repair warranty
 * reopens the conversation with the customer; settlement is a manual decision
 * (rework job or refund) made by the service desk.
 */
@Injectable()
export class RepairWarrantyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly notifications: NotificationsService,
  ) {}

  async listWarranties(query: any = {}) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (query.status) where.status = query.status;
    if (query.repairOrderId) where.repairOrderId = query.repairOrderId;
    if (query.warrantyType) where.warrantyType = query.warrantyType;
    return this.prisma.client.repairWarranty.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: { claims: { orderBy: { claimDate: 'desc' } } },
      take: Math.min(Number(query.take ?? 50), 200),
      skip: Number(query.skip ?? 0),
    });
  }

  async createWarranty(dto: any) {
    const orgId = this.tenant.organizationId;
    const data: any = {
      organizationId: orgId,
      repairOrderId: dto.repairOrderId ?? null,
      assetId: dto.assetId ?? null,
      warrantyType: dto.warrantyType ?? 'repair_warranty',
      coverageStart: dto.coverageStart ? new Date(dto.coverageStart) : null,
      coverageEnd: dto.coverageEnd ? new Date(dto.coverageEnd) : null,
      coveredParts: dto.coveredParts ?? [],
      coveredLabour: dto.coveredLabour ?? true,
      terms: dto.terms ?? null,
    };
    if (dto.warrantyPeriodMonths && !data.coverageEnd) {
      const start = data.coverageStart ? new Date(data.coverageStart) : new Date();
      data.coverageStart = data.coverageStart ?? start;
      const end = new Date(start);
      end.setMonth(end.getMonth() + Number(dto.warrantyPeriodMonths));
      data.coverageEnd = end;
    }
    const warranty = await this.prisma.client.repairWarranty.create({ data });
    if (data.repairOrderId) {
      await this.prisma.client.repairOrder.update({
        where: { id: data.repairOrderId },
        data: {
          warrantyPeriodMonths: dto.warrantyPeriodMonths ?? 0,
          warrantyExpiresAt: data.coverageEnd,
        },
      });
    }
    return warranty;
  }

  async updateWarranty(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairWarranty', id, orgId);
    return this.prisma.client.repairWarranty.update({ where: { id }, data: dto });
  }

  /** Auto-expire: mark any warranty past coverageEnd as expired. */
  async expireOverdue() {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.repairWarranty.updateMany({
      where: { organizationId: orgId, status: 'active', coverageEnd: { lt: new Date() } },
      data: { status: 'expired' },
    });
  }

  // ── Claims ────────────────────────────────────────────────────────────────

  async createClaim(warrantyId: string, dto: any) {
    const orgId = this.tenant.organizationId;
    const warranty = await this.prisma.client.repairWarranty.findFirst({
      where: { id: warrantyId, organizationId: orgId },
    });
    if (!warranty) throw new NotFoundException('Warranty not found');
    if (warranty.status === 'expired') throw new BadRequestException('Warranty is expired — claim not accepted');
    const claim = await this.prisma.client.repairWarrantyClaim.create({
      data: {
        organizationId: orgId,
        warrantyId,
        claimDate: dto.claimDate ? new Date(dto.claimDate) : new Date(),
        description: dto.description ?? null,
        amount: dto.amount ?? 0,
        status: 'pending',
      },
    });
    await this.prisma.client.repairWarranty.update({
      where: { id: warrantyId },
      data: { status: 'claimed' },
    });
    await this.notifications.send({
      organizationId: orgId,
      channel: 'in_app',
      category: 'repair',
      title: 'Warranty claim filed',
      body: `${warranty.warrantyType} — ${dto.description ?? 'no details'}`,
      payload: { warrantyId, claimId: claim.id },
    });
    return claim;
  }

  async resolveClaim(claimId: string, dto: { status: string; resolution?: string }) {
    const orgId = this.tenant.organizationId;
    const claim = await this.prisma.client.repairWarrantyClaim.findFirst({
      where: { id: claimId, organizationId: orgId },
    });
    if (!claim) throw new NotFoundException('Warranty claim not found');
    const status = dto.status as 'pending' | 'approved' | 'rejected' | 'settled';
    if (!['pending', 'approved', 'rejected', 'settled'].includes(status))
      throw new BadRequestException(`Invalid claim status: ${dto.status}`);
    const updated = await this.prisma.client.repairWarrantyClaim.update({
      where: { id: claimId },
      data: { status, resolution: dto.resolution ?? null },
    });
    // A rejected claim closes the warranty conversation; settled keeps it active.
    if (status === 'rejected') {
      await this.prisma.client.repairWarranty.update({
        where: { id: claim.warrantyId },
        data: { status: 'active' },
      });
    }
    return updated;
  }

  private async ensureExists(model: 'repairWarranty', id: string, orgId: string) {
    const row = await (this.prisma.client as any)[model].findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Record not found');
    return row;
  }
}
