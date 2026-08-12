/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, sum, ZERO } from '../../../kernel/common/money';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { TaxCalculationService } from '../tax/tax-calculation.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import { DmsTypeResolver } from '../../documents/dms-type-resolver.service';

export interface DocumentLineInput {
  productId?: string;
  /** Menu-based sale: the MenuItem this line represents (stored for recipe stock + reports). */
  menuItemId?: string;
  variantId?: string;
  variantName?: string;
  accountId?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  discountPercent?: number;
  /** 'percentage' (default) or 'fixed_amount'. When 'fixed_amount', `discountAmount` is the total line discount in currency. */
  discountType?: 'percentage' | 'fixed_amount';
  /** Total fixed discount for this line (in currency, before quantity multiplication). Ignored unless discountType === 'fixed_amount'. */
  discountAmount?: number;
  discountReason?: string;
  discountSource?: 'manual' | 'promotion' | 'loyalty' | 'coupon';
  taxId?: string;
  /** Odoo-style line: 'product' (default) | 'section' | 'note'. */
  lineType?: string;
  /**
   * P10: when true, the line's `unitPrice` is tax-inclusive. The tax engine
   * splits it as net = unitPrice / (1 + rate) and tax = unitPrice - net.
   * Overrides the Tax row's isInclusive flag for this line only.
   */
  taxInclusive?: boolean;
}

export interface DocumentHeaderInput {
  partnerId: string;
  issueDate: string;
  dueDate?: string;
  /** Payment term id (loose ref to core PaymentTerm master). */
  paymentTermId?: string | null;
  /** Snapshot of the term name for history display after rename/archive. */
  paymentTermName?: string | null;
  /** Payment method intent (how the sale will be settled). */
  paymentMode?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';
  /** Fiscal position (loose ref to core FiscalPosition master) + name snapshot. */
  fiscalPositionId?: string | null;
  fiscalPositionName?: string | null;
  /** Invoicing journal (loose ref to Journal master) + name snapshot. */
  invoicingJournalId?: string | null;
  invoicingJournalName?: string | null;
  /** Salesperson on the sale (loose ref to HrEmployee) + name snapshot. */
  salespersonId?: string | null;
  salespersonName?: string | null;
  /** Delivery intent (Odoo Other Info). */
  deliveryDate?: string;
  deliveryAddress?: string | null;
  incoterm?: string | null;
  incotermLocation?: string | null;
  sourceDocument?: string | null;
  currencyId?: string;
  exchangeRate?: number;
  reference?: string;
  notes?: string;
  reversedDocumentId?: string;
  /** Origin of the document (e.g. 'pos'). Tags sales for source-scoped reports. */
  sourceType?: string;
  /** Branch the document belongs to. */
  branchId?: string;
}

interface PreparedLine {
  productId: string | null;
  menuItemId: string | null;
  variantId: string | null;
  variantName: string | null;
  accountId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountPercent: Prisma.Decimal;
  /** 'percentage' or 'fixed_amount'. Persisted so receipts can display the original discount type. */
  discountType: 'percentage' | 'fixed_amount';
  /** Monetary discount amount for this line (0 for percentage discounts). */
  discountAmount: Prisma.Decimal;
  discountReason: string | null;
  discountSource: 'manual' | 'promotion' | 'loyalty' | 'coupon';
  taxId: string | null;
  lineType: string;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  lineNumber: number;
  /** P10: whether the line is tax-inclusive (for receipt badge). */
  taxInclusive: boolean;
}

/**
 * Shared document logic for invoices & credit notes (ADR-010): the SERVER
 * computes line subtotals/tax/totals (never trust the client) and resolves the
 * accounts each line will post to.
 */
@Injectable()
export class DocumentBuilderService {
  constructor(
    private readonly dmsTypes: DmsTypeResolver,
    private readonly tenant: TenantContextService,
    private readonly sequence: SequenceService,
    private readonly tax: TaxCalculationService,
    private readonly determination: AccountDeterminationService,
  ) {}

