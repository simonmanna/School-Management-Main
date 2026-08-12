import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import type { CreateCheckInOutDto } from '../dto/create-checkinout.dto';

@Injectable()
export class AssetCheckInOutService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAsset(assetId: string): Promise<any[]> {
    return this.prisma.client.assetCheckInOut.findMany({
      where: { assetId },
      orderBy: { checkoutDate: 'desc' },
    });
  }

  async create(assetId: string, dto: CreateCheckInOutDto): Promise<any> {
    const asset = await this.prisma.client.asset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    const data: any = { assetId, ...dto };
    if (dto.checkoutDate) data.checkoutDate = new Date(dto.checkoutDate);
    if (dto.expectedReturnDate) data.expectedReturnDate = new Date(dto.expectedReturnDate);
    if (dto.returnDate) data.returnDate = new Date(dto.returnDate);
    return this.prisma.client.assetCheckInOut.create({ data });
  }

  async checkIn(id: string, returnDate: string, condition?: string): Promise<any> {
    const item = await this.prisma.client.assetCheckInOut.findFirst({ where: { id } });
    if (!item) throw new NotFoundException(`CheckInOut ${id} not found`);
    return this.prisma.client.assetCheckInOut.update({
      where: { id },
      data: { returnDate: returnDate ? new Date(returnDate) : new Date(), conditionAfter: condition, status: 'returned' },
    });
  }
}
