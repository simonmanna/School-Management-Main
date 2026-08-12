import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, ZERO } from '../../kernel/common/money';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { ApprovalsService } from '../../kernel/approvals/approvals.service';
import { StockService } from '../inventory/stock.service';
import { StockPostingService } from '../inventory/posting/stock-posting.service';
import { StockReservationService } from '../inventory/stock-reservation.service';
import { resolvePosStockLocation } from '../inventory/pos-stock-location';
import { UomConversionService } from '../core/product/uom-conversion.service';
import { BomService } from './bom.service';
import {
  CancelProductionDto,
  CompleteProductionDto,
  CreateProductionOrderDto,
  RecordQcDto,
  StartProductionDto,
} from './dto/production.dto';

const RESERVATION_SOURCE = 'production_order';

/**
 * Production order engine. Mirrors StockDocService: header + typed lines, a
 * status enum, an approval gate, per-leg postedAt-style idempotency guards, and
 * posting through the shared stock/GL engine on transition.
 *
 *   create → confirm (reserve) → start (consume) → complete (output) → cancel
 *
 * The WIP-flat invariant: with overheadCost = 0 (Phase 1), WIP is debited the
 * material cost at start and credited the identical amount at complete, so a
 * completed order leaves WIP at exactly zero. That is the integration test's
 * anchor assertion.
 */
@Injectable()
export class ProductionService {
  private readonly log = new Logger(ProductionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly stock: StockService,
    private readonly stockPosting: StockPostingService,
    private readonly reservations: StockReservationService,
    private readonly uom: UomConversionService,
    private readonly boms: BomService,
  ) {}

  private get org(): string {
    return this.tenant.organizationId;
  }

  // ===========================================================================
  // create
  // ===========================================================================

