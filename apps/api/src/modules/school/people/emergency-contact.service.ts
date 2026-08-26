import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import type { CreateEmergencyContactDto, UpdateEmergencyContactDto } from './dto.types';

/**
 * EmergencyContact — standalone people (NOT guardians, NOT AR contacts) the
 * school may call if a guardian can't be reached. Full CRUD with soft-delete.
 */
@Injectable()
export class EmergencyContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateEmergencyContactDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const student = await tx.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
      if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

      const row = await tx.emergencyContact.create({
        data: {
          organizationId: this.tenant.organizationId,
          studentProfileId: dto.studentProfileId,
          firstName: dto.firstName,
          middleName: dto.middleName ?? null,
          lastName: dto.lastName ?? null,
          preferredName: dto.preferredName ?? null,
          relationship: dto.relationship ?? null,
          phone: dto.phone ?? null,
          alternativePhone: dto.alternativePhone ?? null,
          email: dto.email ?? null,
          address: dto.address ?? null,
          priority: dto.priority ?? 1,
          authorizedPickup: dto.authorizedPickup ?? false,
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'EmergencyContact',
        entityId: row.id,
        action: 'create',
        newValues: row,
      });
      return row;
    });
  }

  async update(id: string, dto: UpdateEmergencyContactDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const existing = await tx.emergencyContact.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException(`Emergency contact ${id} not found`);

      const data: Record<string, unknown> = {};
      for (const k of [
        'firstName',
        'middleName',
        'lastName',
        'preferredName',
        'relationship',
        'phone',
        'alternativePhone',
        'email',
        'address',
        'priority',
        'authorizedPickup',
      ] as const) {
        if (dto[k] !== undefined) data[k] = dto[k];
      }

      const after = await tx.emergencyContact.update({ where: { id }, data });
      await this.audit.recordInTx(tx, {
        entity: 'EmergencyContact',
        entityId: id,
        action: 'update',
        oldValues: existing,
        newValues: after,
      });
      return after;
    });
  }

  async remove(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.emergencyContact.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      if (res.count === 0) throw new NotFoundException(`Emergency contact ${id} not found`);
      await this.audit.recordInTx(tx, { entity: 'EmergencyContact', entityId: id, action: 'delete' });
    });
  }

  async listByStudent(studentProfileId: string) {
    return this.prisma.client.emergencyContact.findMany({
      where: { studentProfileId, deletedAt: null },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }
}
