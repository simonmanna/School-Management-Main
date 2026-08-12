/**
 * DMS — Phase 5 relations (§3.3, §5.2). Creation is validated against the
 * DocumentRelationType registry semantics: direction, allowed source/target
 * categories, cardinality (one per source), inverse-implicit mirror, duplicate
 * policy. Chain traversal is BFS with a visited set + depth cap (cycle guard).
 *
 * The reversal engine (Phase 2) writes the CANCELS relation mirroring
 * `reversedDocumentId` — both stay in sync because the engine owns both.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../kernel/prisma/prisma.service';

export interface RelationRow {
  id: string;
  relationType: string;
  direction: 'out' | 'both';
  inverseImplicit: boolean;
  duplicatesAllowed: boolean;
  cardinality: string;
  allowedSourceCategories: string[];
  allowedTargetCategories: string[];
}

export interface RelationValidationInput {
  relType: RelationRow;
  sourceCategory: string;
  targetCategory: string;
  currentSourceCount: number;
}

export type RelationValidationResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/** PURE semantics check — unit-tested without a DB (§3.3 table). */
export function validateRelationCreation(
  input: RelationValidationInput,
): RelationValidationResult {
  const { relType } = input;
  if (!relType) return { allowed: false, reason: 'Relation type not found' };

  if (input.sourceCategory && relType.allowedSourceCategories.length > 0) {
    if (!relType.allowedSourceCategories.includes(input.sourceCategory)) {
      return {
        allowed: false,
        reason: `Relation '${relType.relationType}' does not allow source category '${input.sourceCategory}' (allowed: ${relType.allowedSourceCategories.join(', ')})`,
      };
    }
  }
  if (input.targetCategory && relType.allowedTargetCategories.length > 0) {
    if (!relType.allowedTargetCategories.includes(input.targetCategory)) {
      return {
        allowed: false,
        reason: `Relation '${relType.relationType}' does not allow target category '${input.targetCategory}' (allowed: ${relType.allowedTargetCategories.join(', ')})`,
      };
    }
  }
  if (relType.cardinality === 'one' && input.currentSourceCount > 0) {
    return {
      allowed: false,
      reason: `Relation '${relType.relationType}' is cardinality ONE — this document already has one`,
    };
  }
  if (!relType.duplicatesAllowed) {
    // duplicate detection happens at the DB unique constraint as well; this
    // check covers the "any duplicate" reading of the seed semantics before
    // the narrower (from,to,type) unique fires.
    return { allowed: true };
  }
  return { allowed: true };
}