  async createOrder(dto: CreateProductionOrderDto) {
    const adHoc = !dto.bomId && !!dto.outputProductId && (dto.materials?.length ?? 0) > 0;

    let bomId: string | null = null;
    let bomVersion: number | null = null;
    let outputProductId: string;
    let outputVariantId: string | null;
    let outputUomId: string | null;
    let materials: Array<{
      productId: string;
      variantId: string | null;
      qtyPlanned: Prisma.Decimal;
      uomId: string | null;
      distStrategy: string;
      batchNumber: string | null;
      sequence: number;
    }>;
    let expectedOutputQty: Prisma.Decimal;
    let plannedQty: Prisma.Decimal;
    let overheadForOrder: Prisma.Decimal = ZERO;
    let bomDefaults: { locationId?: string | null; outputLocationId?: string | null; shelfLifeDays?: number | null; qcRequired?: boolean } = {};

    if (adHoc) {
      outputProductId = dto.outputProductId!;
      outputVariantId = dto.outputVariantId ?? null;
      outputUomId = null;
      if (dto.plannedQty == null) {
        throw new BadRequestException('plannedQty is required for an ad-hoc production order.');
      }
      plannedQty = dec(dto.plannedQty);
      expectedOutputQty = plannedQty;
      materials = (dto.materials ?? []).map((m, i) => ({
        productId: m.productId,
        variantId: m.variantId ?? null,
        qtyPlanned: dec(m.quantity),
        uomId: m.uomId ?? null,
        distStrategy: m.distStrategy ?? 'FEFO',
        batchNumber: m.batchNumber ?? null,
        sequence: i,
      }));
    } else {
      if (!dto.bomId && !dto.outputProductId) {
        throw new BadRequestException('Provide a bomId or an outputProductId.');
      }
      const bom = await this.boms.resolveForOrder(dto.outputProductId ?? '', dto.outputVariantId ?? null, dto.bomId);
      bomId = bom.id;
      bomVersion = bom.version;
      outputProductId = bom.outputProductId;
      outputVariantId = bom.outputVariantId ?? null;
      outputUomId = bom.outputUomId ?? null;
      bomDefaults = {
        locationId: bom.defaultLocationId,
        outputLocationId: bom.defaultOutputLocationId,
        shelfLifeDays: bom.shelfLifeDays,
        qcRequired: bom.qcRequired,
      };
      plannedQty =
        dto.plannedQty != null
          ? dec(dto.plannedQty)
          : dto.runs != null
            ? dec(bom.outputQuantity).mul(dto.runs)
            : (() => {
                throw new BadRequestException('Provide runs or plannedQty.');
              })();
      const exploded = BomService.explode(bom, plannedQty);
      expectedOutputQty = exploded.expectedOutputQty;
      // BOM overhead is per run (per outputQuantity) — scale it to the order.
      overheadForOrder = dec(bom.overheadCost).mul(plannedQty.div(dec(bom.outputQuantity)));
      materials = exploded.materials.map((m) => ({
        productId: m.componentProductId,
        variantId: m.componentVariantId,
        qtyPlanned: m.qtyPlanned,
        uomId: m.uomId,
        distStrategy: 'FEFO',
        batchNumber: null,
        sequence: m.sequence,
      }));
    }

    const locationId = dto.locationId ?? bomDefaults.locationId ?? null;
    if (!locationId) {
      throw new BadRequestException('No production location: pass locationId or set the BOM default.');
    }
    const outputLocationId =
      dto.outputLocationId ?? bomDefaults.outputLocationId ?? (await this.resolvePosWarehouse());

    // Shelf-life → default expiry (overridable at complete).
    const mfgDate = dto.mfgDate ? new Date(dto.mfgDate) : null;
    let expiryDate: Date | null = dto.expiryDate ? new Date(dto.expiryDate) : null;
    if (!expiryDate && bomDefaults.shelfLifeDays != null) {
      const base = mfgDate ?? new Date();
      expiryDate = new Date(base.getTime() + bomDefaults.shelfLifeDays * 86_400_000);
    }

    const names = await this.productNames([outputProductId, ...materials.map((m) => m.productId)]);
    const orderCode = await this.seq.next('production_order', { prefix: 'MO-', padding: 5 });

    // Output lines: the main finished good, plus any byproduct lines from the DTO.
    const outputLines = [
      {
        organizationId: this.org,
        kind: 'output' as const,
        productId: outputProductId,
        variantId: outputVariantId,
        productName: names[outputProductId] ?? 'Output',
        qtyExpected: expectedOutputQty,
        uomId: outputUomId,
      },
      ...(dto.outputs ?? []).map((o) => ({
        organizationId: this.org,
        kind: (o.kind ?? 'byproduct') as 'output' | 'byproduct',
        productId: o.productId,
        variantId: o.variantId ?? null,
        productName: names[o.productId] ?? 'Byproduct',
        qtyExpected: dec(o.qtyExpected),
        uomId: o.uomId ?? null,
        costAllocationPct: dec(o.costAllocationPct ?? 0),
      })),
    ];

    const created = await this.prisma.client.productionOrder.create({
      data: {
        organizationId: this.org,
        orderCode,
        bomId,
        bomVersion,
        qcRequired: bomDefaults.qcRequired ?? false,
        outputProductId,
        outputVariantId,
        locationId,
        outputLocationId,
        status: 'draft',
        plannedQty,
        overheadCost: overheadForOrder,
        uomId: outputUomId,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        batchNumber: dto.batchNumber ?? null,
        expiryDate,
        mfgDate,
        notes: dto.notes ?? null,
        performedById: this.tenant.userId ?? null,
        createdBy: this.tenant.userId ?? null,
        materials: {
          create: materials.map((m) => ({
            organizationId: this.org,
            productId: m.productId,
            variantId: m.variantId,
            productName: names[m.productId] ?? 'Material',
            qtyPlanned: m.qtyPlanned,
            uomId: m.uomId,
            distStrategy: m.distStrategy,
            batchNumber: m.batchNumber,
            sequence: m.sequence,
          })),
        },
        outputs: { create: outputLines },
      },
      include: { materials: true, outputs: true },
    });

    // Fixed BOM overhead becomes a cost component up front; labour/machine
    // components are added by work orders as they complete (Phase 4).
    if (overheadForOrder.gt(ZERO)) {
      await this.prisma.client.productionCostComponent.create({
        data: {
          organizationId: this.org,
          orderId: created.id,
          kind: 'overhead',
          amount: overheadForOrder,
          sourceType: RESERVATION_SOURCE,
          sourceId: created.orderCode,
          notes: 'BOM overhead',
        },
      });
    }
    return created;
  }

  // ===========================================================================
  // confirm — soft ATP reservation
  // ===========================================================================

  async confirmOrder(id: string) {
    const order = await this.getOrThrow(id, { materials: true });
    if (order.status === 'confirmed') return order; // idempotent
    if (order.status !== 'draft') {
      throw new BadRequestException(`Cannot confirm a ${order.status} order.`);
    }

    // Reservations are soft (ATP holds) and each runs in its own transaction, so
    // reserve OUTSIDE any tx and never let a reservation hiccup block the confirm.
    for (const m of order.materials) {
      try {
        await this.reservations.reserve({
          productId: m.productId,
          variantId: m.variantId,
          locationId: order.locationId,
          quantity: Number(m.qtyPlanned),
          sourceType: RESERVATION_SOURCE,
          sourceId: order.id,
          reason: order.orderCode,
        });
      } catch (e: any) {
        this.log.warn(`reserve failed for ${order.orderCode} / ${m.productId}: ${e?.message ?? e}`);
      }
    }

    return this.prisma.client.productionOrder.update({
      where: { id: order.id },
      data: { status: 'confirmed', updatedBy: this.tenant.userId ?? null },
      include: { materials: true, outputs: true },
    });
  }

