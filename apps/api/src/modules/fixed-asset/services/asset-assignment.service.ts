import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { EventBus } from '../../../kernel/events/event-bus';
import type { CreateAssignmentDto } from '../dto/create-assignment.dto';

@Injectable()
export class AssetAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  async findByAsset(assetId: string): Promise<any[]> {
    return this.prisma.client.assetAssignment.findMany({
      where: { assetId },
      orderBy: { assignedDate: 'desc' },
    });
  }

  async create(assetId: string, dto: CreateAssignmentDto): Promise<any> {
    const asset = await this.prisma.client.asset.findFirst({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    const data: any = { assetId, ...dto };
    if (dto.assignedDate) data.assignedDate = new Date(dto.assignedDate);
    if (dto.returnedDate) data.returnedDate = new Date(dto.returnedDate);
    const assignment = await this.prisma.client.assetAssignment.create({ data });
    await this.prisma.client.asset.update({
      where: { id: assetId },
      data: { assignedToId: dto.assignedToId, assignedToType: dto.assignedToType as any, assignmentDate: data.assignedDate ?? new Date() },
    });
    this.events.publish('fixed_asset.assigned', {
      organizationId: asset.organizationId,
      assetId,
      assignedToId: dto.assignedToId ?? '',
      assignedToType: dto.assignedToType ?? '',
    });
    return assignment;
  }

  async returnAsset(id: string, returnDate: string, condition?: string): Promise<any> {
    const assignment = await this.prisma.client.assetAssignment.findFirst({ where: { id } });
    if (!assignment) throw new NotFoundException(`Assignment ${id} not found`);
    return this.prisma.client.assetAssignment.update({
      where: { id },
      data: { returnedDate: returnDate ? new Date(returnDate) : new Date(), conditionAfter: condition },
    });
  }
}
