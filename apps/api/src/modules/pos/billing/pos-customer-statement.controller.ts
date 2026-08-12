/**
 * POS — Customer credit statement (D4).
 *
 * A read-only house-account statement DERIVED from the source records, not a
 * second set of books:
 *   - charges   ← credit Invoices (paymentMode = 'credit')
 *   - payments  ← PaymentAllocations against those invoices (inbound)
 *   - write-offs← 'pos_invoice_writeoff' journal entries on those invoices
 *
 * Deriving avoids the drift a parallel ledger would introduce, and surfaces
 * historical credit sales with no backfill. `CustomerTab.balance` /
 * `CustomerTabLedger` remain reserved for the manual tab API in
 * pos-loyalty.service.ts and are intentionally NOT touched here.
 *
 * Scope note: this covers on-account (credit) invoices only. A full AR
 * statement across all invoice payment modes is a where-clause extension.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Controller, Get, Injectable, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { RequirePermissions } from '../../../kernel/auth/decorators/require-permissions.decorator';
import { resolveCreditStatus, type CreditStatus } from './credit-status';

export interface StatementEntry {
  date: string;
  type: 'credit_issue' | 'payment' | 'write_off';
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  /** Signed: charges positive (increase balance), payments/write-offs negative. */
  amount: number;
  runningBalance: number;
}

export interface CustomerStatement extends CreditStatus {
  partner: { id: string; name: string; code: string | null };
  entries: StatementEntry[];
}

/** One open (unsettled / partially settled) credit invoice. */
export interface OpenCreditInvoice {
  invoiceId: string;
  invoiceNumber: string;
  issueDate: string;
  partnerId: string;
  partnerName: string;
  totalAmount: number;
  amountPaid: number;
  amountResidual: number;
  /** Whole days since the invoice was issued. */
  daysOutstanding: number;
}

export interface OpenCreditFeed {
  rows: OpenCreditInvoice[];
  total: number;
  page: number;
  pageSize: number;
  /** Sum of amountResidual across ALL matching rows, not just this page. */
  totalOutstanding: number;
  /** Distinct customers owing across ALL matching rows. */
  customersOwing: number;
  /** Age in days of the oldest matching open invoice (0 when none). */
  oldestDebtDays: number;
}

@Injectable()
export class PosCustomerStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  async statement(partnerId: string): Promise<CustomerStatement> {
    const orgId = this.tenant.organizationId;

    const partner = await this.prisma.client.partner.findFirst({
      where: { id: partnerId, organizationId: orgId },
      select: { id: true, name: true, code: true },
    });
    if (!partner) throw new NotFoundException('Customer not found');

    const invoices = await this.prisma.client.invoice.findMany({
      where: { organizationId: orgId, partnerId, paymentMode: 'credit' },
      select: {
        id: true, invoiceNumber: true, issueDate: true, createdAt: true,
        totalAmount: true, amountResidual: true, settlementStatus: true,
      },
    });
    const invoiceIds = invoices.map((i) => i.id);
    const invById = new Map(invoices.map((i) => [i.id, i]));

    const allocations = invoiceIds.length
      ? await this.prisma.client.paymentAllocation.findMany({
          where: { organizationId: orgId, invoiceId: { in: invoiceIds } },
          include: { payment: { select: { paymentNumber: true, paymentDate: true, direction: true } } },
        })
      : [];

    // Write-offs: sum a per-invoice allocation total so the written-off amount is
    // total − paid. `Invoice.amountPaid` is faked to totalAmount by writeOff(),
    // so it can't be used here.
    const writeOffEntries = invoiceIds.length
      ? await this.prisma.client.journalEntry.findMany({
          where: { organizationId: orgId, sourceType: 'pos_invoice_writeoff', sourceId: { in: invoiceIds } },
          select: { sourceId: true, postingDate: true, createdAt: true },
        })
      : [];

    const paidByInvoice = new Map<string, number>();
    for (const a of allocations) {
      if ((a.payment?.direction ?? 'inbound') !== 'inbound') continue;
      paidByInvoice.set(a.invoiceId!, (paidByInvoice.get(a.invoiceId!) ?? 0) + Number(a.amount));
    }

    const rows: Omit<StatementEntry, 'runningBalance'>[] = [];

    // Charge = the credit issue (booked at bill time).
    for (const inv of invoices) {
      rows.push({
        date: new Date(inv.issueDate ?? inv.createdAt).toISOString(),
        type: 'credit_issue',
        reference: inv.invoiceNumber,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: Number(inv.totalAmount),
      });
    }
    // Payments reduce the balance.
    for (const a of allocations) {
      if ((a.payment?.direction ?? 'inbound') !== 'inbound') continue;
      const inv = invById.get(a.invoiceId!);
      if (!inv) continue;
      rows.push({
        date: new Date(a.payment?.paymentDate ?? a.createdAt).toISOString(),
        type: 'payment',
        reference: a.payment?.paymentNumber ?? '—',
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: -Number(a.amount),
      });
    }
    // Write-offs clear the remaining balance.
    for (const w of writeOffEntries) {
      const inv = invById.get(w.sourceId!);
      if (!inv) continue;
      const written = Number(inv.totalAmount) - (paidByInvoice.get(inv.id) ?? 0);
      if (written <= 0.001) continue;
      rows.push({
        date: new Date(w.postingDate ?? w.createdAt).toISOString(),
        type: 'write_off',
        reference: inv.invoiceNumber,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: -written,
      });
    }