  // ===========================================================================
  // start — the consume leg (Dr WIP / Cr Stock Valuation)
  // ===========================================================================

  async startOrder(id: string, dto: StartProductionDto = {}) {
    const pre = await this.getOrThrow(id, { materials: true });
    if (pre.status !== 'confirmed' || pre.consumedAt) {
      throw new BadRequestException(`Order ${pre.orderCode} is not in a startable state (status ${pre.status}).`);
    }

    // Approval gate outside the tx. entityType is free-form; returns null (auto-
    // approve) when no workflow is configured.
    const estValue = await this.estimateMaterialValue(pre);
    const gate = await this.approvals.checkOrRequestApproval({
      entityType: RESERVATION_SOURCE,
      entityId: pre.id,
      snapshot: { amount: Number(estValue), lines: pre.materials.length, orderCode: pre.orderCode },
    });
    if (gate?.needsApproval) {
      throw new BadRequestException(
        `Approval required before starting ${pre.orderCode}. Pending request ${gate.requestId}.`,
      );
    }

    const overrides = new Map((dto.materials ?? []).map((m) => [m.lineId, m]));
    const date = dto.date ? new Date(dto.date) : new Date();

    return this.prisma.client.$transaction(
      async (tx: any) => {
        await this.lock(tx, pre.id);
        const order = await tx.productionOrder.findFirst({ where: { id: pre.id }, include: { materials: true } });
        if (!order) throw new NotFoundException('Order not found');
        if (order.status !== 'confirmed' || order.consumedAt) {
          throw new BadRequestException('Order already started.');
        }

        let materialCost = ZERO;
        for (const line of order.materials) {
          const ov = overrides.get(line.id);
          const qty = ov ? dec(ov.qtyConsumed) : dec(line.qtyPlanned);
          if (qty.lte(ZERO)) continue;
          const batchNumber = ov?.batchNumber ?? line.batchNumber ?? undefined;

          // The whole consume leg — stock AND GL — in one call. moveType
          // production_consume routes postIssue to the PRODUCTION_CONSUME rule
          // (Dr WIP / Cr Stock Valuation). No skipGlPosting; no explicit post.
          const res = await this.stock.issue(
            {
              productId: line.productId,
              variantId: line.variantId ?? undefined,
              locationId: order.locationId,
              quantity: Number(qty),
              uomId: line.uomId ?? undefined,
              moveType: 'production_consume',
              distStrategy: (line.distStrategy as any) ?? 'FEFO',
              batchNumber,
              date: date.toISOString(),
              sourceType: RESERVATION_SOURCE,
              sourceId: order.orderCode,
              notes: order.orderCode,
            } as any,
            tx,
          );
          const lineTotal = dec(res.totalValue);
          materialCost = materialCost.plus(lineTotal);
          await tx.productionMaterial.update({
            where: { id: line.id },
            data: {
              qtyConsumed: qty,
              unitCost: dec(res.unitCost),
              totalCost: lineTotal,
              ledgerCode: res.ledgerCode,
              batchNumber: batchNumber ?? line.batchNumber,
            },
          });
        }

        const updated = await tx.productionOrder.update({
          where: { id: order.id },
          data: {
            status: 'in_progress',
            startedAt: date,
            consumedAt: new Date(),
            materialCost,
            notes: dto.notes ?? order.notes,
            updatedBy: this.tenant.userId ?? null,
          },
          include: { materials: true, outputs: true },
        });
        await this.audit.recordInTx(tx, {
          entity: 'ProductionOrder',
          entityId: order.id,
          action: 'issue',
          newValues: { orderCode: order.orderCode, materialCost: materialCost.toString() },
        });
        return updated;
      },
      { timeout: 30_000 },
    );
  }

  // ===========================================================================
  // complete — the output leg (Dr Stock Valuation / Cr WIP)
  // ===========================================================================

