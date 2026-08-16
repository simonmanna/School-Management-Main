import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import type { UpsertMedicalRecordDto } from './dto.types';

@Injectable()
export class MedicalRecordService {
  constructor(private readonly prisma: PrismaService) {}

  /** One medical record per student — upsert. */
  async upsert(dto: UpsertMedicalRecordDto) {
    return this.prisma.client.medicalRecord.upsert({
      where: { studentProfileId: dto.studentProfileId },
      create: {
        organizationId: (await this.tenantOrgId()),
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

  private async tenantOrgId() {
    const ctx = await this.prisma.client.organization.findFirst({});
    return ctx?.id ?? '';
  }
}