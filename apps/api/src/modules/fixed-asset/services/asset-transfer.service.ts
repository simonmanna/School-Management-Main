import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { ApprovalsService } from '../../../kernel/approvals/approvals.service';
import type { CreateTransferDto } from '../dto/create-transfer.dto';

@Injectable()
export class AssetTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly approvals: ApprovalsService,
  ) {}

  async findByAsset(assetId: string): Promise<any[]> {
    return this.prisma.client.assetTransfer.findMany({
      where: { assetId },
      orderBy: { transferDate: 'desc' },
    });
  }

  async create(assetId: string, dto: CreateTransferDto): Promise<any> {
    const asset = await this.prisma.client.asset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);

    // Approval gate
    const approval = await this.approvals.checkOrRequestApproval({
      entityType: 'asset_transfer',
      entityId: assetId,
      snapshot: {
        assetCode: asset.assetCode,
        assetName: asset.name,
        fromLocation: dto.fromLocation,
        toLocation: dto.toLocation,
        toBranchId: dto.toBranchId,
        reason: dto.reason,
      },
    });
    if (approval?.needsApproval) {
      throw new ForbiddenException(
        `Asset transfer requires approval. Request ID: ${approval.requestId}.`,
      );
    }

    const data: any = { assetId, ...dto };
    if (dto.transferDate) data.transferDate = new Date(dto.transferDate);
    const transfer = await this.prisma.client.assetTransfer.create({ data });
    const updateData: Record<string, any> = {};
    if (dto.toLocation) updateData.location = dto.toLocation;
    if (dto.toBranchId) updateData.branchId = dto.toBranchId;
    if (dto.toDepartment) updateData.department = dto.toDepartment;
    if (dto.toPersonId) updateData.assignedToId = dto.toPersonId;
    if (Object.keys(updateData).length > 0) {
      await this.prisma.client.asset.update({ where: { id: assetId }, data: updateData });
    }
    this.events.publish('fixed_asset.transferred', {
      organizationId: asset.organizationId,
      assetId,
      fromLocation: dto.fromLocation ?? '',
      toLocation: dto.toLocation ?? '',
    });
    return transfer;
  }
}
