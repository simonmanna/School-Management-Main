import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import type { UpsertMedicalRecordDto } from './dto.types';

/**
 * Health records for a learner. The most sensitive rows in the school domain,
 * so ownership is asserted explicitly rather than inferred.
 *
 * SEC-01 — the organization used to come from:
 *
 *     const ctx = await this.prisma.client.organization.findFirst({});
 *     return ctx?.id ?? '';
 *
 * `Organization` is deliberately absent from ORG_SCOPED, so the tenancy
 * extension passed that query through untouched and it returned whichever row
 * Postgres happened to hand back first — not the caller's school. On a
 * multi-school database a medical record could be stamped for the wrong
 * organization, and the empty-string fallback would write a row belonging to no
 * one. It mattered here more than anywhere else because `upsert` is the one
 * operation whose `create:` payload the tenancy extension does not stamp, so
 * this value is what actually landed on the row.
 */
@Injectable()
export class MedicalRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** One medical record per student — upsert. */
  async upsert(dto: UpsertMedicalRecordDto) {
    const organizationId = await this.assertStudentInTenant(dto.studentProfileId);

    return this.prisma.client.medicalRecord.upsert({
      where: { studentProfileId: dto.studentProfileId },
      create: {
        organizationId,
        studentProfileId: dto.studentProfileId,
        bloodGroup: dto.bloodGroup ?? null,
        allergies: (dto.allergies as any) ?? [],
        dietaryRequirements: (dto.dietaryRequirements as any) ?? [],
        conditions: (dto.conditions as any) ?? [],
        medications: (dto.medications as any) ?? [],
        emergencyNotes: dto.emergencyNotes ?? null,
        doctorName: dto.doctorName ?? null,
        doctorPhone: dto.doctorPhone ?? null,
      },
      update: {
        bloodGroup: dto.bloodGroup ?? undefined,
        allergies: (dto.allergies as any) ?? undefined,
        dietaryRequirements: (dto.dietaryRequirements as any) ?? undefined,
        conditions: (dto.conditions as any) ?? undefined,
        medications: (dto.medications as any) ?? undefined,
        emergencyNotes: dto.emergencyNotes ?? undefined,
        doctorName: dto.doctorName ?? undefined,
        doctorPhone: dto.doctorPhone ?? undefined,
      },
    });
  }

  async get(studentProfileId: string) {
    const r = await this.prisma.client.medicalRecord.findFirst({ where: { studentProfileId } });
    if (!r) throw new NotFoundException(`No medical record for student ${studentProfileId}`);
    return r;
  }

  /**
   * The request's organization, having confirmed the learner belongs to it.
   *
   * `studentProfileId` arrives from the URL, so it is attacker-controlled. The
   * scoped client filters the lookup by the caller's organization, which turns
   * a cross-school id into "not found" rather than a record written under the
   * wrong school.
   */
  private async assertStudentInTenant(studentProfileId: string): Promise<string> {
    const organizationId = this.tenant.organizationId;
    const student = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId },
      select: { id: true, organizationId: true },
    });
    if (!student) {
      throw new NotFoundException(`Student ${studentProfileId} not found`);
    }
    if (student.organizationId !== organizationId) {
      // Defence in depth: the scoped client should already have excluded this.
      throw new BadRequestException('Student belongs to a different organization');
    }
    return organizationId;
  }
}
