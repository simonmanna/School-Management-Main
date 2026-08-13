import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import type { CreateGuardianDto, UpdateGuardianDto } from './dto.types';

/**
 * StudentGuardian — links a StudentProfile to a Contact row (the guardian).
 * If the Contact doesn't exist for the partner, we create one. The Contact
 * is reused across siblings — same parent may have multiple children.
 */
@Injectable()
export class GuardianService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateGuardianDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const student = await tx.studentProfile.findFirst({
        where: { id: dto.studentProfileId },
      });
      if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

      // Create the Contact row (parent contact belongs to the student's partner).
      const contact = await tx.contact.create({
        data: {
          organizationId,
          partnerId: student.partnerId,
          firstName: dto.guardian.firstName,
          lastName: dto.guardian.lastName ?? null,
          email: dto.guardian.email ?? null,
          phone: dto.guardian.phone ?? null,
          position: dto.guardian.position ?? null,
          isPrimary: dto.isPrimary ?? false,
        },
      });

      const link = await tx.studentGuardian.create({
        data: {
          organizationId,
          studentProfileId: dto.studentProfileId,
          guardianContactId: contact.id,
          relationship: dto.relationship,
          isPrimary: dto.isPrimary ?? false,
          canPickup: dto.canPickup ?? true,
          receivesStatements: dto.receivesStatements ?? true,
        },
        include: { studentProfile: true },
      });

      await this.audit.recordInTx(tx, {
        entity: 'StudentGuardian',
        entityId: link.id,
        action: 'create',
        newValues: link,
      });
      return { ...link, contact };
    });
  }

  async update(id: string, dto: UpdateGuardianDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.studentGuardian.updateMany({ where: { id }, data: dto as any });
      if (res.count === 0) throw new NotFoundException(`Guardian ${id} not found`);
      return tx.studentGuardian.findFirst({ where: { id } });
    });
  }

  async remove(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const res = await tx.studentGuardian.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      if (res.count === 0) throw new NotFoundException(`Guardian ${id} not found`);
    });
  }

  async listByStudent(studentProfileId: string) {
    const links = await this.prisma.client.studentGuardian.findMany({
      where: { studentProfileId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      // H3: include the guardian's Contact so the UI can show a name/phone.
      // Aliased to `contact` below to match the create() response shape.
      include: { guardianContact: true },
    });
    return links.map(({ guardianContact, ...link }) => ({ ...link, contact: guardianContact }));
  }
}