  async completeOrder(id: string, dto: CompleteProductionDto) {
    const pre = await this.getOrThrow(id, { outputs: true });
    if (pre.status !== 'in_progress' || pre.postedAt) {
      throw new BadRequestException(`Order ${pre.orderCode} is not completable (status ${pre.status}).`);
    }

    const outProduct = await this.getProduct(pre.outputProductId);
    const date = dto.date ? new Date(dto.date) : new Date();
    const outputOverrides = new Map((dto.outputs ?? []).map((o) => [o.lineId, o]));

    // Where finished goods land. A QC-required order lands in quarantine first;
    // recordQc transfers passed units to the real destination.
    const quarantineId = pre.qcRequired ? await this.resolveQuarantineLocation() : null;

    return this.prisma.client.$transaction(
      async (tx: any) => {
        await this.lock(tx, pre.id);
        const order = await tx.productionOrder.findFirst({ where: { id: pre.id }, include: { outputs: true } });
        if (!order) throw new NotFoundException('Order not found');
        if (order.status !== 'in_progress' || order.postedAt) {
          throw new BadRequestException('Order already completed.');
        }

        // Zero-yield batch (a burnt tray): materials are in WIP and gone — expense
        // the WIP directly (Dr Stock Adjustment Expense / Cr WIP). WIP still zeroes.
        if (!(dto.qtyProduced > 0)) {
          await this.stockPosting.postProductionScrap({
            totalValue: dec(order.materialCost),
            date,
            sourceType: RESERVATION_SOURCE,
            sourceId: order.orderCode,
            description: `Production scrap · ${order.orderCode}`,
            tx,
          });
          const scrapped = await tx.productionOrder.update({
            where: { id: order.id },
            data: {
              status: 'completed',
              producedQty: 0,
              scrapQty: order.plannedQty,
              outputUnitCost: 0,
              totalCost: dec(order.materialCost),
              completedAt: date,
              postedAt: new Date(),
              notes: dto.notes ?? order.notes,
              updatedBy: this.tenant.userId ?? null,
            },
            include: { materials: true, outputs: true },
          });
          await tx.stockReservation.updateMany({
            where: { sourceType: RESERVATION_SOURCE, sourceId: order.id, status: 'active' },
            data: { status: 'released', releasedAt: new Date() },
          });
          await this.audit.recordInTx(tx, {
            entity: 'ProductionOrder',
            entityId: order.id,
            action: 'post',
            newValues: { orderCode: order.orderCode, scrapped: order.materialCost.toString() },
          });
          return scrapped;
        }

        const receiveLocationId = quarantineId ?? order.outputLocationId ?? order.locationId;
        let pool = dec(order.materialCost).plus(dec(order.overheadCost));
        let byproductCredit = ZERO;

        // Absorb overhead (BOM fixed + accumulated labour/machine) into WIP so the
        // output credit — which includes overhead — still nets WIP to zero.
        if (dec(order.overheadCost).gt(ZERO)) {
          await this.stockPosting.postOverheadAbsorption({
            totalValue: dec(order.overheadCost),
            date,
            sourceType: RESERVATION_SOURCE,
            sourceId: order.orderCode,
            description: `Overhead · ${order.orderCode}`,
            tx,
          });
        }

        const byproducts = (order.outputs as any[]).filter((o) => o.kind === 'byproduct');
        const mainLine = (order.outputs as any[]).find((o) => o.kind === 'output');

        // 1) Byproducts absorb their % of the pool first.
        for (const bp of byproducts) {
          const ov = outputOverrides.get(bp.id);
          const qtyProduced = ov ? dec(ov.qtyProduced) : dec(bp.qtyExpected);
          const value = pool.mul(dec(bp.costAllocationPct)).div(100);
          if (qtyProduced.lte(ZERO) || value.lte(ZERO)) continue;
          const bpProduct = await this.getProduct(bp.productId);
          const qtyBase = await this.uom.toBase(qtyProduced, bp.uomId, { id: bpProduct.id, uomId: bpProduct.uomId });
          const unitCost = qtyBase.gt(ZERO) ? value.div(qtyBase) : ZERO;
          await this.receiveOutput(tx, {
            productId: bp.productId,
            variantId: bp.variantId,
            locationId: receiveLocationId,
            quantityBase: qtyBase,
            unitCost,
            batchNumber: ov?.batchNumber ?? order.batchNumber,
            expiryDate: ov?.expiryDate ?? this.iso(order.expiryDate),
            mfgDate: this.iso(order.mfgDate),
            orderCode: order.orderCode,
            date,
            lineId: bp.id,
            totalValue: value,
          });
          pool = pool.minus(value);
          byproductCredit = byproductCredit.plus(value);
        }

        // 2) Main output absorbs the remaining pool. Dividing by ACTUAL produced
        // (not expected) is what absorbs normal scrap into the good units.
        const qtyProducedBase = await this.uom.toBase(dto.qtyProduced, dto.uomId ?? order.uomId, {
          id: outProduct.id,
          uomId: outProduct.uomId,
        });
        if (qtyProducedBase.lte(ZERO)) throw new BadRequestException('Produced quantity resolves to 0 in base units.');
        const outputUnitCost = pool.div(qtyProducedBase);

        const mainRes = await this.receiveOutput(tx, {
          productId: order.outputProductId,
          variantId: order.outputVariantId,
          locationId: receiveLocationId,
          quantityBase: qtyProducedBase,
          unitCost: outputUnitCost,
          batchNumber: dto.batchNumber ?? order.batchNumber,
          expiryDate: dto.expiryDate ?? this.iso(order.expiryDate),
          mfgDate: dto.mfgDate ?? this.iso(order.mfgDate),
          orderCode: order.orderCode,
          date,
          lineId: mainLine?.id,
          totalValue: pool,
        });

        const expectedQty = mainLine ? dec(mainLine.qtyExpected) : dec(order.plannedQty);
        const yieldVariance = expectedQty.minus(dec(dto.qtyProduced)).mul(outputUnitCost);
        const totalCost = dec(order.materialCost).plus(dec(order.overheadCost));

        const updated = await tx.productionOrder.update({
          where: { id: order.id },
          data: {
            // QC-required orders sit in quarantine until recordQc clears them.
            status: order.qcRequired ? 'qc_hold' : 'completed',
            producedQty: dec(dto.qtyProduced),
            scrapQty: dto.scrapQty != null ? dec(dto.scrapQty) : order.scrapQty,
            byproductCredit,
            totalCost,
            outputUnitCost,
            yieldVariance,
            batchNumber: mainRes.batchNumber ?? order.batchNumber,
            completedAt: order.qcRequired ? null : date,
            postedAt: new Date(),
            notes: dto.notes ?? order.notes,
            updatedBy: this.tenant.userId ?? null,
          },
          include: { materials: true, outputs: true },
        });

        // Material cost component (the labour/machine/overhead rows are written by
        // work orders and at create; together they sum to totalCost).
        await tx.productionCostComponent.create({
          data: {
            organizationId: this.org,
            orderId: order.id,
            kind: 'material',
            amount: dec(order.materialCost),
            sourceType: RESERVATION_SOURCE,
            sourceId: order.orderCode,
          },
        });

        // Reservations are released after the fact (not consumed): the consume leg
        // already moved real stock, and holding them would double-count ATP.
        await tx.stockReservation.updateMany({
          where: { sourceType: RESERVATION_SOURCE, sourceId: order.id, status: 'active' },
          data: { status: 'released', releasedAt: new Date() },
        });

        await this.audit.recordInTx(tx, {
          entity: 'ProductionOrder',
          entityId: order.id,
          action: 'receive',
          newValues: {
            orderCode: order.orderCode,
            producedQty: String(dto.qtyProduced),
            outputUnitCost: outputUnitCost.toString(),
          },
        });
        return updated;
      },
      { timeout: 30_000 },
    );
  }

