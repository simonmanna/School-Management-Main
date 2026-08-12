import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { ApprovalsService } from '../../../kernel/approvals/approvals.service';
import type { CreateDisposalDto } from '../dto/create-disposal.dto';

@Injectable()
export class AssetDisposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly approvals: ApprovalsService,
  ) {}

  async findByAsset(assetId: string): Promise<any> {
    return this.prisma.client.assetDisposal.findUnique({ where: { assetId } });
  }

  async create(assetId: string, dto: CreateDisposalDto): Promise<any> {
    const asset = await this.prisma.client.asset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    const disposed = await this.prisma.client.assetDisposal.findUnique({ where: { assetId } });
    if (disposed) throw new NotFoundException(`Asset ${assetId} already disposed`);

    // Approval gate
    const approval = await this.approvals.checkOrRequestApproval({
      entityType: 'asset_disposal',
      entityId: assetId,
      snapshot: {
        assetCode: asset.assetCode,
        assetName: asset.name,
        currentValue: Number(asset.currentValue ?? 0),
        disposalValue: dto.disposalValue,
        disposalMethod: dto.disposalMethod,
        reason: dto.reason,
      },
    });
    if (approval?.needsApproval) {
      throw new ForbiddenException(
        `Asset disposal requires approval. Request ID: ${approval.requestId}. Please have an authorized person approve it via the approvals endpoint.`,
      );
    }

    const data: any = { assetId, ...dto };
    if (dto.disposalDate) data.disposalDate = new Date(dto.disposalDate);
    data.bookValueAtDisposal = Number(asset.currentValue ?? 0);
    if (dto.disposalValue != null) data.gainLoss = dto.disposalValue - Number(asset.currentValue ?? 0);
    const disposal = await this.prisma.client.assetDisposal.create({ data });
    await this.prisma.client.asset.update({
      where: { id: assetId },
      data: { status: 'disposed', currentValue: 0 },
    });
    this.events.publish('fixed_asset.disposed', {
      organizationId: asset.organizationId,
      assetId,
      method: dto.disposalMethod,
      value: String(dto.disposalValue ?? 0),
    });
    return disposal;
  }
}
