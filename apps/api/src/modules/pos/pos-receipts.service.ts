/**
 * POS Phase B — Receipts (Sprint P3).
 *
 *   - PdfBackend     → generates a PDF receipt via pdfkit.
 *   - EmailBackend   → sends the PDF to the customer's email via NotificationService.
 *   - EscPosBackend  → prints to a thermal ESC/POS printer over the network.
 *
 * Endpoints exposed by PosReceiptsController:
 *   GET  /pos/receipts/:invoiceId/pdf                         → PDF stream (pdfkit)
 *   GET  /pos/receipts/:invoiceId/text                        → plain-text receipt
 *   POST /pos/receipts/:invoiceId/print                       → ESC/POS print
 *   POST /pos/receipts/:invoiceId/email                       → email PDF
 *   POST /pos/receipts/:invoiceId/reprint                     → alias of /print + audit
 *   POST /pos/receipts/:invoiceId/print-bill                  → print bill
 *   POST /pos/receipts/:invoiceId/print-additional-bill       → print additional bill
 *   POST /pos/receipts/:invoiceId/reprint-bill                → reprint bill
 *   POST /pos/receipts/:invoiceId/print-kot                   → print kitchen ticket
 *   PATCH /pos/receipts/:invoiceId/settings/receipt          → save receipt settings
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Header, NotFoundException,
  Param, Patch, Post, Query, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { Response } from 'express';
import PDFDocument = require('pdfkit');
import { Injectable, Logger, Module } from '@nestjs/common';
import path from 'path';
import fs from 'fs';
import { PNG } from 'pngjs';

import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { NotificationsService } from '../../kernel/notifications/notifications.service';
import { SettingsService } from '../../kernel/settings/settings.service';
import { PosPrintLifecycleService } from './pos-print-lifecycle.service';
import { RequirePermissions } from '../../kernel/auth/decorators/require-permissions.decorator';
import { ReceiptSettingsDto } from './receipt-settings.dto';
import { Prisma } from '@prisma/client';

const fmt = (n: number | string | Prisma.Decimal | null | undefined) =>
  `UGX ${Number(n || 0).toLocaleString()}`;

/** ESC/POS printers speak CP437, not UTF-8 — map common Unicode to ASCII so
 *  multi-byte characters never turn into stray glyphs mid-ticket. */
const toPrinterAscii = (s: string) =>
  s
    .replace(/[—–]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/×/g, 'x')
    .replace(/[^\x00-\x7F]/g, '?');

class ReprintDto {
  @IsString()
  reason!: string;
}

/* ============================== SERVICE ============================== */

@Injectable()
export class PosReceiptsService {
  private readonly logger = new Logger(PosReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly printLifecycle: PosPrintLifecycleService,
  ) {}