  // ===========================================================================
  // recordQc — clear a qc_hold order (pass units out of quarantine, scrap fails)
  // ===========================================================================

  async recordQc(id: string, dto: RecordQcDto) {
    const pre = await this.getOrThrow(id);
    if (pre.status !== 'qc_hold') {
      throw new BadRequestException(`Order ${pre.orderCode} is not awaiting QC (status ${pre.status}).`);
    }
    const quarantineId = await this.resolveQuarantineLocation();
    const destinationId = pre.outputLocationId ?? pre.locationId;
    const date = new Date();
    const passed = dec(dto.passedQty);
    const failed = dec(dto.failedQty ?? 0);
    const rework = dec(dto.reworkQty ?? 0);

    return this.prisma.client.$transaction(
      async (tx: any) => {
        await this.lock(tx, pre.id);
        const order = await tx.productionOrder.findFirst({ where: { id: pre.id } });
        if (!order || order.status !== 'qc_hold') throw new BadRequestException('Order is not awaiting QC.');

        // Passed units leave quarantine for the sale location (internal transfer,
        // GL-neutral: Dr/Cr the same Stock Valuation account).
        if (passed.gt(ZERO)) {
          await this.stock.transfer(
            {
              productId: order.outputProductId,
              variantId: order.outputVariantId ?? undefined,
              fromLocationId: quarantineId,
              toLocationId: destinationId,
              quantity: Number(passed),
              sourceType: 'production_qc',
              sourceId: order.orderCode,
              notes: `QC pass ${order.orderCode}`,
            } as any,
            tx,
          );
        }

        // Failed units are scrapped from quarantine stock (Dr Adj Expense / Cr
        // Stock Valuation) via the existing waste move type.
        if (failed.gt(ZERO)) {
          await this.stock.issue(
            {
              productId: order.outputProductId,
              variantId: order.outputVariantId ?? undefined,
              locationId: quarantineId,
              quantity: Number(failed),
              moveType: 'waste',
              sourceType: 'production_qc',
              sourceId: order.orderCode,
              notes: `QC fail ${order.orderCode} · ${dto.wasteCategory ?? 'qc_rejection'}`,
            } as any,
            tx,
          );
        }

        const status = dto.wasteCategory && failed.gt(ZERO) && passed.lte(ZERO) ? 'failed' : failed.gt(ZERO) ? 'rework' : 'passed';
        await tx.productionQcCheck.create({
          data: {
            organizationId: this.org,
            orderId: order.id,
            status,
            checklist: (dto.checklist ?? []) as any,
            passedQty: passed,
            failedQty: failed,
            reworkQty: rework,
            wasteCategory: dto.wasteCategory ?? null,
            inspectorId: this.tenant.userId ?? null,
            notes: dto.notes ?? null,
            decidedAt: date,
          },
        });

        // Rework keeps the order in quarantine; otherwise it's done.
        const done = rework.lte(ZERO);
        const updated = await tx.productionOrder.update({
          where: { id: order.id },
          data: {
            status: done ? 'completed' : 'qc_hold',
            completedAt: done ? date : null,
            scrapQty: dec(order.scrapQty).plus(failed),
            updatedBy: this.tenant.userId ?? null,
          },
          include: { materials: true, outputs: true },
        });
        await this.audit.recordInTx(tx, {
          entity: 'ProductionOrder',
          entityId: order.id,
          action: 'reconcile',
          newValues: { orderCode: order.orderCode, passed: passed.toString(), failed: failed.toString() },
        });
        return updated;
      },
      { timeout: 30_000 },
    );
  }

