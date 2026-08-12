import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import type { CreateInsuranceDto } from '../dto/create-insurance.dto';

@Injectable()
export class AssetInsuranceService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAsset(assetId: string): Promise<any[]> {
    return this.prisma.client.assetInsurance.findMany({
      where: { assetId },
      orderBy: { renewalDate: 'desc' },
    });
  }

  async create(assetId: string, dto: CreateInsuranceDto): Promise<any> {
    const asset = await this.prisma.client.asset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    const data: any = { assetId, ...dto };
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.renewalDate) data.renewalDate = new Date(dto.renewalDate);
    return this.prisma.client.assetInsurance.create({ data });
  }

  async update(id: string, dto: Partial<CreateInsuranceDto>): Promise<any> {
    const existing = await this.prisma.client.assetInsurance.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`Insurance ${id} not found`);
    const data: any = { ...dto };
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.renewalDate) data.renewalDate = new Date(dto.renewalDate);
    return this.prisma.client.assetInsurance.update({ where: { id }, data });
  }
}