  /**
   * Resolve the invoice + lines + partner for a receipt, scoped to the tenant.
   * Queries the `Invoice` table first (new POS flow); falls back to `Document`
   * (legacy ERP flow) for backward compatibility. Lines are normalised to a
   * compat shape so downstream methods work without change.
   */
  async resolveInvoice(invoiceId: string) {
    const orgId = this.tenant.organizationId;

    // Try the POS Invoice table first.
    const inv = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      include: {
        items: { orderBy: { lineNumber: 'asc' }, include: { modifiers: true } },
        order: { select: { orderType: true } },
      },
    });
    if (inv) {
      const [partner, productMap, cashierName, table] = await Promise.all([
        this.prisma.client.partner.findFirst({ where: { id: inv.partnerId } }),
        this.resolveProductsForLines(inv.items.map((i: any) => i.productId).filter(Boolean)),
        this.resolveUserName((inv as any).createdBy ?? (inv as any).postedBy),
        inv.tableId ? this.prisma.client.posTable.findFirst({ where: { id: inv.tableId } }) : Promise.resolve(null),
      ]);
      const linesWithProducts = inv.items.map((ln: any) => ({
        ...ln,
        product: ln.productId ? productMap.get(ln.productId) : null,
      }));
      return { ...inv, documentNumber: inv.invoiceNumber, partner, cashierName, lines: linesWithProducts, orderType: inv.order?.orderType ?? null, tableName: table?.name ?? null };
    }

    // Fallback to the open tab Order (pre-settle bill — no Invoice yet).
    const order = await this.prisma.client.order.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      include: { items: { where: { cancelled: false }, orderBy: { lineNumber: 'asc' }, include: { modifiers: true } } },
    });
    if (!order) throw new NotFoundException('Invoice not found');
    const [partner, productMap, table] = await Promise.all([
      this.prisma.client.partner.findFirst({ where: { id: order.partnerId ?? undefined } }),
      this.resolveProductsForLines((order.items as any[]).map((i: any) => i.productId).filter(Boolean)),
      order.tableId ? this.prisma.client.posTable.findFirst({ where: { id: order.tableId } }) : Promise.resolve(null),
    ]);
    const linesWithProducts = (order.items as any[]).map((ln: any) => {
      const qty = Number(ln.quantity);
      const unit = Number(ln.unitPrice);
      const disc = Number(ln.discountPercent ?? 0);
      return {
        ...ln,
        total: qty * unit * (1 - disc / 100),
        product: ln.productId ? productMap.get(ln.productId) : null,
      };
    });
    const cashierName = await this.resolveUserName((order as any).createdBy ?? (order as any).waiterId);
    // Normalise to the receipt shape (an un-billed tab has no invoice fields yet).
    return {
      ...order,
      documentNumber: order.orderNumber,
      issueDate: order.openedAt ?? order.createdAt,
      amountPaid: 0,
      amountResidual: Number(order.totalAmount),
      partner,
      cashierName,
      lines: linesWithProducts,
      orderType: order.orderType ?? null,
      tableName: table?.name ?? null,
    };
  }

  /** Resolve a user id into a printable "First Last" (or email) for the receipt. */
  private async resolveUserName(userId?: string | null): Promise<string | null> {
    if (!userId) return null;
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, organizationId: this.tenant.organizationId },
      select: { firstName: true, lastName: true, email: true },
    });
    if (!user) return null;
    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return name || user.email || null;
  }

  private async resolveProductsForLines(productIds: string[]): Promise<Map<string, any>> {
    const orgId = this.tenant.organizationId;
    const ids = Array.from(new Set(productIds)) as string[];
    if (!ids.length) return new Map();
    const products = await this.prisma.client.product.findMany({
      where: { id: { in: ids }, organizationId: orgId },
    });
    return new Map((products as any[]).map((p) => [p.id, p]));
  }

  /** Resolve the org + per-organization receipt customization settings for the receipt header. */
  async resolveOrg() {
    const orgId = this.tenant.organizationId;
    const org = await this.prisma.raw.organization.findUnique({ where: { id: orgId } });
    const [headerSetting, footerSetting] = await Promise.all([
      this.settings.get('receipt.header'),
      this.settings.get('receipt.footer'),
    ]);
    const header = (headerSetting as any)?.value as Record<string, string> | undefined;
    const footer = (footerSetting as any)?.value as Record<string, string> | undefined;
    return {
      ...org,
      receiptHeader: header ?? null,
      receiptFooter: footer ?? null,
    };
  }

  /** Save per-organization receipt customization settings. */
  async saveReceiptSettings(dto: {
    businessName?: string;
    addressLine1?: string;
    addressLine2?: string;
    phone?: string;
    taxId?: string;
    footerMessage?: string;
  }) {
    const headerValue: Record<string, string> = {
      businessName: dto.businessName ?? '',
      addressLine1: dto.addressLine1 ?? '',
      addressLine2: dto.addressLine2 ?? '',
      phone: dto.phone ?? '',
      taxId: dto.taxId ?? '',
    };
    const footerValue: Record<string, string> = { message: dto.footerMessage ?? '' };
    await Promise.all([
      this.settings.set('receipt.header', headerValue),
      this.settings.set('receipt.footer', footerValue),
    ]);
    return { ok: true };
  }

  /** Plain-text receipt — used for ESC/POS printers and a "download .txt" option. */
  async buildTextReceipt(invoiceId: string, isReprint = false, copyLabel?: string): Promise<string> {
    const inv = await this.resolveInvoice(invoiceId);
    const org = await this.resolveOrg();
    const lines: string[] = [];
    const header = (org as any).receiptHeader as Record<string, string> | null;
    const footer = (org as any).receiptFooter as Record<string, string> | null;
    const isMerchant = !!copyLabel && /CASHIER|MERCHANT/i.test(copyLabel);
    if (isReprint) lines.push('*** REPRINT COPY ***');
    if (copyLabel) lines.push(`*** ${copyLabel} ***`);

    const R = 48;
    const rule = '='.repeat(R);
    const addr1 = header?.addressLine1 ?? 'AFEE COMPLEX, KASANGA';
    const addr2 = header?.addressLine2 ?? 'Kampala, Uganda';
    const phone = header?.phone ?? '+256757920771';
    const bizName = (header?.businessName ?? 'Abiliz Cafe and Patisserie').toUpperCase();

    lines.push(rule);
    lines.push(bizName);
    lines.push('');
    lines.push(header?.addressLine1 ?? 'AFEE COMPLEX, KASANGA');
    lines.push(header?.addressLine2 ?? 'Kampala, Uganda');
    lines.push(`Telephone: ${header?.phone ?? '+256757920771'}`);
    if (header?.taxId) lines.push(`TIN/VAT: ${header.taxId}`);
    lines.push('');
    lines.push(`Receipt: #${(inv as any).documentNumber}`);
    const d = new Date(inv.issueDate);
    const datePart = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const timePart = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    lines.push(`Date ${datePart}${' '.repeat(3)}${timePart}`);
    lines.push(`Mode: ${((inv as any).paymentMode || 'CASH').toUpperCase()}`);
    lines.push(`Cashier: ${(inv as any).cashierName ?? '-'}`);
    const custName = (inv as any).partner?.name;
    if (custName && custName !== 'Walk-in Customer') lines.push(`Customer: ${custName}`);
    lines.push('');
    const num = (n: number | string | Prisma.Decimal | null | undefined) =>
      Number(n || 0).toLocaleString();
    lines.push(` ${'Qty'.padStart(3)} ${'Item'.padEnd(22)} ${'Price'.padStart(8)} ${'Total'.padStart(10)}`);
    lines.push('-'.repeat(R));

    for (const ln of inv.lines) {
      const qty = Number(ln.quantity);
      const price = Number(ln.unitPrice);
      const disc = Number(ln.discountPercent ?? 0);
      const lineTotal = qty * price * (1 - disc / 100);
      const inclTag = (ln as any).taxInclusive ? ' (incl)' : '';
      const variantTag = (ln as any).variantName ? `${ln.variantName} ` : '';
      const desc = (variantTag + ln.description + inclTag).slice(0, 22).padEnd(22);
      const qtyStr = String(qty).padStart(3);
      const priceStr = num(price).padStart(8);
      const totalStr = num(lineTotal).padStart(10);
      lines.push(` ${qtyStr} ${desc} ${priceStr} ${totalStr}`);
      const mods: any[] = (ln as any).modifiers ?? [];
      for (const m of mods) {
        lines.push(`      + ${(m.name ?? '').slice(0, 22)}`);
      }
      if (disc > 0) lines.push(`      (discount ${disc}%)`);
      if (ln.note) {
        lines.push(`      ${ln.note.slice(0, R - 6)}`);
      }
    }

    lines.push('');
    lines.push('');
    lines.push('-'.repeat(R));
    lines.push(`Subtotal:`.padEnd(R - 10) + fmt(inv.subtotal).padStart(10));
    if (Number(inv.discountTotal) > 0) lines.push(`Discount:`.padEnd(R - 10) + `-${fmt(inv.discountTotal)}`.padStart(10));
    if (Number(inv.taxAmount) > 0) lines.push(`Tax:`.padEnd(R - 10) + fmt(inv.taxAmount).padStart(10));
    lines.push(`TOTAL:`.padEnd(R - 10) + fmt(inv.totalAmount).padStart(10));
    lines.push(`Paid:`.padEnd(R - 10) + fmt(inv.amountPaid).padStart(10));
    // Cash-change: when the customer handed over more than the bill, show the cash
    // tendered + change returned (Invoice.amountTendered; falls back to Paid = no change).
    const tendered = Number((inv as any).amountTendered ?? inv.amountPaid);
    const change = Math.max(0, tendered - Number(inv.totalAmount));
    if (tendered > Number(inv.amountPaid) + 0.001) lines.push(`Cash tendered:`.padEnd(R - 10) + fmt(tendered).padStart(10));
    if (change > 0) lines.push(`Change:`.padEnd(R - 10) + fmt(change).padStart(10));
    if ((inv as any).discountReason) lines.push(`Why: ${(inv as any).discountReason}`);
    if ((inv as any).discountApprovedBy) lines.push(`Approved: ${(inv as any).discountApprovedBy}`);
    lines.push('-'.repeat(R));
    lines.push('');
    lines.push('');
    if (isMerchant) {
      lines.push('CASHIER COPY — keep for records'.padStart(R));
      lines.push('');
      lines.push('Signature: ____________________'.padStart(R));
    } else {
      lines.push((footer?.message ?? 'Thank you!').padStart(R));
    }
    return lines.join('\n');
  }

  /** HTML receipt — opens browser print dialog when loaded. */
  async buildHtmlReceipt(invoiceId: string, isReprint = false, copyLabel?: string): Promise<string> {
    const inv = await this.resolveInvoice(invoiceId);
    const org = await this.resolveOrg();
    const lines: string[] = [];
    const header = (org as any).receiptHeader as Record<string, string> | null;
    const footer = (org as any).receiptFooter as Record<string, string> | null;
    const isMerchant = !!copyLabel && /CASHIER|MERCHANT/i.test(copyLabel);
    if (isReprint) lines.push('*** REPRINT COPY ***');
    if (copyLabel) lines.push(`*** ${copyLabel} ***`);

    const W = 46;
    const money = (n: number | string | Prisma.Decimal | null | undefined) =>
      Number(n || 0).toLocaleString();
    const center = (s: string) => {
      const pad = Math.max(0, Math.floor((W - s.length) / 2));
      return ' '.repeat(pad) + s;
    };
    const two = (l: string, r: string) => {
      const gap = Math.max(1, W - l.length - r.length);
      return l + ' '.repeat(gap) + r;
    };
    const addr1 = header?.addressLine1 ?? 'AFEE COMPLEX, KASANGA';
    const addr2 = header?.addressLine2 ?? 'Kampala, Uganda';
    const phone = header?.phone ?? '+256757920771';
    const bizName = (header?.businessName ?? 'Abiliz Cafe and Patisserie').toUpperCase();

    lines.push('='.repeat(W));
    lines.push(center(bizName));
    lines.push(center(addr1));
    lines.push(center(addr2));
    lines.push(center(`Tel: ${phone}`));
    if (header?.taxId) lines.push(center(`TIN/VAT: ${header.taxId}`));
    lines.push('-'.repeat(W));
    lines.push(`Receipt #${(inv as any).documentNumber}`);
    const d = new Date(inv.issueDate);
    const datePart = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const timePart = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    lines.push(`${datePart}  ${timePart}`);
    lines.push(`Mode: ${((inv as any).paymentMode || 'CASH').toUpperCase()}`);
    lines.push(`Cashier: ${(inv as any).cashierName ?? '-'}`);
    const custNameH = (inv as any).partner?.name;
    if (custNameH && custNameH !== 'Walk-in Customer') lines.push(`Customer: ${custNameH}`);
    lines.push('-'.repeat(W));

    // Compact item columns — no currency prefix in the item table.
    const qtyW = 3;
    const descW = 26;
    const priceW = 8;
    const totalW = W - qtyW - 3 - descW - priceW;
    lines.push(
      `${'Qty'.padStart(qtyW)} ${'Item'.padEnd(descW)} ${'Price'.padStart(priceW)} ${'Total'.padStart(totalW)}`,
    );
    lines.push('-'.repeat(W));

    for (const ln of inv.lines) {
      const qty = Number(ln.quantity);
      const price = Number(ln.unitPrice);
      const disc = Number(ln.discountPercent ?? 0);
      const lineTotal = qty * price * (1 - disc / 100);
      const inclTag = (ln as any).taxInclusive ? ' (incl)' : '';
      const variantTag = (ln as any).variantName ? `${ln.variantName} ` : '';

      const qtyStr = String(qty).padStart(qtyW);
      const desc = (variantTag + ln.description + inclTag).slice(0, descW).padEnd(descW);
      const priceStr = money(price).padStart(priceW);
      const totalStr = money(lineTotal).padStart(totalW);
      lines.push(`${qtyStr} ${desc} ${priceStr} ${totalStr}`);

      const mods: any[] = (ln as any).modifiers ?? [];
      for (const m of mods) {
        lines.push(`     + ${(m.name ?? '').slice(0, W - 6)}`);
      }
      if (ln.note) {
        lines.push(`     ${ln.note.slice(0, W - 6)}`);
      }
    }

    lines.push('-'.repeat(W));
    lines.push(two('Subtotal:', fmt(inv.subtotal)));
    if (Number(inv.discountTotal) > 0) {
      const typeTag = (inv as any).discountType === 'fixed_amount'
        ? ' (fixed)'
        : (inv as any).discountValue && Number((inv as any).discountValue) > 0
          ? ` (${Number((inv as any).discountValue).toFixed(1)}%)`
          : '';
      lines.push(two(`Discount${typeTag}:`, `-${fmt(inv.discountTotal)}`));
      if ((inv as any).discountReason) lines.push(`  Why: ${(inv as any).discountReason}`);
      if ((inv as any).discountApprovedBy) lines.push(`  Approved: ${(inv as any).discountApprovedBy}`);
    }
    if (Number(inv.taxAmount) > 0) lines.push(two('Tax:', fmt(inv.taxAmount)));
    lines.push(two('TOTAL:', fmt(inv.totalAmount)));
    lines.push(two('Paid:', fmt(inv.amountPaid)));
    // Cash-change: cash tendered + change returned when the customer overpaid.
    const tendered = Number((inv as any).amountTendered ?? inv.amountPaid);
    const change = Math.max(0, tendered - Number(inv.totalAmount));
    if (tendered > Number(inv.amountPaid) + 0.001) lines.push(two('Cash tendered:', fmt(tendered)));
    if (change > 0) lines.push(two('Change:', fmt(change)));
    lines.push('-'.repeat(W));
    if (isMerchant) {
      lines.push(center('CASHIER COPY — keep for records'));
      lines.push('');
      lines.push(center('Signature: ____________________'));
    } else {
      lines.push(center(footer?.message ?? 'Thank you!'));
    }
    // Wrap the monospace text in an HTML envelope: white-space:pre + a fixed
    // monospace font preserve the column alignment (returning bare text makes the
    // browser collapse the newlines/spaces → "dispersed" layout).
    const text = lines.join('\n');
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { margin:0; padding:0; width:72mm; height:auto; }
  body { font-family:'Courier New',Courier,monospace; font-size:9.5px; line-height:1.25; white-space:pre; padding:1mm; }
  @media print {
    @page { margin:0; size:72mm 297mm; }
    html,body { width:72mm; height:auto; }
    /* 14mm bottom padding feeds the last lines past the tear bar/cutter —
       a print concern only; on screen it rendered as a blank band. */
    body { padding:1mm 1mm 14mm; }
  }
</style></head>
<body>${escape(text).replace(/\n/g, '<br>')}<script>
  // "size:80mm auto" is invalid CSS (dropped by browsers), which left the page
  // size to the driver's custom thermal paper — that broke print preview and
  // paginated long receipts so the cutter fired mid-receipt. Size the page to
  // the exact content height instead: one continuous page, one cut at the end.
  // The 14mm bottom padding feeds the last lines past the tear bar/cutter.
  window.onload=function(){
      var mm=Math.max(40,Math.ceil(document.body.scrollHeight*25.4/96)+4);
      var s=document.createElement('style');
      s.textContent='@page { size:72mm '+mm+'mm; margin:0; }';
      document.head.appendChild(s);
    };
</script></body></html>`;
  }

  /** PDF receipt — pdfkit stream. */
  async buildPdfReceipt(invoiceId: string, isReprint = false): Promise<Buffer> {
    const inv = await this.resolveInvoice(invoiceId);
    const org = await this.resolveOrg();
    const header = (org as any).receiptHeader as Record<string, string> | null;
    const footer = (org as any).receiptFooter as Record<string, string> | null;
    const cashierSetting = await this.settings.get('pos.printCashierCopy');
    const includeCashier = cashierSetting?.value !== 'false';
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: [226, 600], margin: 0 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const drawPage = (copyLabel: string) => {
        const isMerchant = /CASHIER|MERCHANT/i.test(copyLabel);
        if (isReprint) doc.font('Helvetica-Bold').fontSize(10).text('*** REPRINT COPY ***');
        doc.font('Helvetica-Bold').fontSize(10).text(`*** ${copyLabel} ***`);
        doc.moveDown(0.35);

        // Centered logo above the business name (skipped silently if the
        // asset is missing — receipts must never fail over branding).
        try {
          const logoPath = this.getLogoPath();
          if (logoPath) {
            const imgWidth = 40;
            const imgHeight = 40;
            const x = (226 - imgWidth) / 2;
            doc.image(logoPath, x, doc.y, { width: imgWidth, height: imgHeight });
            doc.y += imgHeight + 10;
          }
        } catch { /* no logo — continue with the text header */ }

        const bizName = (header?.businessName ?? 'Abiliz Cafe and Patisserie').toUpperCase();
        doc.font('Helvetica-Bold').fontSize(20).text(bizName);
        doc.font('Courier-Bold').fontSize(9).text('='.repeat(42));
        doc.moveDown(0.3);

        doc.font('Helvetica').fontSize(9);
        doc.text(header?.addressLine1 ?? 'AFEE COMPLEX, KASANGA');
        doc.text(header?.addressLine2 ?? 'Kampala, Uganda');
        doc.moveDown(0.1);
        doc.text(`Telephone: ${header?.phone ?? '+256757920771'}`);
        if (header?.taxId) doc.text(`TIN/VAT: ${header.taxId}`);
        doc.moveDown(0.25);

        doc.text(`Receipt #${(inv as any).documentNumber}`);
        doc.moveDown(0.2);
        const d = new Date(inv.issueDate);
        const datePart = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const timePart = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        doc.text(`${datePart}${'     '.repeat(1)}${timePart}`);
        doc.text(`Cashier: ${(inv as any).cashierName ?? '-'}`);
        doc.moveDown(0.3);

        doc.font('Courier-Bold').fontSize(8);
        doc.text('Qty...Item............... Price....... Total', 8, doc.y, { width: 210 });
        doc.moveDown(0.12);
        doc.font('Courier').fontSize(8);
        doc.text('-'.repeat(42), 8, doc.y, { width: 210 });
        doc.moveDown(0.12);

        for (const ln of inv.lines) {
          const qty = Number(ln.quantity);
          const price = Number(ln.unitPrice);
          const lineTotal = qty * price;
          const qtyStr = String(qty).padStart(1);
          const variantTag = (ln as any).variantName ? `${ln.variantName} ` : '';
          const desc = (variantTag + ln.description).slice(0, 18).padEnd(18);
          const priceStr = fmt(price).padStart(8);
          const totalStr = fmt(lineTotal).padStart(9);
          doc.text(`${qtyStr} ${desc} ${priceStr} ${totalStr}`, 8, doc.y, { width: 210 });
          doc.moveDown(0.15);
          const mods: any[] = (ln as any).modifiers ?? [];
          for (const m of mods) {
            doc.font('Courier-Oblique').fontSize(7);
            doc.text(`      + ${(m.name ?? '').slice(0, 35)}`, 8, doc.y, { width: 210 });
            doc.moveDown(0.12);
          }
          if (ln.note) {
            doc.font('Courier-Oblique').fontSize(7);
            doc.text(`      ${ln.note.slice(0, 32).padEnd(32)}`, 8, doc.y, { width: 210 });
            doc.moveDown(0.12);
          }
          doc.font('Courier').fontSize(8);
        }

        doc.moveDown(0.12);
        doc.moveDown(0.12);
        doc.font('Courier').fontSize(8);
        doc.text('-'.repeat(42), 8, doc.y, { width: 210 });
        doc.moveDown(0.12);
        doc.text(`Subtotal:`.padEnd(33) + fmt(inv.subtotal).padStart(9), 8, doc.y, { width: 210 });
        doc.moveDown(0.12);
        if (Number((inv as any).discountTotal) > 0) {
          const typeTag = (inv as any).discountType === 'fixed_amount'
            ? ' (fixed)'
            : (inv as any).discountValue && Number((inv as any).discountValue) > 0
              ? ` (${Number((inv as any).discountValue).toFixed(1)}%)`
              : '';
          doc.text(`Discount${typeTag}:`.padEnd(33) + `-${fmt((inv as any).discountTotal)}`.padStart(9), 8, doc.y, { width: 210 });
          doc.moveDown(0.12);
          if ((inv as any).discountReason) {
            doc.font('Courier-Oblique').fontSize(7);
            doc.text(`Why: ${(inv as any).discountReason}`.slice(0, 42), 8, doc.y, { width: 210 });
            doc.moveDown(0.12);
            doc.font('Courier').fontSize(8);
          }
          if ((inv as any).discountApprovedBy) {
            doc.font('Courier-Oblique').fontSize(7);
            doc.text(`Approved: ${(inv as any).discountApprovedBy}`.slice(0, 42), 8, doc.y, { width: 210 });
            doc.moveDown(0.12);
            doc.font('Courier').fontSize(8);
          }
        }
        if (Number((inv as any).taxAmount) > 0) {
          doc.text(`Tax:`.padEnd(33) + fmt((inv as any).taxAmount).padStart(9), 8, doc.y, { width: 210 });
          doc.moveDown(0.12);
        }
        doc.text(`Total:`.padEnd(33) + fmt(inv.totalAmount).padStart(9), 8, doc.y, { width: 210 });
        doc.moveDown(0.12);
        doc.text(`Paid:`.padEnd(33) + fmt(inv.amountPaid).padStart(9), 8, doc.y, { width: 210 });
        doc.moveDown(0.12);
        // Cash-change: cash tendered + change returned when the customer overpaid.
        const tendered = Number((inv as any).amountTendered ?? inv.amountPaid);
        const change = Math.max(0, tendered - Number(inv.totalAmount));
        if (tendered > Number(inv.amountPaid) + 0.001) {
          doc.text(`Cash tendered:`.padEnd(33) + fmt(tendered).padStart(9), 8, doc.y, { width: 210 });
          doc.moveDown(0.12);
        }
        doc.text(`Change:`.padEnd(33) + fmt(change).padStart(9), 8, doc.y, { width: 210 });
        doc.moveDown(0.12);
        doc.text(`Mode:`.padEnd(33) + ((inv as any).paymentMode || 'CASH').toUpperCase().padStart(9), 8, doc.y, { width: 210 });
        doc.moveDown(0.12);
        doc.font('Courier').fontSize(8);
        doc.text('-'.repeat(42), 8, doc.y, { width: 210 });
        doc.moveDown(0.25);
        doc.moveDown(0.25);
        doc.font('Helvetica').fontSize(9);
        doc.text((footer?.message ?? 'Thank you!'));
      };

      drawPage('CUSTOMER COPY');
      if (includeCashier) {
        doc.addPage();
        drawPage('CASHIER COPY');
      }
      doc.end();
    });
  }

  /** Send the receipt to the customer's email. Returns { ok: true, sentTo } on success. */
  async emailReceipt(invoiceId: string): Promise<{ ok: boolean; sentTo?: string; message?: string }> {
    const inv = await this.resolveInvoice(invoiceId);
    const customerEmail = (inv as any).partner?.email;
    if (!customerEmail) {
      return { ok: false, message: 'Customer has no email on file. Add one in Partners.' };
    }
    const orgId = this.tenant.organizationId;
    const pdf = await this.buildPdfReceipt(invoiceId);
    const text = await this.buildTextReceipt(invoiceId);
    await this.notifications.send({
      organizationId: orgId,
      channel: 'email',
      category: 'transactional',
      title: `Receipt ${(inv as any).documentNumber}`,
      body: text,
      payload: {
        kind: 'pos_receipt',
        invoiceId,
        invoiceNumber: (inv as any).documentNumber,
        attachment: {
          filename: `receipt-${(inv as any).documentNumber}.pdf`,
          contentType: 'application/pdf',
          data: pdf.toString('base64'),
        },
      },
    });
    await this.printLifecycle.markReceiptPrinted(this.prisma.client, invoiceId, this.tenant.userId ?? undefined);
    await this.printLifecycle.recordPrintLog(this.prisma.client, {
      organizationId: orgId,
      documentId: invoiceId,
      type: 'RECEIPT',
      action: 'PRINT',
      printedById: this.tenant.userId ?? undefined,
    });
    await this.audit.record({
      entity: 'Document',
      entityId: invoiceId,
      action: 'update',
      newValues: { receiptEmailedTo: customerEmail },
    });
    return { ok: true, sentTo: customerEmail };
  }

  // ... (rest of the service methods unchanged) ...

  /** Pre-payment bill preview (text). */
  /* ─────────── Shared 48-column ticket frame ───────────
   * The settlement receipt (buildTextReceipt) is the reference layout; these
   * helpers reproduce its header / date / item-row / totals conventions so the
   * bill, additional bill and KOT print with the same look.
   */
  private static readonly TICKET_W = 48;

  private ticketHeader(header: Record<string, string> | null): string[] {
    const R = PosReceiptsService.TICKET_W;
    return [
      '='.repeat(R),
      (header?.businessName ?? 'Abiliz Cafe and Patisserie').toUpperCase(),
      '',
      header?.addressLine1 ?? 'AFEE COMPLEX, KASANGA',
      header?.addressLine2 ?? 'Kampala, Uganda',
      `Telephone: ${header?.phone ?? '+256757920771'}`,
      ...(header?.taxId ? [`TIN/VAT: ${header.taxId}`] : []),
      '',
    ];
  }

  private ticketDate(d: Date): string {
    const datePart = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const timePart = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `Date ${datePart}   ${timePart}`;
  }

  /** `Qty Item Price Total` rows exactly like the settlement receipt. */
  private ticketItemRows(items: any[], out: string[]): void {
    const num = (n: number | string | Prisma.Decimal | null | undefined) => Number(n || 0).toLocaleString();
    for (const ln of items) {
      const qty = Number(ln.quantity);
      const price = Number(ln.unitPrice);
      const disc = Number(ln.discountPercent ?? 0);
      const lineTotal = qty * price * (1 - disc / 100);
      const inclTag = ln.taxInclusive ? ' (incl)' : '';
      const variantTag = ln.variantName ? `${ln.variantName} ` : '';
      const desc = (variantTag + ln.description + inclTag).slice(0, 22).padEnd(22);
      out.push(` ${String(qty).padStart(3)} ${desc} ${num(price).padStart(8)} ${num(lineTotal).padStart(10)}`);
      for (const m of ln.modifiers ?? []) {
        out.push(`      + ${(m.name ?? '').slice(0, 38)}`);
      }
      for (const a of ln.accompanimentNames ?? []) {
        out.push(`      + ${String(a).slice(0, 38)}`);
      }
      if (disc > 0) out.push(`      (discount ${disc}%)`);
      if (ln.note) out.push(`      ${String(ln.note).slice(0, 40)}`);
    }
  }

  /** Right-aligned totals row that always fits the 48-column frame. */
  private ticketTotal(label: string, value: string): string {
    const R = PosReceiptsService.TICKET_W;
    const gap = Math.max(1, R - label.length - value.length);
    return label + ' '.repeat(gap) + value;
  }

  /**
   * Pre-payment bill — same 48-column frame as the settlement receipt; only
   * the document block differs (a bill shows the amount due, never Paid/Change).
   */
  async buildTextBill(invoiceId: string, isReprint = false): Promise<string> {
    const inv = await this.resolveInvoice(invoiceId);
    const org = await this.resolveOrg();
    const header = (org as any).receiptHeader as Record<string, string> | null;
    const R = PosReceiptsService.TICKET_W;
    const orderTypeLabels: Record<string, string> = { dine_in: 'Dine In', takeaway: 'Take Away', delivery: 'Delivery' };
    const lines: string[] = [];
    if (isReprint) lines.push('*** REPRINT COPY ***');
    lines.push('*** BILL ***');
    lines.push(...this.ticketHeader(header));
    lines.push(`Bill: #${(inv as any).documentNumber}`);
    lines.push(this.ticketDate(new Date(inv.issueDate)));
    if ((inv as any).orderType) lines.push(`Order: ${orderTypeLabels[(inv as any).orderType] ?? (inv as any).orderType}`);
    if ((inv as any).tableName) lines.push(`Table: ${(inv as any).tableName}`);
    lines.push('');
    lines.push(` ${'Qty'.padStart(3)} ${'Item'.padEnd(22)} ${'Price'.padStart(8)} ${'Total'.padStart(10)}`);
    lines.push('-'.repeat(R));
    this.ticketItemRows(inv.lines as any[], lines);
    lines.push('');
    lines.push('');
    lines.push('-'.repeat(R));
    lines.push(this.ticketTotal('Subtotal:', fmt(inv.subtotal)));
    if (Number(inv.discountTotal) > 0) lines.push(this.ticketTotal('Discount:', `-${fmt(inv.discountTotal)}`));
    if ((inv as any).discountReason) lines.push(this.ticketTotal('Why:', (inv as any).discountReason));
    if (Number(inv.taxAmount) > 0) lines.push(this.ticketTotal('Tax:', fmt(inv.taxAmount)));
    lines.push(this.ticketTotal('TOTAL DUE:', fmt(inv.totalAmount)));
    lines.push('-'.repeat(R));
    lines.push('');
    lines.push('');
    lines.push('Thank you for your patience!'.padStart(R));
    return lines.join('\n');
  }

  // ... (remaining methods unchanged – assertCanReprint, printBill, getUnbilledLines, buildTextKot, etc.) ...

  /** Assert the current user has an Admin or Manager role. */
  private async assertCanReprint(userId: string | undefined): Promise<void> {
    if (!userId) throw new ForbiddenException('Authentication required for reprint');
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, organizationId: this.tenant.organizationId },
      include: { roles: true },
    });
    if (!user) throw new ForbiddenException('User not found');
    const roleNames = user.roles.map((r: any) => (r.name ?? '').toLowerCase());
    const isAdminOrManager = roleNames.some((n: string) => n.includes('admin') || n.includes('manager'));
    if (!isAdminOrManager) {
      throw new ForbiddenException(
        'Only Admin/Manager can reprint bills and receipts. Record a reason in the audit log.',
      );
    }
  }

  /**
   * Resolve the logo asset across build layouts: dist may be flat
   * (dist/modules/pos → 4 ups to apps/) or src-nested (dist/src/modules/pos →
   * 5 ups), and ts-node runs from src (5 ups). Falls back to cwd-relative
   * paths for monorepo-root launches. Returns null when absent — receipts
   * must never fail over branding.
   */
  private resolvedLogoPath: string | null | undefined = undefined;

  private getLogoPath(): string | null {
    if (this.resolvedLogoPath !== undefined) return this.resolvedLogoPath;
    const candidates = [
      path.join(__dirname, '../../../../../web/public/abiliz-logo.png'),
      path.join(__dirname, '../../../../web/public/abiliz-logo.png'),
      path.resolve(process.cwd(), '../web/public/abiliz-logo.png'),
      path.resolve(process.cwd(), 'apps/web/public/abiliz-logo.png'),
    ];
    this.resolvedLogoPath = candidates.find((p) => fs.existsSync(p)) ?? null;
    if (!this.resolvedLogoPath) this.logger.warn('[POS] Logo file not found (searched dist/src/cwd layouts)');
    return this.resolvedLogoPath;
  }

  /** Load the logo and convert to ESC/POS GS v 0 raster image bytes (cached). */
  private escposLogoBuf: Buffer | null | undefined = undefined;

  private getEscposLogo(): Buffer | null {
    if (this.escposLogoBuf !== undefined) return this.escposLogoBuf;
    try {
      const logoPath = this.getLogoPath();
      if (!logoPath) {
        this.escposLogoBuf = null;
        return null;
      }
      const raw = fs.readFileSync(logoPath);
      const img = PNG.sync.read(raw);

      const MAX_WIDTH = 300;
      const scale = Math.min(1, MAX_WIDTH / img.width);
      const w = Math.floor(img.width * scale);
      const h = Math.floor(img.height * scale);

      const pixels: number[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = Math.floor(x / scale);
          const sy = Math.floor(y / scale);
          const idx = (sy * img.width + sx) * 4;
          const r = img.data[idx];
          const g = img.data[idx + 1];
          const b = img.data[idx + 2];
          const a = img.data[idx + 3];
          const isWhite = a === 0 || (r > 200 && g > 200 && b > 200);
          pixels.push(isWhite ? 0 : 1);
        }
      }

      const bytesPerRow = Math.ceil(w / 8);
      const raster = new Array(bytesPerRow * h).fill(0);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (pixels[y * w + x]) {
            const byteIdx = y * bytesPerRow + Math.floor(x / 8);
            raster[byteIdx] |= (0x80 >> (x % 8));
          }
        }
      }

      const buf = Buffer.alloc(4 + 4 + raster.length);
      buf[0] = 0x1D; buf[1] = 0x76; buf[2] = 0x30; buf[3] = 0x00;
      buf.writeUInt16LE(bytesPerRow, 4);
      buf.writeUInt16LE(h, 6);
      Buffer.from(raster).copy(buf, 8);

      this.escposLogoBuf = buf;
      this.logger.log(`[POS] Logo loaded (${w}x${h} → ${bytesPerRow}x${h} bytes)`);
      return buf;
    } catch (e: any) {
      this.logger.warn(`[POS] Failed to load logo: ${e?.message}`);
      this.escposLogoBuf = null;
      return null;
    }
  }

  /* ─────────── Raw ESC/POS transport ───────────
   * Preference order:
   *  1. pos.printerHost (+ pos.printerPort, default 9100) → network printer, TCP.
   *  2. pos.printerWindowsName → printer installed on the API host's Windows
   *     spooler (USB printers like the SP-240 that have no network port).
   *     Bytes are spooled with datatype RAW via winspool, so the driver's
   *     broken paper forms (80mm x 99999mm) are never involved.
   *  3. neither → 'none'; call sites log the ticket text to the console.
   */
  async resolvePrintTarget(): Promise<
    | { kind: 'tcp'; host: string; port: number; backend: string }
    | { kind: 'windows'; printerName: string; backend: string }
    | { kind: 'none'; backend: string }
  > {
    const hostValue = (await this.settings.get('pos.printerHost'))?.value;
    const host = hostValue == null || hostValue === '' ? null : String(hostValue);
    if (host) {
      const portSetting = await this.settings.get('pos.printerPort');
      return { kind: 'tcp', host, port: portSetting?.value ? Number(portSetting.value) : 9100, backend: 'escpos' };
    }
    const winValue = (await this.settings.get('pos.printerWindowsName'))?.value;
    const winName = winValue == null || winValue === '' ? null : String(winValue);
    if (winName) {
      if (process.platform !== 'win32') {
        this.logger.warn(`[POS] pos.printerWindowsName is set but the API host is not Windows; falling back to console.`);
        return { kind: 'none', backend: 'console' };
      }
      return { kind: 'windows', printerName: winName, backend: 'windows-raw' };
    }
    return { kind: 'none', backend: 'console' };
  }

  /** Send raw ESC/POS bytes to the resolved target. Throws on failure. */
  async sendRaw(
    target: { kind: 'tcp'; host: string; port: number } | { kind: 'windows'; printerName: string } | { kind: 'none' },
    payload: Buffer,
  ): Promise<void> {
    if (target.kind === 'none') throw new Error('No printer configured');
    if (target.kind === 'tcp') {
      const net = require('net');
      await new Promise<void>((resolve, reject) => {
        const client = net.connect({ host: target.host, port: target.port, timeout: 5000 }, () => {
          // Single flushed write preserves byte order; writing piecemeal then
          // calling end() can drop the trailing cut bytes.
          client.write(payload, () => client.end());
        });
        client.on('close', () => resolve());
        client.on('error', reject);
        client.on('timeout', () => { client.destroy(); reject(new Error('printer timeout')); });
      });
      return;
    }
    await this.sendWindowsRaw(target.printerName, payload);
  }

  /**
   * Spool raw bytes to a local Windows printer (datatype RAW → the spooler
   * passes them straight to the port, no driver rendering). Implemented as an
   * inline PowerShell + winspool P/Invoke helper so no native Node module and
   * no on-disk script (dist layouts vary) is needed.
   */
  private async sendWindowsRaw(printerName: string, payload: Buffer): Promise<void> {
    const os = require('os');
    const tmpDir = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp') : os.tmpdir();
    const tmp = path.join(tmpDir, `escpos-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
    fs.writeFileSync(tmp, payload);
    const script = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)] public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)] public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
  public static string Send(string printer, byte[] bytes) {
    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "OpenPrinter failed: " + Marshal.GetLastWin32Error();
    var di = new DOCINFOA(); di.pDocName = "POS ticket"; di.pDataType = "RAW";
    if (!StartDocPrinter(h, 1, di)) { ClosePrinter(h); return "StartDocPrinter failed: " + Marshal.GetLastWin32Error(); }
    StartPagePrinter(h); int written;
    bool ok = WritePrinter(h, bytes, bytes.Length, out written);
    EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h);
    return ok ? ("OK " + written) : ("WritePrinter failed: " + Marshal.GetLastWin32Error());
  }
}
'@
$bytes = [System.IO.File]::ReadAllBytes($env:ESCPOS_FILE)
$r = [RawPrint]::Send($env:ESCPOS_PRINTER, $bytes)
if ($r -like 'OK*') { Write-Output $r; exit 0 } else { [Console]::Error.WriteLine($r); exit 1 }
`;
    const { execFile } = require('child_process');
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
          { env: { ...process.env, TMP: tmpDir, TEMP: tmpDir, ESCPOS_FILE: tmp, ESCPOS_PRINTER: printerName }, timeout: 20000, windowsHide: true },
          (err: any, _stdout: string, stderr: string) => {
            if (err) reject(new Error((stderr || '').trim() || err.message));
            else resolve();
          },
        );
      });
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* temp cleanup is best-effort */ }
    }
  }

  /**
   * Print a paper KOT for already-computed kitchen deltas. Called by the
   * fire-kitchen flow right after it creates the KDS tickets — the KDS decides
   * WHAT fires; this puts the same delta on paper. Never throws: a kitchen
   * fire must not fail because the printer is off.
   */
  async printKotPaper(
    orderId: string,
    addLines: Array<{ line: any; delta: number }>,
    removeLines: Array<{ line: any; delta: number }> = [],
  ): Promise<{ ok: boolean; backend: string; kotNumber?: number; message?: string }> {
    try {
      if (addLines.length === 0 && removeLines.length === 0) {
        return { ok: true, backend: 'none', message: 'No kitchen changes to print' };
      }
      const kotNumber = await this.printLifecycle.getKotCopyNumber(this.prisma.client, orderId);
      const text = addLines.length > 0
        ? await this.buildTextKot(orderId, kotNumber, addLines, removeLines)
        : await this.buildTextCancelKot(orderId, kotNumber, removeLines);
      await this.printLifecycle.markKotPrinted(this.prisma.client, orderId, this.tenant.userId ?? undefined);
      const logType = removeLines.length > 0 && addLines.length === 0 ? 'CANCEL' : 'KOT';

      const target = await this.resolvePrintTarget();
      if (target.kind === 'none') {
        this.logger.warn(`[POS] No printer configured; KOT #${kotNumber}:\n${text}`);
        await this.printLifecycle.recordPrintLog(this.prisma.client, {
          organizationId: this.tenant.organizationId, documentId: orderId, type: logType, printedById: this.tenant.userId ?? undefined,
        });
        return { ok: true, backend: 'console', kotNumber };
      }

      const payload = Buffer.concat([
        Buffer.from(toPrinterAscii(text) + '\n', 'ascii'),
        await this.feedBuffer(),
        Buffer.from([0x1d, 0x56, 0x00]), // GS V 0 — full cut
      ]);
      await this.sendRaw(target, payload);
      await this.printLifecycle.recordPrintLog(this.prisma.client, {
        organizationId: this.tenant.organizationId, documentId: orderId, type: logType, printedById: this.tenant.userId ?? undefined,
      });
      return { ok: true, backend: target.backend, kotNumber };
    } catch (e: any) {
      this.logger.warn(`[POS] Paper KOT failed (kitchen fire continues): ${e?.message}`);
      return { ok: false, backend: 'error', message: e?.message ?? 'printer error' };
    }
  }

  /** Print a pre-payment bill (ESC/POS). */
  async printBill(invoiceId: string, userId?: string, isReprint = false): Promise<{ ok: boolean; backend: string; message?: string }> {
    if (!isReprint) {
      const inv = await this.prisma.client.invoice.findFirst({
        where: { id: invoiceId, organizationId: this.tenant.organizationId },
        select: { billPrintCount: true },
      });
      const prior = inv?.billPrintCount ?? (
        await this.prisma.client.order.findFirst({
          where: { id: invoiceId, organizationId: this.tenant.organizationId },
          select: { billPrintCount: true },
        })
      )?.billPrintCount ?? 0;
      if (prior > 0) {
        throw new ForbiddenException('Bill already printed. Use the reprint endpoint (Admin/Manager only, with a reason).');
      }
    }

    const text = await this.buildTextBill(invoiceId, isReprint);
    const orgId = this.tenant.organizationId;
    await this.printLifecycle.markBillPrinted(this.prisma.client, invoiceId, userId);
    await this.printLifecycle.markLinesBilled(this.prisma.client, invoiceId, userId);

    const target = await this.resolvePrintTarget();

    if (target.kind === 'none') {
      this.logger.warn(`[POS] No printer configured; bill:\n${text}`);
      await this.printLifecycle.recordPrintLog(this.prisma.client, {
        organizationId: orgId, documentId: invoiceId, type: 'BILL', printedById: userId,
      });
      return { ok: true, backend: 'console', message: 'No printer configured; bill logged to server console.' };
    }

    try {
      // Feed past the head→cutter gap, then cut — otherwise the tail of the
      // bill stays inside the printer and has to be pushed out by hand.
      // No raster logo: the settlement receipt prints text-only and the bill
      // mirrors its layout exactly.
      const parts: Buffer[] = [];
      parts.push(Buffer.from(toPrinterAscii(text) + '\n', 'ascii'), await this.feedBuffer(), Buffer.from([0x1d, 0x56, 0x00]));
      await this.sendRaw(target, Buffer.concat(parts));
      await this.printLifecycle.recordPrintLog(this.prisma.client, {
        organizationId: orgId, documentId: invoiceId, type: 'BILL', printedById: userId,
      });
      return { ok: true, backend: target.backend };
    } catch (e: any) {
      this.logger.warn(`[POS] Printer unreachable; bill fallback: ${e?.message}`);
      return { ok: false, backend: 'escpos', message: e?.message ?? 'printer error; bill fallback' };
    }
  }

  /** Fetch only the lines that have NOT yet appeared on a printed bill. Only the
   *  legacy Document tracks per-line bill state; for an open tab Order we return
   *  all current items (the full bill is printed each time). */
  private async getUnbilledLines(recordId: string): Promise<any[]> {
    const orgId = this.tenant.organizationId;
    const doc = await this.prisma.client.document.findFirst({ where: { id: recordId, organizationId: orgId }, select: { id: true } });
    if (doc) {
      return this.prisma.client.documentLine.findMany({
        where: { documentId: recordId, organizationId: orgId, billPrintedAt: null },
        orderBy: { lineNumber: 'asc' },
      });
    }
    const order = await this.prisma.client.order.findFirst({
      where: { id: recordId, organizationId: orgId },
      include: { items: { where: { cancelled: false }, orderBy: { lineNumber: 'asc' } } },
    });
    return (order?.items as any[]) ?? [];
  }

  // ... (KOT, additional bill, printReceipt methods remain exactly as original) ...

  /**
   * Build text for a kitchen order ticket (KOT) — delta only.
   */
  async buildTextKot(
    invoiceId: string,
    kotNumber: number,
    addLines: Array<{ line: any; delta: number }>,
    removeLines: Array<{ line: any; delta: number }>,
  ): Promise<string> {
    const inv = await this.resolveInvoice(invoiceId);
    const org = await this.resolveOrg();
    const header = (org as any).receiptHeader as Record<string, string> | null;
    const R = PosReceiptsService.TICKET_W;
    const orderTypeLabels: Record<string, string> = { dine_in: 'Dine In', takeaway: 'Take Away', delivery: 'Delivery' };
    const lines: string[] = [];
    const isInitial = kotNumber <= 1 && removeLines.length === 0;

    // Same frame as the settlement receipt, minus the address block — the
    // kitchen needs the ticket identity, not the phone number. Fallback is the
    // brand name, never the raw org record name ("Demo Organization").
    lines.push('='.repeat(R));
    lines.push((header?.businessName || 'ABILIZ CAKE & PATISSERIE').toUpperCase());
    lines.push('');
    lines.push(isInitial ? '*** KITCHEN ORDER TICKET ***' : '*** ADDITIONAL KOT ***');
    lines.push(`KOT: #${String(kotNumber).padStart(3, '0')}`);
    lines.push(`Order: #${(inv as any).documentNumber}`);
    lines.push(this.ticketDate(new Date())); // fire time, not order-open time
    if ((inv as any).orderType) lines.push(`Type: ${orderTypeLabels[(inv as any).orderType] ?? (inv as any).orderType}`);
    if ((inv as any).tableName) lines.push(`Table: ${(inv as any).tableName}`);
    lines.push('');
    lines.push(` ${'Qty'.padStart(3)}  Item`);
    lines.push('-'.repeat(R));

    // Full line detail — variant, accompaniments, modifiers and note all print,
    // and names get the whole 41-column width instead of being cut at 20 chars.
    for (const { line, delta } of addLines) {
      const qty = Number(line.quantity);
      const mark = delta >= qty ? `x${qty}` : `+${delta}`;
      lines.push(` ${mark.padStart(3)}  ${String(line.description ?? '').slice(0, R - 7)}`);
      if (line.variantName) lines.push(`        ${String(line.variantName).slice(0, R - 9)}`);
      for (const a of line.accompanimentNames ?? []) lines.push(`        + ${String(a).slice(0, R - 11)}`);
      for (const m of line.modifiers ?? []) lines.push(`        ${String((m as any).kitchenPrintName ?? m.name ?? '').slice(0, R - 9)}`);
      if (line.note) lines.push(`        ! ${String(line.note).slice(0, R - 11)}`);
    }

    if (removeLines.length > 0) {
      lines.push('-'.repeat(R));
      lines.push('CANCELLED:');
      for (const { line, delta } of removeLines) {
        lines.push(` ${`-${delta}`.padStart(3)}  ${String(line.description ?? '').slice(0, R - 7)}`);
      }
    }

    if (addLines.length === 0 && removeLines.length === 0) {
      lines.push('  (no changes)');
    }

    lines.push('-'.repeat(R));
    lines.push('');
    lines.push('Prepare and serve with care'.padStart(R));
    return lines.join('\n');
  }

  /**
   * Build text for a kitchen cancellation ticket (void / reduce).
   */
  async buildTextCancelKot(
    invoiceId: string,
    kotNumber: number,
    removeLines: Array<{ line: any; delta: number }>,
  ): Promise<string> {
    const inv = await this.resolveInvoice(invoiceId);
    const org = await this.resolveOrg();
    const header = (org as any).receiptHeader as Record<string, string> | null;
    const R = PosReceiptsService.TICKET_W;
    const lines: string[] = [];
    lines.push('='.repeat(R));
    lines.push((header?.businessName || 'ABILIZ CAKE & PATISSERIE').toUpperCase());
    lines.push('');
    lines.push('*** CANCEL KOT ***');
    lines.push(`KOT: #${String(kotNumber).padStart(3, '0')}`);
    lines.push(`Order: #${(inv as any).documentNumber}`);
    lines.push(this.ticketDate(new Date()));
    if ((inv as any).tableName) lines.push(`Table: ${(inv as any).tableName}`);
    lines.push('');
    lines.push(` ${'Qty'.padStart(3)}  Item`);
    lines.push('-'.repeat(R));

    for (const { line, delta } of removeLines) {
      lines.push(` ${`-${delta}`.padStart(3)}  ${String(line.description ?? '').slice(0, R - 7)}`);
      if (line.variantName) lines.push(`        ${String(line.variantName).slice(0, R - 9)}`);
    }

    lines.push('-'.repeat(R));
    lines.push('');
    lines.push('VOID / REDUCE'.padStart(R));
    return lines.join('\n');
  }

  /**
   * Build text for an additional bill — only items that have not yet appeared
   * on a previously-printed bill.
   */
  async buildTextAdditionalBill(invoiceId: string, copyNumber = 1): Promise<{ text: string; grandTotal: number; additionalSubtotal: number; previousSubtotal: number }> {
    const inv = await this.resolveInvoice(invoiceId);
    const org = await this.resolveOrg();
    const unbilled = await this.getUnbilledLines(invoiceId);

    const header = (org as any).receiptHeader as Record<string, string> | null;
    const R = PosReceiptsService.TICKET_W;
    const orderTypeLabels: Record<string, string> = { dine_in: 'Dine In', takeaway: 'Take Away', delivery: 'Delivery' };
    const lines: string[] = [];
    lines.push('*** ADDITIONAL BILL ***');
    lines.push(...this.ticketHeader(header));
    lines.push(`Bill: #${(inv as any).documentNumber}`);
    if (copyNumber > 1) lines.push(`Copy: #${copyNumber}`);
    lines.push(this.ticketDate(new Date(inv.issueDate)));
    if ((inv as any).orderType) lines.push(`Order: ${orderTypeLabels[(inv as any).orderType] ?? (inv as any).orderType}`);
    if ((inv as any).tableName) lines.push(`Table: ${(inv as any).tableName}`);
    lines.push('');
    lines.push(` ${'Qty'.padStart(3)} ${'Item'.padEnd(22)} ${'Price'.padStart(8)} ${'Total'.padStart(10)}`);
    lines.push('-'.repeat(R));

    let additionalSubtotal = 0;
    for (const ln of unbilled) {
      const qty = Number(ln.quantity);
      const price = Number(ln.unitPrice);
      const disc = Number(ln.discountPercent ?? 0);
      additionalSubtotal += qty * price * (1 - disc / 100);
    }
    this.ticketItemRows(unbilled as any[], lines);

    if (unbilled.length === 0) {
      lines.push('  (no additional items)');
    }

    const previousSubtotal = Math.max(0, Number(inv.subtotal) - additionalSubtotal);
    const grandTotal = Number(inv.totalAmount);

    lines.push('');
    lines.push('');
    lines.push('-'.repeat(R));
    lines.push(this.ticketTotal('Additional Total:', fmt(additionalSubtotal)));
    lines.push(this.ticketTotal('Previous Total:', fmt(previousSubtotal)));
    lines.push('='.repeat(R));
    lines.push(this.ticketTotal('GRAND TOTAL DUE:', fmt(grandTotal)));
    lines.push('-'.repeat(R));
    lines.push('');
    lines.push('');
    lines.push('Thank you for your patience!'.padStart(R));
    return { text: lines.join('\n'), grandTotal, additionalSubtotal, previousSubtotal };
  }

  /** Print an Additional Bill — only items not yet included on any previous bill print. */
  async printAdditionalBill(invoiceId: string, userId?: string): Promise<{ ok: boolean; backend: string; message?: string; copyNumber: number; grandTotal: number; additionalSubtotal: number; previousSubtotal: number }> {
    const orgId = this.tenant.organizationId;

    const invPrint = await this.prisma.client.invoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      select: { billPrintCount: true },
    });
    const docPrint = invPrint ? null : await this.prisma.client.order.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      select: { billPrintCount: true },
    });
    const billPrintCount = invPrint?.billPrintCount ?? docPrint?.billPrintCount ?? 0;
    const copyNumber = billPrintCount + 1;

    const unbilled = await this.getUnbilledLines(invoiceId);
    if (unbilled.length === 0) {
      throw new BadRequestException('No additional items to bill. All items have already appeared on a previous bill.');
    }

    const { text: additionalBillText, grandTotal, additionalSubtotal, previousSubtotal } =
      await this.buildTextAdditionalBill(invoiceId, copyNumber);

    await this.printLifecycle.markBillPrinted(this.prisma.client, invoiceId, userId);
    await this.printLifecycle.markLinesBilled(this.prisma.client, invoiceId, userId);

    const target = await this.resolvePrintTarget();

    if (target.kind === 'none') {
      this.logger.warn(`[POS] No printer configured; additional bill:\n${additionalBillText}`);
      await this.printLifecycle.recordPrintLog(this.prisma.client, {
        organizationId: orgId, documentId: invoiceId, type: 'BILL', action: 'PRINT', copies: 1, printedById: userId,
      });
      return { ok: true, backend: 'console', message: 'No printer configured; additional bill logged to server console.', copyNumber, grandTotal, additionalSubtotal, previousSubtotal };
    }

    try {
      const parts: Buffer[] = [];
      parts.push(Buffer.from(toPrinterAscii(additionalBillText) + '\n', 'ascii'), await this.feedBuffer(), Buffer.from([0x1d, 0x56, 0x00]));
      await this.sendRaw(target, Buffer.concat(parts));
      await this.printLifecycle.recordPrintLog(this.prisma.client, {
        organizationId: orgId, documentId: invoiceId, type: 'BILL', action: 'PRINT', copies: 1, printedById: userId,
      });
      return { ok: true, backend: target.backend, copyNumber, grandTotal, additionalSubtotal, previousSubtotal };
    } catch (e: any) {
      this.logger.warn(`[POS] Printer unreachable; additional bill fallback: ${e?.message}`);
      return { ok: false, backend: 'escpos', message: e?.message ?? 'printer error', copyNumber, grandTotal, additionalSubtotal, previousSubtotal };
    }
  }

  /**
   * ESC d n — feed n lines so content clears the head→cutter gap before a cut.
   * Configurable via the `pos.cutFeedLines` setting (default 6 ≈ 19mm on 80mm
   * printers); clamped to 0–16. GS V 0 does not feed on its own, so this is
   * what stops the blade slicing the last printed lines.
   */
  private async feedBuffer(): Promise<Buffer> {
    const setting = await this.settings.get('pos.cutFeedLines');
    const parsed = Number(setting?.value);
    const lines = Number.isFinite(parsed) ? Math.min(16, Math.max(0, Math.trunc(parsed))) : 6;
    return Buffer.from([0x1b, 0x64, lines]);
  }

  /**
   * Print the receipt to a thermal ESC/POS printer.
   * Looks up printer IP from settings (pos.printerHost, pos.printerPort).
   *
   * F2 hardening: mirrors `printBill()` — refuses a duplicate auto-print when
   * `receiptPrintCount > 0` and the caller did NOT opt into the reprint path.
   * The auto-print after settlement (`printReceiptSafe`) is unaffected because
   * it fires exactly once on a fresh invoice (count = 0). Re-prints MUST go
   * through the dedicated `/reprint` endpoint, which is role-gated to manager
   * and requires a reason.
   */
  async printReceipt(invoiceId: string, userId?: string, isReprint = false): Promise<{ ok: boolean; backend: string; message?: string }> {
    const orgId = this.tenant.organizationId;
    if (!isReprint) {
      const inv = await this.prisma.client.invoice.findFirst({
        where: { id: invoiceId, organizationId: orgId },
        select: { receiptPrintCount: true },
      });
      if ((inv?.receiptPrintCount ?? 0) > 0) {
        throw new ForbiddenException(
          'Receipt already printed. Use the reprint endpoint (Admin/Manager only, with a reason).',
        );
      }
    }
    const customerText = await this.buildTextReceipt(invoiceId, isReprint, 'CUSTOMER COPY');

    await this.printLifecycle.markReceiptPrinted(this.prisma.client, invoiceId, userId);

    const cashierSetting = await this.settings.get('pos.printCashierCopy');
    const printCashierCopy = cashierSetting?.value !== 'false';
    const merchantText = printCashierCopy ? await this.buildTextReceipt(invoiceId, isReprint, 'CASHIER COPY') : null;
    const copies = merchantText ? 2 : 1;

    const target = await this.resolvePrintTarget();

    if (target.kind === 'none') {
      this.logger.warn(`[POS] No printer configured; receipt (customer):\n${customerText}`);
      if (merchantText) this.logger.warn(`[POS] No printer configured; receipt (cashier copy):\n${merchantText}`);
      await this.printLifecycle.recordPrintLog(this.prisma.client, {
        organizationId: orgId, documentId: invoiceId, type: 'RECEIPT', copies, printedById: userId,
      });
      return { ok: true, backend: 'console', message: `No printer configured; ${copies} receipt cop${copies > 1 ? 'ies' : 'y'} logged to server console.` };
    }

    try {
      const kickSetting = await this.settings.get('pos.kickDrawerOnPrint');
      const shouldKick = kickSetting?.value !== 'false';
      const FEED = await this.feedBuffer(); // pos.cutFeedLines (default 6)
      const CUT = Buffer.from([0x1D, 0x56, 0x00]);
      const KICK = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]);
      const parts: Buffer[] = [Buffer.from(toPrinterAscii(customerText), 'ascii'), FEED, CUT];
      if (merchantText) parts.push(Buffer.from(toPrinterAscii(merchantText), 'ascii'), FEED, CUT);
      if (shouldKick) parts.push(KICK); // drawer AFTER the cut
      await this.sendRaw(target, Buffer.concat(parts));
      await this.printLifecycle.recordPrintLog(this.prisma.client, {
        organizationId: orgId, documentId: invoiceId, type: 'RECEIPT', copies, printedById: userId,
      });
      return { ok: true, backend: target.backend, message: merchantText ? 'Customer + cashier copies printed' : undefined };
    } catch (e: any) {
      this.logger.warn(`[POS] Printer unreachable; receipt fallback: ${e?.message}`);
      return { ok: false, backend: 'escpos', message: e?.message ?? 'printer error' };
    }
  }

  public lifecycle() { return this.printLifecycle; }
  public prismaSvc() { return this.prisma; }
  public tenantSvc() { return this.tenant; }

  async listReceipts(page: number, pageSize: number, search?: string) {
    const orgId = this.tenant.organizationId;
    const where: any = { organizationId: orgId };
    if (search?.trim()) {
      const q = search.trim();
      where.invoiceNumber = { contains: q, mode: 'insensitive' as Prisma.QueryMode };
    }
    const [items, total] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          invoiceNumber: true,
          issueDate: true,
          totalAmount: true,
          amountPaid: true,
          amountResidual: true,
          subtotal: true,
          discountTotal: true,
          paymentStatus: true,
          paymentMode: true,
          settlementStatus: true,
          status: true,
          partnerId: true,
          order: { select: { orderType: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.client.invoice.count({ where }),
    ]);

    const partnerIds = Array.from(new Set(items.map((i: any) => i.partnerId).filter(Boolean))) as string[];
    const partners = partnerIds.length
      ? new Map((await this.prisma.client.partner.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true } })).map((p: any) => [p.id, p]))
      : new Map<string, any>();

    const data = items.map((i: any) => ({
      id: i.id,
      documentNumber: i.invoiceNumber,
      issueDate: i.issueDate,
      totalAmount: i.totalAmount,
      amountPaid: i.amountPaid,
      amountResidual: i.amountResidual,
      subtotal: i.subtotal,
      discountTotal: i.discountTotal,
      paymentStatus: i.paymentStatus,
      paymentMode: i.paymentMode,
      settlementStatus: i.settlementStatus,
      status: i.status,
      partnerId: i.partnerId,
      partner: partners.get(i.partnerId) ?? null,
      orderType: i.order?.orderType ?? null,
      itemCount: i._count?.items ?? 0,
    }));

    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  async getReceiptDetail(invoiceId: string) {
    const resolved = await this.resolveInvoice(invoiceId);
    return resolved;
  }
}