  // ===========================================================================
  // cancel
  // ===========================================================================

  async cancelOrder(id: string, dto: CancelProductionDto = {}) {
    const pre = await this.getOrThrow(id, { materials: true });
    if (pre.status === 'completed') {
      throw new BadRequestException('A completed order cannot be cancelled — reverse it (Phase 3).');
    }
    if (pre.status === 'cancelled') return pre;

    await this.reservations.release(RESERVATION_SOURCE, pre.id).catch(() => undefined);

    // draft / confirmed: nothing posted, just flip.
    if (!pre.consumedAt) {
      return this.prisma.client.productionOrder.update({
        where: { id: pre.id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: dto.reason ?? null,
          updatedBy: this.tenant.userId ?? null,
        },
        include: { materials: true, outputs: true },
      });
    }

    // in_progress: materials are in WIP and must come back (Dr Stock Valuation /
    // Cr WIP) — the exact reversal of the consume leg, reusing the same two calls.
    const date = new Date();
    return this.prisma.client.$transaction(
      async (tx: any) => {
        await this.lock(tx, pre.id);
        const order = await tx.productionOrder.findFirst({ where: { id: pre.id }, include: { materials: true } });
        if (!order || order.status === 'cancelled') return order;
        if (order.postedAt) throw new BadRequestException('Order already completed.');

        for (const line of order.materials as any[]) {
          const qty = dec(line.qtyConsumed);
          if (qty.lte(ZERO)) continue;
          await this.stock.receive(
            {
              productId: line.productId,
              variantId: line.variantId ?? undefined,
              locationId: order.locationId,
              quantity: Number(qty),
              unitCost: Number(dec(line.unitCost)),
              moveType: 'receipt',
              sourceType: 'production_order_cancel',
              sourceId: order.orderCode,
            } as any,
            tx,
          );
          await this.stockPosting.postProductionOutput({
            productId: line.productId,
            totalValue: dec(line.totalCost),
            date,
            sourceType: 'production_order_cancel',
            sourceId: order.orderCode,
            description: `Production cancel · ${order.orderCode}`,
            tx,
          });
        }

        const updated = await tx.productionOrder.update({
          where: { id: order.id },
          data: {
            status: 'cancelled',
            cancelledAt: date,
            cancelReason: dto.reason ?? null,
            materialCost: 0,
            updatedBy: this.tenant.userId ?? null,
          },
          include: { materials: true, outputs: true },
        });
        await this.audit.recordInTx(tx, {
          entity: 'ProductionOrder',
          entityId: order.id,
          action: 'cancel',
          newValues: { orderCode: order.orderCode, reason: dto.reason ?? null },
        });
        return updated;
      },
      { timeout: 30_000 },
    );
  }

  // ===========================================================================
  // reverse — undo a completed order (Phase 3). Finished goods must still be on
  // hand; materials return to stock. The exact inverse of start+complete.
  // ===========================================================================

