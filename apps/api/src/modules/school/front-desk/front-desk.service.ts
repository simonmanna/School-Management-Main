import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { CreateFrontDeskLogDto, CheckoutFrontDeskDto } from './front-desk.dto';

@Injectable()
export class FrontDeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  list(status?: string) {
    return this.prisma.client.frontDeskLog.findMany({
      where: { organizationId: this.orgId, ...(status ? { status } : {}) },
      orderBy: { checkInAt: 'desc' },
      include: { partner: true },
    });
  }

  async findOne(id: string) {
    const row = await this.prisma.client.frontDeskLog.findFirst({
      where: { id, organizationId: this.orgId },
      include: { partner: true },
    });
    if (!row) throw new NotFoundException(`FrontDeskLog ${id} not found`);
    return row;
  }

  create(dto: CreateFrontDeskLogDto) {
    return this.prisma.client.frontDeskLog.create({
      data: {
        organizationId: this.orgId,
        partnerId: dto.partnerId,
        visitorName: dto.visitorName,
        phone: dto.phone,
        purpose: dto.purpose,
        personVisited: dto.personVisited,
        notes: dto.notes,
        status: 'in',
      },
      include: { partner: true },
    });
  }

  checkout(id: string, dto: CheckoutFrontDeskDto) {
    return this.prisma.client.frontDeskLog.update({
      where: { id },
      data: { status: 'out', checkOutAt: new Date(), notes: dto.notes },
      include: { partner: true },
    });
  }
}
