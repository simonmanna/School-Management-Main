import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { FilesService } from '../../kernel/files/files.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * HrPeopleService — the "who a person is" side of an employee record:
 * skills (org catalogue + per-employee links), prior work experience, and
 * personnel documents (CV, ID scans, contract copies).
 *
 * Document bytes go through the platform `FilesService` (the one File vault,
 * G3 — no second store); this service only owns the typed HR rows that point
 * at them.
 */
@Injectable()
export class HrPeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  private get orgId() {
    return this.tenant.organizationId;
  }

  private async assertEmployee(tx: any, employeeId: string) {
    const emp = await tx.hrEmployee.findFirst({
      where: { id: employeeId, organizationId: this.orgId, deletedAt: null },
      select: { id: true },
    });
    if (!emp) throw new NotFoundException('Employee not found');
  }

  // ── Skill catalogue ─────────────────────────────────────────────────────────

  async listSkills(query: any = {}) {
    const where: any = { organizationId: this.orgId, deletedAt: null };
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.category) where.category = query.category;
    const rows = await this.prisma.client.hrSkill.findMany({ where, orderBy: [{ name: 'asc' }] });
    return { rows, total: rows.length };
  }

  async createSkill(dto: any) {
    const userId = this.tenant.userId;
    const existing = await this.prisma.client.hrSkill.findFirst({
      where: { organizationId: this.orgId, code: String(dto.code).toUpperCase() },
    });
    if (existing) throw new BadRequestException(`Skill code "${dto.code}" already exists`);
    return this.prisma.client.hrSkill.create({
      data: {
        organizationId: this.orgId,
        code: String(dto.code).toUpperCase(),
        name: dto.name,
        category: dto.category ?? null,
        isActive: dto.isActive ?? true,
        createdBy: userId,
      },
    });
  }

  async updateSkill(id: string, dto: any) {
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrSkill.findFirst({ where: { id, organizationId: this.orgId } });
    if (!row) throw new NotFoundException('Skill not found');
    const data: any = { updatedBy: userId };
    for (const f of ['name', 'category', 'isActive'] as const) if (dto[f] !== undefined) data[f] = dto[f];
    return this.prisma.client.hrSkill.update({ where: { id }, data });
  }

  async deleteSkill(id: string) {
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrSkill.findFirst({ where: { id, organizationId: this.orgId } });
    if (!row) throw new NotFoundException('Skill not found');
    const inUse = await this.prisma.client.hrEmployeeSkill.count({
      where: { organizationId: this.orgId, skillId: id, deletedAt: null },
    });
    if (inUse > 0) throw new BadRequestException('Skill is assigned to employees — deactivate it instead');
    return this.prisma.client.hrSkill.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: userId } });
  }

  // ── Employee ↔ skill links ────────────────────────────────────────────────

  async listEmployeeSkills(employeeId: string) {
    return this.prisma.client.hrEmployeeSkill.findMany({
      where: { organizationId: this.orgId, employeeId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }],
      include: { skill: true },
    });
  }

  async addEmployeeSkill(dto: any) {
    const userId = this.tenant.userId;
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.assertEmployee(tx, dto.employeeId);
      const skill = await tx.hrSkill.findFirst({
        where: { id: dto.skillId, organizationId: this.orgId, deletedAt: null },
      });
      if (!skill) throw new NotFoundException('Skill not found');
      const dup = await tx.hrEmployeeSkill.findFirst({
        where: { organizationId: this.orgId, employeeId: dto.employeeId, skillId: dto.skillId, deletedAt: null },
      });
      if (dup) throw new BadRequestException('Employee already has this skill');
      const row = await tx.hrEmployeeSkill.create({
        data: {
          organizationId: this.orgId,
          employeeId: dto.employeeId,
          skillId: dto.skillId,
          proficiency: dto.proficiency ?? 'intermediate',
          yearsExperience: dto.yearsExperience ?? null,
          notes: dto.notes ?? null,
          createdBy: userId,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'HrEmployeeSkill',
        entityId: row.id,
        action: 'create',
        newValues: { employeeId: dto.employeeId, skillId: dto.skillId, proficiency: row.proficiency },
      });
      return row;
    });
  }

  async updateEmployeeSkill(id: string, dto: any) {
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrEmployeeSkill.findFirst({ where: { id, organizationId: this.orgId } });
    if (!row) throw new NotFoundException('Employee skill not found');
    const data: any = {};
    for (const f of ['proficiency', 'yearsExperience', 'notes'] as const) if (dto[f] !== undefined) data[f] = dto[f];
    return this.prisma.client.hrEmployeeSkill.update({ where: { id }, data });
  }

  /** Admin sign-off that a claimed skill is real. */
  async verifyEmployeeSkill(id: string, verified: boolean) {
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrEmployeeSkill.findFirst({ where: { id, organizationId: this.orgId } });
    if (!row) throw new NotFoundException('Employee skill not found');
    return this.prisma.client.hrEmployeeSkill.update({
      where: { id },
      data: {
        verified,
        verifiedById: verified ? userId : null,
        verifiedAt: verified ? new Date() : null,
      },
    });
  }

  async removeEmployeeSkill(id: string) {
    const row = await this.prisma.client.hrEmployeeSkill.findFirst({ where: { id, organizationId: this.orgId } });
    if (!row) throw new NotFoundException('Employee skill not found');
    return this.prisma.client.hrEmployeeSkill.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private static readonly PROFICIENCY_RANK: Record<string, number> = {
    beginner: 1,
    intermediate: 2,
    advanced: 3,
    expert: 4,
  };

  /**
   * "Who can cover Physics?" — employees holding a skill at or above a minimum
   * proficiency. This is the integration point with timetable cover (Phase 7).
   */
  async findEmployeesBySkill(skillId: string, minProficiency?: string) {
    const minRank = minProficiency ? (HrPeopleService.PROFICIENCY_RANK[minProficiency] ?? 1) : 1;
    const rows = await this.prisma.client.hrEmployeeSkill.findMany({
      where: { organizationId: this.orgId, skillId, deletedAt: null },
      include: {
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, isActive: true } },
        skill: true,
      },
    });
    return rows
      .filter((r: any) => (HrPeopleService.PROFICIENCY_RANK[r.proficiency] ?? 1) >= minRank)
      .filter((r: any) => r.employee?.isActive);
  }

  // ── Prior work experience ───────────────────────────────────────────────────

  async listExperience(employeeId: string) {
    return this.prisma.client.hrExperience.findMany({
      where: { organizationId: this.orgId, employeeId, deletedAt: null },
      orderBy: [{ startDate: 'desc' }],
    });
  }

  async addExperience(dto: any) {
    const userId = this.tenant.userId;
    return this.prisma.client.$transaction(async (tx: any) => {
      await this.assertEmployee(tx, dto.employeeId);
      return tx.hrExperience.create({
        data: {
          organizationId: this.orgId,
          employeeId: dto.employeeId,
          employer: dto.employer,
          title: dto.title ?? null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          description: dto.description ?? null,
          referenceName: dto.referenceName ?? null,
          referenceContact: dto.referenceContact ?? null,
          documentId: dto.documentId ?? null,
          createdBy: userId,
        },
      });
    });
  }

  async updateExperience(id: string, dto: any) {
    const row = await this.prisma.client.hrExperience.findFirst({ where: { id, organizationId: this.orgId } });
    if (!row) throw new NotFoundException('Experience not found');
    const data: any = {};
    for (const f of ['employer', 'title', 'description', 'referenceName', 'referenceContact', 'documentId'] as const) {
      if (dto[f] !== undefined) data[f] = dto[f];
    }
    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    return this.prisma.client.hrExperience.update({ where: { id }, data });
  }

  async removeExperience(id: string) {
    const row = await this.prisma.client.hrExperience.findFirst({ where: { id, organizationId: this.orgId } });
    if (!row) throw new NotFoundException('Experience not found');
    return this.prisma.client.hrExperience.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Personnel documents ──────────────────────────────────────────────────────

  async listDocuments(employeeId: string) {
    const rows = await this.prisma.client.hrEmployeeDocument.findMany({
      where: { organizationId: this.orgId, employeeId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }],
      include: {
        file: { select: { id: true, filename: true, contentType: true, byteSize: true, createdAt: true } },
      },
    });
    return rows;
  }

  /**
   * Upload the bytes to the File vault, then record the typed HR document row.
   * `ownerType/ownerId` tag the File so it is discoverable from the vault too.
   */
  async uploadDocument(dto: {
    employeeId: string;
    category?: string;
    type?: string;
    title?: string;
    expiresAt?: string;
    notes?: string;
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number };
  }) {
    const userId = this.tenant.userId;
    if (!dto.file) throw new BadRequestException('Missing file');
    await this.assertEmployee(this.prisma.client, dto.employeeId);

    const uploaded = await this.files.upload({
      filename: dto.file.originalname,
      contentType: dto.file.mimetype,
      buffer: dto.file.buffer,
      ownerType: 'HrEmployee',
      ownerId: dto.employeeId,
      visibility: 'private',
    });

    return this.prisma.client.$transaction(async (tx: any) => {
      const doc = await tx.hrEmployeeDocument.create({
        data: {
          organizationId: this.orgId,
          employeeId: dto.employeeId,
          category: dto.category ?? 'other',
          type: dto.type ?? null,
          title: dto.title ?? dto.file.originalname,
          fileId: uploaded.id,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          notes: dto.notes ?? null,
          createdBy: userId,
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'HrEmployeeDocument',
        entityId: doc.id,
        action: 'create',
        newValues: { employeeId: dto.employeeId, category: doc.category, title: doc.title, fileId: uploaded.id },
      });
      return doc;
    });
  }

  async updateDocument(id: string, dto: any) {
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrEmployeeDocument.findFirst({ where: { id, organizationId: this.orgId } });
    if (!row) throw new NotFoundException('Document not found');
    const data: any = {};
    for (const f of ['category', 'type', 'title', 'notes'] as const) if (dto[f] !== undefined) data[f] = dto[f];
    if (dto.expiresAt !== undefined) data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    return this.prisma.client.hrEmployeeDocument.update({ where: { id }, data });
  }

  async verifyDocument(id: string, verified: boolean) {
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrEmployeeDocument.findFirst({ where: { id, organizationId: this.orgId } });
    if (!row) throw new NotFoundException('Document not found');
    return this.prisma.client.hrEmployeeDocument.update({
      where: { id },
      data: {
        verified,
        verifiedById: verified ? userId : null,
        verifiedAt: verified ? new Date() : null,
      },
    });
  }

  /** Ownership-checked signed download for the document's underlying file. */
  async getDocumentDownload(id: string) {
    const row = await this.prisma.client.hrEmployeeDocument.findFirst({
      where: { id, organizationId: this.orgId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Document not found');
    return this.files.signDownloadForCaller(row.fileId);
  }

  async deleteDocument(id: string) {
    const userId = this.tenant.userId;
    const row = await this.prisma.client.hrEmployeeDocument.findFirst({ where: { id, organizationId: this.orgId } });
    if (!row) throw new NotFoundException('Document not found');
    // Soft-delete the HR row; the File is left in the vault (immutable history).
    return this.prisma.client.hrEmployeeDocument.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
