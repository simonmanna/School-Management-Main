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
      const existing = await tx.studentGuardian.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException(`Guardian ${id} not found`);

      // Patch the linked Contact (parent) details when supplied.
      if (dto.guardian) {
        const g = dto.guardian;
        await tx.contact.updateMany({
          where: { id: existing.guardianContactId },
          data: {
            firstName: g.firstName ?? undefined,
            lastName: g.lastName ?? undefined,
            email: g.email ?? undefined,
            phone: g.phone ?? undefined,
            position: g.position ?? undefined,
          },
        });
      }

      const linkData: any = {};
      if (dto.relationship !== undefined) linkData.relationship = dto.relationship;
      if (dto.isPrimary !== undefined) linkData.isPrimary = dto.isPrimary;
      if (dto.canPickup !== undefined) linkData.canPickup = dto.canPickup;
      if (dto.receivesStatements !== undefined) linkData.receivesStatements = dto.receivesStatements;
      if (Object.keys(linkData).length > 0) {
        await tx.studentGuardian.updateMany({ where: { id }, data: linkData });
      }
      return tx.studentGuardian.findFirst({
        where: { id },
        include: { guardianContact: true },
      }).then(({ guardianContact, ...link }: any) => ({ ...link, contact: guardianContact }));
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