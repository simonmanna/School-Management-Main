import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { dec, ZERO } from '../../kernel/common/money';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { ApprovalsService } from '../../kernel/approvals/approvals.service';
import { StockService } from './stock.service';
import {
  CreateStockOutDto,
  CreateWasteDto,
  CreateStockAdjustmentDto,
  CreateStockTransferDto,
} from './dto/stock-doc.dto';

/**
 * F.8 — Document wrappers around the stock engine. Each header carries lines and
 * a {@link StockDocStatus}. Posting to the ledger happens once, on approve, by
 * delegating to {@link StockService} inside a single $transaction (idempotent via
 * `postedAt`). The engine remains the single source of truth for quants, batches,
 * AVCO and GL — these wrappers only add an auditable, approvable paper trail.
 */
@Injectable()
export class StockDocService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly stock: StockService,
    private readonly approvals: ApprovalsService,
  ) {}

  /**
   * Gate a stock document behind the approval engine. Returns when it is safe to
   * post (no policy, or an approved request exists); throws when a pending
   * request must be decided first. Backward-compatible: with no ApprovalPolicy
   * for `entityType`, checkOrRequestApproval returns null and posting proceeds.
   */
  private async gateApproval(
    entityType: string,
    entityId: string,
    snapshot: Record<string, unknown>,
    label: string,
  ): Promise<void> {
    const gate = await this.approvals.checkOrRequestApproval({ entityType, entityId, snapshot });
    if (gate?.needsApproval) {
      throw new BadRequestException(
        `Approval required before posting ${label}. Pending approval request ${gate.requestId}.`,
      );
    }
  }

  private get org(): string {
    return this.tenant.organizationId;
  }

  /** Snapshot product names for the given ids → { id: name }. */
  private async productNames(ids: string[]): Promise<Record<string, string>> {
    const products = await this.prisma.client.product.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return Object.fromEntries(products.map((p) => [p.id, p.name]));
  }

  private async location(id: string) {
    const loc = await this.prisma.client.inventoryLocation.findFirst({ where: { id } });
    if (!loc) throw new NotFoundException('Location not found');
    return loc;
  }

  // ===========================================================================
  // StockOut — internal use / testing / sample / comp (posts ISSUE)
  // ===========================================================================

  async createStockOut(dto: CreateStockOutDto) {
    await this.location(dto.locationId);
    const names = await this.productNames(dto.items.map((i) => i.productId));
    const outCode = await this.seq.next('stock_out', { prefix: 'SO-', padding: 5 });
    return this.prisma.client.stockOut.create({
      data: {
        organizationId: this.org,
        outCode,
        locationId: dto.locationId,
        category: dto.category ?? 'general_use',
        status: 'pending',
        reason: dto.reason ?? null,
        notes: dto.notes ?? null,
        performedById: this.tenant.userId ?? null,
        createdBy: this.tenant.userId ?? null,
        items: {
          create: dto.items.map((i) => ({
            organizationId: this.org,
            productId: i.productId,
            variantId: i.variantId ?? null,
            productName: names[i.productId] ?? 'Unknown',
            unit: i.unit ?? null,
            qty: dec(i.qty),
            batchNumber: i.batchNumber ?? null,
            distStrategy: i.distStrategy ?? 'FEFO',
          })),
        },
      },
      include: { items: true },
    });
  }

  async approveStockOut(id: string) {
    const doc = await this.prisma.client.stockOut.findFirst({ where: { id }, include: { items: true } });
    if (!doc) throw new NotFoundException('Stock-out not found');
    this.assertPostable(doc.status, doc.postedAt);
    await this.gateApproval(
      'stock_out',
      doc.id,
      { amount: Number(doc.totalValue ?? 0), lines: doc.items.length, category: doc.category },
      'stock-out',
    );

    return this.prisma.client.$transaction(async (tx: any) => {
      let total = ZERO;
      for (const item of doc.items) {
        // Map StockOutCategory to StockMoveType for correct GL posting.
        // sample/comp → promo_sample; internal_use/testing/training → internal_use;
        // damaged/waste → waste; expired → expiry_write_off; general_use/other → issue
        const catToMove: Record<string, string> = {
          sample: 'promo_sample',
          complimentary: 'promo_sample',
          kitchen_testing: 'internal_use',
          training: 'internal_use',
          damaged: 'waste',
          expired: 'expiry_write_off',
        };
        const mt = (catToMove[doc.category] ?? 'issue') as any;
        const res = await this.stock.issue(
          {
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            locationId: doc.locationId,
            quantity: Number(item.qty),
            moveType: mt,
            distStrategy: (item.distStrategy as any) ?? 'FEFO',
            batchNumber: item.batchNumber ?? undefined,
            sourceType: 'stock_out',
            sourceId: doc.outCode,
            notes: doc.reason ?? undefined,
          },
          tx,
        );
        const lineTotal = dec(res.totalValue);
        total = total.plus(lineTotal);
        await tx.stockOutItem.update({
          where: { id: item.id },
          data: { unitCost: dec(res.unitCost), totalCost: lineTotal },
        });
      }
      return tx.stockOut.update({
        where: { id: doc.id },
        data: {
          status: 'completed',
          approvedById: this.tenant.userId ?? null,
          approvedAt: new Date(),
          postedAt: new Date(),
          totalValue: total,
        },
        include: { items: true },
      });
    });
  }

  // ===========================================================================
  // WasteRecord — spoilage / expiry / breakage (posts WASTE / EXPIRY_WRITE_OFF)
  // ===========================================================================

  async createWaste(dto: CreateWasteDto) {
    await this.location(dto.locationId);
    const names = await this.productNames(dto.items.map((i) => i.productId));
    const wasteCode = await this.seq.next('waste_doc', { prefix: 'WST-', padding: 5 });
    return this.prisma.client.wasteRecord.create({
      data: {
        organizationId: this.org,
        wasteCode,
        locationId: dto.locationId,
        category: dto.category ?? 'other',
        status: 'pending',
        notes: dto.notes ?? null,
        reportedById: this.tenant.userId ?? null,
        createdBy: this.tenant.userId ?? null,
        items: {
          create: dto.items.map((i) => ({
            organizationId: this.org,
            productId: i.productId,
            variantId: i.variantId ?? null,
            productName: names[i.productId] ?? 'Unknown',
            unit: i.unit ?? null,
            qty: dec(i.qty),
            batchNumber: i.batchNumber ?? null,
            isExpiry: i.isExpiry ?? false,
          })),
        },
      },
      include: { items: true },
    });
  }

  async approveWaste(id: string) {
    const doc = await this.prisma.client.wasteRecord.findFirst({ where: { id }, include: { items: true } });
    if (!doc) throw new NotFoundException('Waste record not found');
    this.assertPostable(doc.status, doc.postedAt);
    await this.gateApproval(
      'waste',
      doc.id,
      { amount: Number(doc.totalValue ?? 0), lines: doc.items.length },
      'waste',
    );

    return this.prisma.client.$transaction(async (tx: any) => {
      let total = ZERO;
      for (const item of doc.items) {
        const res = await this.stock.issue(
          {
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            locationId: doc.locationId,
            quantity: Number(item.qty),
            moveType: item.isExpiry ? 'expiry_write_off' : 'waste',
            distStrategy: item.batchNumber ? 'MANUAL' : 'FEFO',
            batchNumber: item.batchNumber ?? undefined,
            sourceType: 'waste',
            sourceId: doc.wasteCode,
            notes: doc.notes ?? undefined,
          },
          tx,
        );
        const lineTotal = dec(res.totalValue);
        total = total.plus(lineTotal);
        await tx.wasteItem.update({
          where: { id: item.id },
          data: { unitCost: dec(res.unitCost), totalCost: lineTotal },
        });
      }
      return tx.wasteRecord.update({
        where: { id: doc.id },
        data: {
          status: 'completed',
          approvedById: this.tenant.userId ?? null,
          approvedAt: new Date(),
          postedAt: new Date(),
          totalValue: total,
        },
        include: { items: true },
      });
    });
  }

  // ===========================================================================
  // StockAdjustment — cycle count (posts ADJUSTMENT_IN / ADJUSTMENT_OUT)
  // ===========================================================================

  async createAdjustment(dto: CreateStockAdjustmentDto, externalTx?: any) {
    await this.location(dto.locationId);
    const names = await this.productNames(dto.items.map((i) => i.productId));
    const adjCode = await this.seq.next('stock_adj', { prefix: 'ADJ-', padding: 5 });

    // Snapshot system on-hand per line at creation time.
    const lines = await Promise.all(
      dto.items.map(async (i) => {
        const variantKey = i.variantId ?? '';
        const si = await this.prisma.client.stockItem.findFirst({
          where: { productId: i.productId, variantKey, locationId: dto.locationId },
          select: { quantity: true },
        });
        const qtySystem = si ? dec(si.quantity) : ZERO;
        const qtyActual = dec(i.qtyActual);
        return {
          organizationId: this.org,
          productId: i.productId,
          variantId: i.variantId ?? null,
          productName: names[i.productId] ?? 'Unknown',
          unit: i.unit ?? null,
          qtySystem,
          qtyActual,
          qtyDiff: qtyActual.minus(qtySystem),
          batchNumber: i.batchNumber ?? null,
        };
      }),
    );

    const run = async (tx: any) =>
      tx.stockAdjustment.create({
        data: {
          organizationId: this.org,
          adjCode,
          locationId: dto.locationId,
          reason: dto.reason ?? 'cycle_count',
          status: 'pending',
          notes: dto.notes ?? null,
          performedById: this.tenant.userId ?? null,
          createdBy: this.tenant.userId ?? null,
          items: { create: lines },
        },
        include: { items: true },
      });
    return externalTx ? run(externalTx) : this.prisma.client.$transaction(run);
  }

  async approveAdjustment(id: string, externalTx?: any) {
    // Standalone approval is gated by the approval engine. When embedded in another
    // flow (externalTx present, e.g. guided count submit) the caller owns approval.
    if (!externalTx) {
      const pre = await this.prisma.client.stockAdjustment.findFirst({
        where: { id },
        include: { items: true },
      });
      if (!pre) throw new NotFoundException('Adjustment not found');
      const magnitude = pre.items.reduce((s, it) => s + Math.abs(Number(it.qtyDiff)), 0);
      await this.gateApproval(
        'stock_adjustment',
        pre.id,
        { amount: magnitude, adjCode: pre.adjCode, reason: pre.reason },
        `adjustment ${pre.adjCode}`,
      );
    }
    const run = async (tx: any) => {
      const doc = await tx.stockAdjustment.findFirst({ where: { id }, include: { items: true } });
      if (!doc) throw new NotFoundException('Adjustment not found');
      if (doc.postedAt) throw new BadRequestException('Document already posted');
      if (doc.status !== 'pending' && doc.status !== 'draft') {
        throw new BadRequestException(`Cannot approve a ${doc.status} document`);
      }

      for (const item of doc.items) {
        // adjust() re-reads current on-hand and counts to qtyActual — robust to
        // drift between creation and approval.
        await this.stock.adjust(
          {
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            locationId: doc.locationId,
            countedQuantity: Number(item.qtyActual),
            notes: `${doc.adjCode} · ${doc.reason}`,
          },
          tx,
        );
      }
      return tx.stockAdjustment.update({
        where: { id: doc.id },
        data: {
          status: 'completed',
          approvedById: this.tenant.userId ?? null,
          approvedAt: new Date(),
          postedAt: new Date(),
        },
        include: { items: true },
      });
    };
    return externalTx ? run(externalTx) : this.prisma.client.$transaction(run);
  }

  // ===========================================================================
  // StockTransfer — inter-location (posts TRANSFER_OUT / TRANSFER_IN)
  // ===========================================================================

  async createTransfer(dto: CreateStockTransferDto) {
    if (dto.fromLocationId === dto.toLocationId) {
      throw new BadRequestException('Source and destination must differ');
    }
    await this.location(dto.fromLocationId);
    await this.location(dto.toLocationId);
    const names = await this.productNames(dto.items.map((i) => i.productId));
    const transferCode = await this.seq.next('stock_transfer', { prefix: 'TRF-', padding: 5 });
    return this.prisma.client.stockTransfer.create({
      data: {
        organizationId: this.org,
        transferCode,
        fromLocId: dto.fromLocationId,
        toLocId: dto.toLocationId,
        status: 'pending',
        notes: dto.notes ?? null,
        performedById: this.tenant.userId ?? null,
        createdBy: this.tenant.userId ?? null,
        items: {
          create: dto.items.map((i) => ({
            organizationId: this.org,
            productId: i.productId,
            variantId: i.variantId ?? null,
            productName: names[i.productId] ?? 'Unknown',
            unit: i.unit ?? null,
            qtyRequested: dec(i.qtyRequested),
            batchNumber: i.batchNumber ?? null,
            distStrategy: i.distStrategy ?? 'FEFO',
          })),
        },
      },
      include: { items: true },
    });
  }

  async approveTransfer(id: string) {
    const doc = await this.prisma.client.stockTransfer.findFirst({ where: { id }, include: { items: true } });
    if (!doc) throw new NotFoundException('Transfer not found');
    this.assertPostable(doc.status, doc.postedAt);

    const magnitude = doc.items.reduce((s, it) => s + Number(it.qtyRequested), 0);
    await this.gateApproval(
      'stock_transfer',
      doc.id,
      { amount: magnitude, transferCode: doc.transferCode },
      `transfer ${doc.transferCode}`,
    );

    return this.prisma.client.$transaction(async (tx: any) => {
      for (const item of doc.items) {
        await this.stock.transfer(
          {
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            fromLocationId: doc.fromLocId,
            toLocationId: doc.toLocId,
            quantity: Number(item.qtyRequested),
            sourceType: 'stock_transfer',
            sourceId: doc.transferCode,
            notes: doc.notes ?? undefined,
          },
          tx,
        );
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { qtyTransferred: item.qtyRequested },
        });
      }
      return tx.stockTransfer.update({
        where: { id: doc.id },
        data: {
          status: 'completed',
          approvedById: this.tenant.userId ?? null,
          approvedAt: new Date(),
          postedAt: new Date(),
          completedAt: new Date(),
        },
        include: { items: true },
      });
    });
  }

  // ===========================================================================
  // Shared helpers + list/get
  // ===========================================================================

  private assertPostable(status: string, postedAt: Date | null): void {
    if (postedAt) throw new BadRequestException('Document already posted');
    if (status !== 'pending' && status !== 'draft') {
      throw new BadRequestException(`Cannot approve a ${status} document`);
    }
  }

  list(kind: 'out' | 'waste' | 'adjustment' | 'transfer', status?: string) {
    const where = status ? { status: status as any } : {};
    const order = { createdAt: 'desc' as const };
    switch (kind) {
      case 'out':
        return this.prisma.client.stockOut.findMany({ where, orderBy: order, include: { items: true } });
      case 'waste':
        return this.prisma.client.wasteRecord.findMany({ where, orderBy: order, include: { items: true } });
      case 'adjustment':
        return this.prisma.client.stockAdjustment.findMany({ where, orderBy: order, include: { items: true, location: true } });
      case 'transfer':
        return this.prisma.client.stockTransfer.findMany({ where, orderBy: order, include: { items: true } });
    }
  }
}