    rows.sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    const entries: StatementEntry[] = rows.map((r) => {
      running = Math.round((running + r.amount) * 100) / 100;
      return { ...r, runningBalance: running };
    });

    return { partner, ...(await this.creditStatus(partnerId)), entries };
  }

  /** Credit limit / outstanding / headroom / hold for one customer. */
  async creditStatus(partnerId: string): Promise<CreditStatus> {
    return resolveCreditStatus(this.prisma.client, this.tenant.organizationId, partnerId);
  }

  /**
   * Every open credit invoice — the receivables worklist. Ordered oldest-first
   * so the debt most in need of chasing is on top.
   */
  async openCredit(params: {
    partnerId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<OpenCreditFeed> {
    const orgId = this.tenant.organizationId;
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 50));
    const search = params.search?.trim();

    // Invoice carries only `partnerId` (no Prisma relation to Partner), so a
    // name search resolves to ids first and names are stitched on afterwards.
    const nameMatches = search
      ? await this.prisma.client.partner.findMany({
          where: { organizationId: orgId, name: { contains: search, mode: 'insensitive' } },
          select: { id: true },
        })
      : [];

    const where: any = {
      organizationId: orgId,
      paymentMode: 'credit',
      settlementStatus: { in: ['unsettled', 'partially_settled'] },
      ...(params.partnerId ? { partnerId: params.partnerId } : {}),
      ...(search
        ? {
            OR: [
              { invoiceNumber: { contains: search, mode: 'insensitive' } },
              { partnerId: { in: nameMatches.map((p) => p.id) } },
            ],
          }
        : {}),
    };

    const [rows, total, agg, distinctPartners, oldest] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where,
        orderBy: { issueDate: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, invoiceNumber: true, issueDate: true, partnerId: true,
          totalAmount: true, amountPaid: true, amountResidual: true,
        },
      }),
      this.prisma.client.invoice.count({ where }),
      this.prisma.client.invoice.aggregate({ where, _sum: { amountResidual: true } }),
      this.prisma.client.invoice.findMany({ where, distinct: ['partnerId'], select: { partnerId: true } }),
      this.prisma.client.invoice.findFirst({ where, orderBy: { issueDate: 'asc' }, select: { issueDate: true } }),
    ]);

    const partners = rows.length
      ? await this.prisma.client.partner.findMany({
          where: { organizationId: orgId, id: { in: [...new Set(rows.map((r) => r.partnerId))] } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(partners.map((p) => [p.id, p.name]));

    const days = (d: Date) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));

    return {
      rows: rows.map((r) => ({
        invoiceId: r.id,
        invoiceNumber: r.invoiceNumber,
        issueDate: new Date(r.issueDate).toISOString(),
        partnerId: r.partnerId,
        partnerName: nameById.get(r.partnerId) ?? '—',
        totalAmount: Number(r.totalAmount),
        amountPaid: Number(r.amountPaid),
        amountResidual: Number(r.amountResidual),
        daysOutstanding: days(r.issueDate),
      })),
      total,
      page,
      pageSize,
      totalOutstanding: Math.round(Number(agg._sum.amountResidual ?? 0) * 100) / 100,
      customersOwing: distinctPartners.length,
      oldestDebtDays: oldest ? days(oldest.issueDate) : 0,
    };
  }
}

@ApiTags('POS')
@ApiBearerAuth()
@Controller('pos/customers')
export class PosCustomerStatementController {
  constructor(private readonly service: PosCustomerStatementService) {}

  /** Derived house-account statement for a customer. */
  @Get(':partnerId/statement')
  @RequirePermissions('pos:read')
  statement(@Param('partnerId') partnerId: string): Promise<CustomerStatement> {
    return this.service.statement(partnerId);
  }

  /** Credit standing only — the cheap lookup the Charge dialog polls. */
  @Get(':partnerId/credit')
  @RequirePermissions('pos:read')
  credit(@Param('partnerId') partnerId: string): Promise<CreditStatus> {
    return this.service.creditStatus(partnerId);
  }
}

@ApiTags('POS')
@ApiBearerAuth()
@Controller('pos/credit')
export class PosCreditController {
  constructor(private readonly service: PosCustomerStatementService) {}

  /** Receivables worklist: every open credit invoice, oldest first. */
  @Get('open')
  @RequirePermissions('pos:read')
  open(
    @Query('partnerId') partnerId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OpenCreditFeed> {
    return this.service.openCredit({
      partnerId,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
