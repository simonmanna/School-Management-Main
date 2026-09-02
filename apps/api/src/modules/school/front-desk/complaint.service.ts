import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { CreateComplaintDto, UpdateComplaintDto } from './complaint.dto';
import { ComplaintCategory, ComplaintStatus, ComplaintPriority } from '@prisma/client';

@Injectable()
export class ComplaintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  list(filters?: { category?: ComplaintCategory; status?: ComplaintStatus; priority?: ComplaintPriority; partnerId?: string; assignedToId?: string; fromDate?: Date; toDate?: Date }) {
    const where: any = { organizationId: this.orgId };
    if (filters?.category) where.category = filters.category;
    if (filters?.status) where.status = filters.status;
    if (filters?.priority) where.priority = filters.priority;
    if (filters?.partnerId) where.partnerId = filters.partnerId;
    if (filters?.assignedToId) where.assignedToId = filters.assignedToId;
    if (filters?.fromDate || filters?.toDate) {
      where.createdAt = {};
      if (filters.fromDate) where.createdAt.gte = filters.fromDate;
      if (filters.toDate) where.createdAt.lte = filters.toDate;
    }
    return this.prisma.client.complaint.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.client.complaint.findFirst({
      where: { id, organizationId: this.orgId },
    });
    if (!row) throw new NotFoundException(`Complaint ${id} not found`);
    return row;
  }

  create(dto: CreateComplaintDto) {
    // Empty-string FK ids (sent by the UI when nothing is selected) must be
    // normalised to null — otherwise Prisma treats "" as a real FK and the
    // constraint blows up with a 500.
    const partnerId = dto.partnerId && dto.partnerId.trim() !== '' ? dto.partnerId : null;
    const assignedToId = dto.assignedToId && dto.assignedToId.trim() !== '' ? dto.assignedToId : null;
    return this.prisma.client.complaint.create({
      data: {
        organizationId: this.orgId,
        partnerId,
        category: dto.category,
        subject: dto.subject,
        description: dto.description,
        status: dto.status ?? 'open',
        priority: dto.priority ?? 'medium',
        assignedToId,
        resolution: dto.resolution,
        receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : undefined,
      },
    });
  }

  update(id: string, dto: UpdateComplaintDto) {
    const updateData: any = { ...dto };
    // Auto-set resolvedAt when status changes to resolved
    if (dto.status === 'resolved' || dto.status === 'closed') {
      updateData.resolvedAt = new Date();
    }
    if ('partnerId' in updateData) {
      updateData.partnerId = updateData.partnerId && String(updateData.partnerId).trim() !== '' ? updateData.partnerId : null;
    }
    if ('assignedToId' in updateData) {
      updateData.assignedToId = updateData.assignedToId && String(updateData.assignedToId).trim() !== '' ? updateData.assignedToId : null;
    }
    if ('receivedAt' in updateData && updateData.receivedAt) {
      updateData.receivedAt = new Date(updateData.receivedAt);
    }
    return this.prisma.client.complaint.update({
      where: { id },
      data: updateData,
    });
  }

  async delete(id: string) {
    await this.findOne(id);
    return this.prisma.client.complaint.delete({ where: { id } });
  }
}