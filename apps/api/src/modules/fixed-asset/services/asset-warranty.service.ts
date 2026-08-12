import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import type { CreateWarrantyDto } from '../dto/create-warranty.dto';

@Injectable()
export class AssetWarrantyService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAsset(assetId: string): Promise<any[]> {
    return this.prisma.client.assetWarranty.findMany({
      where: { assetId },
      orderBy: { warrantyEnd: 'desc' },
    });
  }

  async create(assetId: string, dto: CreateWarrantyDto): Promise<any> {
    const asset = await this.prisma.client.asset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    const data: any = { assetId, ...dto };
    data.warrantyStart = new Date(dto.warrantyStart);
    data.warrantyEnd = new Date(dto.warrantyEnd);
    return this.prisma.client.assetWarranty.create({ data });
  }

  async update(id: string, dto: Partial<CreateWarrantyDto>): Promise<any> {
    const existing = await this.prisma.client.assetWarranty.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`Warranty ${id} not found`);
    const data: any = { ...dto };
    if (dto.warrantyStart) data.warrantyStart = new Date(dto.warrantyStart);
    if (dto.warrantyEnd) data.warrantyEnd = new Date(dto.warrantyEnd);
    return this.prisma.client.assetWarranty.update({ where: { id }, data });
  }

  async getExpiringWarranties(orgId: string, days: number): Promise<any[]> {
    const now = new Date();
    const future = new Date(Date.now() + days * 86400000);
    return this.prisma.client.assetWarranty.findMany({
      where: {
        organizationId: orgId,
        warrantyEnd: { gte: now, lte: future },
      },
      include: { asset: { select: { name: true, assetCode: true } } },
      orderBy: { warrantyEnd: 'asc' },
    });
  }
}
