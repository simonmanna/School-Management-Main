import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { dec, sum, ZERO } from '../../../kernel/common/money';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import { TaxCalculationService } from '../tax/tax-calculation.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface DocumentLineInput {
  productId?: string;
  accountId?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  discountPercent?: number;
  taxId?: string;
}

export interface DocumentHeaderInput {
  partnerId: string;
  issueDate: string;
  dueDate?: string;
  currencyId?: string;
  exchangeRate?: number;
  reference?: string;
  notes?: string;
  reversedDocumentId?: string;
}

interface PreparedLine {
  productId: string | null;
  accountId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountPercent: Prisma.Decimal;
  taxId: string | null;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  lineNumber: number;
}

/**
 * Shared document logic for invoices & credit notes (ADR-010): the SERVER
 * computes line subtotals/tax/totals (never trust the client) and resolves the
 * accounts each line will post to.
 */
@Injectable()
export class DocumentBuilderService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly sequence: SequenceService,
    private readonly tax: TaxCalculationService,
    private readonly determination: AccountDeterminationService,
  ) {}

  async prepareLines(client: any, lines: DocumentLineInput[]) {
    const prepared: PreparedLine[] = [];
    let discountTotal = ZERO;

    for (const [i, l] of lines.entries()) {
      let product: any = null;
      if (l.productId) {
        product = await client.product.findFirst({ where: { id: l.productId }, include: { category: true } });
      }
      const unitPrice = l.unitPrice != null ? dec(l.unitPrice) : product?.salesPrice ? dec(product.salesPrice) : ZERO;
      const quantity = dec(l.quantity ?? 1);
      const discountPercent = dec(l.discountPercent ?? 0);
      const gross = quantity.times(unitPrice);
      const afterDiscount = gross.times(dec(1).minus(discountPercent.dividedBy(100)));
      discountTotal = discountTotal.plus(gross.minus(afterDiscount));

      const taxId = l.taxId ?? product?.taxId ?? null;
      let tax: any = null;
      if (taxId) tax = await client.tax.findFirst({ where: { id: taxId } });
      const result = this.tax.computeLine(
        afterDiscount,
        tax ? [{ id: tax.id, rate: tax.rate, isInclusive: tax.isInclusive, isCompound: tax.isCompound }] : [],
      );

      prepared.push({
        productId: l.productId ?? null,
        accountId: l.accountId ?? null,
        description: l.description ?? product?.name ?? 'Item',
        quantity,
        unitPrice,
        discountPercent,
        taxId,
        subtotal: result.net,
        taxAmount: result.taxTotal,
        total: result.gross,
        lineNumber: i + 1,
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
        partnerId: header.partnerId,
        currencyId: header.currencyId ?? null,
        exchangeRate: dec(header.exchangeRate ?? 1),
        issueDate: new Date(header.issueDate),
        dueDate: header.dueDate ? new Date(header.dueDate) : null,
        status: 'draft',
        reference: header.reference ?? null,
        notes: header.notes ?? null,
        reversedDocumentId: header.reversedDocumentId ?? null,
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
   * If `stockableAccountId` is provided, lines whose product has
   * `trackInventory=true` will be grouped under that account (typically the
   * GRNI-Accrued account) instead of the product's expense/income account.
   * This is the GRNI pre-stage flow (M3): the bill post clears GRNI, and the
   * StockPostingService posts the mirror Dr Stock / Cr GRNI leg.
   */
  async groupForPosting(
    client: any,
    doc: any,
    kind: 'sales' | 'purchase' = 'sales',
    stockableAccountId?: string,
  ) {
    const partner = await client.partner.findFirst({ where: { id: doc.partnerId } });
    const counterAccount =
      kind === 'sales'
        ? await this.determination.receivableAccount(partner, client)
        : await this.determination.payableAccount(partner, client);
    const itemByAccount = new Map<string, Prisma.Decimal>();
    const taxByAccount = new Map<string, Prisma.Decimal>();

    for (const line of doc.lines) {
      let product: any = null;
      let category: any = null;
      if (line.productId) {
        product = await client.product.findFirst({ where: { id: line.productId }, include: { category: true } });
        category = product?.category ?? null;
      }

      // GRNI pre-stage: stockable purchase lines post to GRNI, not Expense.
      const isStockablePurchase = kind === 'purchase' && stockableAccountId && product?.trackInventory === true;
      const itemAcc = isStockablePurchase
        ? stockableAccountId
        : kind === 'sales'
          ? await this.determination.incomeAccount({ lineAccountId: line.accountId, category }, client)
          : await this.determination.expenseAccount({ lineAccountId: line.accountId, category }, client);
      itemByAccount.set(itemAcc, (itemByAccount.get(itemAcc) ?? ZERO).plus(line.subtotal));

      if (line.taxId && !(line.taxAmount as Prisma.Decimal).isZero()) {
        const tax = await client.tax.findFirst({ where: { id: line.taxId } });
        const taxAcc = await this.determination.taxAccount(
          tax,
          client,
          kind === 'sales' ? 'tax_payable' : 'tax_receivable',
        );
        taxByAccount.set(taxAcc, (taxByAccount.get(taxAcc) ?? ZERO).plus(line.taxAmount));
      }
    }

    return { counterAccount, itemByAccount, taxByAccount };
  }
}
