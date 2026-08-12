import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import type { CreateInspectionDto } from '../dto/create-inspection.dto';

@Injectable()
export class AssetInspectionService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAsset(assetId: string): Promise<any[]> {
    return this.prisma.client.assetInspection.findMany({
      where: { assetId },
      orderBy: { inspectionDate: 'desc' },
    });
  }

  async create(assetId: string, dto: CreateInspectionDto): Promise<any> {
    const asset = await this.prisma.client.asset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    const data: any = { assetId, ...dto };
    if (dto.inspectionDate) data.inspectionDate = new Date(dto.inspectionDate);
    return this.prisma.client.assetInspection.create({ data });
  }
}
