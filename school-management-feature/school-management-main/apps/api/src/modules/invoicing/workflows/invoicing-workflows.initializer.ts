import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import type { WorkflowDefinition } from '@erp/shared';
import { WorkflowRegistry } from '../../../kernel/workflow/workflow.registry';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { StockService } from '../../inventory/stock.service';
import { DocumentBuilderService } from '../document/document-builder.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';

/**
 * Registers the workflows for invoicing-side documents (ADR-007): invoice,
 * credit note, vendor bill, payment. Each module owns its workflows so the
 * kernel layer stays free of business dependencies.
 */
@Injectable()
export class InvoicingWorkflowsInitializer implements OnModuleInit {
  private readonly logger = new Logger('InvoicingWorkflows');

  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly stock: StockService,
    private readonly builder: DocumentBuilderService,
    private readonly determination: AccountDeterminationService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.invoiceWorkflow());
    this.registry.register(this.creditNoteWorkflow());
    this.registry.register(this.vendorBillWorkflow());
    this.registry.register(this.paymentWorkflow());
  }

  // ───────────────────── invoice ─────────────────────
  private invoiceWorkflow(): WorkflowDefinition {
    return {
      documentType: 'invoice',
      initial: 'draft',
      transitions: [
        {
          from: 'draft', to: 'posted', action: 'post',
          permission: 'invoice:post',
          guard: (ctx) => {
            const doc = ctx.entity as any;
            if (doc?.status === 'posted' || doc?.status === 'paid') return false;
            if (doc?.status === 'cancelled') return false;
            return true;
          },
          sideEffect: async (ctx, tx) => {
            const doc = ctx.entity as any;
            const productIds = (doc.lines ?? []).map((l: any) => l.productId).filter(Boolean);
            const products = await tx.product.findMany({
              where: { id: { in: productIds } },
              include: { category: true },
            });
            const productById = new Map(products.map((p: any) => [p.id, p]));
            for (const line of doc.lines ?? []) {
              const product: any = line.productId ? productById.get(line.productId) : null;
              if (product?.trackInventory && line.productId) {
                const location = await tx.inventoryLocation.findFirst({
                  where: { organizationId: ctx.organizationId, type: 'warehouse', isActive: true },
                  orderBy: { createdAt: 'asc' },
                });
                if (!location) throw new Error(`No warehouse location for stockable line ${product.name}`);
                await this.stock.issue({
                  productId: line.productId,
                  locationId: location.id,
                  quantity: Number(line.quantity),
                  date: doc.issueDate.toISOString(),
                  sourceType: 'sales_invoice',
                  sourceId: doc.id,
                  notes: `Auto-issue for invoice ${doc.documentNumber}`,
                });
              }
            }
            const fullDoc = await tx.document.findFirst({ where: { id: doc.id }, include: { lines: true } });
            fullDoc.lines = fullDoc.lines.map((l: any) => ({ ...l, product: l.productId ? productById.get(l.productId) : null }));
            const { counterAccount, itemByAccount, taxByAccount } = await this.builder.groupForPosting(tx, fullDoc, 'sales');
            const lines: any[] = [
              { accountId: counterAccount, debit: fullDoc.totalAmount.toString(), partnerId: fullDoc.partnerId, description: `Invoice ${fullDoc.documentNumber}` },
            ];
            for (const [accountId, amount] of itemByAccount) {
              lines.push({ accountId, credit: amount.toString(), partnerId: fullDoc.partnerId, description: 'Revenue' });
            }
            for (const [accountId, amount] of taxByAccount) {
              lines.push({ accountId, credit: amount.toString(), description: 'Output tax' });
            }
            const entry = await this.posting.post({
              journalCode: 'SALES',
              date: fullDoc.issueDate,
              description: `Invoice ${fullDoc.documentNumber}`,
              currencyId: fullDoc.currencyId ?? undefined,
              exchangeRate: Number(fullDoc.exchangeRate),
              sourceType: 'invoice',
              sourceId: fullDoc.id,
              lines,
            }, tx);
            await tx.document.updateMany({
              where: { id: fullDoc.id },
              data: { journalEntryId: entry.id, amountResidual: fullDoc.totalAmount, paymentStatus: 'not_paid' },
            });
          },
        },
        {
          from: 'posted', to: 'cancelled', action: 'cancel',
          permission: 'invoice:cancel',
          guard: (ctx) => {
            const doc = ctx.entity as any;
            return !(Number(doc?.amountPaid) > 0);
          },
          sideEffect: async (ctx, tx) => {
            const doc = ctx.entity as any;
            if (doc.journalEntryId) {
              await this.posting.reverse(doc.journalEntryId, { description: `Cancellation of ${doc.documentNumber}` }, tx);
            }
            await tx.document.updateMany({
              where: { id: doc.id },
              data: { amountResidual: 0, paymentStatus: 'not_paid' },
            });
          },
        },
      ],
    };
  }

  // ───────────────────── credit note ─────────────────────
  private creditNoteWorkflow(): WorkflowDefinition {
    return {
      documentType: 'credit_note',
      initial: 'draft',
      transitions: [
        {
          from: 'draft', to: 'posted', action: 'post',
          permission: 'credit_note:post',
          sideEffect: async (ctx, tx) => {
            const doc = ctx.entity as any;
            const fullDoc = await tx.document.findFirst({ where: { id: doc.id }, include: { lines: true } });
            const { counterAccount, itemByAccount, taxByAccount } = await this.builder.groupForPosting(tx, fullDoc, 'sales');
            const lines: any[] = [
              { accountId: counterAccount, credit: fullDoc.totalAmount.toString(), partnerId: fullDoc.partnerId, description: `Credit note ${fullDoc.documentNumber}` },
            ];
            for (const [accountId, amount] of itemByAccount) {
              lines.push({ accountId, debit: amount.toString(), partnerId: fullDoc.partnerId, description: 'Revenue reversal' });
            }
            for (const [accountId, amount] of taxByAccount) {
              lines.push({ accountId, debit: amount.toString(), description: 'Output tax reversal' });
            }
            await this.posting.post({
              journalCode: 'SALES',
              date: fullDoc.issueDate,
              description: `Credit note ${fullDoc.documentNumber}`,
              currencyId: fullDoc.currencyId ?? undefined,
              exchangeRate: Number(fullDoc.exchangeRate),
              sourceType: 'credit_note',
              sourceId: fullDoc.id,
              lines,
            }, tx);
          },
        },
      ],
    };
  }

  // ───────────────────── vendor bill ─────────────────────
  private vendorBillWorkflow(): WorkflowDefinition {
    return {
      documentType: 'vendor_bill',
      initial: 'draft',
      transitions: [
        {
          from: 'draft', to: 'posted', action: 'post',
          permission: 'expense:post',
          sideEffect: async (ctx, tx) => {
            const doc = ctx.entity as any;
            const products = await tx.product.findMany({
              where: { id: { in: doc.lines.map((l: any) => l.productId).filter(Boolean) } },
            });
            const productById = new Map(products.map((p: any) => [p.id, p]));
            const fullDoc = await tx.document.findFirst({ where: { id: doc.id }, include: { lines: true } });
            fullDoc.lines = fullDoc.lines.map((l: any) => ({ ...l, product: l.productId ? productById.get(l.productId) : null }));
            const grniAccountId = await this.determination.mapped('grni_accrued', tx);
            const { counterAccount, itemByAccount, taxByAccount } = await this.builder.groupForPosting(tx, fullDoc, 'purchase', grniAccountId);
            const lines: any[] = [];
            for (const [accountId, amount] of itemByAccount) {
              lines.push({ accountId, debit: amount.toString(), partnerId: fullDoc.partnerId, description: accountId === grniAccountId ? 'GRNI clearing' : 'Expense' });
            }
            for (const [accountId, amount] of taxByAccount) {
              lines.push({ accountId, debit: amount.toString(), description: 'Input tax' });
            }
            lines.push({
              accountId: counterAccount,
              credit: fullDoc.totalAmount.toString(),
              partnerId: fullDoc.partnerId,
              description: `Bill ${fullDoc.documentNumber}`,
            });
            const entry = await this.posting.post({
              journalCode: 'PURCH',
              date: fullDoc.issueDate,
              description: `Bill ${fullDoc.documentNumber}`,
              currencyId: fullDoc.currencyId ?? undefined,
              exchangeRate: Number(fullDoc.exchangeRate),
              sourceType: 'vendor_bill',
              sourceId: fullDoc.id,
              lines,
            }, tx);

            for (const line of fullDoc.lines) {
              if (line.product?.trackInventory && line.productId) {
                const location = await tx.inventoryLocation.findFirst({
                  where: { organizationId: ctx.organizationId, type: 'warehouse', isActive: true },
                  orderBy: { createdAt: 'asc' },
                });
                if (!location) throw new Error(`No warehouse location for stockable line ${line.product.name}`);
                await this.stock.receiveFromBill({
                  productId: line.productId,
                  locationId: location.id,
                  quantity: Number(line.quantity),
                  unitCost: Number(line.product.costPrice ?? 0),
                  billId: fullDoc.id,
                  billDate: fullDoc.issueDate.toISOString(),
                  notes: `Auto-receive for bill ${fullDoc.documentNumber}`,
                });
              }
            }
            await tx.document.updateMany({
              where: { id: fullDoc.id },
              data: { journalEntryId: entry.id, amountResidual: fullDoc.totalAmount, paymentStatus: 'not_paid' },
            });
          },
        },
        {
          from: 'posted', to: 'cancelled', action: 'cancel',
          permission: 'expense:cancel',
          guard: (ctx) => !(Number((ctx.entity as any)?.amountPaid) > 0),
          sideEffect: async (ctx, tx) => {
            const doc = ctx.entity as any;
            if (doc.journalEntryId) {
              await this.posting.reverse(doc.journalEntryId, { description: `Void of ${doc.documentNumber}` }, tx);
            }
            await tx.document.updateMany({
              where: { id: doc.id },
              data: { amountResidual: 0, paymentStatus: 'not_paid' },
            });
          },
        },
      ],
    };
  }

  // ───────────────────── payment ─────────────────────
  private paymentWorkflow(): WorkflowDefinition {
    return {
      documentType: 'payment',
      initial: 'posted',
      transitions: [
        {
          from: 'posted', to: 'cancelled', action: 'void',
          permission: 'payment:void',
          sideEffect: async (ctx, tx) => {
            const payment = ctx.entity as any;
            if (payment.journalEntryId) {
              await this.posting.reverse(payment.journalEntryId, { description: `Void of ${payment.paymentNumber}` }, tx);
            }
            for (const alloc of payment.allocations ?? []) {
              const doc = await tx.document.findFirst({ where: { id: alloc.documentId } });
              if (doc) {
                const newPaid = (doc.amountPaid as any).minus(alloc.amount);
                const newResidual = (doc.amountResidual as any).plus(alloc.amount);
                const paymentStatus = newResidual.lessThanOrEqualTo(0) ? 'paid' : (newResidual.lessThan(doc.totalAmount) ? 'partial' : 'not_paid');
                const status = doc.status === 'paid' && newResidual.greaterThan(0) ? 'posted' : doc.status;
                await tx.document.updateMany({
                  where: { id: doc.id },
                  data: { amountPaid: newPaid, amountResidual: newResidual, paymentStatus, status },
                });
              }
              await tx.paymentAllocation.deleteMany({ where: { id: alloc.id } });
            }
            await tx.payment.updateMany({
              where: { id: payment.id },
              data: { allocatedAmount: 0, unallocatedAmount: 0 },
            });
          },
        },
      ],
    };
  }
}