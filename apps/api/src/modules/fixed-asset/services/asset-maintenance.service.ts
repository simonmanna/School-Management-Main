import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { EventBus } from '../../../kernel/events/event-bus';
import type { CreateMaintenanceDto } from '../dto/create-maintenance.dto';

@Injectable()
export class AssetMaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  async findByAsset(assetId: string): Promise<any[]> {
    return this.prisma.client.assetMaintenance.findMany({
      where: { assetId },
      orderBy: { scheduledDate: 'desc' },
    });
  }

  async create(assetId: string, dto: CreateMaintenanceDto): Promise<any> {
    const asset = await this.prisma.client.asset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    const data: any = { assetId, ...dto };
    if (dto.scheduledDate) data.scheduledDate = new Date(dto.scheduledDate);
    if (dto.completedDate) data.completedDate = new Date(dto.completedDate);
    if (dto.nextMaintenanceDate) data.nextMaintenanceDate = new Date(dto.nextMaintenanceDate);
    const maintenance = await this.prisma.client.assetMaintenance.create({ data });
    if (maintenance.status === 'in_progress' || maintenance.status === 'scheduled') {
      await this.prisma.client.asset.update({
        where: { id: assetId },
        data: { status: 'under_maintenance' },
      });
    }
    return maintenance;
  }

  async update(id: string, dto: Partial<CreateMaintenanceDto>): Promise<any> {
    const existing = await this.prisma.client.assetMaintenance.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`Maintenance ${id} not found`);
    const data: any = { ...dto };
    if (dto.scheduledDate) data.scheduledDate = new Date(dto.scheduledDate);
    if (dto.completedDate) data.completedDate = new Date(dto.completedDate);
    if (dto.nextMaintenanceDate) data.nextMaintenanceDate = new Date(dto.nextMaintenanceDate);
    const updated = await this.prisma.client.assetMaintenance.update({ where: { id }, data });
    if (updated.status === 'completed') {
      await this.prisma.client.asset.update({
        where: { id: existing.assetId },
        data: { status: 'active' },
      });
    }
    return updated;
  }

  async getDueMaintenance(orgId: string): Promise<any[]> {
    return this.prisma.client.assetMaintenance.findMany({
      where: {
        organizationId: orgId,
        nextMaintenanceDate: { lte: new Date(Date.now() + 30 * 86400000) },
        status: { not: 'completed' },
      },
      include: { asset: { select: { name: true, assetCode: true } } },
      orderBy: { nextMaintenanceDate: 'asc' },
    });
  }
}
