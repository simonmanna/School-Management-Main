import { Injectable, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Payslip PDF.
 *
 * pdfkit, for the same reasons `ReportPdfSerializer` gives: the documents
 * module's headless-Chrome renderer is not exported, serialises at concurrency
 * 1, and needs a Chrome binary a school server may not have. A payslip is
 * issued to every member of staff every month — it cannot depend on that.
 *
 * The document prints ONLY stored figures from `HrPayrollItem` and its
 * allowance/deduction lines. Nothing here recalculates: a payslip that computed
 * its own totals could disagree with the register, the GL journal and the
 * bank instruction that were all built from the same row.
 */
@Injectable()
export class HrPayslipPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private get db(): Record<string, any> {
    return this.prisma.client as unknown as Record<string, any>;
  }

  /**
   * Load one payslip with everything the document prints.
   *
   * `employeeId` is an OPTIONAL ownership constraint, passed by the
   * self-service route. Employee self-service must never be able to fetch a
   * colleague's payslip by guessing an id, and the safe way to enforce that is
   * in the WHERE clause rather than in a check after the read.
   */
  async load(payslipId: string, employeeId?: string) {
    const row = await this.db.hrPayslip.findFirst({
      where: {
        id: payslipId,
        organizationId: this.tenant.organizationId,
        deletedAt: null,
        ...(employeeId ? { item: { employeeId } } : {}),
      },
      include: {
        item: {
          include: {
            employee: {
              include: { department: true, position: true },
            },
            run: { include: { period: true } },
            allowances: { orderBy: { name: 'asc' } },
            deductions: { orderBy: { name: 'asc' } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Payslip not found');
    return row;
  }

  async filenameFor(payslipId: string, employeeId?: string): Promise<string> {
    const slip = await this.load(payslipId, employeeId);
    const code = slip.item?.employee?.employeeCode ?? 'employee';
    const period = slip.item?.run?.period?.periodCode ?? 'period';
    return `payslip-${code}-${period}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');
  }

  /** Render a payslip straight to the response stream. */
  async write(res: Response, payslipId: string, employeeId?: string): Promise<void> {
    const slip = await this.load(payslipId, employeeId);
    const org = await this.db.organization.findUnique({
      where: { id: this.tenant.organizationId },
      select: { name: true, currencyCode: true, receiptHeader: true },
    });
    this.render(res, slip, org);
  }

  private render(res: Response, slip: any, org: any): void {
    const item = slip.item ?? {};
    const emp = item.employee ?? {};
    const run = item.run ?? {};
    const period = run.period ?? {};
    const currency = org?.currencyCode ?? 'UGX';
    const header = (org?.receiptHeader ?? {}) as Record<string, string>;

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    const M = 40;
    const usable = doc.page.width - M * 2;
    const mid = M + usable / 2;
    const money = (v: any) => fmtMoney(v, currency);

    // ── Masthead ─────────────────────────────────────────────────────────────
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f172a')
      .text(header.businessName || org?.name || 'Payslip', M, M);
    const subLines = [header.addressLine1, header.phone, header.taxId ? `TIN ${header.taxId}` : '']
      .filter(Boolean)
      .join(' · ');
    if (subLines) {
      doc.fontSize(8).font('Helvetica').fillColor('#64748b').text(subLines, M, doc.y + 1);
    }
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f172a')
      .text('PAYSLIP', M, M, { width: usable, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('#475569')
      .text(`No. ${slip.payslipNumber ?? ''}`, M, M + 15, { width: usable, align: 'right' })
      .text(`Period ${period.periodCode ?? ''}`, M, M + 26, { width: usable, align: 'right' })
      .text(`Run ${run.runNumber ?? ''}`, M, M + 37, { width: usable, align: 'right' });

    let y = Math.max(doc.y, M + 52) + 8;
    doc.moveTo(M, y).lineTo(M + usable, y).lineWidth(1).strokeColor('#cbd5e1').stroke();
    y += 12;

    // A cancelled payslip has to say so on its face — a reversed run's slips
    // may already be in employees' hands, and the number stays resolvable.
    if (slip.status === 'CANCELLED') {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#b91c1c')
        .text('CANCELLED — this payslip was voided when its payroll run was reversed.', M, y, { width: usable });
      y = doc.y + 8;
    }

    // ── Employee block ───────────────────────────────────────────────────────
    const label = (text: string, x: number, yy: number) =>
      doc.fontSize(7.5).font('Helvetica').fillColor('#64748b').text(text.toUpperCase(), x, yy);
    const value = (text: string, x: number, yy: number, width: number) =>
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a').text(text || '—', x, yy, { width });

    const colW = usable / 2 - 10;
    const left: Array<[string, string]> = [
      ['Employee', `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim()],
      ['Employee no.', emp.employeeCode ?? ''],
      ['Department', emp.department?.name ?? ''],
      ['Post', emp.position?.title ?? ''],
    ];
    const right: Array<[string, string]> = [
      ['Pay period', `${fmtDate(period.startDate)} – ${fmtDate(period.endDate)}`],
      ['Days paid', `${num(item.paidDays)} of ${num(item.periodDays)}`],
      ['Tax number', emp.taxNumber ?? ''],
      ['Paid to', emp.bankAccountNumber
        ? `${emp.bankName ?? 'Bank'} · ${maskAccount(emp.bankAccountNumber)}`
        : emp.mobileMoneyNumber
          ? `${emp.mobileMoneyProvider ?? 'Mobile money'} · ${maskAccount(emp.mobileMoneyNumber)}`
          : ''],
    ];
    let blockY = y;
    for (let i = 0; i < left.length; i += 1) {
      label(left[i][0], M, blockY);
      value(left[i][1], M, blockY + 9, colW);
      label(right[i][0], mid, blockY);
      value(right[i][1], mid, blockY + 9, colW);
      blockY += 26;
    }
    y = blockY + 4;

    // A pro-rated payslip must explain itself, or it reads as an underpayment.
    const proRata = Number(item.proRataFactor ?? 1);
    if (proRata < 1) {
      const reasons: string[] = [];
      if (Number(item.unpaidLeaveDays ?? 0) > 0) {
        reasons.push(`${num(item.unpaidLeaveDays)} day(s) unpaid leave`);
      }
      if (emp.hireDate && period.startDate && new Date(emp.hireDate) > new Date(period.startDate)) {
        reasons.push(`joined ${fmtDate(emp.hireDate)}`);
      }
      doc.fontSize(8).font('Helvetica-Oblique').fillColor('#b45309')
        .text(
          `Pay pro-rated to ${(proRata * 100).toFixed(1)}% of the period${reasons.length ? `: ${reasons.join(', ')}` : ''}.`,
          M, y, { width: usable },
        );
      y = doc.y + 8;
    }

    // ── Earnings / deductions, side by side ──────────────────────────────────
    const earnings: Array<[string, any]> = [
      ['Basic pay', item.baseSalary],
      ...(Number(item.overtimePay ?? 0) > 0
        ? ([[`Overtime (${num(item.overtimeHours)} h)`, item.overtimePay]] as Array<[string, any]>)
        : []),
      ...(item.allowances ?? []).map((a: any) => [
        a.isTaxable ? a.name : `${a.name} (untaxed)`,
        a.amount,
      ] as [string, any]),
    ];
    const deductions: Array<[string, any]> = (item.deductions ?? []).map(
      (d: any) => [d.name, d.amount] as [string, any],
    );

    const tableTop = y;
    y = this.column(doc, M, tableTop, colW, 'Earnings', earnings, item.grossPay, 'Gross pay', money);
    const rightBottom = this.column(
      doc, mid, tableTop, colW, 'Deductions', deductions, item.totalDeductions, 'Total deductions', money,
    );
    y = Math.max(y, rightBottom) + 12;

    // ── Net pay ──────────────────────────────────────────────────────────────
    doc.roundedRect(M, y, usable, 40, 4).fillAndStroke('#0f172a', '#0f172a');
    doc.fontSize(9).font('Helvetica').fillColor('#e2e8f0')
      .text('NET PAY', M + 14, y + 10);
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#ffffff')
      .text(money(item.netPay), M, y + 8, { width: usable - 14, align: 'right' });
    y += 52;

    // ── Year-to-date is deliberately absent ──────────────────────────────────
    // A YTD column would have to be summed across runs here, and this file is
    // not allowed to compute payroll figures. It belongs on the payroll item
    // when the engine writes it, not in the renderer.

    doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
      .text(
        `Issued ${fmtDate(slip.issuedAt ?? slip.createdAt)}` +
          (slip.paidAt ? ` · Paid ${fmtDate(slip.paidAt)}` : '') +
          ` · Status ${slip.status}`,
        M, y, { width: usable },
      );
    doc.fontSize(7).fillColor('#cbd5e1')
      .text(
        'This payslip is computer generated from the approved payroll run and is valid without a signature.',
        M, doc.y + 3, { width: usable },
      );

    doc.end();
  }

  /** One labelled money column. Returns the y it finished at. */
  private column(
    doc: any,
    x: number,
    y: number,
    width: number,
    heading: string,
    rows: Array<[string, any]>,
    total: any,
    totalLabel: string,
    money: (v: any) => string,
  ): number {
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569')
      .text(heading.toUpperCase(), x, y);
    let cursor = y + 13;
    doc.moveTo(x, cursor - 3).lineTo(x + width, cursor - 3).lineWidth(0.5).strokeColor('#e2e8f0').stroke();

    if (rows.length === 0) {
      doc.fontSize(8.5).font('Helvetica-Oblique').fillColor('#94a3b8').text('None', x, cursor);
      cursor += 14;
    }
    for (const [name, amount] of rows) {
      doc.fontSize(8.5).font('Helvetica').fillColor('#334155')
        .text(String(name), x, cursor, { width: width * 0.58, ellipsis: true });
      doc.fontSize(8.5).font('Helvetica').fillColor('#0f172a')
        .text(money(amount), x, cursor, { width, align: 'right' });
      cursor += 14;
    }

    cursor += 2;
    doc.moveTo(x, cursor).lineTo(x + width, cursor).lineWidth(0.5).strokeColor('#cbd5e1').stroke();
    cursor += 5;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a')
      .text(totalLabel, x, cursor, { width: width * 0.58 });
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a')
      .text(money(total), x, cursor, { width, align: 'right' });
    return cursor + 16;
  }
}

function num(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function fmtMoney(v: any, currency: string): string {
  const n = Number(v ?? 0);
  return `${currency} ${(Number.isFinite(n) ? n : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(v: any): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * Payslips are printed, photographed and forwarded. Showing the full account
 * number on every one of them turns a routine document into a standing
 * disclosure, so only the last four digits are printed.
 */
function maskAccount(account: string): string {
  const s = String(account);
  return s.length <= 4 ? s : `••••${s.slice(-4)}`;
}
