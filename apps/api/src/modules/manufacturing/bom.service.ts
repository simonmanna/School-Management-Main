import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec } from '../../kernel/common/money';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { ApprovalsService } from '../../kernel/approvals/approvals.service';
import { CreateBomDto, UpdateBomDto } from './dto/bom.dto';

/** A BOM line as needed by the explosion math (pure, DB-free). */
export interface ExplodableBomLine {
  componentProductId: string;
  componentVariantId?: string | null;
  quantity: Prisma.Decimal.Value;
  uomId?: string | null;
  scrapPct?: Prisma.Decimal.Value | null;
  sequence?: number | null;
}

export interface ExplodableBom {
  outputQuantity: Prisma.Decimal.Value;
  expectedYieldPct?: Prisma.Decimal.Value | null;
  lines: ExplodableBomLine[];
}

export interface ExplodedMaterial {
  componentProductId: string;
  componentVariantId: string | null;
  qtyPlanned: Prisma.Decimal;
  uomId: string | null;
  sequence: number;
}

export interface ExplodedBom {
  /** planned output quantity × expected yield %, in output units. */
  expectedOutputQty: Prisma.Decimal;
  materials: ExplodedMaterial[];
}

@Injectable()
export class BomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly approvals: ApprovalsService,
  ) {}

  private get org(): string {
    return this.tenant.organizationId;
  }

  // ===========================================================================
  // Explosion math — PURE. No DB, no I/O. Unit-tested directly.
  // ===========================================================================

  /**
   * Scale a BOM to `plannedQty` output units.
   *
   *   scale        = plannedQty / bom.outputQuantity
   *   line.planned = line.quantity × scale × (1 + scrapPct/100)
   *
   * `uomId` is carried through verbatim — conversion to base happens exactly once,
   * later, inside StockService.issue via dto.uomId. Converting here would
   * double-round.
   */
  static explode(bom: ExplodableBom, plannedQty: Prisma.Decimal.Value): ExplodedBom {
    const output = dec(bom.outputQuantity);
    if (output.lte(0)) throw new BadRequestException('BOM outputQuantity must be > 0');
    const scale = dec(plannedQty).div(output);
    const yieldPct = dec(bom.expectedYieldPct ?? 100);

    const materials = bom.lines.map((line, i) => {
      const scrapFactor = dec(1).plus(dec(line.scrapPct ?? 0).div(100));
      return {
        componentProductId: line.componentProductId,
        componentVariantId: line.componentVariantId ?? null,
        qtyPlanned: dec(line.quantity).mul(scale).mul(scrapFactor),
        uomId: line.uomId ?? null,
        sequence: line.sequence ?? i,
      };
    });

    return {
      expectedOutputQty: dec(plannedQty).mul(yieldPct).div(100),
      materials,
    };
  }

  // ===========================================================================
  // CRUD
  // ===========================================================================

  async create(dto: CreateBomDto) {
    const variantKey = dto.outputVariantId ?? '';
    // Next version for this (product, variant). Versions are per output line, so a
    // fork of an active recipe gets version+1 rather than colliding.
    const latest = await this.prisma.client.bom.findFirst({
      where: { outputProductId: dto.outputProductId, outputVariantKey: variantKey },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;
    const code = await this.seq.next('bom', { prefix: 'BOM-', padding: 5 });

    await this.assertNoCycle(dto.outputProductId, dto.lines.map((l) => l.componentProductId));

    return this.prisma.client.bom.create({
      data: {
        organizationId: this.org,
        code,
        name: dto.name,
        outputProductId: dto.outputProductId,
        outputVariantId: dto.outputVariantId ?? null,
        outputVariantKey: variantKey,
        outputQuantity: dec(dto.outputQuantity),
        outputUomId: dto.outputUomId ?? null,
        version,
        status: 'draft',
        isDefault: dto.isDefault ?? false,
        expectedYieldPct: dec(dto.expectedYieldPct ?? 100),
        overheadCost: dec(dto.overheadCost ?? 0),
        defaultLocationId: dto.defaultLocationId ?? null,
        defaultOutputLocationId: dto.defaultOutputLocationId ?? null,
        shelfLifeDays: dto.shelfLifeDays ?? null,
        estimatedDurationMins: dto.estimatedDurationMins ?? null,
        qcRequired: dto.qcRequired ?? false,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        notes: dto.notes ?? null,
        createdBy: this.tenant.userId ?? null,
        lines: { create: dto.lines.map((l, i) => this.lineData(l, i)) },
      },
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });
  }

  async update(id: string, dto: UpdateBomDto) {
    const bom = await this.getOrThrow(id);
    // An active BOM is immutable — this is what lets a completed production order
    // trust the recipe it references. Editing forks a new draft version.
    if (bom.status !== 'draft') {
      throw new BadRequestException(
        `BOM ${bom.code} is ${bom.status} and cannot be edited. Create a new version instead.`,
      );
    }

    if (dto.lines) {
      await this.assertNoCycle(bom.outputProductId, dto.lines.map((l) => l.componentProductId));
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      if (dto.lines) {
        await tx.bomLine.deleteMany({ where: { bomId: id } });
        await tx.bomLine.createMany({
          data: dto.lines.map((l, i) => ({ bomId: id, ...this.lineData(l, i) })),
        });
      }
      return tx.bom.update({
        where: { id },
        data: {
          name: dto.name ?? undefined,
          outputQuantity: dto.outputQuantity != null ? dec(dto.outputQuantity) : undefined,
          outputUomId: dto.outputUomId ?? undefined,
          expectedYieldPct: dto.expectedYieldPct != null ? dec(dto.expectedYieldPct) : undefined,
          defaultLocationId: dto.defaultLocationId ?? undefined,
          defaultOutputLocationId: dto.defaultOutputLocationId ?? undefined,
          shelfLifeDays: dto.shelfLifeDays ?? undefined,
          estimatedDurationMins: dto.estimatedDurationMins ?? undefined,
          qcRequired: dto.qcRequired ?? undefined,
          isDefault: dto.isDefault ?? undefined,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
          notes: dto.notes ?? undefined,
          updatedBy: this.tenant.userId ?? null,
        },
        include: { lines: { orderBy: { sequence: 'asc' } } },
      });
    });
  }

  /**
   * Activate a draft BOM. Gated by the approval engine (entityType
   * 'bom_version'). Archives the prior active version for the same output and, if
   * this one is the default, clears isDefault on its siblings so exactly one
   * active BOM per product is the default.
   */
  async activate(id: string) {
    const bom = await this.getOrThrow(id);
    if (bom.status === 'active') return bom;
    if (bom.status === 'archived') {
      throw new BadRequestException('Cannot re-activate an archived BOM version.');
    }

    const gate = await this.approvals.checkOrRequestApproval({
      entityType: 'bom_version',
      entityId: bom.id,
      snapshot: { amount: 0, code: bom.code, product: bom.outputProductId, version: bom.version },
    });
    if (gate?.needsApproval) {
      throw new BadRequestException(
        `Approval required before activating BOM ${bom.code}. Pending request ${gate.requestId}.`,
      );
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      // Archive whatever is currently active for this output.
      await tx.bom.updateMany({
        where: {
          outputProductId: bom.outputProductId,
          outputVariantKey: bom.outputVariantKey,
          status: 'active',
          id: { not: bom.id },
        },
        data: { status: 'archived' },
      });
      if (bom.isDefault) {
        await tx.bom.updateMany({
          where: {
            outputProductId: bom.outputProductId,
            outputVariantKey: bom.outputVariantKey,
            id: { not: bom.id },
          },
          data: { isDefault: false },
        });
      }
      return tx.bom.update({
        where: { id: bom.id },
        data: { status: 'active', updatedBy: this.tenant.userId ?? null },
        include: { lines: { orderBy: { sequence: 'asc' } } },
      });
    });
  }

  async remove(id: string) {
    const bom = await this.getOrThrow(id);
    return this.prisma.client.bom.update({
      where: { id: bom.id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: this.tenant.userId ?? null },
    });
  }

  list(params: { outputProductId?: string; status?: string } = {}) {
    return this.prisma.client.bom.findMany({
      where: {
        outputProductId: params.outputProductId,
        status: params.status ? (params.status as any) : undefined,
      },
      orderBy: [{ outputProductId: 'asc' }, { version: 'desc' }],
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });
  }

  get(id: string) {
    return this.getOrThrow(id);
  }

  // ===========================================================================
  // Resolution — which BOM does a production order use.
  // ===========================================================================

  /**
   * Resolve the BOM for a production order: the named one (must be active), else
   * the active default for the product, else the sole active BOM. Effective-dated
   * BOMs outside their window are excluded.
   */
  async resolveForOrder(outputProductId: string, variantId: string | null | undefined, bomId?: string) {
    if (bomId) {
      const bom = await this.getOrThrow(bomId);
      if (bom.status !== 'active') {
        throw new BadRequestException(`BOM ${bom.code} is ${bom.status}, not active.`);
      }
      return bom;
    }
    const variantKey = variantId ?? '';
    const now = new Date();
    const candidates = await this.prisma.client.bom.findMany({
      where: {
        outputProductId,
        outputVariantKey: variantKey,
        status: 'active',
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        ],
      },
      orderBy: [{ isDefault: 'desc' }, { version: 'desc' }],
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });
    if (candidates.length === 0) {
      throw new BadRequestException('No active BOM for this product. Create and activate one first.');
    }
    return candidates[0];
  }

  /** Non-throwing active-BOM lookup (unlike resolveForOrder). */
  async findActive(outputProductId: string, variantId?: string | null) {
    const now = new Date();
    return this.prisma.client.bom.findFirst({
      where: {
        outputProductId,
        outputVariantKey: variantId ?? '',
        status: 'active',
        AND: [
          { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        ],
      },
      orderBy: [{ isDefault: 'desc' }, { version: 'desc' }],
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });
  }

  /**
   * Explode a product to its RAW material requirements, recursing through
   * semi-finished components that have their own active BOMs. Read-only planning
   * preview for shortage checks / MRP. Path-based cycle guard + depth cap.
   * Returns { productId → total required base-ish qty (in each line's uom) }.
   */
  async explodeRequirements(
    outputProductId: string,
    variantId: string | null | undefined,
    qty: Prisma.Decimal.Value,
    acc: Map<string, Prisma.Decimal> = new Map(),
    depth = 0,
    path: Set<string> = new Set(),
  ): Promise<Map<string, Prisma.Decimal>> {
    const add = (id: string, q: Prisma.Decimal) => acc.set(id, (acc.get(id) ?? dec(0)).plus(q));
    if (depth > 10 || path.has(outputProductId)) {
      add(outputProductId, dec(qty));
      return acc;
    }
    const bom = await this.findActive(outputProductId, variantId ?? '');
    if (!bom) {
      // A leaf (raw material) — record the requirement.
      add(outputProductId, dec(qty));
      return acc;
    }
    path.add(outputProductId);
    const exploded = BomService.explode(bom, qty);
    for (const m of exploded.materials) {
      await this.explodeRequirements(m.componentProductId, m.componentVariantId, m.qtyPlanned, acc, depth + 1, path);
    }
    path.delete(outputProductId);
    return acc;
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private lineData(l: CreateBomDto['lines'][number], i: number) {
    return {
      organizationId: this.org,
      componentProductId: l.componentProductId,
      componentVariantId: l.componentVariantId ?? null,
      quantity: dec(l.quantity),
      uomId: l.uomId ?? null,
      scrapPct: dec(l.scrapPct ?? 0),
      sequence: l.sequence ?? i,
      isOptional: l.isOptional ?? false,
      notes: l.notes ?? null,
    };
  }

  private async getOrThrow(id: string) {
    const bom = await this.prisma.client.bom.findFirst({
      where: { id },
      include: { lines: { orderBy: { sequence: 'asc' } } },
    });
    if (!bom) throw new NotFoundException('BOM not found');
    return bom;
  }

  /**
   * Reject a BOM whose components (transitively, via their own active BOMs) reach
   * back to the output product — a circular recipe (A makes B makes A). Bounded
   * depth so a mis-seeded graph can't spin.
   */
  private async assertNoCycle(outputProductId: string, componentProductIds: string[], depth = 0): Promise<void> {
    if (depth > 10) return;
    if (componentProductIds.includes(outputProductId)) {
      throw new BadRequestException('Circular BOM: a component is (transitively) the output product.');
    }
    for (const componentId of componentProductIds) {
      const childBom = await this.prisma.client.bom.findFirst({
        where: { outputProductId: componentId, status: 'active' },
        include: { lines: { select: { componentProductId: true } } },
      });
      if (!childBom) continue;
      await this.assertNoCycle(
        outputProductId,
        childBom.lines.map((l) => l.componentProductId),
        depth + 1,
      );
    }
  }
}
