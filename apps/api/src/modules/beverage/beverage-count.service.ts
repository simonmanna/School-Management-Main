import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PERMISSIONS, type BottleConfidence } from '@erp/shared';
import { dec } from '../../kernel/common/money';
import {
  checkReading,
  classifyConfidence,
  remainingMlFromWeight,
} from '../../kernel/common/beverage-math';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { PasswordService } from '../../kernel/auth/password.service';
import { StockDocService } from '../inventory/stock-doc.service';
import {
  SaveBottleCountDraftDto,
  StartBottleCountDto,
  SubmitBottleCountDto,
} from './dto/bottle-count.dto';

/** Fallback variance tolerance (grams) when neither product nor org sets one. */
const DEFAULT_TOLERANCE_G = 5;

interface BevProduct {
  id: string;
  name: string;
  unit: string | null;
  containerVolumeMl: number;
  effectiveEmptyWeightG: number;
  fullBottleWeightG: number;
  conversionFactorMlPerG: number;
  standardPourMl: number;
  toleranceG: number;
}

/**
 * Beverage Control — digital-weight bottle count (bar alcohol shrinkage control).
 *
 * A separate, alcohol-only physical count. Bartenders weigh open bottles; the
 * system converts grams → remaining ml and reconciles against live system stock
 * (which POS sales already deducted in ml). On submit ONLY the variance is posted
 * as a {@link StockDocService} adjustment — reusing the exact adjustment → ledger
 * → GL → audit path as the generic inventory count. The count itself is a
 * permanent record of what was physically weighed, by whom, when, and why.
 */
