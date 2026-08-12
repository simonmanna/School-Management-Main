/**
 * DMS — Phase 5 sources (§5.1). DocumentSource links a document to the domain
 * record that produced it (RentalAgreement, PurchaseOrder, Student, …).
 *
 * Ownership boundary: the SOURCE validator is registered by the owning domain
 * module (sourceType → predicate). The DMS stores the link and validates via
 * the registry; an unregistered sourceType is accepted (deferred wiring), a
 * REGISTERED one must pass its predicate. No DMS table is consulted for
 * business truth.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';

export type SourceValidator = (orgId: string, sourceId: string, client: PrismaService['client']) => Promise<boolean>;

const registeredValidators = new Map<string, SourceValidator>();

/** Register a validator from the owning domain module (Phase 6 verticals). */
export function registerSourceValidator(sourceType: string, validator: SourceValidator): void {
  registeredValidators.set(sourceType, validator);
}

export interface AddSourceInput {
  orgId: string;
  userId: string;
  documentId: string;
  sourceType: string;
  sourceId: string;
  relationship?: 'primary' | 'related';
}

@Injectable()
export class DocumentSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async addSource(input: AddSourceInput): Promise<{ id: string; sourceType: string; sourceId: string }> {
    if (!input.sourceType?.trim() || !input.sourceId?.trim()) {
      throw new BadRequestException('sourceType and sourceId are required');
    }
    const doc = await this.prisma.client.document.findFirst({
      where: { id: input.documentId, organizationId: input.orgId },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const validator = registeredValidators.get(input.sourceType.trim());
    if (validator) {
      const ok = await validator(input.orgId, input.sourceId.trim(), this.prisma.client);
      if (!ok) {
        throw new BadRequestException(`Source '${input.sourceType}:${input.sourceId}' does not exist in its owning module`);
      }
    }

    const row = await this.prisma.client.documentSource.create({
      data: {
        organizationId: input.orgId,
        documentId: input.documentId,
        sourceType: input.sourceType.trim(),
        sourceId: input.sourceId.trim(),
        relationship: input.relationship ?? 'primary',
        createdById: input.userId,
      },
    });
    return { id: row.id, sourceType: row.sourceType, sourceId: row.sourceId };
  }

  async listSources(orgId: string, documentId: string) {
    const doc = await this.prisma.client.document.findFirst({
      where: { id: documentId, organizationId: orgId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return this.prisma.client.documentSource.findMany({
      where: { organizationId: orgId, documentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async removeSource(orgId: string, documentId: string, sourceId: string): Promise<{ deleted: boolean }> {
    const rows = await this.prisma.client.documentSource.deleteMany({
      where: { id: sourceId, organizationId: orgId, documentId },
    });
    if (rows.count === 0) throw new NotFoundException('Source link not found');
    return { deleted: true };
  }
}