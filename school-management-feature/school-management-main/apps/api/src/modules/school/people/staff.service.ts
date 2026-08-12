import { Injectable, NotFoundException } from '@nestjs/common';
import type { StaffProfile } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { BaseCrudService, type CrudDelegate } from '../../../kernel/common/base-crud.service';
import { EVENTS } from '@erp/shared';
import type { CreateStaffDto, UpdateStaffDto } from './dto.types';

/**
 * Staff = Partner (employee) + StaffProfile (school metadata).
 * Same pattern as StudentService: the universal Partner model is reused,
 * and the StaffProfile table adds school-specific fields.
 */
@Injectable()
export class StaffService extends BaseCrudService<StaffProfile, CreateStaffDto, UpdateStaffDto> {
  protected readonly entityName = 'StaffProfile';
  protected readonly searchFields: string[] = ['employeeNo'];
  protected readonly defaultInclude = {
    department: true,
    position: true,
    campus: true,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
  ) {
    super(prisma.client.staffProfile as unknown as CrudDelegate);
  }

  async create(dto: CreateStaffDto): Promise<StaffProfile> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const code =
        dto.code ??
        (await this.sequence.next(`staff:${new Date().getUTCFullYear()}`, { prefix: 'EMP-', padding: 6 }, tx));

      const partner = await tx.partner.create({
        data: {
          organizationId,
          code,
          name: dto.name,
          isCompany: dto.isCompany ?? false,
          isEmployee: true,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          customFields: dto.customFields ?? {},
        },
      });

      const profile = await tx.staffProfile.create({
        data: {
          organizationId,
          partnerId: partner.id,
          employeeNo: dto.employeeNo,
          departmentId: dto.departmentId ?? null,
          positionId: dto.positionId ?? null,
          campusId: dto.campusId ?? null,
          joinDate: new Date(dto.joinDate),
          contractType: dto.contractType ?? 'permanent',
          contractEndDate: dto.contractEndDate ? new Date(dto.contractEndDate) : null,
          compensation: (dto.compensation as any) ?? {},
          staffCategory: dto.staffCategory ?? 'teaching',
          customFields: dto.customFields ?? {},
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'StaffProfile',
        entityId: profile.id,
        action: 'create',
        newValues: { partner, profile },
      });

      this.events.publish(EVENTS.StaffCreated, {
        organizationId,
        staffProfileId: profile.id,
        partnerId: partner.id,
        employeeNo: profile.employeeNo,
      });

      return profile;
    });
  }

  async update(id: string, dto: UpdateStaffDto): Promise<StaffProfile> {
    return this.prisma.client.$transaction(async (tx: any) => {
      const before = await tx.staffProfile.findFirst({ where: { id } });
      if (!before) throw new NotFoundException(`Staff ${id} not found`);

      const partnerUpdates: Record<string, unknown> = {};
      if (dto.name !== undefined) partnerUpdates.name = dto.name;
      if (dto.email !== undefined) partnerUpdates.email = dto.email;
      if (dto.phone !== undefined) partnerUpdates.phone = dto.phone;
      if (Object.keys(partnerUpdates).length > 0) {
        await tx.partner.updateMany({ where: { id: before.partnerId }, data: partnerUpdates });
      }

      if (dto.status && dto.status !== before.status) {
        await tx.staffStatusHistory.create({
          data: {
            organizationId: before.organizationId,
            staffProfileId: id,
            fromStatus: before.status,
            toStatus: dto.status,
            reason: dto.reason ?? null,
            changedById: this.tenant.userId ?? null,
          },
        });
        this.events.publish(EVENTS.StaffStatusChanged, {
          organizationId: this.tenant.organizationId,
          staffProfileId: id,
          fromStatus: before.status,
          toStatus: dto.status,
        });
      }

      const profileUpdates: Record<string, unknown> = {};
      for (const k of [
        'departmentId',
        'positionId',
        'campusId',
        'joinDate',
        'contractType',
        'contractEndDate',
        'compensation',
        'staffCategory',
        'customFields',
      ] as const) {
        if (dto[k] !== undefined) profileUpdates[k] = dto[k];
      }
      if (dto.status !== undefined) profileUpdates.status = dto.status;

      await tx.staffProfile.updateMany({ where: { id }, data: profileUpdates });
      const after = await tx.staffProfile.findFirst({ where: { id } });
      await this.audit.recordInTx(tx, {
        entity: 'StaffProfile',
        entityId: id,
        action: 'update',
        oldValues: before,
        newValues: after,
      });
      return after as StaffProfile;
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx: any) => {
      const profile = await tx.staffProfile.findFirst({ where: { id } });
      if (!profile) throw new NotFoundException(`Staff ${id} not found`);
      await tx.staffProfile.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      await tx.partner.updateMany({ where: { id: profile.partnerId }, data: { deletedAt: new Date() } });
      await this.audit.recordInTx(tx, { entity: 'StaffProfile', entityId: id, action: 'delete' });
    });
  }

  async listByCampus(campusId: string) {
    return this.prisma.client.staffProfile.findMany({
      where: { campusId, status: 'active' },
      orderBy: { employeeNo: 'asc' },
    });
  }

  async listByDepartment(departmentId: string) {
    return this.prisma.client.staffProfile.findMany({
      where: { departmentId, status: 'active' },
      orderBy: { employeeNo: 'asc' },
    });
  }
}