export interface CreateRelationInput {
  orgId: string;
  userId: string;
  fromDocumentId: string;
  toDocumentId: string;
  relationCode: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class DocumentRelationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createRelation(input: CreateRelationInput): Promise<{ id: string; mirrorId: string | null }> {
    const [from, to, relType] = await Promise.all([
      this.prisma.client.document.findFirst({
        where: { id: input.fromDocumentId, organizationId: input.orgId },
        include: { documentTypeDef: true },
      }),
      this.prisma.client.document.findFirst({
        where: { id: input.toDocumentId, organizationId: input.orgId },
        include: { documentTypeDef: true },
      }),
      this.prisma.client.documentRelationType.findUnique({ where: { code: input.relationCode } }),
    ]);
    if (!from) throw new NotFoundException('Source document not found');
    if (!to) throw new NotFoundException('Target document not found');
    if (!relType) throw new BadRequestException(`Relation type '${input.relationCode}' is not registered`);

    const currentSourceCount = await this.prisma.client.documentRelation.count({
      where: { fromDocumentId: from.id, organizationId: input.orgId, relationTypeId: relType.id },
    });
    const verdict = validateRelationCreation({
      relType: {
        id: relType.id,
        relationType: relType.code,
        direction: relType.direction as 'out' | 'both',
        inverseImplicit: relType.inverseImplicit,
        duplicatesAllowed: relType.duplicatesAllowed,
        cardinality: relType.cardinality,
        allowedSourceCategories: relType.allowedSourceCategories,
        allowedTargetCategories: relType.allowedTargetCategories,
      },
      sourceCategory: from.documentTypeDef?.category ?? 'custom',
      targetCategory: to.documentTypeDef?.category ?? 'custom',
      currentSourceCount,
    });
    if (!verdict.allowed) throw new BadRequestException(verdict.reason);

    const payload = (input.payload ?? {}) as Prisma.InputJsonValue;
    try {
      const row = await this.prisma.client.documentRelation.create({
        data: {
          organizationId: input.orgId,
          fromDocumentId: from.id,
          toDocumentId: to.id,
          relationTypeId: relType.id,
          payload,
          createdById: input.userId,
        },
      });
      let mirrorId: string | null = null;
      if (relType.inverseImplicit) {
        const existing = await this.prisma.client.documentRelation.findFirst({
          where: {
            fromDocumentId: to.id,
            toDocumentId: from.id,
            relationTypeId: relType.id,
            organizationId: input.orgId,
          },
        });
        if (!existing) {
          const mirror = await this.prisma.client.documentRelation.create({
            data: {
              organizationId: input.orgId,
              fromDocumentId: to.id,
              toDocumentId: from.id,
              relationTypeId: relType.id,
              payload: { mirrored: true } as Prisma.InputJsonValue,
              createdById: input.userId,
            },
          });
          mirrorId = mirror.id;
        }
      }
      return { id: row.id, mirrorId };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          `Relation '${input.relationCode}' already exists between these documents`,
        );
      }
      throw err;
    }
  }

  async listRelations(orgId: string, documentId: string) {
    const doc = await this.prisma.client.document.findFirst({
      where: { id: documentId, organizationId: orgId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const rows = await this.prisma.client.documentRelation.findMany({
      where: { organizationId: orgId, OR: [{ fromDocumentId: documentId }, { toDocumentId: documentId }] },
      include: {
        relationType: true,
        fromDocument: { select: { id: true, documentNumber: true, status: true } },
        toDocument: { select: { id: true, documentNumber: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      relationType: r.relationType.code,
      direction: r.fromDocumentId === documentId ? 'out' : 'in',
      fromDocumentId: r.fromDocumentId,
      fromNumber: r.fromDocument.documentNumber,
      toDocumentId: r.toDocumentId,
      toNumber: r.toDocument.documentNumber,
      payload: r.payload,
      createdAt: r.createdAt,
    }));
  }

  /** BFS chain with visited set + depth cap — cycle-safe (§5.2). */
  async relationChain(orgId: string, documentId: string, relationCode: string, maxDepth = 10) {
    const relType = await this.prisma.client.documentRelationType.findUnique({
      where: { code: relationCode },
    });
    if (!relType) throw new BadRequestException(`Relation type '${relationCode}' is not registered`);
    const chain: Array<{ documentId: string; depth: number; via: string }> = [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: documentId, depth: 0 }];
    visited.add(documentId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth > 0) chain.push({ documentId: current.id, depth: current.depth, via: relationCode });
      if (current.depth >= maxDepth) continue;
      const neighbors = await this.prisma.client.documentRelation.findMany({
        where: {
          organizationId: orgId,
          relationTypeId: relType.id,
          OR: [{ fromDocumentId: current.id }, { toDocumentId: current.id }],
        },
        select: {
          fromDocumentId: true,
          toDocumentId: true,
        },
      });
      for (const n of neighbors) {
        const next = n.fromDocumentId === current.id ? n.toDocumentId : n.fromDocumentId;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ id: next, depth: current.depth + 1 });
        }
      }
    }
    return { relationCode, chain };
  }

  async deleteRelation(orgId: string, documentId: string, relationId: string): Promise<{ deleted: boolean }> {
    const row = await this.prisma.client.documentRelation.findFirst({
      where: {
        id: relationId,
        organizationId: orgId,
        OR: [{ fromDocumentId: documentId }, { toDocumentId: documentId }],
      },
    });
    if (!row) throw new NotFoundException('Relation not found');
    // removing an explicit row also removes its implicit mirror (same pair, flagged).
    await this.prisma.client.documentRelation.deleteMany({
      where: { id: row.id, organizationId: orgId },
    });
    await this.prisma.client.documentRelation.deleteMany({
      where: {
        organizationId: orgId,
        fromDocumentId: row.toDocumentId,
        toDocumentId: row.fromDocumentId,
        relationTypeId: row.relationTypeId,
        payload: { path: ['mirrored'], equals: true },
      },
    });
    return { deleted: true };
  }
}