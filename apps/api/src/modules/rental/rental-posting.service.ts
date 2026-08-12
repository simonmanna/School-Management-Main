import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { StockService } from '../inventory/stock.service';
import { PosInvoiceService } from '../pos/billing/pos-invoice.service';
import { RentalLocationConfigService } from './rental-location-config.service';
import { SettingResolverService } from '../../kernel/settings/setting-resolver.service';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';
import type { RentalFeeType } from '@prisma/client';

/**
 * RentalPostingService — the stock + invoice mechanics of a rental.
 *
 * Checkout moves each rented unit RENT-STOCK → RENT-OUT via a plain internal
 * transfer (no COGS, no revenue, no ATP reserve — the availability calendar is
 * the reservation). Return moves RENT-OUT → RENT-CLEAN (or RENT-REPAIR /
 * RENT-DAMAGED by disposition) and back to RENT-STOCK after inspection.
 *
 * Fees (rental income, extension, late, damage, missing) ride the standard POS
 * invoice spine so the drawer, GL and COA mapping stay untouched: one Order per
 * billing event, one Invoice, regular OrderItems tagged with rentalAgreementLineId.
 */
@Injectable()
export class RentalPostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SequenceService,
    private readonly stock: StockService,
    private readonly locations: RentalLocationConfigService,
    private readonly posInvoice: PosInvoiceService,
    private readonly settings: SettingResolverService,
    private readonly modules: ModuleRegistry,
  ) {}

  /**
   * Checkout transfer for one agreement line. Serialized units transfer their
   * inventory serial; pooled products transfer count. RENT-STOCK → RENT-OUT.
   */
  async checkoutTransfer(tx: any, orgId: string, line: any) {
    const { stockLocId, outLocId } = await this.locationIds(tx, orgId);
    const quantity = Number(line.quantity) || 1;
    if (quantity <= 0) throw new BadRequestException('Line quantity must be positive');

    await this.stock.transfer(
      {
        productId: line.productId,
        fromLocationId: stockLocId,
        toLocationId: outLocId,
        quantity,
        sourceType: 'rental_checkout',
        sourceId: line.agreementId,
        notes: `Rental checkout ${line.agreementId}`,
      },
      tx,
    );
  }

  /**
   * Return transfer: RENT-OUT → destination by disposition. `unitId` is not
   * needed by the stock layer (it tracks quantity); the unit's own status
   * transition happens in the return service.
   */
  async returnTransfer(
    tx: any,
    orgId: string,
    agreementId: string,
    productId: string,
    quantity: number,
    disposition: 'returned' | 'damaged' | 'repair' | 'missing',
  ) {
    const { outLocId } = await this.locationIds(tx, orgId);
    const destRole =
      disposition === 'damaged' ? 'damaged' : disposition === 'repair' ? 'repair' : 'cleaning';
    const destLocId = await this.locations.resolveInTx(tx, orgId, destRole);

    await this.stock.transfer(
      {
        productId,
        fromLocationId: outLocId,
        toLocationId: destLocId,
        quantity,
        sourceType: 'rental_return',
        sourceId: agreementId,
        notes: `Rental return (${disposition}) ${agreementId}`,
      },
      tx,
    );
  }

  /**
   * Cleaning complete: RENT-CLEAN → RENT-STOCK. Called from inspection.
   */
  async cleaningCompleteTransfer(tx: any, orgId: string, agreementId: string, productId: string, quantity: number) {
    const { stockLocId } = await this.locationIds(tx, orgId);
    const cleanLocId = await this.locations.resolveInTx(tx, orgId, 'cleaning');
    await this.stock.transfer(
      {
        productId,
        fromLocationId: cleanLocId,
        toLocationId: stockLocId,
        quantity,
        sourceType: 'rental_inspect',
        sourceId: agreementId,
        notes: `Rental inspection passed ${agreementId}`,
      },
      tx,
    );
  }

  /**
   * Create the fee order + invoice. `lines` are {productId, description,
   * quantity, unitPrice, rentalFeeType?, taxId?, incomeAccountId?} — the
   * incomeAccountId override maps the fee line to its GL account
   * (rental_income / late_fee / damage_recovery).
   *
   * Returns { orderId, invoiceId, order, invoice }.
   */
  async createFeeInvoice(
    tx: any,
    orgId: string,
    input: {
      agreementId: string;
      partnerId: string;
      branchId?: string;
      feeType: RentalFeeType;
      lines: Array<{
        productId: string;
        description?: string;
        quantity?: number;
        unitPrice: number;
        rentalFeeType?: RentalFeeType;
        taxId?: string | null;
        incomeAccountId?: string | null;
      }>;
      paymentMode?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';
      tenders?: Array<{ method: string; amount: number; reference?: string }>;
      occurredAt?: string;
    },
  ) {
    return this.buildFeeInvoice(tx, orgId, input);
  }

  /** Checkout alias — one order + one invoice covering the whole agreement. */
  async checkoutInvoice(tx: any, orgId: string, agreement: any) {
    const feeProduct = await tx.product.findFirst({
      where: { organizationId: orgId, code: 'RENT-FEE', isActive: true },
    });
    const lines = (agreement.lines ?? []).map((l: any) => ({
      productId: feeProduct?.id ?? l.productId,
      description: `Rental ${l.ratePeriod} — ${agreement.agreementNumber}`,
      quantity: l.quantity ?? 1,
      unitPrice: Number(l.lineTotal) / (Number(l.quantity) || 1),
      rentalFeeType: 'rental' as RentalFeeType,
    }));
    return this.buildFeeInvoice(tx, orgId, {
      agreementId: agreement.id,
      partnerId: agreement.partnerId,
      branchId: agreement.branchId ?? undefined,
      feeType: 'rental',
      lines,
    });
  }

  private async buildFeeInvoice(
    tx: any,
    orgId: string,
    input: {
      agreementId: string;
      partnerId: string;
      branchId?: string;
      feeType: RentalFeeType;
      lines: Array<{
        productId: string;
        description?: string;
        quantity?: number;
        unitPrice: number;
        rentalFeeType?: RentalFeeType;
        taxId?: string | null;
        incomeAccountId?: string | null;
      }>;
      paymentMode?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';
      tenders?: Array<{ method: string; amount: number; reference?: string }>;
      occurredAt?: string;
    },
  ) {
    this.modules.assertKnownOrderKind('rental'); // Phase D: validated against the registry, not a shared enum.
    const orderNumber = await this.seq.next('pos_order', { prefix: 'OR-', padding: 6 }, tx);
    const order = await tx.order.create({
      data: {
        organizationId: orgId,
        orderNumber,
        orderType: 'takeaway',
        status: 'confirmed',
        partnerId: input.partnerId,
        branchId: input.branchId ?? null,
        notes: `Rental ${input.feeType} — agreement ${input.agreementId}`,
        // Rental marker on the order header. Polymorphic source document
        // (Phase D) + the deprecated `rentalAgreementId`, dual-written for one
        // release.
        transactionKind: 'rental',
        sourceDocumentType: 'rental_agreement',
        sourceDocumentId: input.agreementId,
        rentalAgreementId: input.agreementId,
        items: {
          create: input.lines.map((l, idx) => ({
            organizationId: orgId,
            productId: l.productId,
            description: l.description ?? `Rental ${input.feeType}`,
            quantity: l.quantity ?? 1,
            unitPrice: l.unitPrice,
            discountPercent: 0,
            discountType: 'percentage',
            discountAmount: 0,
            taxId: l.taxId ?? null,
            taxInclusive: false,
            lineNumber: idx,
            rentalFeeType: l.rentalFeeType ?? input.feeType,
            rentalAgreementLineId: null,
          })),
        },
      },
    });

    const invoice = await this.posInvoice.generateInvoice(order.id, {
      paymentMode: input.paymentMode ?? 'cash',
      occurredAt: input.occurredAt,
    }, tx);

    // Apply income-account overrides (fee → its GL account) after the invoice
    // spine resolved defaults. The spine keeps product-based accounts for
    // ordinary lines; rental fee products carry an incomeAccountId themselves
    // (seeded), so this is only a defensive backstop.
    for (const l of input.lines) {
      if (l.incomeAccountId) {
        await tx.invoiceLine.updateMany({
          where: { invoiceId: invoice.id, productId: l.productId, unitPrice: l.unitPrice },
          data: { accountId: l.incomeAccountId },
        });
      }
    }

    return { orderId: order.id, invoiceId: invoice.id, order, invoice };
  }

  /**
   * Record payment tenders against the fee invoice (settlement flow).
   */
  async receivePayment(
    invoiceId: string,
    dto: {
      tenders?: Array<{ method: string; amount: number; reference?: string }>;
      paymentMethod?: string;
      amountTendered?: number;
      cashSessionId?: string;
    },
  ) {
    return this.posInvoice.receivePayment(invoiceId, {
      tenders: dto.tenders?.map((t) => ({
        method: t.method as any,
        amount: t.amount,
        reference: t.reference,
      })),
      paymentMethod: dto.paymentMethod as any,
      amountTendered: dto.amountTendered,
      cashSessionId: dto.cashSessionId,
    });
  }

  private async locationIds(tx: any, orgId: string) {
    const stockLocId = await this.locations.resolveInTx(tx, orgId, 'stock');
    const outLocId = await this.locations.resolveInTx(tx, orgId, 'out');
    return { stockLocId, outLocId };
  }
}
