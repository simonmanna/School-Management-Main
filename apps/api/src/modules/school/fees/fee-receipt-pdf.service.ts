import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { SchoolFinanceQueryService } from './school-finance-query.service';
import {
  MM,
  drawLetterhead,
  drawSignatures,
  drawTitle,
  fmtDate,
  fmtMoney,
  loadLetterhead,
  renderPdf,
} from '../documents/school-pdf';

export type ReceiptFormat = 'a4' | 'thermal';

const METHOD: Record<string, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile money',
  bank: 'Bank',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  card: 'Card',
};

/**
 * Wave 16 — the school fee receipt as a server-rendered PDF: A4 for the file
 * and the parent, 80 mm for the bursar's thermal printer.
 *
 * Every print is audited against the payment. The first print is the
 * original; every later one is stamped "COPY — reprint n" on the paper, so a
 * duplicate receipt can never pass as a second payment.
 */
@Injectable()
export class FeeReceiptPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly finance: SchoolFinanceQueryService,
  ) {}

  /**
   * `family` prints (the parent portal) are always stamped as a family copy and
   * never consume the office's original.
   */
  async generate(
    paymentId: string,
    format: ReceiptFormat = 'a4',
    audience: 'office' | 'family' = 'office',
  ): Promise<{ filename: string; pdf: Buffer; reprint: number }> {
    const { payment, student, balance } = (await this.finance.getReceipt(paymentId)) as any;
    const school = await loadLetterhead(this.prisma.client, this.tenant.organizationId);
    const reprint = await this.prisma.client.auditLog.count({
      where: { entity: 'FeeReceipt', entityId: payment.id, action: { in: ['issue', 'reprint'] } },
    });

    const lines = (payment.allocations ?? [])
      .filter((a: any) => a.status !== 'reversed')
      .map((a: any) => ({ label: a.document?.documentNumber ?? 'Fees', amount: Number(a.amount) }));
    const allocated = lines.reduce((t: number, l: any) => t + l.amount, 0);
    const unallocated = Math.max(0, Number(payment.amount) - allocated);
    const facts = {
      number: String(payment.paymentNumber),
      date: fmtDate(payment.paymentDate),
      pupil: String(student?.partner?.name ?? payment.partner?.name ?? '—'),
      admissionNo: String(student?.admissionNo ?? '—'),
      className: [student?.currentClass?.name, student?.currentSection?.name].filter(Boolean).join(' ') || '—',
      method: METHOD[payment.paymentMethod] ?? String(payment.paymentMethod),
      reference: payment.externalReference ?? payment.reference ?? '',
      amount: Number(payment.amount),
      balance: balance ? Math.round(balance.balance) : null,
    };
    const copy = audience === 'family' ? 'FAMILY COPY' : reprint > 0 ? `COPY — reprint ${reprint}` : null;

    const pdf = format === 'thermal' ? await this.thermal(school, facts, lines, unallocated, copy) : await this.a4(school, facts, lines, unallocated, copy);

    await this.audit.record({
      entity: 'FeeReceipt',
      entityId: payment.id,
      action: audience === 'family' ? 'read' : reprint > 0 ? 'reprint' : 'issue',
      newValues: { format, receiptNumber: facts.number, reprint, audience },
    });
    const suffix = audience === 'family' ? '-family' : reprint ? `-copy${reprint}` : '';
    return { filename: `${facts.number}${suffix}.pdf`, pdf, reprint };
  }

  private a4(school: any, f: any, lines: Array<{ label: string; amount: number }>, unallocated: number, copy: string | null) {
    return renderPdf({ size: 'A5', layout: 'landscape', margins: { top: 12 * MM, bottom: 12 * MM, left: 14 * MM, right: 14 * MM } }, (doc) => {
      const left = doc.page.margins.left;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      let y = drawLetterhead(doc, school, { compact: true });
      y = drawTitle(doc, 'Official Fee Receipt', y, 12);

      doc.font('Helvetica').fontSize(9);
      const half = width / 2;
      const kv = (label: string, value: string, x: number, yy: number) => {
        doc.font('Helvetica-Bold').text(label, x, yy, { width: 80, lineBreak: false });
        doc.font('Helvetica').text(value, x + 80, yy, { width: half - 90, lineBreak: false, ellipsis: true });
      };
      kv('Receipt No:', f.number, left, y);
      kv('Date:', f.date, left + half, y);
      kv('Received from:', f.pupil, left, y + 14);
      kv('Adm No:', f.admissionNo, left + half, y + 14);
      kv('Class:', f.className, left, y + 28);
      kv('Paid by:', `${f.method}${f.reference ? ` · ${f.reference}` : ''}`, left + half, y + 28);
      y += 48;

      doc.rect(left, y, width, 16).fill('#1e293b');
      doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9).text('Applied to', left + 6, y + 4).text('Amount', left, y + 4, { width: width - 6, align: 'right' });
      doc.fillColor('#000').font('Helvetica');
      y += 18;
      const rows = [...lines, ...(unallocated > 0 ? [{ label: 'Held as credit on account', amount: unallocated }] : [])];
      for (const l of rows) {
        doc.text(l.label, left + 6, y, { width: width - 120, lineBreak: false });
        doc.text(fmtMoney(l.amount), left, y, { width: width - 6, align: 'right' });
        y += 14;
      }
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.6).stroke();
      doc.font('Helvetica-Bold').fontSize(11).text('TOTAL RECEIVED', left + 6, y + 5).text(fmtMoney(f.amount), left, y + 5, { width: width - 6, align: 'right' });
      y += 24;
      if (f.balance != null) {
        doc.font('Helvetica').fontSize(9).text(
          f.balance > 0 ? `Balance outstanding after this payment: ${fmtMoney(f.balance)}` : f.balance < 0 ? `Credit on account: ${fmtMoney(-f.balance)}` : 'Fees fully paid to date.',
          left + 6,
          y,
        );
        y += 16;
      }
      drawSignatures(doc, ['Received by (Bursar)', 'School stamp'], y + 4);
      if (copy) this.stamp(doc, copy);
    });
  }

  private thermal(school: any, f: any, lines: Array<{ label: string; amount: number }>, unallocated: number, copy: string | null) {
    // 80 mm roll, 72 mm printable. Height generous; thermal printers cut at content end.
    const W = 72 * MM;
    return renderPdf({ size: [W + 8, 170 * MM], margins: { top: 8, bottom: 8, left: 4, right: 4 } }, (doc) => {
      const width = W;
      const x = 4;
      const center = (text: string, size = 8, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).text(text, x, doc.y, { width, align: 'center' });
      };
      const row = (a: string, b: string, bold = false) => {
        const y = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).text(a, x, y, { width: width * 0.6, lineBreak: false, ellipsis: true });
        doc.text(b, x, y, { width, align: 'right' });
      };
      const rule = () => {
        doc.moveDown(0.2);
        doc.moveTo(x, doc.y).lineTo(x + width, doc.y).dash(1, { space: 1.5 }).lineWidth(0.5).stroke().undash();
        doc.moveDown(0.3);
      };
      doc.y = 8;
      center(school.name.toUpperCase(), 10, true);
      if (school.address) center(school.address, 7);
      if (school.phone) center(school.phone, 7);
      rule();
      center('FEE RECEIPT', 9, true);
      if (copy) center(copy, 9, true);
      rule();
      row('Receipt', f.number);
      row('Date', f.date);
      row('Pupil', f.pupil);
      row('Adm No', f.admissionNo);
      row('Class', f.className);
      row('Paid by', f.method);
      if (f.reference) row('Ref', String(f.reference));
      rule();
      for (const l of lines) row(l.label, fmtMoney(l.amount));
      if (unallocated > 0) row('Credit on account', fmtMoney(unallocated));
      rule();
      row('TOTAL', fmtMoney(f.amount), true);
      if (f.balance != null) row(f.balance >= 0 ? 'Balance' : 'Credit', fmtMoney(Math.abs(f.balance)));
      rule();
      center('Thank you. Keep this receipt.', 7);
    });
  }

  private stamp(doc: PDFKit.PDFDocument, text: string) {
    doc.save().rotate(-20, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Helvetica-Bold').fontSize(36).fillColor('#c00').opacity(0.22);
    doc.text(text, 0, doc.page.height / 2 - 20, { width: doc.page.width, align: 'center' });
    doc.restore();
    doc.opacity(1).fillColor('#000');
  }
}