/* ============================== CONTROLLER ============================== */

@ApiTags('pos/receipts')
@ApiBearerAuth()
@Controller('pos/receipts')
export class PosReceiptsController {
  private readonly logger = new Logger(PosReceiptsController.name);

  constructor(private readonly svc: PosReceiptsService) {}

  @Get(':invoiceId/pdf')
  @RequirePermissions('pos:read')
  async pdf(@Param('invoiceId') id: string, @Res() res: Response) {
    const buf = await this.svc.buildPdfReceipt(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${id}.pdf"`);
    res.send(buf);
  }

  @Get(':invoiceId/text')
  @RequirePermissions('pos:read')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async text(@Param('invoiceId') id: string) {
    return this.svc.buildTextReceipt(id);
  }

  @Post(':invoiceId/print')
  @RequirePermissions('pos:checkout')
  async print(@Param('invoiceId') id: string) {
    return this.svc.printReceipt(id, this.svc.tenantSvc().userId ?? undefined, false);
  }

  @Post(':invoiceId/email')
  @RequirePermissions('pos:checkout')
  async email(@Param('invoiceId') id: string, @Query('to') to?: string) {
    const r = await this.svc.emailReceipt(id);
    if (!r.ok) throw new BadRequestException(r.message ?? 'email failed');
    return r;
  }

  @Post(':invoiceId/reprint')
  @RequirePermissions('pos:override')
  async reprint(@Param('invoiceId') id: string, @Body() dto: ReprintDto) {
    const userId = this.svc.tenantSvc().userId ?? undefined;
    await this.svc['assertCanReprint'](userId);
    const r = await this.svc.printReceipt(id, userId, true);
    await this.svc.lifecycle().recordPrintLog(this.svc.prismaSvc().client, {
      organizationId: this.svc.tenantSvc().organizationId,
      documentId: id,
      type: 'RECEIPT',
      action: 'REPRINT',
      printedById: userId,
      reason: dto.reason,
    });
    await this.svc['audit'].record({
      entity: 'Document',
      entityId: id,
      action: 'reprint' as any,
      newValues: { kind: 'RECEIPT', reason: dto.reason, printedById: userId ?? null },
    });
    return r;
  }

  @Post(':invoiceId/print-bill')
  @RequirePermissions('pos:checkout')
  async printBill(@Param('invoiceId') id: string) {
    return this.svc.printBill(id, this.svc.tenantSvc().userId ?? undefined, false);
  }

  @Post(':invoiceId/print-additional-bill')
  @RequirePermissions('pos:checkout')
  async printAdditionalBill(@Param('invoiceId') id: string) {
    return this.svc.printAdditionalBill(id, this.svc.tenantSvc().userId ?? undefined);
  }

  @Post(':invoiceId/reprint-bill')
  @RequirePermissions('pos:override')
  async reprintBill(@Param('invoiceId') id: string, @Body() dto: ReprintDto) {
    const userId = this.svc.tenantSvc().userId ?? undefined;
    await this.svc['assertCanReprint'](userId);
    const r = await this.svc.printBill(id, userId, true);
    await this.svc.lifecycle().recordPrintLog(this.svc.prismaSvc().client, {
      organizationId: this.svc.tenantSvc().organizationId,
      documentId: id,
      type: 'BILL',
      action: 'REPRINT',
      printedById: userId,
      reason: dto.reason,
    });
    await this.svc['audit'].record({
      entity: 'Document',
      entityId: id,
      action: 'reprint',
      newValues: { kind: 'BILL', reason: dto.reason, printedById: userId ?? null },
    });
    return r;
  }

  @Post(':invoiceId/print-kot')
  @RequirePermissions('pos:checkout')
  async printKot(@Param('invoiceId') id: string) {
    const userId = this.svc.tenantSvc().userId ?? undefined;
    const orgId = this.svc.tenantSvc().organizationId;
    const kotNumber = await this.svc.lifecycle().getKotCopyNumber(this.svc.prismaSvc().client, id);

    // Resolve the order ID — getKitchenDeltas keys on OrderItem.orderId.
    // Frontend passes an Order ID (open tab) or Invoice ID (settled); support both.
    let orderId: string | null = null;
    const kotInv = await this.svc.prismaSvc().client.invoice.findFirst({
      where: { id, organizationId: orgId },
      select: { orderId: true },
    });
    if (kotInv?.orderId) {
      orderId = kotInv.orderId;
    } else {
      // Fallback: id is an Order ID directly (pre-settle tab)
      const order = await this.svc.prismaSvc().client.order.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true },
      });
      if (order) orderId = order.id;
    }
    if (!orderId) {
      return { ok: false, backend: 'none', message: 'Invoice has no linked order' };
    }
    // Fetch all active order items — the KOT is a full snapshot, not a delta.
    // fireKitchen (KDS push) marks kitchenPrintedQty, which would make
    // getKitchenDeltas return empty; we bypass that and read items directly.
    const allItems = await this.svc.prismaSvc().client.orderItem.findMany({
      where: { orderId, cancelled: false },
      orderBy: { lineNumber: 'asc' },
      include: { modifiers: true },
    });

    // A line is kitchen-eligible if it maps to a stock product OR a menu item.
    const kotEligible = (l: any) => !!l.productId || !!l.menuItemId;
    const eligibleItems = allItems.filter(kotEligible);

    if (eligibleItems.length === 0) {
      return { ok: true, backend: 'none', message: 'No kitchen-eligible items on this order', kotNumber } as any;
    }

    // Build the KOT showing ALL current items (not just newly-printed ones).
    const addLines = eligibleItems.map((ln: any) => ({ line: ln, delta: Number(ln.quantity) }));
    const text = await this.svc.buildTextKot(id, kotNumber, addLines, []);

    await this.svc.lifecycle().markKotPrinted(this.svc.prismaSvc().client, id, userId);

    const target = await this.svc.resolvePrintTarget();

    if (target.kind === 'none') {
      this.logger.warn(`[POS] No printer configured; KOT #${kotNumber}:\n${text}`);
      await this.svc.lifecycle().recordPrintLog(this.svc.prismaSvc().client, {
        organizationId: orgId, documentId: id, type: 'KOT', printedById: userId,
      });
      return { ok: true, backend: 'console', message: 'No printer; KOT logged to server console.', kotNumber, text } as any;
    }

    try {
      // Feed + cut so the ticket ejects fully instead of half-hanging in the printer.
      const payload = Buffer.concat([
        Buffer.from(toPrinterAscii(text) + '\n', 'ascii'),
        Buffer.from([0x1b, 0x64, 0x0c]), // ESC d 12 — generous feed past head→cutter gap
        Buffer.from([0x1d, 0x56, 0x00]), // GS V 0 — full cut
      ]);
      await this.svc.sendRaw(target, payload);
      await this.svc.lifecycle().recordPrintLog(this.svc.prismaSvc().client, {
        organizationId: orgId, documentId: id, type: 'KOT', printedById: userId,
      });
      return { ok: true, backend: target.backend, kotNumber, text } as any;
    } catch (e: any) {
      this.logger.warn(`[POS] Printer unreachable; KOT #${kotNumber} fallback: ${e?.message}`);
      return { ok: false, backend: 'escpos', message: e?.message ?? 'printer error', kotNumber, text } as any;
    }
  }

  @Get(':invoiceId')
  @RequirePermissions('pos:read')
  async get(@Param('invoiceId') id: string) {
    return this.svc.getReceiptDetail(id);
  }

  @Get()
  @RequirePermissions('pos:read')
  async list(@Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('search') search?: string) {
    return this.svc.listReceipts(
      Number(page) || 1,
      Math.min(Number(pageSize) || 20, 100),
      search,
    );
  }

  @Patch(':invoiceId/settings/receipt')
  @RequirePermissions('pos:reports')
  async updateReceiptSettings(@Param('invoiceId') _id: string, @Body() dto: ReceiptSettingsDto) {
    return this.svc.saveReceiptSettings(dto);
  }
}

/* ============================== MODULE ============================== */

@Module({
  controllers: [PosReceiptsController],
  providers: [PosReceiptsService],
  exports: [PosReceiptsService],
})
export class PosReceiptsModule {}