@Injectable()
export class BeverageCountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly password: PasswordService,
    private readonly stockDoc: StockDocService,
  ) {}

  private get org(): string {
    return this.tenant.organizationId;
  }

  /** Org-default variance tolerance (grams), read from Setting; else the fallback. */
  private async orgToleranceG(): Promise<number> {
    const row = await this.prisma.raw.setting.findFirst({
      where: { organizationId: this.org, scope: 'organization', key: 'beverage.varianceToleranceG' },
    });
    const v = row?.value as unknown;
    const n = typeof v === 'number' ? v : v != null ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TOLERANCE_G;
  }

  /** Resolve the count location: explicit id, else the active warehouse (where
   *  POS sales deduct stock — so the count reconciles against the same quants). */
  private async resolveLocation(locationId?: string) {
    if (locationId) {
      const loc = await this.prisma.client.inventoryLocation.findFirst({ where: { id: locationId } });
      if (!loc) throw new NotFoundException('Location not found');
      return loc;
    }
    const wh = await this.prisma.client.inventoryLocation.findFirst({
      where: { type: 'warehouse', isActive: true },
    });
    if (!wh) {
      throw new BadRequestException('No location specified and no active warehouse configured.');
    }
    return wh;
  }

  /** Load beverage config for the given products (digital-weight only). */
  private async loadProducts(productIds: string[], orgTolerance: number): Promise<Map<string, BevProduct>> {
    const rows = await this.prisma.client.product.findMany({
      where: { id: { in: productIds }, measurementMethod: 'digital_weight' },
      select: {
        id: true, name: true,
        containerVolumeMl: true, emptyBottleWeightG: true, actualEmptyWeightG: true,
        fullBottleWeightG: true, conversionFactorMlPerG: true, standardPourMl: true,
        varianceToleranceG: true, uom: { select: { code: true } },
      },
    });
    const map = new Map<string, BevProduct>();
    for (const r of rows) {
      const effectiveEmptyWeightG = Number(r.actualEmptyWeightG ?? r.emptyBottleWeightG ?? 0);
      map.set(r.id, {
        id: r.id,
        name: r.name,
        unit: r.uom?.code ?? 'ml',
        containerVolumeMl: Number(r.containerVolumeMl ?? 0),
        effectiveEmptyWeightG,
        fullBottleWeightG: Number(r.fullBottleWeightG ?? 0),
        conversionFactorMlPerG: Number(r.conversionFactorMlPerG ?? 0),
        standardPourMl: Number(r.standardPourMl ?? 0),
        toleranceG: Number(r.varianceToleranceG ?? 0) || orgTolerance,
      });
    }
    return map;
  }

  // ── reads ────────────────────────────────────────────────────────────────

  async get(id: string) {
    const session = await this.prisma.client.bottleCountSession.findFirst({
      where: { id },
      include: { lines: { orderBy: { productName: 'asc' }, include: { readings: true } } },
    });
    if (!session) throw new NotFoundException('Bottle count not found');
    return session;
  }

  async list() {
    return this.prisma.client.bottleCountSession.findMany({
      orderBy: { startedAt: 'desc' },
      include: { _count: { select: { lines: true } } },
      take: 100,
    });
  }

  // ── start ──────────────────────────────────────────────────────────────────

  /**
   * Start a fresh bottle count. Cancels any existing draft for this location +
   * type, snapshots every digital-weight product and its live system ml.
   */
  async start(dto: StartBottleCountDto) {
    const loc = await this.resolveLocation(dto.locationId);
    const countType = dto.countType ?? 'closing';

    await this.prisma.client.bottleCountSession.updateMany({
      where: { locationId: loc.id, countType, status: 'draft' },
      data: { status: 'cancelled', updatedBy: this.tenant.userId ?? null },
    });

    const products = await this.prisma.client.product.findMany({
      where: { measurementMethod: 'digital_weight', isActive: true },
      select: { id: true, name: true, uom: { select: { code: true } } },
      orderBy: { name: 'asc' },
    });
    if (products.length === 0) {
      throw new BadRequestException(
        'No digital-weight (bar alcohol) products configured. Set a product\'s measurement method to "Digital weight scale" first.',
      );
    }

    // Snapshot live system ml (non-variant quants) at the count location.
    const stockItems = await this.prisma.client.stockItem.findMany({
      where: { locationId: loc.id, productId: { in: products.map((p) => p.id) }, variantKey: '' },
      select: { productId: true, quantity: true },
    });
    const systemMl = new Map(stockItems.map((si) => [si.productId, si.quantity]));

    const lines = products.map((p) => ({
      organizationId: this.org,
      productId: p.id,
      productName: p.name,
      unit: p.uom?.code ?? 'ml',
      systemMl: systemMl.get(p.id) ?? dec(0),
      sealedFullCount: dec(0),
      varianceMl: dec(0),
      varianceG: dec(0),
      confidence: 'GOOD',
    }));

    const countCode = await this.seq.next('bottle_count', { prefix: 'BCNT-', padding: 5 });
    const now = new Date();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateStr = `${months[now.getMonth()]} ${String(now.getDate()).padStart(2,'0')}, ${now.getFullYear()}`;
    const autoName = `${countType === 'opening' ? 'Opening' : 'Closing'} Bottle Count – ${dateStr}`;

    try {
      const session = await this.prisma.client.bottleCountSession.create({
        data: {
          organizationId: this.org,
          countCode,
          name: autoName,
          locationId: loc.id,
          countType,
          status: 'draft',
          notes: dto.notes ?? null,
          startedById: this.tenant.userId ?? null,
          createdBy: this.tenant.userId ?? null,
          lines: { create: lines as any },
        },
      });
      return this.get(session.id);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const existing = await this.prisma.client.bottleCountSession.findFirst({
          where: { locationId: loc.id, countType, status: 'draft' },
        });
        if (existing) return this.get(existing.id);
      }
      throw err;
    }
  }

  private async assertDraft(id: string) {
    const s = await this.prisma.client.bottleCountSession.findFirst({ where: { id } });
    if (!s) throw new NotFoundException('Bottle count not found');
    if (s.status !== 'draft') throw new BadRequestException(`Cannot modify a ${s.status} count`);
    return s;
  }

  // ── save draft ──────────────────────────────────────────────────────────────

  /** Persist per-line weighings: replace each line's readings, recompute the
   *  remaining ml, variance (ml + grams) and confidence. */
  async saveDraft(id: string, dto: SaveBottleCountDraftDto) {
    await this.assertDraft(id);
    const tol = await this.orgToleranceG();
    const dbLines = await this.prisma.client.bottleCountLine.findMany({
      where: { sessionId: id },
      select: { id: true, productId: true, systemMl: true },
    });
    const lineById = new Map(dbLines.map((l) => [l.id, l]));
    const products = await this.loadProducts(dbLines.map((l) => l.productId), tol);

    for (const l of dto.lines) {
      const db = lineById.get(l.lineId);
      if (!db) continue; // ignore lines not in this session
      const cfg = products.get(db.productId);
      const computed = this.computeLine(cfg, l.sealedFullCount ?? 0, l.readings ?? [], Number(db.systemMl));

      await this.prisma.client.bottleCountReading.deleteMany({ where: { lineId: l.lineId } });
      if (computed.readings.length > 0) {
        await this.prisma.client.bottleCountReading.createMany({
          data: computed.readings.map((r) => ({
            organizationId: this.org,
            lineId: l.lineId,
            bottleNumber: r.bottleNumber ?? null,
            measuredWeightG: r.measuredWeightG,
            expectedWeightG: null,
            remainingMl: r.remainingMl,
            confidence: r.confidence,
          })),
        });
      }

      await this.prisma.client.bottleCountLine.updateMany({
        where: { id: l.lineId, sessionId: id },
        data: {
          sealedFullCount: l.sealedFullCount ?? 0,
          countedMl: computed.counted ? computed.countedMl : null,
          varianceMl: computed.varianceMl,
          varianceG: computed.varianceG,
          expectedShots: computed.expectedShots,
          reason: l.reason ?? null,
          confidence: computed.confidence,
          countedById: computed.counted ? this.tenant.userId ?? null : null,
          countedAt: computed.counted ? new Date() : null,
        },
      });
    }

    const upd: Record<string, any> = { updatedBy: this.tenant.userId ?? null };
    if (dto.name !== undefined) upd.name = dto.name;
    if (dto.notes !== undefined) upd.notes = dto.notes;
    await this.prisma.client.bottleCountSession.update({ where: { id }, data: upd });
    return this.get(id);
  }

  /** Pure per-line math (grams → ml, variance, confidence). */
  private computeLine(
    cfg: BevProduct | undefined,
    sealedFullCount: number,
    readings: { measuredWeightG: number; bottleNumber?: string; measurementSource?: string }[],
    systemMl: number,
  ) {
    const factor = cfg?.conversionFactorMlPerG ?? 0;
    const vol = cfg?.containerVolumeMl ?? 0;
    const empty = cfg?.effectiveEmptyWeightG ?? 0;
    const full = cfg?.fullBottleWeightG ?? 0;
    const tol = cfg?.toleranceG ?? DEFAULT_TOLERANCE_G;
    const pour = cfg?.standardPourMl ?? 0;

    const counted = sealedFullCount > 0 || readings.length > 0;
    let anyOutOfRange = false;
    const computedReadings = readings.map((r) => {
      const chk = checkReading(r.measuredWeightG, empty, full);
      if (chk.outOfRange) anyOutOfRange = true;
      const remainingMl = factor > 0 ? remainingMlFromWeight(r.measuredWeightG, empty, factor) : 0;
      return {
        measuredWeightG: r.measuredWeightG,
        bottleNumber: r.bottleNumber,
        measurementSource: r.measurementSource ?? 'MANUAL',
        remainingMl,
        confidence: (chk.outOfRange ? 'OUT_OF_RANGE' : 'GOOD') as BottleConfidence,
      };
    });

    const openMl = computedReadings.reduce((s, r) => s + r.remainingMl, 0);
    const countedMl = round(sealedFullCount * vol + openMl, 6);
    const varianceMl = round(countedMl - systemMl, 6);
    const varianceG = factor > 0 ? round(varianceMl / factor, 6) : 0;
    const confidence = classifyConfidence(varianceG, tol, anyOutOfRange);
    const expectedShots = pour > 0 ? round(countedMl / pour, 6) : null;

    return { counted, countedMl, varianceMl, varianceG, confidence, expectedShots, readings: computedReadings };
  }

  // ── submit ──────────────────────────────────────────────────────────────────

  /**
   * Finalise the count. Requires a reason on every out-of-tolerance line, a
   * manager approval (SoD: not the counter) when any line is over tolerance or
   * physically impossible, then posts the variance as a StockAdjustment and
   * writes the immutable BottleMeasurement log — all in one transaction.
   */
  async submit(id: string, dto: SubmitBottleCountDto = {}) {
    await this.assertDraft(id);
    const lines = await this.prisma.client.bottleCountLine.findMany({
      where: { sessionId: id },
      include: { readings: true },
    });
    const counted = lines.filter((l) => l.countedMl !== null);
    if (counted.length === 0) {
      throw new BadRequestException('Nothing weighed yet — weigh at least one bottle.');
    }

    // A reason is required on any line the system flagged (over tolerance/impossible).
    const flagged = counted.filter((l) => l.confidence !== 'GOOD');
    const missingReason = flagged.filter((l) => !l.reason || !l.reason.trim());
    if (missingReason.length > 0) {
      throw new BadRequestException(
        `A reason is required for ${missingReason.length} flagged line(s) (variance over tolerance).`,
      );
    }

    const varianceLines = counted.filter((l) => !dec(l.varianceMl).isZero());
    const needsApproval = flagged.length > 0;

    return this.prisma.client.$transaction(async (tx: any) => {
      const session = await tx.bottleCountSession.findFirst({ where: { id } });
      if (!session || session.status !== 'draft') {
        throw new BadRequestException('Count was modified; please retry.');
      }

      let approverId: string | null = null;
      if (needsApproval) {
        const manager = await this.assertManagerApproval(tx, {
          approverId: dto.approverId,
          approverEmail: dto.approverEmail,
          managerPin: dto.managerPin,
          counterUserId: session.startedById,
        });
        approverId = manager.id;
      }

      // Post ONLY the variance lines through the shared adjustment pipeline.
      let adjustmentId: string | null = null;
      if (varianceLines.length > 0) {
        const adj = await this.stockDoc.createAdjustment({
          locationId: session.locationId,
          reason: 'cycle_count',
          notes: `${session.countType} bottle count ${session.countCode}`,
          items: varianceLines.map((l) => ({
            productId: l.productId,
            unit: l.unit ?? undefined,
            qtyActual: Number(l.countedMl),
          })),
        }, tx);
        await this.stockDoc.approveAdjustment(adj.id, tx);
        adjustmentId = adj.id;
      }

      // Immutable weighing log — one row per physical reading.
      const measurements: any[] = [];
      for (const l of counted) {
        for (const r of l.readings) {
          measurements.push({
            organizationId: this.org,
            productId: l.productId,
            bottleNumber: r.bottleNumber ?? null,
            locationId: session.locationId,
            sessionId: session.id,
            expectedWeightG: r.expectedWeightG ?? null,
            measuredWeightG: r.measuredWeightG,
            remainingMl: r.remainingMl,
            varianceMl: 0,
            varianceG: 0,
            measurementSource: 'MANUAL',
            confidence: r.confidence,
            measuredById: this.tenant.userId ?? null,
          });
        }
      }
      if (measurements.length > 0) {
        await tx.bottleMeasurement.createMany({ data: measurements });
      }

      await tx.bottleCountSession.update({
        where: { id },
        data: {
          status: 'submitted',
          submittedById: this.tenant.userId ?? null,
          submittedAt: new Date(),
          approvedById: approverId,
          approvedAt: approverId ? new Date() : null,
          adjustmentId,
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'BottleCountSession',
        entityId: id,
        action: 'measure',
        newValues: {
          countCode: session.countCode,
          locationId: session.locationId,
          counterId: session.startedById,
          approverId,
          adjustmentId,
          flaggedLines: flagged.length,
          varianceLines: varianceLines.length,
        },
      });

      return tx.bottleCountSession.findFirst({
        where: { id },
        include: { lines: { orderBy: { productName: 'asc' }, include: { readings: true } } },
      });
    });
  }

  /** Abandon a draft count (soft delete) without touching stock. */
  async cancel(id: string) {
    await this.assertDraft(id);
    await this.prisma.client.bottleCountSession.update({
      where: { id },
      data: { status: 'cancelled', updatedBy: this.tenant.userId ?? null },
    });
    return { ok: true };
  }

  /**
   * Manager-approval gate (segregation of duties). Resolves the approver by id or
   * email, verifies they are active, hold beverage:approve, are NOT the counter,
   * and (optionally) that the PIN matches. Mirrors the cash-session pattern.
   */
  private async assertManagerApproval(
    tx: any,
    opts: { approverId?: string; approverEmail?: string; managerPin?: string; counterUserId: string | null },
  ) {
    if (!opts.approverId && !opts.approverEmail) {
      throw new BadRequestException('This count has a variance over tolerance and requires manager approval.');
    }
    const orgId = this.org;
    const manager = opts.approverId
      ? await tx.user.findFirst({ where: { id: opts.approverId, organizationId: orgId, isActive: true }, include: { roles: true } })
      : await tx.user.findFirst({ where: { email: opts.approverEmail!.toLowerCase(), organizationId: orgId, isActive: true }, include: { roles: true } });
    if (!manager) throw new NotFoundException('Approving manager not found');
    if (opts.counterUserId && manager.id === opts.counterUserId) {
      throw new ForbiddenException('The person who counted cannot approve their own count.');
    }
    if (opts.managerPin) {
      if (!manager.pinHash) throw new BadRequestException('Manager has not set a PIN');
      const ok = await this.password.compare(opts.managerPin, manager.pinHash);
      if (!ok) throw new UnauthorizedException('Invalid manager PIN');
    }
    const perms = new Set(manager.roles.flatMap((r: any) => r.permissions ?? []));
    if (!perms.has(PERMISSIONS.beverage.approve)) {
      throw new UnauthorizedException(`Approver does not hold ${PERMISSIONS.beverage.approve}`);
    }
    return manager;
  }
}

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