  async prepareLines(client: any, lines: DocumentLineInput[]) {
    const prepared: PreparedLine[] = [];
    let discountTotal = ZERO;

    for (const [i, l] of lines.entries()) {
      const lineType = l.lineType ?? 'product';
      const isMeta = lineType !== 'product';
      let product: any = null;
      if (l.productId && !isMeta) {
        product = await client.product.findFirst({ where: { id: l.productId }, include: { category: true } });
      }
      const unitPrice = isMeta ? ZERO : l.unitPrice != null ? dec(l.unitPrice) : product?.salesPrice ? dec(product.salesPrice) : ZERO;
      const quantity = isMeta ? ZERO : dec(l.quantity ?? 1);
      const gross = quantity.times(unitPrice);
      const discType = l.discountType ?? 'percentage';

      // Compute effective discount: fixed_amount uses discountAmount, percentage uses discountPercent.
      const effectiveDiscount = discType === 'fixed_amount' && (l.discountAmount ?? 0) > 0
        ? dec(Math.min(l.discountAmount!, Number(gross)))
        : gross.times(dec(l.discountPercent ?? 0).dividedBy(100));

      const afterDiscount = gross.minus(effectiveDiscount);
      discountTotal = discountTotal.plus(effectiveDiscount);

      // Derive effective discountPercent for backward compat with existing consumers.
      const effectivePct = gross.greaterThan(0)
        ? effectiveDiscount.dividedBy(gross).times(100)
        : dec(0);

      const discountReason = l.discountReason ?? null;
      const discountSource = l.discountSource ?? 'manual';

      const taxId = isMeta ? null : (l.taxId ?? product?.taxId ?? null);
      let taxRow: any = null;
      if (taxId) taxRow = await client.tax.findFirst({ where: { id: taxId } });
      // P10: per-line taxInclusive override wins over product/tax default.
      // Falls back to product.taxInclusive (if set), then Tax.isInclusive.
      const taxInclusive = l.taxInclusive
        ?? (product as any)?.taxInclusive
        ?? (taxRow ? !!taxRow.isInclusive : false);
      const result = this.tax.computeLine(
        afterDiscount,
        taxRow
          ? [{ id: taxRow.id, rate: taxRow.rate, isInclusive: taxInclusive, isCompound: taxRow.isCompound, type: taxRow.type }]
          : [],
      );

      prepared.push({
        productId: l.productId ?? null,
        menuItemId: l.menuItemId ?? null,
        variantId: l.variantId ?? null,
        variantName: l.variantName ?? null,
        accountId: l.accountId ?? null,
        description: l.description ?? product?.name ?? 'Item',
        quantity,
        unitPrice,
        discountPercent: effectivePct,
        discountType: discType,
        discountAmount: effectiveDiscount,
        discountReason,
        discountSource,
        taxId,
        lineType,
        subtotal: result.net,
        taxAmount: result.taxTotal,
        total: result.gross,
        lineNumber: i + 1,
        taxInclusive,
      });
    }

    const subtotal = sum(prepared.map((p) => p.subtotal));
    const taxAmount = sum(prepared.map((p) => p.taxAmount));
    return { prepared, subtotal, taxAmount, total: subtotal.plus(taxAmount), discountTotal };
  }

