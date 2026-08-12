import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

class ActivityQuery {
  @ApiProperty({ required: false, default: 10, minimum: 1, maximum: 50 })
  @IsOptional() limit?: number;
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsDashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Single endpoint for the home dashboard KPIs. */
  @Get('dashboard-kpi')
  async kpi() {
    const orgId = this.tenant.organizationId;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const dueSoon = new Date(now.getTime() + 30 * 86400 * 1000);

    const [
      openInvoices,
      overdueInvoices,
      cashAgg,
      revenueMonth,
      cogsMonth,
      expenseMonth,
      arCurrent,
      arB30,
      arB60,
      arB90,
      arOver90,
    ] = await Promise.all([
      this.prisma.raw.document.count({
        where: { organizationId: orgId, documentType: 'sales_invoice', status: { in: ['posted'] }, amountResidual: { gt: 0 } },
      }),
      this.prisma.raw.document.count({
        where: {
          organizationId: orgId,
          documentType: 'sales_invoice',
          status: { in: ['posted'] },
          amountResidual: { gt: 0 },
          dueDate: { lt: now },
        },
      }),
      // Cash position = sum of posted lines on cash-equivalent accounts, as
      // flagged by their category (cash, bank, mobile money, petty cash).
      this.prisma.raw.$queryRaw<{ total: any }[]>`
        SELECT COALESCE(SUM("baseDebit" - "baseCredit"), 0)::text AS total
        FROM "JournalLine" jl
        JOIN "Account" a ON a.id = jl."accountId"
        JOIN "AccountCategory" ac ON ac.id = a."categoryId"
        JOIN "JournalEntry" je ON je.id = jl."journalEntryId"
        WHERE jl."organizationId" = ${orgId}
          AND je.status = 'posted'
          AND ac."isCashEquivalent" = true
      `,
      this.aggSectionSince(orgId, ['revenue', 'other_income'], startOfMonth),
      this.aggSectionSince(orgId, ['cogs'], startOfMonth),
      this.aggSectionSince(orgId, ['operating_expense', 'other_expense'], startOfMonth),
      this.arBucket(orgId, 'current'),
      this.arBucket(orgId, 'b1_30'),
      this.arBucket(orgId, 'b31_60'),
      this.arBucket(orgId, 'b61_90'),
      this.arBucket(orgId, 'b90p'),
    ]);

    const cashPosition = Number((cashAgg[0] as any)?.total ?? 0);
    const revenue = Number((revenueMonth as any)?.total ?? 0);
    const cogs = Number((cogsMonth as any)?.total ?? 0);
    const exp = Number((expenseMonth as any)?.total ?? 0);
    return {
      openInvoices,
      overdueInvoices,
      cashPosition,
      revenueMonth: revenue,
      netIncomeMonth: revenue - cogs - exp,
      arAging: {
        current: Number(arCurrent[0]?.total ?? 0),
        b30: Number(arB30[0]?.total ?? 0),
        b60: Number(arB60[0]?.total ?? 0),
        b90: Number(arB90[0]?.total ?? 0),
        over90: Number(arOver90[0]?.total ?? 0),
      },
    };
  }

  @Get('dashboard-activity')
  async activity(@Query() q: ActivityQuery) {
    const orgId = this.tenant.organizationId;
    const limit = Math.min(50, Math.max(1, Number(q.limit ?? 10)));
    // Recent invoices, payments, journal entries.
    const [invoices, payments, journalEntries] = await Promise.all([
      this.prisma.raw.document.findMany({
        where: { organizationId: orgId, documentType: { in: ['sales_invoice', 'vendor_bill', 'credit_note'] } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { partner: { select: { name: true } } },
      }),
      this.prisma.raw.payment.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { partner: { select: { name: true } } },
      }),
      this.prisma.raw.journalEntry.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);
    type Item = { id: string; type: string; description: string; amount?: number; at: string; href: string };
    const items: Item[] = [];
    for (const d of invoices) {
      items.push({
        id: d.id,
        type: d.documentType,
        description: `${d.documentNumber} · ${d.partner?.name ?? ''}`,
        amount: Number(d.totalAmount),
        at: d.createdAt.toISOString(),
        href:
          d.documentType === 'sales_invoice'
            ? `/invoices/${d.id}`
            : d.documentType === 'credit_note'
              ? `/credit-notes/${d.id}`
              : `/expenses/${d.id}`,
      });
    }
    for (const p of payments) {
      items.push({
        id: p.id,
        type: 'payment',
        description: `${p.paymentNumber} · ${p.partner?.name ?? ''}`,
        amount: Number(p.amount),
        at: p.createdAt.toISOString(),
        href: `/payments/${p.id}`,
      });
    }
    for (const j of journalEntries) {
      items.push({
        id: j.id,
        type: 'journal_entry',
        description: `${j.entryNumber}${j.description ? ' · ' + j.description : ''}`,
        at: j.createdAt.toISOString(),
        href: `/journal-entries/${j.id}`,
      });
    }
    return {
      data: items
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, limit),
    };
  }

  /**
   * Sum posted movement on every account in the given report sections, signed by
   * each account's own normal balance. This replaces a hand-rolled
   * `accountType === 'revenue' ? 'credit' : 'debit'` direction hack, which got
   * contra accounts backwards.
   */
  private async aggSectionSince(orgId: string, sections: string[], since: Date) {
    const rows = await this.prisma.raw.$queryRaw<{ total: any }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN ac."normalBalance" = 'credit'
             THEN jl."baseCredit" - jl."baseDebit"
             ELSE jl."baseDebit" - jl."baseCredit" END
      ), 0)::text AS total
      FROM "JournalLine" jl
      JOIN "Account" a ON a.id = jl."accountId"
      JOIN "AccountCategory" ac ON ac.id = a."categoryId"
      JOIN "JournalEntry" je ON je.id = jl."journalEntryId"
      WHERE jl."organizationId" = ${orgId}
        AND je.status = 'posted'
        AND je."postingDate" >= ${since}
        AND ac."reportSection"::text = ANY(${sections})
    `;
    return rows[0];
  }

  private async arBucket(orgId: string, bucket: 'current' | 'b1_30' | 'b31_60' | 'b61_90' | 'b90p') {
    const now = new Date();
    const day = (n: number) => new Date(now.getTime() - n * 86400 * 1000);
    let where: any = {
      organizationId: orgId,
      documentType: 'sales_invoice',
      status: 'posted',
      amountResidual: { gt: 0 },
    };
    if (bucket === 'current') {
      where = { ...where, OR: [{ dueDate: null }, { dueDate: { gte: now } }] };
    } else if (bucket === 'b1_30') {
      where = { ...where, dueDate: { gte: day(30), lt: now } };
    } else if (bucket === 'b31_60') {
      where = { ...where, dueDate: { gte: day(60), lt: day(30) } };
    } else if (bucket === 'b61_90') {
      where = { ...where, dueDate: { gte: day(90), lt: day(60) } };
    } else if (bucket === 'b90p') {
      where = { ...where, dueDate: { lt: day(90) } };
    }
    const r = await this.prisma.raw.document.aggregate({
      where,
      _sum: { amountResidual: true },
    });
    return [{ total: r._sum.amountResidual ?? 0 }];
  }
}
