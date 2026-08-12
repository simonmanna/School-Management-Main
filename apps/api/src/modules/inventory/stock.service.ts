import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StockMoveType, StockDistributionStrategy } from '@erp/shared';
import { dec, ZERO } from '../../kernel/common/money';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../kernel/events/event-bus';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { SettingResolverService } from '../../kernel/settings/setting-resolver.service';
import { StockPostingService } from './posting/stock-posting.service';
import { CostResolverService } from './costing/cost-resolver.service';
import { UomConversionService } from '../core/product/uom-conversion.service';
import {
  ReceiveStockDto,
  IssueStockDto,
  AdjustStockDto,
  TransferStockDto,
  ReceiveFromBillDto,
} from './dto/stock.dto';

/**
 * Identifies the source document that owns a receipt's accounting effect.
 * Presence of this context is what makes a receipt post to the GL: it both
 * triggers the Dr Stock Valuation / Cr GRNI entry and stamps the ledger row's
 * referenceType/referenceId so the movement traces back to its document.
 */
export type GlReceiptContext = {
  sourceType: string;
  sourceId: string;
  date: Date;
};

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly seq: SequenceService,
    private readonly audit: AuditService,
    private readonly stockPosting: StockPostingService,
    private readonly costResolver: CostResolverService,
    private readonly settings: SettingResolverService,
    private readonly uomConversion: UomConversionService,
  ) {}

  /**
   * Convert an incoming (quantity, unitCost) pair expressed in `sourceUomId` into
   * the product's base unit. Total value is preserved: unitCost is divided by the
   * same factor the quantity is multiplied by. No-op when sourceUomId is absent or
   * already the base unit.
   */
  private async toBaseQtyCost(
    product: { id: string; uomId: string | null },
    sourceUomId: string | null | undefined,
    quantity: Prisma.Decimal,
    unitCost: Prisma.Decimal,
  ): Promise<{ quantity: Prisma.Decimal; unitCost: Prisma.Decimal }> {
    if (!sourceUomId || !product.uomId || sourceUomId === product.uomId || quantity.lte(ZERO)) {
      return { quantity, unitCost };
    }
    const baseQty = await this.uomConversion.toBase(quantity, sourceUomId, product);
    const factor = baseQty.dividedBy(quantity); // base units per source unit
    return {
      quantity: baseQty,
      unitCost: factor.gt(ZERO) ? unitCost.dividedBy(factor) : unitCost,
    };
  }

  /**
   * Serialise the AVCO running-average recompute for one (product, variant,
   * location) quant. The running average is a read-compute-write in application
   * code, so two concurrent receipts — or a receipt racing a transfer-in — would
   * lost-update it: quantity stays correct (atomic increments), the weighted
   * average does not. A transaction-scoped Postgres advisory lock makes the
   * recompute exclusive and releases automatically at commit/rollback. Keyed by a
   * stable string hash, so it also covers the first-ever receipt, where there is
   * no row yet to `SELECT … FOR UPDATE`. Only the average is protected; quantity
   * mutations elsewhere stay lock-free.
   */
  private async lockQuantForAvco(
    tx: any,
    organizationId: string,
    productId: string,
    variantKey: string,
    locationId: string,
  ): Promise<void> {
    const key = `avco:${organizationId}:${productId}:${variantKey}:${locationId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
  }

  /**
   * Bare receipt: recomputes AVCO and moves quantity but does NOT post to GL.
   *
   * Only correct for movements whose value is owned by another journal entry
   * (or that genuinely have no accounting effect). A purchase receipt is NOT
   * one of those — goods arriving must capitalise into inventory, so the
   * procurement paths call {@link receiveForDocument} instead. Leaving this
   * method GL-less was the root of the "stock expensed on sale but never
   * capitalised on receipt" defect: Stock Valuation drifted to a permanent
   * credit balance and the sub-ledger could never tie to the GL.
   */
  async receive(dto: ReceiveStockDto, externalTx?: any) {
    return this.receiveCore(dto, null, externalTx);
  }

  /**
   * Receipt owned by a source document (goods receipt, vendor bill): same as
   * receive() but additionally posts the GL effect (Dr Stock Valuation / Cr
   * GRNI-Accrued) inside the caller's transaction, and stamps the ledger row
   * with the document reference so a movement is traceable to its GRN/bill.
   *
   * GRNI is the accrual for "goods are here, we owe for them". It is cleared by
   * whichever document settles the obligation — the vendor bill (Dr GRNI / Cr AP)
   * or, for a PO with no separate bill, the PO payment (Dr GRNI / Cr Cash|Bank).
   */
  async receiveForDocument(dto: ReceiveStockDto, glCtx: GlReceiptContext, externalTx?: any) {
    return this.receiveCore(dto, glCtx, externalTx);
  }

  /**
   * Receipt from a vendor bill. Thin wrapper over {@link receiveForDocument}.
   */
  async receiveFromBill(dto: ReceiveFromBillDto, externalTx?: any) {
    return this.receiveCore(
      { productId: dto.productId, locationId: dto.locationId, quantity: dto.quantity, unitCost: dto.unitCost, batchNumber: dto.batchNumber, expiryDate: dto.expiryDate, notes: dto.notes, serialNumbers: dto.serialNumbers },
      { sourceType: 'vendor_bill', sourceId: dto.billId, date: new Date(dto.billDate) },
      externalTx,
    );
  }

  /**
   * Restock a customer return (goods back on the shelf): receive with move type
   * `return_in` AND post the COGS reversal (Dr Stock Valuation / Cr COGS) in the
   * same transaction — the mirror of an issue's Dr COGS / Cr Stock Valuation.
   *
   * The restock is valued at the product's CURRENT cost basis (AVCO running
   * average, else STANDARD cost price) unless an explicit `unitCost` is supplied.
   * That both (a) reverses COGS at a sensible basis and (b) prevents the receipt
   * from diluting the running average with a zero cost — the latent bug in the
   * old refund path, which restocked at unitCost=0. Zero-cost returns skip the GL,
   * mirroring postIssue. Caller passes the tx so it stays atomic with the refund.
   */
  async receiveReturn(
    dto: {
      productId: string;
      variantId?: string;
      locationId: string;
      quantity: number;
      unitCost?: number;
      reference?: string;
      sourceType?: string;
      sourceId?: string;
      notes?: string;
      date?: Date;
      /** Unit the `quantity` is expressed in (e.g. a recipe line in grams). Converted
       *  to base here; the cost basis is already per base unit so it is NOT rescaled. */
      uomId?: string;
      /** Serial-tracked returns: the exact units coming back (flipped to in_stock). */
      serialNumbers?: string[];
    },
    externalTx?: any,
  ) {
    const run = async (tx: any) => {
      // Convert the return quantity to the product's base unit (cost stays per base).
      const product = await tx.product.findFirst({ where: { id: dto.productId } });
      const baseQty =
        dto.uomId && product?.uomId && dto.uomId !== product.uomId
          ? await this.uomConversion.toBase(dto.quantity, dto.uomId, { id: dto.productId, uomId: product.uomId })
          : dec(dto.quantity);

      const unitCost =
        dto.unitCost != null
          ? dec(dto.unitCost)
          : await this.resolveCurrentCost(tx, dto.productId, dto.variantId ?? null, dto.locationId);

      const res = await this.receiveCore(
        {
          productId: dto.productId,
          variantId: dto.variantId,
          locationId: dto.locationId,
          quantity: Number(baseQty),
          unitCost: Number(unitCost),
          reference: dto.reference,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          notes: dto.notes,
          moveType: 'return_in',
          serialNumbers: dto.serialNumbers,
        },
        null,
        tx,
      );

      const totalValue = unitCost.times(baseQty);
      if (totalValue.gt(ZERO)) {
        await this.stockPosting.postReturnRestock({
          productId: dto.productId,
          totalValue,
          date: dto.date ?? new Date(),
          sourceType: dto.sourceType ?? 'return_restock',
          sourceId: dto.sourceId ?? dto.reference ?? dto.productId,
          description: `Return restock · ${dto.quantity}`,
          tx,
        });
      }
      return res;
    };
    // 20s (vs Prisma's 5s default): these paths can wait on the per-quant AVCO
    // advisory lock under contention, and a receipt/transfer must not fail just
    // because another movement on the same quant is mid-flight.
    return externalTx ? run(externalTx) : this.prisma.client.$transaction(run, { timeout: 20_000 });
  }

  /**
   * Best cost basis for valuing a return: the location's running average when
   * positive, else the product's standard cost price, else zero. Used by
   * receiveReturn so a restock reverses COGS at the same basis it was expensed.
   */
  private async resolveCurrentCost(
    tx: any,
    productId: string,
    variantId: string | null,
    locationId: string,
  ): Promise<Prisma.Decimal> {
    const product = await tx.product.findFirst({ where: { id: productId } });
    const item = await tx.stockItem.findFirst({
      where: { organizationId: this.tenant.organizationId, productId, variantKey: variantId ?? '', locationId },
    });
    if (item && dec(item.runningAverageCost).gt(ZERO)) return dec(item.runningAverageCost);
    return dec(product?.costPrice ?? 0);
  }

  /**
   * Generate a batch number from the org format setting (tokens YYYY MM DD and a
   * #### sequence run). Used when a batch-tracked receipt omits a batch number and
   * auto-numbering is enabled.
   */
  private async generateBatchNumber(tx: any): Promise<string> {
    const format = await this.settings.resolveString('inventory.batchNumberFormat');
    const seq = await this.seq.next('batch_no', { prefix: '', padding: 4 }, tx);
    const d = new Date();
    return format
      .replace(/YYYY/g, String(d.getFullYear()))
      .replace(/MM/g, String(d.getMonth() + 1).padStart(2, '0'))
      .replace(/DD/g, String(d.getDate()).padStart(2, '0'))
      .replace(/#+/g, seq);
  }

  private async receiveCore(
    dto: ReceiveStockDto,
    glCtx: GlReceiptContext | null,
    externalTx?: any,
  ) {
    const organizationId = this.tenant.organizationId;
    const product = await this.prisma.client.product.findFirst({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Product not found');

    const location = await this.prisma.client.inventoryLocation.findFirst({ where: { id: dto.locationId } });
    if (!location) throw new NotFoundException('Location not found');

    if (product.batchTracking && !dto.batchNumber) {
      // No batch number given: allow only when auto-numbering is enabled, else block.
      const autoNumber = await this.settings.resolveBool('inventory.batchAutoNumber');
      if (!autoNumber) {
        throw new BadRequestException('Batch number is required for batch-tracked products');
      }
    }
    if (dto.expiryDate && !product.batchTracking) {
      throw new BadRequestException('Expiry date is only valid for batch-tracked products');
    }
    if (product.expiryTracking && !dto.expiryDate) {
      throw new BadRequestException('Expiry date is required for expiry-tracked products');
    }
    if (product.costingMethod === 'FIFO' && !product.batchTracking) {
      throw new BadRequestException('FIFO costing requires batchTracking=true on the product');
    }
    if (product.serialTracking) {
      const serials = dto.serialNumbers ?? [];
      // Serials are captured when supplied but NOT mandatory at receive: a receive
      // path without a serial-input UI (e.g. a goods receipt) must never be blocked
      // — units still track by quantity and the issue side auto-picks whatever
      // serials exist. When serials ARE provided they must be unique and not exceed
      // the received quantity.
      if (serials.length > 0) {
        if (new Set(serials).size !== serials.length) {
          throw new BadRequestException('Duplicate serial numbers in the receipt');
        }
        if (serials.length > Number(dto.quantity)) {
          throw new BadRequestException(
            `Received ${dto.quantity} unit(s) but ${serials.length} serial number(s) provided`,
          );
        }
      }
    }

    // Convert a purchase-unit receipt into the base stock unit (total value kept).
    const { quantity: qty, unitCost } = await this.toBaseQtyCost(
      product,
      dto.uomId,
      dec(dto.quantity),
      dto.unitCost != null ? dec(dto.unitCost) : ZERO,
    );
    const variantId = dto.variantId ?? null;
    const variantKey = variantId ?? '';

    const run = async (tx: any) => {
      // Exclusive on this quant's AVCO recompute for the duration of the tx.
      await this.lockQuantForAvco(tx, organizationId, dto.productId, variantKey, dto.locationId);
      const ledgerCode = await this.seq.next('stock_move', { prefix: 'STK/', padding: 6 }, tx);

      // Recompute AVCO before writing the ledger row.
      const existingItem = await tx.stockItem.findFirst({
        where: { organizationId, productId: dto.productId, variantKey, locationId: dto.locationId },
      });

      const costResolution = this.costResolver.resolveReceiptCost(
        { costingMethod: product.costingMethod, costPrice: product.costPrice },
        existingItem
          ? { quantity: dec(existingItem.quantity), runningAverageCost: dec(existingItem.runningAverageCost) }
          : null,
        qty,
        unitCost,
      );

      const stockItem = await tx.stockItem.upsert({
        where: { organizationId_productId_variantKey_locationId: { organizationId, productId: dto.productId, variantKey, locationId: dto.locationId } },
        create: {
          organizationId,
          productId: dto.productId,
          variantId,
          variantKey,
          locationId: dto.locationId,
          quantity: qty,
          runningAverageCost: costResolution.newRunningAverage ?? ZERO,
        },
        update: {
          quantity: { increment: qty },
          ...(costResolution.newRunningAverage ? { runningAverageCost: costResolution.newRunningAverage } : {}),
        },
      });

      let batchId: string | null = null;
      if (product.batchTracking) {
        const batchNumber = dto.batchNumber ?? (await this.generateBatchNumber(tx));
        const batch = await tx.inventoryBatch.create({
          data: {
            organizationId,
            productId: dto.productId,
            variantId,
            locationId: dto.locationId,
            batchNumber,
            quantity: qty,
            unitCost,
            expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
            mfgDate: dto.mfgDate ? new Date(dto.mfgDate) : null,
          },
        });
        batchId = batch.id;
      }

      // Serial capture: one InventorySerial row per received unit (status in_stock),
      // carrying its own receipt cost so SPECIFIC costing values it exactly on issue.
      // Upsert (not createMany) so a return of a previously-issued unit flips its
      // existing row back to in_stock instead of colliding on the unique serial.
      if (product.serialTracking && dto.serialNumbers?.length) {
        const receiptRef = `${glCtx?.sourceType ?? dto.sourceType ?? 'receipt'}:${glCtx?.sourceId ?? dto.sourceId ?? ledgerCode}`;
        for (const serialNumber of dto.serialNumbers) {
          await tx.inventorySerial.upsert({
            where: {
              organizationId_productId_serialNumber: {
                organizationId,
                productId: dto.productId,
                serialNumber,
              },
            },
            create: {
              organizationId,
              productId: dto.productId,
              variantId,
              locationId: dto.locationId,
              serialNumber,
              batchId,
              unitCost,
              status: 'in_stock',
              receiptRef,
            },
            update: {
              // Return / re-receipt: bring the unit back in stock at this location.
              locationId: dto.locationId,
              variantId,
              batchId,
              status: 'in_stock',
              issuedAt: null,
              issueRef: null,
              receiptRef,
            },
          });
        }
      }

      const currentQty = dec(stockItem.quantity);
      await tx.inventoryLedger.create({
        data: {
          organizationId,
          ledgerCode,
          productId: dto.productId,
          variantId,
          locationId: dto.locationId,
          batchId,
          type: dto.moveType ?? 'receipt',
          qtyBefore: currentQty.minus(qty),
          quantityChange: qty,
          balanceAfter: currentQty,
          unitCost,
          totalValue: costResolution.totalValue,
          referenceType: glCtx?.sourceType ?? dto.sourceType ?? null,
          referenceId: glCtx?.sourceId ?? dto.sourceId ?? null,
          notes: dto.notes ?? null,
          performedBy: this.tenant.userId ?? null,
        },
      });

      // GL effect (Dr Stock Valuation / Cr GRNI): only when a source document
      // owns the receipt's accounting. A bare receive() stays quantity-only.
      if (glCtx) {
        await this.stockPosting.postReceipt({
          productId: dto.productId,
          quantity: qty,
          unitCost,
          date: glCtx.date,
          sourceType: glCtx.sourceType,
          sourceId: glCtx.sourceId,
          description: `Stock receipt · ${product.name} · ${dto.quantity}`,
          tx,
        });

        // The receipt landed on negative on-hand: the units already sold were
        // expensed at a stale (often zero) average, so inventory is overstated
        // and COGS understated by exactly this residual. Square it up in the same
        // transaction. Only meaningful when the receipt itself hit the GL — a
        // bare receive() never debited Stock Valuation, so there is nothing to
        // correct against.
        if (costResolution.costCorrection && !costResolution.costCorrection.isZero()) {
          await this.stockPosting.postNegativeStockCostCorrection({
            productId: dto.productId,
            amount: costResolution.costCorrection,
            date: glCtx.date,
            sourceType: glCtx.sourceType,
            sourceId: glCtx.sourceId,
            description: `Negative-stock cost correction · ${product.name}`,
            tx,
          });
        }
      }

      this.events.publish('stock.received', {
        organizationId,
        productId: dto.productId,
        locationId: dto.locationId,
        ledgerCode,
        quantity: String(dto.quantity),
        unitCost: unitCost.toString(),
        newRunningAverage: costResolution.newRunningAverage?.toString(),
      });

      await this.audit.recordInTx(tx, {
        entity: 'StockItem',
        entityId: stockItem.id,
        action: 'receive',
        newValues: { productId: dto.productId, locationId: dto.locationId, quantity: dto.quantity, unitCost: unitCost.toString(), ledgerCode },
      });

      return {
        ledgerCode,
        quantity: dto.quantity,
        unitCost: unitCost.toString(),
        // Value actually capitalised into inventory (post UOM conversion). Callers
        // that voucher the receipt against a supplier sum this so their AP credit
        // exactly matches the GRNI credit raised here — no rounding residual.
        totalValue: costResolution.totalValue.toString(),
        runningAverageCost: costResolution.newRunningAverage?.toString() ?? stockItem.runningAverageCost.toString(),
      };
    };
    // 20s (vs Prisma's 5s default): these paths can wait on the per-quant AVCO
    // advisory lock under contention, and a receipt/transfer must not fail just
    // because another movement on the same quant is mid-flight.
    return externalTx ? run(externalTx) : this.prisma.client.$transaction(run, { timeout: 20_000 });
  }

  async issue(dto: IssueStockDto, externalTx?: any) {
    const organizationId = this.tenant.organizationId;
    const product = await this.prisma.client.product.findFirst({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Product not found');

    const location = await this.prisma.client.inventoryLocation.findFirst({ where: { id: dto.locationId } });
    if (!location) throw new NotFoundException('Location not found');

    // Convert a source-unit issue (e.g. a recipe line in grams) into the base unit.
    const { quantity: qty } = await this.toBaseQtyCost(product, dto.uomId, dec(dto.quantity), ZERO);
    if (qty.lte(ZERO)) throw new BadRequestException('Quantity must be positive');
    const variantId = dto.variantId ?? null;
    const variantKey = variantId ?? '';
    const moveType: StockMoveType = dto.moveType ?? 'issue';
    // Removal strategy cascade: an explicit transaction override wins; otherwise a
    // configured Setting override (product/category/warehouse/org) takes precedence
    // over the product's own column, which is the final fallback before FEFO.
    const settingCtx = {
      productId: dto.productId,
      categoryId: product.categoryId,
      warehouseId: dto.locationId,
    };
    const strategyOverride = await this.settings.describe('inventory.defaultPickingStrategy', settingCtx);
    const strategy = (dto.distStrategy ??
      (strategyOverride.source !== 'default' ? (strategyOverride.value as string) : null) ??
      product.pickingStrategy ??
      'FEFO') as StockDistributionStrategy;
    // Negative-stock policy: default keeps sales unblocked (owner rule). Only when an
    // admin sets allowNegativeStock=false do we consult the product's stock policy.
    const allowNegativeStock = await this.settings.resolveBool(
      'inventory.allowNegativeStock',
      settingCtx,
    );

    const run = async (tx: any) => {
      let stockItem = await tx.stockItem.findFirst({
        where: { organizationId, productId: dto.productId, variantKey, locationId: dto.locationId },
      });
      if (!stockItem) {
        stockItem = await tx.stockItem.create({
          data: {
            organizationId,
            productId: dto.productId,
            variantId,
            variantKey,
            locationId: dto.locationId,
            quantity: 0,
            runningAverageCost: dec(product.costPrice ?? 0),
          },
        });
      }

      // Strict-mode oversell guard. Skipped entirely when negative stock is allowed
      // (the default), so the never-block-sales behaviour is unchanged out of the box.
      if (!allowNegativeStock) {
        const usesLayers = product.costingMethod === 'FIFO' || product.batchTracking;
        const available = usesLayers
          ? dec(
              (
                await tx.inventoryBatch.aggregate({
                  where: {
                    organizationId,
                    productId: dto.productId,
                    variantId,
                    locationId: dto.locationId,
                    quantity: { gt: 0 },
                    isActive: true,
                  },
                  _sum: { quantity: true },
                })
              )._sum.quantity ?? 0,
            )
          : dec(stockItem.quantity);
        if (qty.gt(available)) {
          if (product.stockPolicy === 'block') {
            throw new BadRequestException(
              `Insufficient stock for ${product.name}: on hand ${available.toString()}, requested ${qty.toString()}.`,
            );
          }
          if (product.stockPolicy === 'warn') {
            console.warn(
              `[stock] oversell ${product.sku ?? dto.productId} @ ${dto.locationId}: on hand ${available.toString()}, issuing ${qty.toString()}`,
            );
          }
          // 'silent' → proceed
        }
      }

      const ledgerCode = await this.seq.next('stock_move', { prefix: 'STK/', padding: 6 }, tx);
      let totalValue = ZERO;
      let unitCost = ZERO;

      // Whether this issue drew from identified cost-layers (batches). When true we
      // pass the actually-consumed value straight to the GL leg so it never re-derives
      // the cost from the now-decremented batches.
      const usesLayerCosting = product.costingMethod === 'FIFO' || product.batchTracking;
      const isSerialIssue = product.serialTracking;
      if (isSerialIssue) {
        // Serial-tracked issue: consume identified units (explicit serials, else
        // oldest in-stock first), value each at its own receipt cost (SPECIFIC), mark
        // it issued, and write one ledger row per unit linked to its serialId. Never
        // blocks a sale — any shortfall of serials overflows at the product cost.
        const requested = dto.serialNumbers ?? [];
        let serialRows: Array<{ id: string; unitCost: any; batchId: string | null; serialNumber: string }>;
        if (requested.length > 0) {
          serialRows = await tx.inventorySerial.findMany({
            where: {
              organizationId,
              productId: dto.productId,
              variantId,
              locationId: dto.locationId,
              status: 'in_stock',
              serialNumber: { in: requested },
            },
            select: { id: true, unitCost: true, batchId: true, serialNumber: true },
          });
          if (serialRows.length !== requested.length) {
            const found = new Set(serialRows.map((s) => s.serialNumber));
            const missing = requested.filter((s) => !found.has(s));
            throw new BadRequestException(
              `Serial number(s) not available at this location: ${missing.join(', ')}`,
            );
          }
        } else {
          serialRows = await tx.inventorySerial.findMany({
            where: {
              organizationId,
              productId: dto.productId,
              variantId,
              locationId: dto.locationId,
              status: 'in_stock',
            },
            orderBy: { receivedAt: 'asc' },
            take: Math.max(0, Math.floor(qty.toNumber())),
            select: { id: true, unitCost: true, batchId: true, serialNumber: true },
          });
        }

        const issueRef = `${dto.sourceType ?? 'issue'}:${dto.sourceId ?? ledgerCode}`;
        let runningBefore = dec(stockItem.quantity);
        for (const s of serialRows) {
          const sUnit = s.unitCost ? dec(s.unitCost) : dec(product.costPrice ?? 0);
          await tx.inventorySerial.update({
            where: { id: s.id },
            data: { status: 'issued', issuedAt: new Date(), issueRef },
          });
          const after = runningBefore.minus(1);
          await tx.stockItem.update({
            where: { id: stockItem.id },
            data: { quantity: { decrement: 1 } },
          });
          await tx.inventoryLedger.create({
            data: {
              organizationId,
              ledgerCode,
              productId: dto.productId,
              variantId,
              locationId: dto.locationId,
              batchId: s.batchId ?? null,
              serialId: s.id,
              type: moveType,
              qtyBefore: runningBefore,
              quantityChange: dec(1).negated(),
              balanceAfter: after,
              unitCost: sUnit,
              totalValue: sUnit,
              referenceType: dto.sourceType ?? null,
              referenceId: dto.sourceId ?? null,
              notes: dto.notes ?? null,
              performedBy: this.tenant.userId ?? null,
            },
          });
          totalValue = totalValue.plus(sUnit);
          runningBefore = after;
        }

        // Shortfall (fewer serials than requested qty): never block — overflow the
        // remainder at product cost, mirroring the batch overflow path.
        const covered = dec(serialRows.length);
        if (qty.gt(covered)) {
          const remaining = qty.minus(covered);
          const overflowUnit = dec(product.costPrice ?? 0);
          const overflowValue = overflowUnit.times(remaining);
          const after = runningBefore.minus(remaining);
          await tx.stockItem.update({
            where: { id: stockItem.id },
            data: { quantity: { decrement: remaining } },
          });
          await tx.inventoryLedger.create({
            data: {
              organizationId,
              ledgerCode,
              productId: dto.productId,
              variantId,
              locationId: dto.locationId,
              batchId: null,
              serialId: null,
              type: moveType,
              qtyBefore: runningBefore,
              quantityChange: remaining.negated(),
              balanceAfter: after,
              unitCost: overflowUnit,
              totalValue: overflowValue,
              referenceType: dto.sourceType ?? null,
              referenceId: dto.sourceId ?? null,
              notes: dto.notes ?? null,
              performedBy: this.tenant.userId ?? null,
            },
          });
          totalValue = totalValue.plus(overflowValue);
          runningBefore = after;
        }
        unitCost = totalValue.gt(ZERO) ? totalValue.dividedBy(qty) : ZERO;
      } else if (usesLayerCosting) {
        // FEFO (default): nearest expiry first. FIFO: oldest receipt first.
        // MANUAL: restrict to the named batch only.
        const orderBy =
          strategy === 'FIFO'
            ? [{ receivedAt: 'asc' as const }]
            : [{ expiryDate: { sort: 'asc' as const, nulls: 'last' as const } }, { receivedAt: 'asc' as const }];
        const batches = await tx.inventoryBatch.findMany({
          where: {
            organizationId,
            productId: dto.productId,
            variantId,
            locationId: dto.locationId,
            quantity: { gt: 0 },
            isActive: true,
            ...(strategy === 'MANUAL' && dto.batchNumber ? { batchNumber: dto.batchNumber } : {}),
          },
          orderBy,
        });
        let remaining = qty;
        // Location on-hand running balance. Seeds the ledger qtyBefore/balanceAfter
        // in LOCATION terms on this path too (matching the AVCO and serial paths),
        // instead of the batch-scoped values this branch used to write — those two
        // meanings on one column made every batch-product stock card wrong.
        let runningBefore = dec(stockItem.quantity);
        for (const batch of batches) {
          if (remaining.lte(ZERO)) break;
          const batchQty = dec(batch.quantity);
          // Atomic decrement: only succeeds when batch.quantity >= consumed.
          const consumed = Prisma.Decimal.min(remaining, batchQty);
          const updateRes = await tx.inventoryBatch.updateMany({
            where: { id: batch.id, organizationId, quantity: { gte: consumed } },
            data: { quantity: { decrement: consumed } },
          });
          if (updateRes.count === 0) {
            // Another transaction took this batch first; re-read and continue.
            continue;
          }
          const newBatchQty = batchQty.minus(consumed);
          if (newBatchQty.lte(ZERO)) {
            await tx.inventoryBatch.updateMany({
              where: { id: batch.id, organizationId },
              data: { isActive: false },
            });
          }
          // Decrement the cached location on-hand in lock-step with the batch
          // layer. Without this, StockItem.quantity never moved on a batch issue,
          // so on-hand inflated on every sale and diverged from sum(batches).
          await tx.stockItem.update({
            where: { id: stockItem.id },
            data: { quantity: { decrement: consumed } },
          });
          const afterLoc = runningBefore.minus(consumed);
          const batchUnitCost = batch.unitCost ? dec(batch.unitCost) : ZERO;
          const consumedValue = batchUnitCost.times(consumed);
          await tx.inventoryLedger.create({
            data: {
              organizationId,
              ledgerCode,
              productId: dto.productId,
              variantId,
              locationId: dto.locationId,
              batchId: batch.id,
              type: moveType,
              qtyBefore: runningBefore,
              quantityChange: consumed.negated(),
              balanceAfter: afterLoc,
              unitCost: batchUnitCost,
              totalValue: consumedValue,
              referenceType: dto.sourceType ?? null,
              referenceId: dto.sourceId ?? null,
              notes: dto.notes ?? null,
              performedBy: this.tenant.userId ?? null,
            },
          });
          totalValue = totalValue.plus(consumedValue);
          remaining = remaining.minus(consumed);
          runningBefore = afterLoc;
        }
        if (remaining.gt(ZERO)) {
          const consumedQty = qty.minus(remaining);
          const overflowUnitCost = consumedQty.gt(ZERO)
            ? totalValue.dividedBy(consumedQty)
            : dec(product.costPrice ?? 0);
          const overflowValue = overflowUnitCost.times(remaining);
          const beforeOverflow = runningBefore;
          await tx.stockItem.update({
            where: { id: stockItem.id },
            data: { quantity: { decrement: remaining } },
          });
          await tx.inventoryLedger.create({
            data: {
              organizationId,
              ledgerCode,
              productId: dto.productId,
              variantId,
              locationId: dto.locationId,
              batchId: null,
              type: moveType,
              qtyBefore: beforeOverflow,
              quantityChange: remaining.negated(),
              balanceAfter: beforeOverflow.minus(remaining),
              unitCost: overflowUnitCost,
              totalValue: overflowValue,
              referenceType: dto.sourceType ?? null,
              referenceId: dto.sourceId ?? null,
              notes: dto.notes ?? null,
              performedBy: this.tenant.userId ?? null,
            },
          });
          totalValue = totalValue.plus(overflowValue);
          remaining = ZERO;
        }
        unitCost = totalValue.gt(ZERO) ? totalValue.dividedBy(qty) : ZERO;
      } else {
        // AVCO / STANDARD: unconditional decrement (allows negative stock) so a
        // sale is NEVER blocked at bill time — overselling surfaces as a negative
        // on-hand that signals "restock", not a 500 to the cashier. The pure cost
        // resolver intentionally THROWS for AVCO with zero/negative on-hand, so we
        // bypass it for AVCO and value the issue at the running average directly
        // (identical result when stock is positive). STANDARD never throws.
        if (product.costingMethod === 'AVCO') {
          unitCost = dec(stockItem.runningAverageCost);
          totalValue = unitCost.times(qty);
        } else {
          const resolution = this.costResolver.resolveIssueCost(
            { costingMethod: product.costingMethod, costPrice: product.costPrice },
            { quantity: dec(stockItem.quantity), runningAverageCost: dec(stockItem.runningAverageCost) },
            qty,
          );
          unitCost = resolution.unitCost;
          totalValue = resolution.totalValue;
        }

        const beforeQty = dec(stockItem.quantity);
        const updated = await tx.stockItem.update({
          where: { id: stockItem.id },
          data: { quantity: { decrement: qty } },
        });
        const newQty = dec(updated.quantity);
        await tx.inventoryLedger.create({
          data: {
            organizationId,
            ledgerCode,
            productId: dto.productId,
            variantId,
            locationId: dto.locationId,
            batchId: null,
            type: moveType,
            qtyBefore: beforeQty,
            quantityChange: qty.negated(),
            balanceAfter: newQty,
            unitCost,
            totalValue,
            referenceType: dto.sourceType ?? null,
            referenceId: dto.sourceId ?? null,
            notes: dto.notes ?? null,
            performedBy: this.tenant.userId ?? null,
          },
        });
      }

      // GL effect: Dr {expense} / Cr Stock Valuation. Passes the same tx so it's atomic.
      // skipGlPosting = quantitative-only (RTV: the debit note owns the balanced JE).
      // Maps StockMoveType → InventoryMovementType so waste/expiry/sample/consume
      // use the correct movement-type account rules instead of being miscategorised as STOCK_OUT.
      const INV_MOVE_TYPES: Record<string, string> = {
        issue: 'STOCK_OUT',
        waste: 'WASTE',
        expiry_write_off: 'EXPIRY_WRITE_OFF',
        return_to_supplier: 'RETURN_TO_SUPPLIER',
        internal_use: 'INTERNAL_CONSUMPTION',
        promo_sample: 'PROMO_SAMPLE',
        // Production consume relieves raw materials into WIP (Dr WIP / Cr Stock
        // Valuation). Without this entry the issue would default to STOCK_OUT and
        // book flour straight to COGS. (production_output is a receive, not an
        // issue — its ledger row is tagged from dto.moveType in receiveCore.)
        production_consume: 'PRODUCTION_CONSUME',
      };
      if (totalValue.gt(ZERO) && !dto.skipGlPosting) {
        await this.stockPosting.postIssue({
          productId: dto.productId,
          // Cost basis is per (product, variant, location) — without this the GL
          // leg re-resolves from a sibling variant's average.
          variantId,
          locationId: dto.locationId,
          quantity: qty,
          date: dto.date ? new Date(dto.date) : new Date(),
          sourceType: dto.sourceType ?? 'stock_issue',
          sourceId: dto.sourceId ?? ledgerCode,
          description: `Stock issue · ${product.name} · ${dto.quantity}`,
          movementType: (INV_MOVE_TYPES[moveType] ?? 'STOCK_OUT') as any,
          // Layer-costed issues (FIFO/SPECIFIC/batch/serial) already computed the
          // exact consumed value above; hand it to the GL leg so it doesn't re-resolve
          // from the already-decremented batches.
          overrideTotalValue: usesLayerCosting || isSerialIssue ? totalValue : undefined,
          tx,
        });
      }

      this.events.publish('stock.issued', {
        organizationId,
        productId: dto.productId,
        locationId: dto.locationId,
        ledgerCode,
        quantity: String(dto.quantity),
        unitCost: unitCost.toString(),
        totalValue: totalValue.toString(),
      });

      await this.audit.recordInTx(tx, {
        entity: 'StockItem',
        entityId: stockItem.id,
        action: 'issue',
        newValues: { productId: dto.productId, locationId: dto.locationId, quantity: dto.quantity, unitCost: unitCost.toString(), totalValue: totalValue.toString(), ledgerCode },
      });

      return { ledgerCode, quantity: dto.quantity, unitCost: unitCost.toString(), totalValue: totalValue.toString() };
    };
    // 20s (vs Prisma's 5s default): these paths can wait on the per-quant AVCO
    // advisory lock under contention, and a receipt/transfer must not fail just
    // because another movement on the same quant is mid-flight.
    return externalTx ? run(externalTx) : this.prisma.client.$transaction(run, { timeout: 20_000 });
  }

  async adjust(dto: AdjustStockDto, externalTx?: any) {
    const organizationId = this.tenant.organizationId;
    const product = await this.prisma.client.product.findFirst({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Product not found');

    const location = await this.prisma.client.inventoryLocation.findFirst({ where: { id: dto.locationId } });
    if (!location) throw new NotFoundException('Location not found');

    const countedQty = dec(dto.countedQuantity);
    const variantId = dto.variantId ?? null;
    const variantKey = variantId ?? '';

    const run = async (tx: any) => {
      const stockItem = await tx.stockItem.findFirst({
        where: { organizationId, productId: dto.productId, variantKey, locationId: dto.locationId },
      });

      const currentQty = stockItem ? dec(stockItem.quantity) : ZERO;
      const delta = countedQty.minus(currentQty);
      if (delta.isZero()) return { ledgerCode: null, quantity: 0, delta: 0 };

      const ledgerCode = await this.seq.next('stock_move', { prefix: 'STK/', padding: 6 }, tx);
      const moveType: StockMoveType = delta.gt(ZERO) ? 'adjustment_in' : 'adjustment_out';

      // Use the AVCO (or standard cost) for the variance value.
      const unitCost = stockItem
        ? dec(stockItem.runningAverageCost).gt(ZERO)
          ? dec(stockItem.runningAverageCost)
          : dec(product.costPrice ?? ZERO)
        : dec(product.costPrice ?? ZERO);

      if (stockItem) {
        // Atomic conditional update: only update when the current quantity is
        // exactly what we read (prevents lost-update with a concurrent issue).
        const upd = await tx.stockItem.updateMany({
          where: {
            id: stockItem.id,
            organizationId,
            quantity: currentQty.toString() as any,
          },
          data: { quantity: countedQty },
        });
        if (upd.count === 0) {
          throw new BadRequestException(
            'Stock was modified concurrently; please re-read the current quantity and retry.',
          );
        }
      } else {
        await tx.stockItem.create({
          data: { organizationId, productId: dto.productId, variantId, variantKey, locationId: dto.locationId, quantity: countedQty, runningAverageCost: unitCost },
        });
      }

      await tx.inventoryLedger.create({
        data: {
          organizationId,
          ledgerCode,
          productId: dto.productId,
          variantId,
          locationId: dto.locationId,
          type: moveType,
          qtyBefore: currentQty,
          quantityChange: delta,
          balanceAfter: countedQty,
          unitCost,
          totalValue: unitCost.times(delta.abs()),
          notes: dto.notes ?? null,
          performedBy: this.tenant.userId ?? null,
        },
      });

      // GL effect for variance (Dr/Cr Stock Valuation / Stock Adj Income/Expense)
      await this.stockPosting.postAdjustment({
        productId: dto.productId,
        delta,
        unitCost,
        date: new Date(),
        sourceType: 'stock_adjust',
        sourceId: ledgerCode,
        description: `Stock adjustment · ${product.name}`,
        tx,
      });

      this.events.publish('stock.adjusted', {
        organizationId,
        productId: dto.productId,
        locationId: dto.locationId,
        ledgerCode,
        quantity: String(countedQty),
        delta: delta.toString(),
      });

      await this.audit.recordInTx(tx, {
        entity: 'StockItem',
        entityId: stockItem?.id ?? 'new',
        action: 'adjust',
        newValues: { productId: dto.productId, locationId: dto.locationId, countedQuantity: dto.countedQuantity, previousQuantity: Number(currentQty), ledgerCode },
      });

      return { ledgerCode, previousQuantity: Number(currentQty), newQuantity: Number(countedQty), delta: Number(delta), unitCost: unitCost.toString() };
    };
    // 20s (vs Prisma's 5s default): these paths can wait on the per-quant AVCO
    // advisory lock under contention, and a receipt/transfer must not fail just
    // because another movement on the same quant is mid-flight.
    return externalTx ? run(externalTx) : this.prisma.client.$transaction(run, { timeout: 20_000 });
  }

  async transfer(dto: TransferStockDto, externalTx?: any) {
    const organizationId = this.tenant.organizationId;
    if (dto.fromLocationId === dto.toLocationId) {
      throw new BadRequestException('Source and destination locations must be different');
    }

    const product = await this.prisma.client.product.findFirst({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Product not found');

    const [fromLoc, toLoc] = await Promise.all([
      this.prisma.client.inventoryLocation.findFirst({ where: { id: dto.fromLocationId } }),
      this.prisma.client.inventoryLocation.findFirst({ where: { id: dto.toLocationId } }),
    ]);
    if (!fromLoc) throw new NotFoundException('Source location not found');
    if (!toLoc) throw new NotFoundException('Destination location not found');

    const qty = dec(dto.quantity);
    if (qty.lte(ZERO)) throw new BadRequestException('Quantity must be positive');
    const variantId = dto.variantId ?? null;
    const variantKey = variantId ?? '';

    const run = async (tx: any) => {
      // Serialise the destination AVCO recompute (the transfer-in blend below is a
      // read-compute-write on the dest average, same race as a receipt). Taken
      // first, before the source decrement, so it is the earliest lock this tx
      // holds. The source side uses an atomic conditional decrement and needs no
      // such lock.
      await this.lockQuantForAvco(tx, organizationId, dto.productId, variantKey, dto.toLocationId);

      const fromItem = await tx.stockItem.findFirst({
        where: { organizationId, productId: dto.productId, variantKey, locationId: dto.fromLocationId },
      });
      if (!fromItem) throw new BadRequestException('No stock found at source location');

      const ledgerCode = await this.seq.next('stock_move', { prefix: 'STK/', padding: 6 }, tx);

      // Preserve AVCO across the transfer (same product, same org).
      const carriedAvg = dec(fromItem.runningAverageCost);

      // Atomic conditional decrement at the source. Returns 0 if a concurrent
      // transfer/issue drained the stock first.
      const fromDecrement = await tx.stockItem.updateMany({
        where: {
          id: fromItem.id,
          organizationId,
          quantity: { gte: qty.toString() as any },
        },
        data: { quantity: { decrement: qty } },
      });
      if (fromDecrement.count === 0) {
        const fresh = await tx.stockItem.findFirst({ where: { id: fromItem.id, organizationId } });
        throw new BadRequestException(
          `Insufficient stock at source: available ${fresh?.quantity ?? 0}, requested ${qty}`,
        );
      }

      // Blend the carried cost into the destination's running average. A
      // transfer-in is economically a receipt at the source's carried cost, so it
      // reuses the same AVCO recompute as receiveCore (including the negative-on-
      // hand basis reset). Without this, moving stock into a destination that
      // already holds units at a different average silently kept the old average
      // and the destination valuation drifted from the ledger.
      const existingTo = await tx.stockItem.findFirst({
        where: { organizationId, productId: dto.productId, variantKey, locationId: dto.toLocationId },
      });
      const destCost = this.costResolver.resolveReceiptCost(
        { costingMethod: product.costingMethod, costPrice: product.costPrice },
        existingTo
          ? { quantity: dec(existingTo.quantity), runningAverageCost: dec(existingTo.runningAverageCost) }
          : null,
        qty,
        carriedAvg,
      );

      const toItem = await tx.stockItem.upsert({
        where: { organizationId_productId_variantKey_locationId: { organizationId, productId: dto.productId, variantKey, locationId: dto.toLocationId } },
        create: { organizationId, productId: dto.productId, variantId, variantKey, locationId: dto.toLocationId, quantity: qty, runningAverageCost: destCost.newRunningAverage ?? carriedAvg },
        update: { quantity: { increment: qty }, ...(destCost.newRunningAverage ? { runningAverageCost: destCost.newRunningAverage } : {}) },
      });

      if (product.batchTracking) {
        const batches = await tx.inventoryBatch.findMany({
          where: { organizationId, productId: dto.productId, variantId, locationId: dto.fromLocationId, quantity: { gt: 0 }, isActive: true },
          orderBy: { receivedAt: 'asc' },
        });

        let remaining = qty;
        for (const batch of batches) {
          if (remaining.lte(ZERO)) break;
          const batchQty = dec(batch.quantity);
          const movedQty = Prisma.Decimal.min(remaining, batchQty);
          const leftover = batchQty.minus(movedQty);

          await tx.inventoryBatch.updateMany({
            where: { id: batch.id, organizationId },
            data: { quantity: leftover, ...(leftover.lte(ZERO) ? { isActive: false } : {}) },
          });

          await tx.inventoryBatch.create({
            data: {
              organizationId,
              productId: dto.productId,
              variantId,
              locationId: dto.toLocationId,
              batchNumber: batch.batchNumber,
              quantity: movedQty,
              unitCost: batch.unitCost,
              expiryDate: batch.expiryDate,
            },
          });

          remaining = remaining.minus(movedQty);
        }
      }

      // Serial-tracked products: the physical units move with the stock, so their
      // location must move too. Without this the serials stayed at the source —
      // the destination could never issue by serial (it fell through to the
      // product-cost overflow path) and the source kept phantom `in_stock` rows.
      // Batch ids are remapped to the destination copies created above.
      if (product.serialTracking) {
        const movingSerials = await tx.inventorySerial.findMany({
          where: {
            organizationId,
            productId: dto.productId,
            variantId,
            locationId: dto.fromLocationId,
            status: 'in_stock',
          },
          orderBy: { receivedAt: 'asc' },
          take: Math.max(0, Math.floor(qty.toNumber())),
          select: { id: true, batchId: true },
        });
        if (movingSerials.length > 0) {
          // Map each moved serial's old batch to the destination batch with the
          // same batchNumber (created in the batch loop above), so batch+serial
          // products keep their lot linkage across the transfer.
          const oldBatchIds = [...new Set(movingSerials.map((s: any) => s.batchId).filter(Boolean))] as string[];
          const batchIdMap = new Map<string, string>();
          if (oldBatchIds.length > 0) {
            const oldBatches = await tx.inventoryBatch.findMany({
              where: { id: { in: oldBatchIds }, organizationId },
              select: { id: true, batchNumber: true },
            });
            const destBatches = await tx.inventoryBatch.findMany({
              where: {
                organizationId,
                productId: dto.productId,
                variantId,
                locationId: dto.toLocationId,
                batchNumber: { in: oldBatches.map((b: any) => b.batchNumber) },
              },
              orderBy: { receivedAt: 'desc' },
              select: { id: true, batchNumber: true },
            });
            const destByNumber = new Map<string, string>();
            for (const b of destBatches) {
              if (!destByNumber.has(b.batchNumber)) destByNumber.set(b.batchNumber, b.id);
            }
            for (const b of oldBatches) {
              const destId = destByNumber.get(b.batchNumber);
              if (destId) batchIdMap.set(b.id, destId);
            }
          }
          for (const s of movingSerials) {
            await tx.inventorySerial.update({
              where: { id: s.id },
              data: {
                locationId: dto.toLocationId,
                ...(s.batchId && batchIdMap.has(s.batchId) ? { batchId: batchIdMap.get(s.batchId) } : {}),
              },
            });
          }
        }
      }

      const newFromQty = dec(fromItem.quantity).minus(qty);
      const newToQty = dec(toItem.quantity);

      await tx.inventoryLedger.create({
        data: {
          organizationId,
          ledgerCode,
          productId: dto.productId,
          variantId,
          locationId: dto.fromLocationId,
          type: 'transfer_out',
          qtyBefore: dec(fromItem.quantity),
          quantityChange: qty.negated(),
          balanceAfter: newFromQty,
          unitCost: carriedAvg,
          totalValue: carriedAvg.times(qty),
          referenceType: dto.sourceType ?? null,
          referenceId: dto.sourceId ?? null,
          notes: dto.notes ?? null,
          performedBy: this.tenant.userId ?? null,
        },
      });

      await tx.inventoryLedger.create({
        data: {
          organizationId,
          ledgerCode,
          productId: dto.productId,
          variantId,
          locationId: dto.toLocationId,
          type: 'transfer_in',
          qtyBefore: newToQty.minus(qty),
          quantityChange: qty,
          balanceAfter: newToQty,
          unitCost: carriedAvg,
          totalValue: carriedAvg.times(qty),
          referenceType: dto.sourceType ?? null,
          referenceId: dto.sourceId ?? null,
          notes: dto.notes ?? null,
          performedBy: this.tenant.userId ?? null,
        },
      });

      // GL effect: Dr Stock Valuation (destination) / Cr Stock Valuation (source).
      // Uses configurable posting rules so inter-branch transfers can be routed
      // through clearing accounts. Same-unit transfers are a wash at the org level
      // but still produce audit entries.
      const carriedValue = carriedAvg.times(qty);
      if (carriedValue.gt(ZERO)) {
        await this.stockPosting.postTransfer({
          productId: dto.productId,
          totalValue: carriedValue,
          fromLocationId: dto.fromLocationId,
          toLocationId: dto.toLocationId,
          date: new Date(),
          sourceType: dto.sourceType ?? 'stock_transfer',
          sourceId: dto.sourceId ?? ledgerCode,
          description: `Stock transfer · ${product.name} · ${dto.quantity}`,
          tx,
        });
      }

      this.events.publish('stock.transferred', {
        organizationId,
        productId: dto.productId,
        locationId: dto.toLocationId,
        ledgerCode,
        quantity: String(dto.quantity),
      });

      await this.audit.recordInTx(tx, {
        entity: 'StockItem',
        entityId: fromItem.id,
        action: 'transfer',
        newValues: { productId: dto.productId, fromLocationId: dto.fromLocationId, toLocationId: dto.toLocationId, quantity: dto.quantity, ledgerCode },
      });

      return { ledgerCode, quantity: dto.quantity, fromLocationId: dto.fromLocationId, toLocationId: dto.toLocationId };
    };
    // 20s (vs Prisma's 5s default): these paths can wait on the per-quant AVCO
    // advisory lock under contention, and a receipt/transfer must not fail just
    // because another movement on the same quant is mid-flight.
    return externalTx ? run(externalTx) : this.prisma.client.$transaction(run, { timeout: 20_000 });
  }
}