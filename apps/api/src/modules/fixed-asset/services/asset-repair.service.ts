import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import type { CreateRepairDto } from '../dto/create-repair.dto';

@Injectable()
export class AssetRepairService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAsset(assetId: string): Promise<any[]> {
    return this.prisma.client.assetRepair.findMany({
      where: { assetId },
      orderBy: { breakdownDate: 'desc' },
    });
  }

  async create(assetId: string, dto: CreateRepairDto): Promise<any> {
    const asset = await this.prisma.client.asset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    const data: any = { assetId, ...dto };
    if (dto.breakdownDate) data.breakdownDate = new Date(dto.breakdownDate);
    if (dto.repairDate) data.repairDate = new Date(dto.repairDate);
    const repair = await this.prisma.client.assetRepair.create({ data });
    if (repair.status === 'pending' || repair.status === 'in_progress') {
      await this.prisma.client.asset.update({
        where: { id: assetId },
        data: { status: 'in_repair' },
      });
    }
    return repair;
  }

  async update(id: string, dto: Partial<CreateRepairDto>): Promise<any> {
    const existing = await this.prisma.client.assetRepair.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`Repair ${id} not found`);
    const data: any = { ...dto };
    if (dto.repairDate) data.repairDate = new Date(dto.repairDate);
    const updated = await this.prisma.client.assetRepair.update({ where: { id }, data });
    if (updated.status === 'completed') {
      await this.prisma.client.asset.update({
        where: { id: existing.assetId },
        data: { status: 'active' },
      });
    }
    return updated;
  }
}
