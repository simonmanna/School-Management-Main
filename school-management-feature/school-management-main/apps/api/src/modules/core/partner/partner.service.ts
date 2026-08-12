import { Injectable, NotFoundException } from '@nestjs/common';
import type { Partner } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';

@Injectable()
export class PartnerService extends BaseCrudService<Partner, CreatePartnerDto, UpdatePartnerDto> {
  protected readonly entityName = 'Partner';
  protected readonly searchFields = ['code', 'name', 'email', 'phone', 'taxNumber'];
  protected readonly defaultInclude = { category: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {
    super(prisma.client.partner as unknown as CrudDelegate);
  }

  async create(dto: CreatePartnerDto): Promise<Partner> {
    const partner = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.partner.create({ data: dto as any });
      await this.audit.recordInTx(tx, {
        entity: 'Partner',
        entityId: created.id,
        action: 'create',
        newValues: created,
      });
      return created;
    });
    this.events.publish('partner.created', {
      id: partner.id,
      organizationId: this.tenant.organizationId,
    });
    return partner;
  }

  async update(id: string, dto: UpdatePartnerDto): Promise<Partner> {
    const partner = await this.prisma.client.$transaction(async (tx) => {
      const before = await tx.partner.findFirst({ where: { id } });
      const res = await tx.partner.updateMany({ where: { id }, data: dto as any });
      if (res.count === 0) throw new NotFoundException(`Partner ${id} not found`);
      const after = await tx.partner.findFirst({ where: { id } });
      await this.audit.recordInTx(tx, {
        entity: 'Partner',
        entityId: id,
        action: 'update',
        oldValues: before,
        newValues: after,
      });
      return after as Partner;
    });
    this.events.publish('partner.updated', {
      id,
      organizationId: this.tenant.organizationId,
    });
    return partner;
  }

  async remove(id: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.partner.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.recordInTx(tx, {
        entity: 'Partner',
        entityId: id,
        action: 'delete',
      });
    });
    this.events.publish('partner.deleted', {
      id,
      organizationId: this.tenant.organizationId,
    });
  }
}