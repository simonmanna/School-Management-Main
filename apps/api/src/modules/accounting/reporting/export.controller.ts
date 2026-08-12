import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { stringify } from 'csv-stringify/sync';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';

/**
 * F.5 — Report export.
 *
 * Supports CSV and PDF (the latter for invoices / receipts via PDFKit). Reports
 * larger than a single page stream the rows; PDF streams via http response.
 */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports/export')
export class ExportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get('trial-balance.csv')
  @ApiQuery({ name: 'asOf', required: false, example: '2025-01-31' })
  async trialBalanceCsv(@Query('asOf') asOf: string, @Res() res: Response) {
    const orgId = this.tenant.organizationId;
    const date = asOf ? new Date(asOf) : new Date();
    const accounts = await this.prisma.raw.account.findMany({
      where: { organizationId: orgId, isPostable: true, isActive: true },
      orderBy: { code: 'asc' },
    });
    const rows: any[] = await this.prisma.raw.$queryRaw`
      SELECT a.code, a.name, ac.key AS "categoryKey", ac.name AS "categoryName",
        ac."classification"::text AS classification,
        COALESCE(SUM(jl."baseDebit"), 0)::text AS debit,
        COALESCE(SUM(jl."baseCredit"), 0)::text AS credit,
        COALESCE(SUM(jl."baseDebit" - jl."baseCredit"), 0)::text AS balance
      FROM "Account" a
      LEFT JOIN "AccountCategory" ac ON ac.id = a."categoryId"
      LEFT JOIN "JournalLine" jl ON jl."accountId" = a.id
      LEFT JOIN "JournalEntry" je ON je.id = jl."journalEntryId" AND je.status IN ('posted', 'reversed') AND je."postingDate" <= ${date}
      WHERE a."organizationId" = ${orgId}
      GROUP BY a.id, a.code, a.name, a."sortOrder", ac.key, ac.name, ac."classification"
      ORDER BY a."sortOrder", a.code
    `;
    const csv = stringify(
      rows.map((r: any) => ({
        code: r.code,
        name: r.name,
        category: r.categoryName ?? r.categoryKey ?? '',
        classification: r.classification ?? '',
        debit: Number(r.debit).toFixed(2),
        credit: Number(r.credit).toFixed(2),
        balance: Number(r.balance).toFixed(2),
      })),
      {
        header: true,
        columns: ['code', 'name', 'category', 'classification', 'debit', 'credit', 'balance'],
      },
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="trial-balance-${date.toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }

  @Get('ar-aging.csv')
  async arAgingCsv(@Res() res: Response) {
    const orgId = this.tenant.organizationId;
    const now = new Date();
    const day = (n: number) => new Date(now.getTime() - n * 86400 * 1000);
    const docs = await this.prisma.raw.document.findMany({
      where: {
        organizationId: orgId,
        documentType: 'sales_invoice',
        status: 'posted',
        amountResidual: { gt: 0 },
      },
      include: { partner: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
    });
    const bucket = (d: Date | null): string => {
      if (!d) return 'Current';
      if (d >= now) return 'Current';
      const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400 / 1000);
      if (diffDays <= 30) return '1-30';
      if (diffDays <= 60) return '31-60';
      if (diffDays <= 90) return '61-90';
      return '90+';
    };
    const rows = docs.map((d) => ({
      documentNumber: d.documentNumber,
      partner: d.partner?.name ?? '',
      issueDate: d.issueDate.toISOString().slice(0, 10),
      dueDate: d.dueDate?.toISOString().slice(0, 10) ?? '',
      bucket: bucket(d.dueDate),
      amount: Number(d.totalAmount).toFixed(2),
      residual: Number(d.amountResidual).toFixed(2),
    }));
    const csv = stringify(rows, {
      header: true,
      columns: ['documentNumber', 'partner', 'issueDate', 'dueDate', 'bucket', 'amount', 'residual'],
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ar-aging-${now.toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }

  @Get('invoice/:id.pdf')
  async invoicePdf(@Query('id') id: string, @Res() res: Response) {
    const doc = await this.prisma.raw.document.findFirst({
      where: { id, organizationId: this.tenant.organizationId },
      include: { lines: true, partner: true },
    });
    if (!doc) {
      res.status(404).send('Not found');
      return;
    }
    const org = await this.prisma.raw.organization.findUnique({ where: { id: this.tenant.organizationId } });

    const pdf = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.documentNumber}.pdf"`);
    pdf.pipe(res);

    // Header
    pdf.fontSize(20).text(org?.name ?? 'ERP', { align: 'left' });
    pdf.fontSize(10).fillColor('gray').text(((org?.settings as any)?.address) ?? '', { align: 'left' });
    pdf.fillColor('black');
    pdf.moveDown(2);

    // Title
    pdf.fontSize(18).text(doc.documentType === 'sales_invoice' ? 'INVOICE' : doc.documentType.toUpperCase(), { align: 'right' });
    pdf.fontSize(10).fillColor('gray').text(`# ${doc.documentNumber}`, { align: 'right' });
    pdf.fillColor('black');
    pdf.moveDown();

    // Meta
    pdf.fontSize(10);
    pdf.text(`Issue date: ${doc.issueDate.toISOString().slice(0, 10)}`);
    if (doc.dueDate) pdf.text(`Due date: ${doc.dueDate.toISOString().slice(0, 10)}`);
    if (doc.reference) pdf.text(`Reference: ${doc.reference}`);
    pdf.moveDown();

    // Bill to
    pdf.fontSize(11).text('Bill to:', { underline: true });
    pdf.fontSize(10).text(doc.partner?.name ?? '');
    pdf.moveDown();

    // Line items
    pdf.fontSize(11).text('Items:', { underline: true });
    pdf.moveDown(0.5);
    pdf.fontSize(10);
    doc.lines.forEach((ln) => {
      pdf.text(`${ln.description}    qty ${ln.quantity} × ${Number(ln.unitPrice).toFixed(2)}  =  ${Number(ln.total).toFixed(2)}`);
    });
    pdf.moveDown();

    // Totals
    pdf.fontSize(12).text(`Subtotal: ${Number(doc.subtotal).toFixed(2)}`, { align: 'right' });
    pdf.text(`Tax: ${Number(doc.taxAmount).toFixed(2)}`, { align: 'right' });
    pdf.fontSize(14).text(`Total: ${Number(doc.totalAmount).toFixed(2)}`, { align: 'right' });
    pdf.text(`Amount due: ${Number(doc.amountResidual).toFixed(2)}`, { align: 'right' });

    if (doc.notes) {
      pdf.moveDown();
      pdf.fontSize(10).fillColor('gray').text(`Notes: ${doc.notes}`);
    }

    pdf.end();
  }
}
