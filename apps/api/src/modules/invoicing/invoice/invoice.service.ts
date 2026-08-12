import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PaginationQuery } from '@erp/shared';
import { dec, ZERO } from '../../../kernel/common/money';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { WorkflowService } from '../../../kernel/workflow/workflow.service';
import { ApprovalsService } from '../../../kernel/approvals/approvals.service';
import { DocumentBuilderService } from '../document/document-builder.service';
import { PaymentTermService, computeDueDate } from '../../core/payment-term.service';
import { JournalService } from '../../accounting/journal/journal.service';
import { CreateInvoiceDto } from './dto/invoice.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly workflow: WorkflowService,
    private readonly builder: DocumentBuilderService,
    private readonly approvals: ApprovalsService,
    private readonly terms: PaymentTermService,
    private readonly journals: JournalService,
  ) {}

  async list(
    query: PaginationQuery,
    partnerId?: string,
    filters?: { status?: string; paymentStatus?: string; settlementStatus?: string; dateFrom?: string; dateTo?: string },
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));
    const search = query.search?.trim();
    const f = filters ?? {};

    const docWhere: any = { documentType: 'sales_invoice' };
    const invWhere: any = {};
    if (partnerId) {
      docWhere.partnerId = partnerId;
      invWhere.partnerId = partnerId;
    }
    if (f.status) {
      docWhere.status = f.status;
      invWhere.status = f.status;
    }
    if (f.dateFrom || f.dateTo) {
      const dateFilter: any = {};
      if (f.dateFrom) dateFilter.gte = new Date(f.dateFrom);
      if (f.dateTo) {
        const end = new Date(f.dateTo);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      docWhere.issueDate = dateFilter;
      invWhere.issueDate = dateFilter;
    }
    if (search) {
      const matchingPartners = await this.prisma.client.partner.findMany({
        where: { name: { contains: search, mode: 'insensitive' } },
        select: { id: true },
      });
      const pIds = matchingPartners.map((p: any) => p.id);

      const docOr: any[] = [
        { documentNumber: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
      if (pIds.length) docOr.push({ partnerId: { in: pIds } });
      docWhere.OR = docOr;

      const invOr: any[] = [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ];
      if (pIds.length) invOr.push({ partnerId: { in: pIds } });
      invWhere.OR = invOr;
    }

    const take = page * pageSize;
    const [docs, invs] = await Promise.all([
      this.prisma.client.document.findMany({
        where: docWhere,
        include: { partner: true, _count: { select: { lines: true } } },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.client.invoice.findMany({
        where: invWhere,
        include: { _count: { select: { items: true } } },
        orderBy: { createdAt: 'desc' },
        take,
      }),
    ]);

    const partnerIds = [...new Set((invs as any[]).map((i) => i.partnerId))];
    const partners = partnerIds.length
      ? await this.prisma.client.partner.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(partners.map((p: any) => [p.id, p.name]));

    const normInvs = (invs as any[]).map((i) => ({
      ...i,
      documentNumber: i.invoiceNumber,
      documentType: 'sales_invoice',
      source: 'pos',
      partner: { id: i.partnerId, name: nameById.get(i.partnerId) ?? 'Walk-in' },
      _count: { lines: i._count?.items ?? 0 },
    }));
    const normDocs = (docs as any[]).map((d) => ({
      ...d,
      source: 'manual',
      paymentStatus: d.amountResidual === '0' ? 'paid' : 'unpaid',
      settlementStatus: d.amountResidual === '0' ? 'settled' : 'unsettled',
    }));

    let merged = [...normDocs, ...normInvs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    if (f.paymentStatus) merged = merged.filter((m: any) => m.paymentStatus === f.paymentStatus);
    if (f.settlementStatus) merged = merged.filter((m: any) => m.settlementStatus === f.settlementStatus);

    const total = merged.length;
    const start = (page - 1) * pageSize;
    const data = merged.slice(start, start + pageSize);
    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async findOne(id: string) {
    const doc = await this.prisma.client.document.findFirst({
      where: { id, documentType: 'sales_invoice' },
      include: { partner: true, allocations: { include: { payment: true } } },
    });
    if (doc) {
      // Lines joined with the resolved GL account (Odoo-style Account column) and
      // the tax row (loose ref → second pass lookup).
      const rawLines = await this.prisma.client.documentLine.findMany({
        where: { documentId: doc.id },
        orderBy: { lineNumber: 'asc' },
        include: { account: { select: { id: true, code: true, name: true } } },
      });
      const taxIds = [...new Set(rawLines.map((l: any) => l.taxId).filter(Boolean))] as string[];
      const taxes = taxIds.length
        ? await this.prisma.client.tax.findMany({
            where: { id: { in: taxIds } },
            select: { id: true, name: true, rate: true },
          })
        : [];
      const taxMap = new Map(taxes.map((t) => [t.id, t]));
      const lines = rawLines.map((l: any) => ({ ...l, tax: l.taxId ? (taxMap.get(l.taxId) ?? null) : null }));
      return { ...doc, lines };
    }

    // POS sale — lives in the separate Invoice table. Normalise to the Document
    // shape the detail page expects (documentNumber, partner, lines).
    const inv = await this.prisma.client.invoice.findFirst({
      where: { id },
      include: { items: { orderBy: { lineNumber: 'asc' } }, allocations: { include: { payment: true } } },
    });
    if (!inv) return null;
    const partner = await this.prisma.client.partner.findFirst({
      where: { id: (inv as any).partnerId },
      select: { id: true, name: true },
    });
    return {
      ...inv,
      documentNumber: (inv as any).invoiceNumber,
      documentType: 'sales_invoice',
      source: 'pos',
      partner,
      lines: (inv as any).items,
    };
  }

  async create(dto: CreateInvoiceDto) {
    const [term, names] = await Promise.all([this.resolveTerm(dto), this.resolveNames(dto)]);
    const doc = await this.builder.createDocument(
      this.prisma.client,
      'sales_invoice',
      { ...dto, paymentMode: (dto.paymentMode as any) ?? null, ...term, ...names },
      dto.lines,
    );
    this.events.publish('invoice.created', {
      organizationId: this.tenant.organizationId,
      documentId: doc.id,
      documentNumber: doc.documentNumber,
    });
    return doc;
  }

  /**
   * Read-only preview of the journal entry the invoice will generate when
   * posted — the exact same account resolution + line construction as the
   * posting workflow side-effect (invoicing-workflows.initializer), but with
   * NOTHING written. Powers the "Journal Entry" tab on the /invoices/new form.
   *
   * The journal resolves through {@link JournalService.resolveSalesJournal}:
   * the form's Invoicing Journal → the org "Default Sales Journal" setting →
   * legacy `SALES` code → first active sales-type journal.
   */
  async previewJournal(dto: CreateInvoiceDto) {
    const totals = await this.builder.prepareLines(this.prisma.client, dto.lines);
    const fakeDoc: any = {
      id: 'preview',
      partnerId: dto.partnerId,
      issueDate: new Date(dto.issueDate),
      currencyId: dto.currencyId ?? null,
      exchangeRate: dto.exchangeRate ?? 1,
      documentNumber: '(draft)',
      lines: totals.prepared,
      totalAmount: totals.total,
    };

    const { counterAccount, itemByAccount, taxByAccount } = await this.builder.groupForPosting(
      this.prisma.client,
      fakeDoc,
      'sales',
    );
    const journal = await this.journals.resolveSalesJournal(this.prisma.client, dto.invoicingJournalId);

    const rawLines: any[] = [
      {
        accountId: counterAccount,
        debit: totals.total,
        partnerId: dto.partnerId,
        description: `Invoice (draft)`,
      },
    ];
    for (const [accountId, amount] of itemByAccount) {
      rawLines.push({ accountId, credit: amount, partnerId: dto.partnerId, description: 'Revenue' });
    }
    for (const [accountId, amount] of taxByAccount) {
      rawLines.push({ accountId, credit: amount, description: 'Output tax' });
    }

    const accountIds = [...new Set(rawLines.map((l) => l.accountId))];
    const accounts = await this.prisma.client.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, code: true, name: true },
    });
    const accountById = new Map(accounts.map((a: any) => [a.id, a]));
    const partner = await this.prisma.client.partner.findFirst({
      where: { id: dto.partnerId },
      select: { name: true },
    });

    let debitTotal = ZERO;
    let creditTotal = ZERO;
    const lines = rawLines.map((l, i) => {
      const account = accountById.get(l.accountId);
      debitTotal = debitTotal.plus(l.debit ?? ZERO);
      creditTotal = creditTotal.plus(l.credit ?? ZERO);
      return {
        lineNumber: i + 1,
        account: account ? { id: account.id, code: account.code, name: account.name } : null,
        partnerName: l.partnerId ? (partner?.name ?? null) : null,
        description: l.description ?? null,
        debit: l.debit ? l.debit.toString() : null,
        credit: l.credit ? l.credit.toString() : null,
      };
    });

    return {
      journal: {
        id: journal.id,
        code: journal.code,
        name: journal.name,
        journalType: journal.journalType,
      },
      postingDate: dto.issueDate,
      description: `Invoice (draft) — posted automatically to ${journal.name} on "Save & Post"`,
      lines,
      debitTotal: debitTotal.toString(),
      creditTotal: creditTotal.toString(),
      balanced: debitTotal.minus(creditTotal).abs().lessThan(0.01),
    };
  }

  /**
   * Resolve a payment term into its id + name snapshot, deriving the due date
   * from the term's method when the caller didn't pass an explicit one. A
   * missing/archived term id never blocks the sale — it just leaves the term null.
   */
  private async resolveTerm(dto: Pick<CreateInvoiceDto, 'paymentTermId' | 'dueDate' | 'issueDate'>) {
    const paymentTermId = dto.paymentTermId || null;
    let dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    let paymentTermName: string | null = null;
    if (paymentTermId) {
      const term = await this.terms.get(paymentTermId).catch(() => null);
      if (term) {
        paymentTermName = term.name;
        if (!dueDate) dueDate = computeDueDate(term.method, term.netDays, new Date(dto.issueDate));
      }
    }
    return {
      paymentTermId,
      paymentTermName,
      dueDate: dueDate ? dueDate.toISOString() : undefined,
    };
  }

  /**
   * Resolve the referenced masters into display-name snapshots so invoice
   * history survives a later rename/archive of the master rows. A missing id
   * never blocks the sale — it just leaves the snapshot null.
   */
  private async resolveNames(dto: Pick<CreateInvoiceDto, 'fiscalPositionId' | 'invoicingJournalId' | 'salespersonId'>) {
    let fiscalPositionName: string | null = null;
    let invoicingJournalName: string | null = null;
    let salespersonName: string | null = null;
    if (dto.fiscalPositionId) {
      const p = await this.prisma.client.fiscalPosition.findFirst({
        where: { id: dto.fiscalPositionId },
        select: { name: true },
      });
      fiscalPositionName = p?.name ?? null;
    }
    if (dto.invoicingJournalId) {
      const j = await this.prisma.client.journal.findFirst({
        where: { id: dto.invoicingJournalId },
        select: { name: true },
      });
      invoicingJournalName = j?.name ?? null;
    }
    if (dto.salespersonId) {
      const e = await this.prisma.client.hrEmployee.findFirst({
        where: { id: dto.salespersonId },
        select: { firstName: true, lastName: true },
      });
      if (e) salespersonName = [e.firstName, e.lastName].filter(Boolean).join(' ');
    }
    return { fiscalPositionName, invoicingJournalName, salespersonName };
  }

  async update(id: string, dto: CreateInvoiceDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const doc = await tx.document.findFirst({ where: { id, documentType: 'sales_invoice' } });
      if (!doc) throw new NotFoundException('Invoice not found');
      if (doc.status !== 'draft') throw new BadRequestException('Only draft invoices can be edited');

      await tx.documentLine.deleteMany({ where: { documentId: id } });
      const totals = await this.builder.prepareLines(tx, dto.lines);
      const organizationId = this.tenant.organizationId;
      const term = await this.resolveTerm(dto);
      const names = await this.resolveNames(dto);

      await tx.document.updateMany({
        where: { id },
        data: {
          partnerId: dto.partnerId,
          issueDate: new Date(dto.issueDate),
          dueDate: term.dueDate ? new Date(term.dueDate) : null,
          paymentTermId: term.paymentTermId,
          paymentTermName: term.paymentTermName,
          paymentMode: (dto.paymentMode as any) ?? null,
          fiscalPositionId: dto.fiscalPositionId ?? null,
          fiscalPositionName: names.fiscalPositionName,
          invoicingJournalId: dto.invoicingJournalId ?? null,
          invoicingJournalName: names.invoicingJournalName,
          salespersonId: dto.salespersonId ?? null,
          salespersonName: names.salespersonName,
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          deliveryAddress: dto.deliveryAddress ?? null,
          incoterm: dto.incoterm ?? null,
          incotermLocation: dto.incotermLocation ?? null,
          sourceDocument: dto.sourceDocument ?? null,
          currencyId: dto.currencyId ?? null,
          exchangeRate: dec(dto.exchangeRate ?? 1),
          reference: dto.reference ?? null,
          notes: dto.notes ?? null,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.total,
          amountResidual: totals.total,
        },
      });
      for (const p of totals.prepared) {
        await tx.documentLine.create({
          data: {
            organizationId,
            documentId: id,
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
          },
        });
      }
      return tx.document.findFirst({ where: { id }, include: { lines: true, partner: true } });
    });
  }

  async post(id: string) {
    const doc = await this.prisma.client.document.findFirst({
      where: { id, documentType: 'sales_invoice' },
      include: { lines: true },
    });
    if (!doc) throw new NotFoundException('Invoice not found');

    const result = await this.workflow.transition({
      entityType: 'invoice',
      entityId: id,
      action: 'post',
      entity: doc,
    });

    this.events.publish('invoice.posted', {
      organizationId: this.tenant.organizationId,
      documentId: doc.id,
      documentNumber: doc.documentNumber,
    });
    return this.prisma.client.document.findFirst({ where: { id }, include: { lines: true, partner: true } });
  }

  async cancel(id: string) {
    // Approval gate
    const approval = await this.approvals.checkOrRequestApproval({
      entityType: 'invoice_cancel',
      entityId: id,
      snapshot: {},
    });
    if (approval?.needsApproval) {
      throw new ForbiddenException(
        `Invoice cancellation requires approval. Request ID: ${approval.requestId}. Please have an authorized person approve it via the approvals endpoint.`,
      );
    }

    const doc = await this.prisma.client.document.findFirst({
      where: { id, documentType: 'sales_invoice' },
      include: { allocations: true },
    });
    if (!doc) throw new NotFoundException('Invoice not found');
    if (doc.status === 'cancelled') return doc;

    await this.workflow.transition({
      entityType: 'invoice',
      entityId: id,
      action: 'cancel',
      entity: doc,
    });

    this.events.publish('invoice.cancelled', {
      organizationId: this.tenant.organizationId,
      documentId: doc.id,
      documentNumber: doc.documentNumber,
    });
    return this.prisma.client.document.findFirst({ where: { id } });
  }
}
