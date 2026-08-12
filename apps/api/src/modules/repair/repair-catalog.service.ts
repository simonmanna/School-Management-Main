import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';

/**
 * RepairCatalogService — RMMS config masters: labour charge types and
 * technicians. Both carry deletedAt (soft-delete via the tenancy extension).
 */
@Injectable()
export class RepairCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
  ) {}

  // ── Labour types ──────────────────────────────────────────────────────────

  listLabourTypes(query: any = {}) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.repairLabourType.findMany({
      where: {
        organizationId: orgId,
        ...(query.isActive !== undefined && query.isActive !== 'all'
          ? { isActive: query.isActive === 'true' }
          : {}),
      },
      orderBy: [{ code: 'asc' }],
    });
  }

  async createLabourType(dto: any) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.repairLabourType.create({
      data: {
        organizationId: orgId,
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        productId: dto.productId ?? null,
        price: dto.price ?? 0,
        durationMinutes: dto.durationMinutes ?? 60,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateLabourType(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairLabourType', id, orgId);
    return this.prisma.client.repairLabourType.update({ where: { id }, data: dto });
  }

  async deleteLabourType(id: string) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairLabourType', id, orgId);
    return this.prisma.client.repairLabourType.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ── Technicians ───────────────────────────────────────────────────────────

  listTechnicians(query: any = {}) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.repairTechnician.findMany({
      where: {
        organizationId: orgId,
        ...(query.availability ? { availability: query.availability } : {}),
        ...(query.isActive !== undefined && query.isActive !== 'all'
          ? { isActive: query.isActive === 'true' }
          : {}),
      },
      orderBy: [{ name: 'asc' }],
    });
  }

  async createTechnician(dto: any) {
    const orgId = this.tenant.organizationId;
    const code = dto.code ?? (await this.seq.next('repair_technician', { prefix: 'TECH-', padding: 4 }));
    return this.prisma.client.repairTechnician.create({
      data: {
        organizationId: orgId,
        code,
        name: dto.name,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        skills: dto.skills ?? [],
        certifications: dto.certifications ?? [],
        availability: dto.availability ?? 'available',
        hourlyRate: dto.hourlyRate ?? 0,
        isActive: dto.isActive ?? true,
        notes: dto.notes ?? null,
      },
    });
  }

  async updateTechnician(id: string, dto: any) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairTechnician', id, orgId);
    return this.prisma.client.repairTechnician.update({ where: { id }, data: dto });
  }

  async deleteTechnician(id: string) {
    const orgId = this.tenant.organizationId;
    await this.ensureExists('repairTechnician', id, orgId);
    return this.prisma.client.repairTechnician.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async ensureExists(model: 'repairLabourType' | 'repairTechnician', id: string, orgId: string) {
    const row = await (this.prisma.client as any)[model].findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException('Record not found');
    return row;
  }
}