  async reverseOrder(id: string, dto: CancelProductionDto = {}) {
    const pre = await this.getOrThrow(id, { materials: true });
    if (pre.status !== 'completed' || !pre.postedAt) {
      throw new BadRequestException(`Only a completed order can be reversed (status ${pre.status}).`);
    }
    if (pre.reversedAt) throw new BadRequestException('Order already reversed.');
    if (Number(pre.producedQty) <= 0) {
      throw new BadRequestException('A scrapped (zero-yield) order has no output to reverse.');
    }

    const fgLocationId = pre.outputLocationId ?? pre.locationId;
    // Finished goods must still be fully on hand — you cannot un-produce what has
    // already been sold.
    const fgStock = await this.prisma.client.stockItem.findFirst({
      where: { productId: pre.outputProductId, variantKey: pre.outputVariantId ?? '', locationId: fgLocationId },
      select: { quantity: true },
    });
    if (!fgStock || dec(fgStock.quantity).lt(dec(pre.producedQty))) {
      throw new BadRequestException('Cannot reverse: finished goods are no longer fully in stock (sold or moved).');
    }

    const date = new Date();
    const fgValue = dec(pre.outputUnitCost).mul(dec(pre.producedQty));

    return this.prisma.client.$transaction(
      async (tx: any) => {
        await this.lock(tx, pre.id);
        const order = await tx.productionOrder.findFirst({ where: { id: pre.id }, include: { materials: true } });
        if (!order || order.reversedAt) throw new BadRequestException('Order already reversed.');

        // 1) Remove finished goods, moving their value back into WIP
        //    (Dr WIP / Cr Stock Valuation) — the inverse of the output leg.
        await this.stock.issue(
          {
            productId: order.outputProductId,
            variantId: order.outputVariantId ?? undefined,
            locationId: fgLocationId,
            quantity: Number(order.producedQty),
            skipGlPosting: true,
            sourceType: 'production_reversal',
            sourceId: order.orderCode,
          } as any,
          tx,
        );
        await this.stockPosting.postProductionConsume({
          productId: order.outputProductId,
          totalValue: fgValue,
          date,
          sourceType: 'production_reversal',
          sourceId: order.orderCode,
          description: `Production reversal · ${order.orderCode}`,
          tx,
        });

        // 2) Return each material to its source location, clearing WIP
        //    (Dr Stock Valuation / Cr WIP) — the inverse of the consume leg.
        for (const line of order.materials as any[]) {
          const qty = dec(line.qtyConsumed);
          if (qty.lte(ZERO)) continue;
          await this.stock.receive(
            {
              productId: line.productId,
              variantId: line.variantId ?? undefined,
              locationId: order.locationId,
              quantity: Number(qty),
              unitCost: Number(dec(line.unitCost)),
              moveType: 'receipt',
              sourceType: 'production_reversal',
              sourceId: order.orderCode,
            } as any,
            tx,
          );
          await this.stockPosting.postProductionOutput({
            productId: line.productId,
            totalValue: dec(line.totalCost),
            date,
            sourceType: 'production_reversal',
            sourceId: order.orderCode,
            description: `Production reversal · ${order.orderCode}`,
            tx,
          });
        }

        const updated = await tx.productionOrder.update({
          where: { id: order.id },
          data: {
            status: 'cancelled',
            reversedAt: date,
            reversalReason: dto.reason ?? null,
            updatedBy: this.tenant.userId ?? null,
          },
          include: { materials: true, outputs: true },
        });
        await this.audit.recordInTx(tx, {
          entity: 'ProductionOrder',
          entityId: order.id,
          action: 'cancel',
          newValues: { orderCode: order.orderCode, reversed: fgValue.toString() },
        });
        return updated;
      },
      { timeout: 30_000 },
    );
  }

  // ===========================================================================
  // list / get
  // ===========================================================================

