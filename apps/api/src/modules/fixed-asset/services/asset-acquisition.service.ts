import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { ApprovalsService } from '../../../kernel/approvals/approvals.service';
import type { CreateAcquisitionDto } from '../dto/create-acquisition.dto';

@Injectable()
export class AssetAcquisitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
  ) {}

  async findByAsset(assetId: string): Promise<any> {
    const acq = await this.prisma.client.assetAcquisition.findUnique({ where: { assetId } });
    if (!acq) throw new NotFoundException(`Acquisition for asset ${assetId} not found`);
    return acq;
  }

  async upsert(assetId: string, dto: CreateAcquisitionDto): Promise<any> {
    const asset = await this.prisma.client.asset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);

    // Check if creating
    const existing = await this.prisma.client.assetAcquisition.findUnique({ where: { assetId } });
    if (!existing) {
      // Approval gate for new acquisition sub-records
      const approval = await this.approvals.checkOrRequestApproval({
        entityType: 'asset_acquisition',
        entityId: assetId,
        snapshot: {
        assetCode: asset.assetCode,
          assetName: asset.name,
          vendor: dto.vendor,
          invoiceId: dto.invoiceId,
          purchaseOrderId: dto.purchaseOrderId,
          capitalizedCost: dto.capitalizedCost,
        },
      });
      if (approval?.needsApproval) {
        throw new ForbiddenException(
          `Asset acquisition details require approval. Request ID: ${approval.requestId}.`,
        );
      }
    }

    const data: any = { ...dto };
    if (dto.acquisitionDate) data.acquisitionDate = new Date(dto.acquisitionDate);
    return this.prisma.client.assetAcquisition.upsert({
      where: { assetId },
      create: { assetId, ...data },
      update: data,
    });
  }

  async remove(assetId: string): Promise<void> {
    await this.prisma.client.assetAcquisition.deleteMany({ where: { assetId } });
  }
}