  async createDocument(
    client: any,
    documentType: 'sales_invoice' | 'credit_note' | 'vendor_bill',
    header: DocumentHeaderInput,
    lines: DocumentLineInput[],
  ) {
    const organizationId = this.tenant.organizationId;
    const totals = await this.prepareLines(client, lines);
    const year = new Date(header.issueDate).getUTCFullYear();
    const numbering: Record<string, { key: string; prefix: string }> = {
      sales_invoice: { key: `invoice:${year}`, prefix: `INV-${year}-` },
      credit_note: { key: `creditnote:${year}`, prefix: `CN-${year}-` },
      vendor_bill: { key: `vendorbill:${year}`, prefix: `BILL-${year}-` },
    };
    const seq = numbering[documentType];
    const documentNumber = await this.sequence.next(seq.key, { prefix: seq.prefix, padding: 6 }, client);

    return client.document.create({
      data: {
        organizationId,
        documentNumber,
        documentType,
        documentTypeId: await this.dmsTypes.resolveIdByCode(documentType, client),
        partnerId: header.partnerId,
        currencyId: header.currencyId ?? null,
        exchangeRate: dec(header.exchangeRate ?? 1),
        issueDate: new Date(header.issueDate),
        dueDate: header.dueDate ? new Date(header.dueDate) : null,
        paymentTermId: header.paymentTermId ?? null,
        paymentTermName: header.paymentTermName ?? null,
        paymentMode: (header.paymentMode as any) ?? null,
        fiscalPositionId: header.fiscalPositionId ?? null,
        fiscalPositionName: header.fiscalPositionName ?? null,
        invoicingJournalId: header.invoicingJournalId ?? null,
        invoicingJournalName: header.invoicingJournalName ?? null,
        salespersonId: header.salespersonId ?? null,
        salespersonName: header.salespersonName ?? null,
        deliveryDate: header.deliveryDate ? new Date(header.deliveryDate) : null,
        deliveryAddress: header.deliveryAddress ?? null,
        incoterm: header.incoterm ?? null,
        incotermLocation: header.incotermLocation ?? null,
        sourceDocument: header.sourceDocument ?? null,
        status: 'draft',
        reference: header.reference ?? null,
        notes: header.notes ?? null,
        reversedDocumentId: header.reversedDocumentId ?? null,
        sourceType: header.sourceType ?? null,
        branchId: header.branchId ?? null,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.total,
        amountResidual: totals.total,
        amountPaid: ZERO,
        paymentStatus: 'not_paid',
        lines: {
          create: totals.prepared.map((p) => ({
            organizationId,
            productId: p.productId,
            menuItemId: p.menuItemId,
            accountId: p.accountId,
            description: p.description,
            quantity: p.quantity,
            unitPrice: p.unitPrice,
            discountPercent: p.discountPercent,
            taxId: p.taxId,
            subtotal: p.subtotal,
            taxAmount: p.taxAmount,
            total: p.total,
            lineNumber: p.lineNumber,
            lineType: p.lineType,
            // P10: taxInclusive persisted on the line so receipts can
            // render "(incl. tax)" without re-deriving it.
            taxInclusive: p.taxInclusive,
          })),
        },
      },
      include: { lines: true, partner: true },
    });
  }

  /**
   * Resolve the counter account (AR for sales, AP for purchase) plus the
   * income/expense and tax accounts (grouped) for a document.
   *
   * `grniAccountId` (purchase only): stockable lines are routed to GRNI-Accrued
   * rather than an expense account, so posting the bill DEBITS the accrual the
   * stock receipt credited — clearing it to AP instead of double-counting the
   * purchase into both Inventory and Expense. Non-stockable lines (services,
   * opex) still go to expense. Omit the argument to send everything to expense.
   */
  async groupForPosting(client: any, doc: any, kind: 'sales' | 'purchase' = 'sales', grniAccountId?: string) {
    const partner = await client.partner.findFirst({ where: { id: doc.partnerId } });
    const counterAccount =
      kind === 'sales'
        ? await this.determination.receivableAccount(partner, client)
        : await this.determination.payableAccount(partner, client);
    const itemByAccount = new Map<string, Prisma.Decimal>();
    const taxByAccount = new Map<string, Prisma.Decimal>();

    for (const line of doc.lines) {
      if ((line.lineType ?? 'product') !== 'product') continue;
      let category: any = null;
      let stockable = false;
      if (line.productId) {
        const p = await client.product.findFirst({ where: { id: line.productId }, include: { category: true } });
        category = p?.category ?? null;
        stockable = Boolean(p?.trackInventory);
      }
      const itemAcc =
        kind === 'sales'
          ? await this.determination.incomeAccount({ lineAccountId: line.accountId, category }, client)
          : stockable && grniAccountId
            ? grniAccountId
            : await this.determination.expenseAccount({ lineAccountId: line.accountId, category }, client);
      itemByAccount.set(itemAcc, (itemByAccount.get(itemAcc) ?? ZERO).plus(line.subtotal));

      if (line.taxId && !(line.taxAmount as Prisma.Decimal).isZero()) {
        const tax = await client.tax.findFirst({ where: { id: line.taxId } });
        // Withholding is not output tax — never book it to tax_payable/receivable
        // here. (Its taxAmount is already 0 via the engine; this is defence-in-depth.)
        if (tax && tax.type !== 'withholding') {
          const taxAcc = await this.determination.taxAccount(
            tax,
            client,
            kind === 'sales' ? 'tax_payable' : 'tax_receivable',
          );
          taxByAccount.set(taxAcc, (taxByAccount.get(taxAcc) ?? ZERO).plus(line.taxAmount));
        }
      }
    }

    return { counterAccount, itemByAccount, taxByAccount };
  }
}