  /**
   * One-click convergence (Phase 5): make a finished good sellable at POS by
   * creating a MenuItem whose single recipe line points at the product (qty 1).
   * Selling the menu item then relieves the finished good — the manufacturing →
   * sales handoff, with no double-counting.
   */
  async createMenuItemForProduct(productId: string) {
    const product = await this.prisma.client.product.findFirst({
      where: { id: productId },
      select: { id: true, name: true, salesPrice: true, taxId: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return this.prisma.client.menuItem.create({
      data: {
        organizationId: this.org,
        name: product.name,
        // basePrice follows the POS minor-unit convention (×100 of the major price).
        basePrice: dec(product.salesPrice ?? 0).mul(100),
        isInventoryTracked: true,
        taxId: product.taxId ?? null,
        ingredients: { create: [{ organizationId: this.org, productId, quantity: 1 }] },
      },
      include: { ingredients: true },
    });
  }

  list(params: { status?: string; outputProductId?: string } = {}) {
    return this.prisma.client.productionOrder.findMany({
      where: {
        status: params.status ? (params.status as any) : undefined,
        outputProductId: params.outputProductId,
      },
      orderBy: { createdAt: 'desc' },
      include: { materials: true, outputs: true },
    });
  }

  get(id: string) {
    return this.getOrThrow(id, { materials: true, outputs: true });
  }

  // ===========================================================================
  // internals
  // ===========================================================================

  /**
   * Receive one output line: real stock via StockService.receive (no GL by
   * design — receiveForDocument would credit GRNI, a phantom supplier payable),
   * then the explicit WIP-clearing entry via postProductionOutput.
   */
  private async receiveOutput(
    tx: any,
    p: {
      productId: string;
      variantId: string | null;
      locationId: string;
      quantityBase: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      batchNumber: string | null;
      expiryDate: string | null;
      mfgDate: string | null;
      orderCode: string;
      date: Date;
      lineId?: string;
      totalValue: Prisma.Decimal;
    },
  ): Promise<{ batchNumber: string | null }> {
    const res = await this.stock.receive(
      {
        productId: p.productId,
        variantId: p.variantId ?? undefined,
        locationId: p.locationId,
        quantity: Number(p.quantityBase),
        unitCost: Number(p.unitCost),
        moveType: 'production_output',
        batchNumber: p.batchNumber ?? undefined,
        expiryDate: p.expiryDate ?? undefined,
        mfgDate: p.mfgDate ?? undefined,
        sourceType: RESERVATION_SOURCE,
        sourceId: p.orderCode,
      } as any,
      tx,
    );

    if (p.totalValue.gt(ZERO)) {
      await this.stockPosting.postProductionOutput({
        productId: p.productId,
        totalValue: p.totalValue,
        date: p.date,
        sourceType: RESERVATION_SOURCE,
        sourceId: p.orderCode,
        description: `Production output · ${p.orderCode}`,
        tx,
      });
    }

    if (p.lineId) {
      await tx.productionOutput.update({
        where: { id: p.lineId },
        data: {
          qtyProduced: p.quantityBase,
          unitCost: p.unitCost,
          totalCost: p.totalValue,
          batchNumber: (res as any).batchNumber ?? p.batchNumber,
          ledgerCode: res.ledgerCode,
        },
      });
    }
    return { batchNumber: (res as any).batchNumber ?? p.batchNumber ?? null };
  }

  /** Serialise concurrent start/complete/cancel of one order (double-tap guard).
   *  $executeRaw (not $queryRaw) — pg_advisory_xact_lock returns void, which a
   *  row-deserialising query can't read. Mirrors StockService.lockQuantForAvco. */
  private async lock(tx: any, orderId: string): Promise<void> {
    const key = `production:${this.org}:${orderId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
  }

  private async estimateMaterialValue(order: { materials: any[]; locationId: string }): Promise<Prisma.Decimal> {
    let total = ZERO;
    for (const m of order.materials) {
      const si = await this.prisma.client.stockItem.findFirst({
        where: { productId: m.productId, variantKey: m.variantId ?? '', locationId: order.locationId },
        select: { runningAverageCost: true },
      });
      if (si) total = total.plus(dec(m.qtyPlanned).mul(dec(si.runningAverageCost)));
    }
    return total;
  }

  /** Where finished goods land so the till can sell them — the SAME resolver POS
   *  uses (pos.stockLocationId setting, else first active warehouse), so the two
   *  never disagree about where stock lives. */
  private async resolvePosWarehouse(): Promise<string> {
    const wh = await resolvePosStockLocation(this.prisma, this.org);
    if (!wh) throw new BadRequestException('No active warehouse for finished goods. Create one first.');
    return wh.id;
  }

  /** The QC quarantine location — finished goods sit here until inspected. A
   *  virtual location (no physical bin), auto-created once per org. */
  private async resolveQuarantineLocation(): Promise<string> {
    const existing = await this.prisma.client.inventoryLocation.findFirst({
      where: { organizationId: this.org, code: 'QC-QUARANTINE' },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.client.inventoryLocation.create({
      data: {
        organizationId: this.org,
        code: 'QC-QUARANTINE',
        name: 'QC Quarantine',
        type: 'virtual',
        isActive: true,
        createdBy: this.tenant.userId ?? null,
      },
      select: { id: true },
    });
    return created.id;
  }

  private async getProduct(id: string): Promise<{ id: string; uomId: string | null }> {
    const p = await this.prisma.client.product.findFirst({ where: { id }, select: { id: true, uomId: true } });
    if (!p) throw new NotFoundException(`Product ${id} not found`);
    return p;
  }

  private async productNames(ids: string[]): Promise<Record<string, string>> {
    const products = await this.prisma.client.product.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return Object.fromEntries(products.map((p) => [p.id, p.name]));
  }

  private async getOrThrow(id: string, include: Prisma.ProductionOrderInclude = {}) {
    const order = await this.prisma.client.productionOrder.findFirst({ where: { id }, include });
    if (!order) throw new NotFoundException('Production order not found');
    return order;
  }

  private iso(d: Date | null): string | null {
    return d ? d.toISOString() : null;
  }
}
