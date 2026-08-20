import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

export interface SchoolDocFilter {
  ownerType?: string;
  ownerId?: string;
  category?: string;
  type?: string;
  verified?: boolean;
  /// 'expiring' = expires within `expiryDays`; 'expired' = already past; omit = all.
  expiry?: 'expiring' | 'expired';
  expiryDays?: number;
  /// Role keys the caller holds — used for secure-access filtering.
  roles?: string[];
}

@Injectable()
export class SchoolDocumentsService {
  constructor(private readonly prisma: PrismaService, private readonly tenant: TenantContextService) {}

  private where(f: SchoolDocFilter, orgId: string) {
    const w: any = { organizationId: orgId };
    if (f.ownerType) w.ownerType = f.ownerType;
    if (f.ownerId) w.ownerId = f.ownerId;
    if (f.category) w.category = f.category;
    if (f.type) w.type = f.type;
    if (typeof f.verified === 'boolean') w.verified = f.verified;
    if (f.expiry === 'expired') w.expiresAt = { lt: new Date() };
    if (f.expiry === 'expiring') {
      const d = new Date();
      d.setDate(d.getDate() + (f.expiryDays ?? 30));
      w.expiresAt = { gte: new Date(), lte: d };
    }
    return w;
  }

  /** Secure-access: only return docs the caller may see. */
  private visible(docs: any[], roles: string[] = []) {
    return docs.filter((d) => {
      const allowed = (d.accessRoles ?? []) as string[];
      return allowed.length === 0 || allowed.some((r) => roles.includes(r));
    });
  }

  async list(f: SchoolDocFilter) {
    const orgId = this.tenant.organizationId;
    const rows = await this.prisma.client.schoolDoc.findMany({
      where: this.where(f, orgId),
      include: { file: true, signatureFile: true },
      orderBy: { createdAt: 'desc' },
    });
    return this.visible(rows, f.roles);
  }

  async get(id: string, roles: string[] = []) {
    const orgId = this.tenant.organizationId;
    const d = await this.prisma.client.schoolDoc.findFirst({
      where: { id, organizationId: orgId },
      include: { file: true, signatureFile: true, versions: { orderBy: { versionNo: 'desc' } } },
    });
    if (!d) throw new NotFoundException(`SchoolDoc ${id} not found`);
    const allowed = (d.accessRoles ?? []) as string[];
    if (allowed.length && !allowed.some((r) => roles.includes(r))) {
      throw new NotFoundException(`SchoolDoc ${id} not accessible`);
    }
    return d;
  }

  async create(dto: {
    ownerType?: string; ownerId: string; category?: string; type: string; title: string;
    fileId: string; signatureFileId?: string; expiresAt?: string; accessRoles?: string[]; notes?: string; customFields?: any;
  }) {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.schoolDoc.create({
      data: {
        organizationId: orgId,
        ownerType: dto.ownerType ?? 'student',
        ownerId: dto.ownerId,
        category: dto.category ?? 'other',
        type: dto.type,
        title: dto.title,
        fileId: dto.fileId,
        signatureFileId: dto.signatureFileId ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        accessRoles: (dto.accessRoles ?? []) as any,
        notes: dto.notes ?? null,
        customFields: (dto.customFields ?? {}) as any,
        createdBy: this.tenant.userId ?? null,
      },
    });
  }

  async update(id: string, dto: { title?: string; type?: string; category?: string; expiresAt?: string; accessRoles?: string[]; notes?: string; changeNote?: string; fileId?: string }) {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.schoolDoc.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) throw new NotFoundException(`SchoolDoc ${id} not found`);
    // Snapshot current state as a version before mutating.
    const nextVersion = (existing.version ?? 0) + 1;
    await this.prisma.client.schoolDocVersion.create({
      data: {
        organizationId: orgId,
        schoolDocId: id,
        versionNo: nextVersion,
        snapshot: {
          title: existing.title, type: existing.type, category: existing.category,
          expiresAt: existing.expiresAt, notes: existing.notes, accessRoles: existing.accessRoles,
        } as any,
        fileId: existing.fileId,
        changeNote: dto.changeNote ?? 'update',
        createdById: this.tenant.userId ?? null,
      },
    });
    return this.prisma.client.schoolDoc.update({
      where: { id },
      data: {
        title: dto.title ?? existing.title,
        type: dto.type ?? existing.type,
        category: dto.category ?? existing.category,
        expiresAt: dto.expiresAt !== undefined ? (dto.expiresAt ? new Date(dto.expiresAt) : null) : existing.expiresAt,
        accessRoles: dto.accessRoles !== undefined ? (dto.accessRoles as any) : existing.accessRoles,
        notes: dto.notes !== undefined ? dto.notes : existing.notes,
        fileId: dto.fileId ?? existing.fileId,
        version: nextVersion,
        updatedBy: this.tenant.userId ?? null,
      },
    });
  }

  async verify(id: string, verified: boolean) {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.schoolDoc.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) throw new NotFoundException(`SchoolDoc ${id} not found`);
    return this.prisma.client.schoolDoc.update({
      where: { id },
      data: { verified, verifiedById: this.tenant.userId ?? null, verifiedAt: verified ? new Date() : null },
    });
  }

  /** Attach a digital signature (signed-copy file) to the document. */
  async sign(id: string, signatureFileId: string) {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.schoolDoc.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) throw new NotFoundException(`SchoolDoc ${id} not found`);
    return this.prisma.client.schoolDoc.update({
      where: { id },
      data: { signatureFileId, signedAt: new Date(), signedById: this.tenant.userId ?? null },
    });
  }

  async versions(id: string, roles: string[] = []) {
    const d = await this.get(id, roles);
    return this.prisma.client.schoolDocVersion.findMany({
      where: { schoolDocId: d.id },
      orderBy: { versionNo: 'desc' },
      include: { schoolDoc: true },
    });
  }

  async remove(id: string) {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.schoolDoc.findFirst({ where: { id, organizationId: orgId } });
    if (!existing) throw new NotFoundException(`SchoolDoc ${id} not found`);
    await this.prisma.client.schoolDoc.delete({ where: { id } });
    return { id, deleted: true };
  }
}
