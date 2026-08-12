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
  protected readonly defaultInclude = {
    category: true,
    contacts: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' } },
    addresses: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' } },
  };

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
      const { contacts, addresses, ...rest } = dto as any;
      if (!rest.code) {
        rest.code = `CUST-${Date.now().toString(36).toUpperCase()}`;
      }
      const created = await tx.partner.create({ data: rest as any });
      if (contacts && contacts.length > 0) {
        await tx.contact.createMany({
          data: contacts.map((c: any) => ({
            organizationId: created.organizationId,
            partnerId: created.id,
            firstName: c.firstName ?? '',
            lastName: c.lastName ?? null,
            position: c.position ?? null,
            email: c.email ?? null,
            phone: c.phone ?? null,
            isPrimary: c.isPrimary ?? false,
          })),
        });
      }
      if (addresses && addresses.length > 0) {
        await tx.address.createMany({
          data: addresses.map((a: any) => ({
            organizationId: created.organizationId,
            partnerId: created.id,
            type: a.type ?? 'billing',
            line1: a.line1 ?? '',
            line2: a.line2 ?? null,
            city: a.city ?? null,
            state: a.state ?? null,
            postalCode: a.postalCode ?? null,
            country: a.country ?? null,
            isPrimary: a.isPrimary ?? false,
          })),
        });
      }
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
      const { contacts, addresses, ...rest } = dto as any;
      const before = await tx.partner.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`Partner ${id} not found`);
      const orgId = before.organizationId;
      const res = await tx.partner.updateMany({ where: { id }, data: rest as any });
      if (res.count === 0) throw new NotFoundException(`Partner ${id} not found`);
      if (contacts && contacts.length > 0) {
        await tx.contact.deleteMany({ where: { partnerId: id, organizationId: orgId } });
        await tx.contact.createMany({
          data: contacts.map((c: any) => ({
            organizationId: orgId,
            partnerId: id,
            firstName: c.firstName ?? '',
            lastName: c.lastName ?? null,
            position: c.position ?? null,
            email: c.email ?? null,
            phone: c.phone ?? null,
            isPrimary: c.isPrimary ?? false,
          })),
        });
      }
      if (addresses && addresses.length > 0) {
        await tx.address.deleteMany({ where: { partnerId: id, organizationId: orgId } });
        await tx.address.createMany({
          data: addresses.map((a: any) => ({
            organizationId: orgId,
            partnerId: id,
            type: a.type ?? 'billing',
            line1: a.line1 ?? '',
            line2: a.line2 ?? null,
            city: a.city ?? null,
            state: a.state ?? null,
            postalCode: a.postalCode ?? null,
            country: a.country ?? null,
            isPrimary: a.isPrimary ?? false,
          })),
        });
      }
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