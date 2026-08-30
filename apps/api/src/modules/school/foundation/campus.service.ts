import { Injectable, NotFoundException } from '@nestjs/common';
import type { Campus } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type { CreateCampusDto, UpdateCampusDto } from './dto.types';

@Injectable()
export class CampusService extends BaseCrudService<Campus, CreateCampusDto, UpdateCampusDto> {
  protected readonly entityName = 'Campus';
  protected readonly searchFields = ['code', 'name', 'email', 'phone'];
  protected readonly defaultInclude = { classes: true };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {
    super(prisma.client.campus as unknown as CrudDelegate);
  }

  async create(dto: CreateCampusDto): Promise<Campus> {
    const prisma = (this as any).delegate;
    const orgId = this.tenant.organizationId;
    const created = await this.prisma.client.$transaction(async (tx: any) => {
      // Default the first campus of an org to "main" unless caller says otherwise.
      const existingCount = await tx.campus.count({ where: { organizationId: orgId, deletedAt: null } });
      const row = await tx.campus.create({
        data: { ...(dto as any), isMain: dto.isMain ?? (existingCount === 0) },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Campus',
        entityId: row.id,
        action: 'create',
        newValues: row,
      });
      return row;
    });
    return created;
  }

  async update(id: string, dto: UpdateCampusDto): Promise<Campus> {
    const updated = await this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.campus.updateMany({ where: { id }, data: dto as any });
      if (res.count === 0) throw new NotFoundException(`Campus ${id} not found`);
      const after = await tx.campus.findFirst({ where: { id } });
      await this.audit.recordInTx(tx, {
        entity: 'Campus',
        entityId: id,
        action: 'update',
        newValues: after,
      });
      return after;
    });
    return updated as Campus;
  }
}