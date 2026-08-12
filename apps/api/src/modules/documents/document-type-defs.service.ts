/**
 * Read API over the DMS registry (Phase 1.4). Writes/admin arrive with the
 * Phase 7 registry UI; read endpoints are consumed by the Document Center UI
 * and the Phase 2 engine.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';

export interface EffectiveType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  isSystem: boolean;
  /** Effective activation for the requesting org (OrganizationDocumentType). */
  isActive: boolean;
  configOverrides: unknown;
  numberingKey: string | null;
  numberingPrefix: string | null;
  numberingPadding: number;
  editPolicy: string;
  snapshotPolicy: unknown;
  printProfile: unknown;
  businessEffects: unknown;
  security: unknown;
  isFinancial: boolean;
  isInventoryRelevant: boolean;
  requiresPosting: boolean;
  approvalPolicy: unknown;
  postingPolicy: unknown;
  paymentPolicy: unknown;
  cancellationPolicy: unknown;
}

@Injectable()
export class DocumentTypeDefsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Global registry + per-org activation rows resolved for one org (ADR O2). */
  async listEffective(organizationId: string): Promise<EffectiveType[]> {
    const [defs, overrides] = await Promise.all([
      this.prisma.raw.documentTypeDef.findMany({
        where: { isActive: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.raw.organizationDocumentType.findMany({
        where: { organizationId },
      }),
    ]);
    const overrideByType = new Map(overrides.map((o) => [o.documentTypeId, o]));
    return defs.map((d) => {
      const o = overrideByType.get(d.id);
      return {
        id: d.id,
        code: d.code,
        name: d.name,
        description: d.description,
        category: d.category,
        isSystem: d.isSystem,
        isActive: o ? o.isActive : true,
        configOverrides: o?.configOverrides ?? null,
        numberingKey: d.numberingKey,
        numberingPrefix: d.numberingPrefix,
        numberingPadding: d.numberingPadding,
        editPolicy: d.editPolicy,
        snapshotPolicy: d.snapshotPolicy,
        printProfile: d.printProfile,
        businessEffects: d.businessEffects,
        security: d.security,
        isFinancial: d.isFinancial,
        isInventoryRelevant: d.isInventoryRelevant,
        requiresPosting: d.requiresPosting,
        approvalPolicy: d.approvalPolicy,
        postingPolicy: d.postingPolicy,
        paymentPolicy: d.paymentPolicy,
        cancellationPolicy: d.cancellationPolicy,
      };
    });
  }

  async getByCode(code: string) {
    const def = await this.prisma.raw.documentTypeDef.findUnique({ where: { code } });
    if (!def || !def.isActive) throw new NotFoundException(`Unknown document type code: ${code}`);
    return def;
  }

  /** Phase 7 — create a new document type definition (admin). */
  async create(input: { orgId: string; code: string; name: string; category?: string; lifecycleId?: string | null; config?: Record<string, unknown> }) {
    return this.prisma.client.$transaction(async (tx) => {
      // Global type def (Phase 7 registry). Per-org binding via OrganizationDocumentType.
      const def = await tx.documentTypeDef.create({
        data: {
          code: input.code,
          name: input.name,
          description: '',
          category: input.category ?? 'custom',
          lifecycleId: input.lifecycleId ?? undefined,
          ...(input.config as Record<string, unknown>),
        },
      });
      // Activate for the creating org.
      await tx.organizationDocumentType.create({
        data: {
          organizationId: input.orgId,
          documentTypeId: def.id,
          isActive: true,
        },
      });
      return def;
    });
  }

  /** Phase 7 — update a document type definition (admin). */
  async update(id: string, patch: { name?: string; description?: string; category?: string; lifecycleId?: string | null; isActive?: boolean } & Record<string, unknown>) {
    return this.prisma.raw.documentTypeDef.update({
      where: { id },
      data: patch,
    });
  }

  /** Phase 7 — update by code (resolver convenience). */
  async updateByCode(_orgId: string, code: string, patch: Record<string, unknown>) {
    const def = await this.prisma.raw.documentTypeDef.findUnique({ where: { code } });
    if (!def) throw new NotFoundException(`Unknown document type code: ${code}`);
    return this.prisma.raw.documentTypeDef.update({
      where: { id: def.id },
      data: patch,
    });
  }

  /** Phase 7 — soft-delete a document type (system types protected). */
  async remove(id: string) {
    const def = await this.prisma.raw.documentTypeDef.findUnique({ where: { id } });
    if (!def) throw new NotFoundException(`Document type not found: ${id}`);
    if (def.isSystem) {
      throw new BadRequestException('System document types cannot be deleted');
    }
    // Soft-delete via isActive so FK references (documents, org bindings) stay intact.
    return this.prisma.raw.documentTypeDef.update({ where: { id }, data: { isActive: false } });
  }

  /** Phase 7 — delete by code (resolver convenience). */
  async removeByCode(_orgId: string, code: string) {
    const def = await this.prisma.raw.documentTypeDef.findUnique({ where: { code } });
    if (!def) throw new NotFoundException(`Unknown document type code: ${code}`);
    if (def.isSystem) {
      throw new BadRequestException('System document types cannot be deleted');
    }
    return this.prisma.raw.documentTypeDef.update({ where: { id: def.id }, data: { isActive: false } });
  }

  async listCategories(): Promise<string[]> {
    const rows = await this.prisma.raw.documentTypeDef.findMany({
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    return rows.map((r) => r.category);
  }
}