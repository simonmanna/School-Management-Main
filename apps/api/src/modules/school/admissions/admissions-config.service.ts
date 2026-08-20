import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';

/**
 * Admissions configuration: requirements (Phase 1), offer-letter templates
 * (Phase 2) and enquiries/leads (Phase 5). Kept out of the core FSM service so
 * that god-class does not keep growing; all three are ordinary tenant-scoped CRUD.
 */
@Injectable()
export class AdmissionsConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  // ─────────────────────────── Requirements ───────────────────────────
  listRequirements(admissionCycleId?: string) {
    return this.prisma.client.admissionRequirement.findMany({
      where: { ...(admissionCycleId ? { admissionCycleId } : {}) },
      orderBy: [{ gate: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async upsertRequirement(dto: {
    id?: string;
    admissionCycleId?: string | null;
    classId?: string | null;
    kind?: string;
    code: string;
    label: string;
    required?: boolean;
    gate?: string;
    sortOrder?: number;
  }) {
    const organizationId = this.tenant.organizationId;
    const data = {
      admissionCycleId: dto.admissionCycleId ?? null,
      classId: dto.classId ?? null,
      kind: dto.kind ?? 'document',
      code: dto.code,
      label: dto.label,
      required: dto.required ?? true,
      gate: dto.gate ?? 'submit',
      sortOrder: dto.sortOrder ?? 0,
    };
    if (dto.id) {
      const existing = await this.prisma.client.admissionRequirement.findFirst({ where: { id: dto.id } });
      if (!existing) throw new NotFoundException(`Requirement ${dto.id} not found`);
      return this.prisma.client.admissionRequirement.update({ where: { id: dto.id }, data });
    }
    return this.prisma.client.admissionRequirement.create({ data: { organizationId, ...data } });
  }

  async removeRequirement(id: string) {
    const res = await this.prisma.client.admissionRequirement.deleteMany({ where: { id } });
    if (res.count === 0) throw new NotFoundException(`Requirement ${id} not found`);
    return { id, deleted: true };
  }

  // ───────────────────────── Offer templates ──────────────────────────
  listOfferTemplates() {
    return this.prisma.client.admissionOfferTemplate.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async upsertOfferTemplate(dto: { id?: string; name: string; body: string; validityDays?: number; isDefault?: boolean }) {
    const organizationId = this.tenant.organizationId;
    // Only one default template per org — clear the flag elsewhere when setting it.
    if (dto.isDefault) {
      await this.prisma.client.admissionOfferTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    const data = { name: dto.name, body: dto.body, validityDays: dto.validityDays ?? 14, isDefault: dto.isDefault ?? false };
    if (dto.id) {
      const existing = await this.prisma.client.admissionOfferTemplate.findFirst({ where: { id: dto.id } });
      if (!existing) throw new NotFoundException(`Offer template ${dto.id} not found`);
      return this.prisma.client.admissionOfferTemplate.update({ where: { id: dto.id }, data });
    }
    return this.prisma.client.admissionOfferTemplate.create({ data: { organizationId, ...data } });
  }

  async removeOfferTemplate(id: string) {
    const res = await this.prisma.client.admissionOfferTemplate.updateMany({ where: { id }, data: { deletedAt: new Date() } });
    if (res.count === 0) throw new NotFoundException(`Offer template ${id} not found`);
    return { id, deleted: true };
  }

  // ───────────────────────────── Enquiries ────────────────────────────
  listEnquiries(status?: string) {
    return this.prisma.client.admissionEnquiry.findMany({
      where: { ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createEnquiry(dto: {
    applicantName: string;
    guardianName?: string;
    phone?: string;
    email?: string;
    academicYearId?: string;
    interestedClassId?: string;
    source?: string;
    notes?: string;
  }) {
    const organizationId = this.tenant.organizationId;
    const row = await this.prisma.client.admissionEnquiry.create({
      data: {
        organizationId,
        applicantName: dto.applicantName,
        guardianName: dto.guardianName ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        academicYearId: dto.academicYearId ?? null,
        interestedClassId: dto.interestedClassId ?? null,
        source: dto.source ?? null,
        notes: dto.notes ?? null,
        assignedToId: this.tenant.userId ?? null,
      },
    });
    await this.audit.record({ entity: 'AdmissionEnquiry', entityId: row.id, action: 'create', newValues: row });
    return row;
  }

  async updateEnquiry(id: string, dto: { status?: string; notes?: string; assignedToId?: string }) {
    const existing = await this.prisma.client.admissionEnquiry.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`Enquiry ${id} not found`);
    return this.prisma.client.admissionEnquiry.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.assignedToId !== undefined ? { assignedToId: dto.assignedToId } : {}),
      },
    });
  }

  /**
   * Mark an enquiry converted, linking it to the application it became. The
   * application itself is created via the normal AdmissionsService.create path;
   * this just closes the loop so the funnel can measure enquiry→application.
   */
  async markEnquiryConverted(id: string, applicationId: string) {
    const existing = await this.prisma.client.admissionEnquiry.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException(`Enquiry ${id} not found`);
    if (existing.status === 'converted') throw new BadRequestException('Enquiry already converted');
    return this.prisma.client.admissionEnquiry.update({
      where: { id },
      data: { status: 'converted', convertedApplicationId: applicationId },
    });
  }

  async removeEnquiry(id: string) {
    const res = await this.prisma.client.admissionEnquiry.updateMany({ where: { id }, data: { deletedAt: new Date() } });
    if (res.count === 0) throw new NotFoundException(`Enquiry ${id} not found`);
    return { id, deleted: true };
  }
}
