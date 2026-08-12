import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { ApprovalsService } from '../../../kernel/approvals/approvals.service';
import type { CreateRevaluationDto } from '../dto/create-revaluation.dto';

@Injectable()
export class AssetRevaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
  ) {}

  async findByAsset(assetId: string): Promise<any[]> {
    return this.prisma.client.assetRevaluation.findMany({
      where: { assetId },
      orderBy: { revaluationDate: 'desc' },
    });
  }

  async create(assetId: string, dto: CreateRevaluationDto): Promise<any> {
    const asset = await this.prisma.client.asset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);

    // Approval gate
    const approval = await this.approvals.checkOrRequestApproval({
      entityType: 'asset_revaluation',
      entityId: assetId,
      snapshot: {
        assetCode: asset.assetCode,
        assetName: asset.name,
        previousValue: Number(asset.currentValue ?? 0),
        newValue: dto.newValue,
        reason: dto.reason,
      },
    });
    if (approval?.needsApproval) {
      throw new ForbiddenException(
        `Asset revaluation requires approval. Request ID: ${approval.requestId}.`,
      );
    }

    const data: any = { assetId, ...dto };
    if (dto.revaluationDate) data.revaluationDate = new Date(dto.revaluationDate);
    const reval = await this.prisma.client.assetRevaluation.create({ data });
    await this.prisma.client.asset.update({
      where: { id: assetId },
      data: { currentValue: dto.newValue },
    });
    return reval;
  }
}
