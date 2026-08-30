import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { CreatePhoneCallDto, UpdatePhoneCallDto } from './phone-call.dto';
import { CallDirection, CallStatus } from '@prisma/client';

@Injectable()
export class PhoneCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  list(filters?: { direction?: CallDirection; status?: CallStatus; partnerId?: string; fromDate?: Date; toDate?: Date }) {
    const where: any = { organizationId: this.orgId };
    if (filters?.direction) where.direction = filters.direction;
    if (filters?.status) where.status = filters.status;
    if (filters?.partnerId) where.partnerId = filters.partnerId;
    if (filters?.fromDate || filters?.toDate) {
      where.callAt = {};
      if (filters.fromDate) where.callAt.gte = filters.fromDate;
      if (filters.toDate) where.callAt.lte = filters.toDate;
    }
    return this.prisma.client.phoneCall.findMany({
      where,
      orderBy: { callAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.client.phoneCall.findFirst({
      where: { id, organizationId: this.orgId },
    });
    if (!row) throw new NotFoundException(`PhoneCall ${id} not found`);
    return row;
  }

  create(dto: CreatePhoneCallDto) {
    return this.prisma.client.phoneCall.create({
      data: {
        organizationId: this.orgId,
        partnerId: dto.partnerId,
        direction: dto.direction,
        contactName: dto.contactName,
        phone: dto.phone,
        subject: dto.subject,
        outcome: dto.outcome,
        notes: dto.notes,
        durationSec: dto.durationSec,
        status: dto.status ?? 'completed',
      },
    });
  }

  update(id: string, dto: UpdatePhoneCallDto) {
    return this.prisma.client.phoneCall.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string) {
    await this.findOne(id);
    return this.prisma.client.phoneCall.delete({ where: { id } });
  }
}