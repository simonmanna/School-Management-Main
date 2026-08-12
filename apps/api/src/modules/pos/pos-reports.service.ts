/**
 * POS — X / Z reports and sales analytics (financial-grade).
 *
 *   X-report: mid-shift snapshot (live, recomputed on each call).
 *   Z-report: end-of-shift frozen snapshot — same data as X, stamped to a
 *             `PosReportSnapshot` row when the cash session is closed.
 *
 * Design rules (audit-hardened):
 *   • SALES figures are derived from the POS `Invoice` pipeline (all tenders),
 *     NOT from cash movements — so card / mobile / credit sales are included.
 *   • CASH-DRAWER figures (expectedCash) come from `CashMovement` rows (cash
 *     only) — that is what actually hits the till.
 *   • "Revenue" means NET of tax (Invoice.subtotal). Gross, tax, discount and
 *     refunds are reported as separate lines so totals reconcile.
 *   • Only POS sales are counted: the `Invoice` table is POS-native; legacy
 *     `Document` rows are included only when `sourceType = 'pos'`.
 *   • Money is summed with Decimal (`dec`) — never floating-point — to avoid
 *     rounding drift on large sums.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { EventBus } from '../../kernel/events/event-bus';
import { EVENTS } from '@erp/shared';
import { dec } from '../../kernel/common/money';
import { toCanonicalOrderStatus } from './order-status.util';

type Money = ReturnType<typeof dec>;

export interface XReport {
  asOf: string;
  cashSession: {
    id: string;
    cashRegisterId: string;
    userId: string | null;
    openedAt: Date | null;
    openingFloat: string;
  } | null;
  totals: {
    saleCount: number;
    /** Gross sales incl. tax, all tenders (kept key for back-compat). */
    salesTotal: string;
    grossSales: string;
    /** Net revenue, ex-tax (Invoice.subtotal). */
    netRevenue: string;
    taxTotal: string;
    discountTotal: string;
    /** Cash actually collected into the drawer (cash tenders only). */
    cashCollected: string;
    overridesTotal: string;
    payInsTotal: string;
    payOutsTotal: string;
    expectedCash: string;
  };
  byMethod: Array<{ method: string; count: number; total: string }>;
  byCategory: Array<{ categoryId: string | null; categoryName: string; count: number; total: string }>;
}

@Injectable()
export class PosReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Live mid-shift X-report for a given cash session (or the open one). */
  async xReport(cashSessionId?: string): Promise<XReport> {
    const organizationId = this.tenant.organizationId;
    const session = await this.resolveSession(organizationId, cashSessionId);
    if (!session) throw new NotFoundException('No cash session found');

    // ── Cash drawer: derive collected / refunded / pay-in / pay-out straight
    //    from CashMovement (cash only — this is what hits the till). ──────────
    const movements = await this.prisma.client.cashMovement.findMany({
      where: { cashSessionId: session.id },
    });
    let cashCollected = dec(0);
    let cashRefunds = dec(0);
    let payInsTotal = dec(0);
    let payOutsTotal = dec(0);
    for (const m of movements as any[]) {
      const amt = dec(m.amount);
      if (m.movementType === 'sale') cashCollected = cashCollected.plus(amt);
      else if (m.movementType === 'refund') cashRefunds = cashRefunds.plus(amt);
      else if (m.movementType === 'pay_in') payInsTotal = payInsTotal.plus(amt);
      else if (m.movementType === 'pay_out') payOutsTotal = payOutsTotal.plus(amt);
    }

    // ── Sales: ALL tenders for this session, from the POS Invoice pipeline. ──
    const invoices = await this.prisma.client.invoice.findMany({
      where: { organizationId, cashSessionId: session.id },
      include: { items: true },
    });

    const overrides = await this.prisma.client.auditLog.findMany({
      where: {
        organizationId,
        entity: 'PosOverride' as any,
        createdAt: { gte: session.openedAt ?? new Date(0) },
      },
    });

    let saleCount = 0;
    let grossSales = dec(0);
    let netRevenue = dec(0);
    let taxTotal = dec(0);
    let discountTotal = dec(0);
    const byMethodMap = new Map<string, { method: string; count: number; total: Money }>();
    const saleItems: any[] = [];
    const productIds = new Set<string>();

    for (const inv of invoices as any[]) {
      if (inv.status !== 'posted' && inv.status !== 'paid') continue; // skip draft/cancelled/refunded
      saleCount += 1;
      grossSales = grossSales.plus(dec(inv.totalAmount));
      netRevenue = netRevenue.plus(dec(inv.subtotal));
      taxTotal = taxTotal.plus(dec(inv.taxAmount));
      discountTotal = discountTotal.plus(dec(inv.discountTotal));

      const method = inv.paymentMode ?? 'unpaid';
      const b = byMethodMap.get(method) ?? { method, count: 0, total: dec(0) };
      b.count += 1;
      b.total = b.total.plus(dec(inv.totalAmount));
      byMethodMap.set(method, b);

      for (const it of inv.items ?? []) {
        saleItems.push(it);
        if (it.productId) productIds.add(it.productId);
      }
    }

    // Category breakdown from the sale lines.
    const products = productIds.size
      ? await this.prisma.client.product.findMany({
          where: { id: { in: Array.from(productIds) } },
          include: { category: true },
        })
      : [];
    const productMap = new Map(products.map((p: any) => [p.id, p]));
    const byCategoryMap = new Map<string, { categoryId: string | null; categoryName: string; count: number; total: Money }>();
    for (const it of saleItems) {
      const product = it.productId ? productMap.get(it.productId) : null;
      const cat = (product as any)?.category;
      const key = cat?.id ?? 'uncategorised';
      const bucket = byCategoryMap.get(key) ?? {
        categoryId: cat?.id ?? null,
        categoryName: cat?.name ?? 'Uncategorised',
        count: 0,
        total: dec(0),
      };
      bucket.count += Number(it.quantity);
      bucket.total = bucket.total.plus(dec(it.total ?? 0));
      byCategoryMap.set(key, bucket);
    }

    const overridesTotal = overrides.reduce((s, o) => {
      const v = (o as any).newValues;
      return s.plus(v && v.amount ? dec(v.amount) : dec(0));
    }, dec(0));

    const expectedCash = dec(session.openingFloat)
      .plus(cashCollected)
      .minus(cashRefunds)
      .plus(payInsTotal)
      .minus(payOutsTotal);

    this.events.publish(EVENTS.PosReportGenerated, {
      organizationId,
      reportKind: 'x',
      cashSessionId: session.id,
      asOf: new Date().toISOString(),
    });

    return {
      asOf: new Date().toISOString(),
      cashSession: {
        id: session.id,
        cashRegisterId: session.cashRegisterId,
        userId: session.userId,
        openedAt: session.openedAt,
        openingFloat: dec(session.openingFloat).toString(),
      },
      totals: {
        saleCount,
        salesTotal: grossSales.toFixed(2),
        grossSales: grossSales.toFixed(2),
        netRevenue: netRevenue.toFixed(2),
        taxTotal: taxTotal.toFixed(2),
        discountTotal: discountTotal.toFixed(2),
        cashCollected: cashCollected.toFixed(2),
        overridesTotal: overridesTotal.toFixed(2),
        payInsTotal: payInsTotal.toFixed(2),
        payOutsTotal: payOutsTotal.toFixed(2),
        expectedCash: expectedCash.toFixed(2),
      },
      byMethod: Array.from(byMethodMap.values()).map((b) => ({
        method: b.method,
        count: b.count,
        total: b.total.toFixed(2),
      })),
      byCategory: Array.from(byCategoryMap.values()).map((b) => ({
        categoryId: b.categoryId,
        categoryName: b.categoryName,
        count: b.count,
        total: b.total.toFixed(2),
      })),
    };
  }

  /** Z-report: same shape as X but the cash session must be closed. */
  async zReport(cashSessionId?: string): Promise<XReport> {
    const report = await this.xReport(cashSessionId);
    if (report.cashSession && (await this.sessionStatus(report.cashSession.id)) !== 'closed') {
      throw new BadRequestException('Z-report requires the cash session to be closed');
    }
    if (report.cashSession?.id) {
      const organizationId = this.tenant.organizationId;
      await this.prisma.client.posReportSnapshot.upsert({
        where: { cashSessionId: report.cashSession.id },
        create: {
          organizationId,
          cashSessionId: report.cashSession.id,
          kind: 'z',
          reportData: report as any,
        },
        update: {
          reportData: report as any,
          generatedAt: new Date(),
        },
      });
    }
    await this.audit.record({
      entity: 'PosReport' as any,
      entityId: report.cashSession?.id ?? 'no-session',
      action: 'create' as any,
      newValues: { kind: 'z', totals: report.totals, asOf: report.asOf },
    });
    this.events.publish(EVENTS.PosReportGenerated, {
      organizationId: this.tenant.organizationId,
      reportKind: 'z',
      cashSessionId: report.cashSession?.id,
      asOf: report.asOf,
    });
    return report;
  }

  /** Hourly buckets across a date range (POS sales only, gross). */
  async salesByHour(fromDate: string, toDate: string, hours?: string) {
    const organizationId = this.tenant.organizationId;
    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid fromDate/toDate');
    }
    end.setHours(23, 59, 59, 999);
    start.setHours(0, 0, 0, 0);

    // Parse optional hour filter
    const hourFilter: Set<number> | null = hours
      ? new Set(hours.split(',').map((h) => parseInt(h, 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 23))
      : null;

    // POS sales live on Invoice and always carry an orderId (bridged from the
    // operational Order). Scoping by `orderId: { not: null }` keeps manual AR
    // invoices out of the POS hourly totals. The legacy Document branch is gone
    // (POS no longer writes Document after the Document→Invoice migration).
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        organizationId,
        orderId: { not: null },
        status: { in: ['posted', 'paid'] },
        createdAt: { gte: start, lte: end },
      },
      select: { totalAmount: true, createdAt: true },
    });

    const buckets = new Array(24).fill(0).map((_, hour) => ({ hour, count: 0, total: dec(0) }));
    for (const d of invoices as any[]) {
      const hour = new Date(d.createdAt).getHours();
      if (hourFilter && !hourFilter.has(hour)) continue;
      buckets[hour].count += 1;
      buckets[hour].total = buckets[hour].total.plus(dec(d.totalAmount));
    }
    return {
      fromDate: start.toISOString().slice(0, 10),
      toDate: end.toISOString().slice(0, 10),
      buckets: buckets.map((b) => ({ hour: b.hour, count: b.count, total: b.total.toFixed(2) })),
    };
  }

  /**
   * Sales summary — period-aggregated revenue (NET of tax), gross, tax,
   * discounts and refunds, grouped by day / week / month, with a
   * payment-method breakdown derived from actual allocations.
   */
  async salesSummary(fromDate: string, toDate: string, groupBy: 'day' | 'week' | 'month') {
    const organizationId = this.tenant.organizationId;
    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid fromDate/toDate');
    }
    end.setHours(23, 59, 59, 999);

    // POS-only: Invoice rows bridged from an Order (orderId set). Excludes manual
    // AR invoices. Legacy Document branch removed post-migration.
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        organizationId,
        orderId: { not: null },
        status: { in: ['posted', 'paid', 'refunded'] },
        createdAt: { gte: start, lte: end },
      },
      select: { id: true, subtotal: true, totalAmount: true, discountTotal: true, taxAmount: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const rows = invoices.map((i: any) => ({ ...i, refunded: i.status === 'refunded' }));

    const periodKey = (d: Date): string => {
      if (groupBy === 'day') return d.toISOString().slice(0, 10);
      if (groupBy === 'week') {
        const dow = d.getUTCDay();
        const mon = new Date(d);
        mon.setUTCDate(d.getUTCDate() - dow + (dow === 0 ? -6 : 1));
        return mon.toISOString().slice(0, 10);
      }
      return d.toISOString().slice(0, 7);
    };

    type Bucket = { gross: Money; net: Money; tax: Money; discount: Money; refunds: Money; orders: number };
    const fresh = (): Bucket => ({ gross: dec(0), net: dec(0), tax: dec(0), discount: dec(0), refunds: dec(0), orders: 0 });
    const grouped = new Map<string, Bucket>();
    const overall = fresh();

    for (const r of rows as any[]) {
      const key = periodKey(new Date(r.createdAt));
      const cur = grouped.get(key) ?? fresh();
      if (r.refunded) {
        cur.refunds = cur.refunds.plus(dec(r.totalAmount));
        overall.refunds = overall.refunds.plus(dec(r.totalAmount));
      } else {
        cur.gross = cur.gross.plus(dec(r.totalAmount));
        cur.net = cur.net.plus(dec(r.subtotal));
        cur.tax = cur.tax.plus(dec(r.taxAmount));
        cur.discount = cur.discount.plus(dec(r.discountTotal));
        cur.orders += 1;
        overall.gross = overall.gross.plus(dec(r.totalAmount));
        overall.net = overall.net.plus(dec(r.subtotal));
        overall.tax = overall.tax.plus(dec(r.taxAmount));
        overall.discount = overall.discount.plus(dec(r.discountTotal));
        overall.orders += 1;
      }
      grouped.set(key, cur);
    }

    // Payment-method breakdown — actual money received, by allocation amount,
    // inbound only (refunds excluded so methods aren't inflated).
    const invIds = invoices.map((i: any) => i.id);
    const allocations = invIds.length
      ? await this.prisma.client.paymentAllocation.findMany({
          where: { invoiceId: { in: invIds } },
          include: { payment: { select: { paymentMethod: true, direction: true } } },
        })
      : [];
    const byMethodMap = new Map<string, { method: string; count: number; total: Money }>();
    for (const a of allocations as any[]) {
      if (a.payment?.direction !== 'inbound') continue;
      const method = a.payment.paymentMethod;
      const cur = byMethodMap.get(method) ?? { method, count: 0, total: dec(0) };
      cur.count += 1;
      cur.total = cur.total.plus(dec(a.amount));
      byMethodMap.set(method, cur);
    }

    const aov = (gross: Money, orders: number) => (orders > 0 ? gross.dividedBy(orders).toFixed(2) : '0.00');

    return {
      fromDate: start.toISOString().slice(0, 10),
      toDate: end.toISOString().slice(0, 10),
      groupBy,
      totals: {
        revenue: overall.net.toFixed(2), // NET of tax
        grossSales: overall.gross.toFixed(2),
        netSales: overall.gross.minus(overall.refunds).toFixed(2),
        refunds: overall.refunds.toFixed(2),
        orders: overall.orders,
        avgOrderValue: aov(overall.gross, overall.orders),
        discounts: overall.discount.toFixed(2),
        taxes: overall.tax.toFixed(2),
      },
      periods: Array.from(grouped.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, p]) => ({
          periodKey: key,
          revenue: p.net.toFixed(2), // NET
          grossSales: p.gross.toFixed(2),
          refunds: p.refunds.toFixed(2),
          orders: p.orders,
          avgOrderValue: aov(p.gross, p.orders),
          discounts: p.discount.toFixed(2),
          taxes: p.tax.toFixed(2),
        })),
      byMethod: Array.from(byMethodMap.values()).map((m) => ({
        method: m.method,
        count: m.count,
        total: m.total.toFixed(2),
      })),
    };
  }

  /**
   * Top N items sold in a date range (POS only, gross line total). Aggregated
   * in SQL via groupBy so it scales without loading every line into memory.
   */
  async topItems(fromDate: string, toDate: string, limit = 20) {
    const organizationId = this.tenant.organizationId;
    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid fromDate/toDate');
    }
    end.setHours(23, 59, 59, 999);
    const cap = Math.min(200, Math.max(1, Math.trunc(limit) || 20));

    const [invGroups, docGroups] = await Promise.all([
      this.prisma.client.invoiceItem.groupBy({
        by: ['productId'],
        where: { organizationId, invoice: { status: { in: ['posted', 'paid'] }, createdAt: { gte: start, lte: end } } },
        _sum: { quantity: true, total: true },
      }),
      this.prisma.client.documentLine.groupBy({
        by: ['productId'],
        where: {
          organizationId,
          document: { documentType: 'sales_invoice', sourceType: 'pos', status: { in: ['posted', 'paid'] }, createdAt: { gte: start, lte: end } },
        },
        _sum: { quantity: true, total: true },
      }),
    ]);

    const merged = new Map<string, { productId: string; quantity: Money; total: Money }>();
    for (const g of [...invGroups, ...docGroups] as any[]) {
      const pid = g.productId;
      if (!pid) continue; // skip free-text (non-product) lines
      const cur = merged.get(pid) ?? { productId: pid, quantity: dec(0), total: dec(0) };
      cur.quantity = cur.quantity.plus(dec(g._sum?.quantity ?? 0));
      cur.total = cur.total.plus(dec(g._sum?.total ?? 0));
      merged.set(pid, cur);
    }

    const products = merged.size
      ? await this.prisma.client.product.findMany({ where: { id: { in: Array.from(merged.keys()) } }, select: { id: true, name: true, sku: true } })
      : [];
    const productMap = new Map(products.map((p: any) => [p.id, p]));

    return Array.from(merged.values())
      .map((r) => {
        const p = productMap.get(r.productId);
        return {
          productId: r.productId,
          name: p?.name ?? '(deleted product)',
          sku: p?.sku ?? null,
          quantity: Number(r.quantity),
          total: r.total,
        };
      })
      .sort((a, b) => b.total.minus(a.total).toNumber())
      .slice(0, cap)
      .map((r) => ({ ...r, total: r.total.toFixed(2) }));
  }

  /**
   * Sales report — one row per invoice in a date range.
   * Columns: order number, invoice number, sale date, subtotal, discount,
   * total amount, waiter.
   *
   * @param waiterId - optional filter by waiter (cashier) user ID.
   * @param search - optional text search on invoice or order number.
   * @param paymentMethod - optional filter by primary payment mode.
   */
  async salesReport(fromDate: string, toDate: string, waiterId?: string, search?: string, paymentMethod?: string, orderType?: string) {
    const organizationId = this.tenant.organizationId;
    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid fromDate/toDate');
    }
    end.setHours(23, 59, 59, 999);

    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        organizationId,
        status: { in: ['posted', 'paid'] },
        createdAt: { gte: start, lte: end },
        ...(waiterId ? { waiterId } : {}),
        ...(paymentMethod ? { paymentMode: paymentMethod as any } : {}),
        ...(orderType ? { order: { orderType: orderType as any } } : {}),
        ...(search
          ? {
              OR: [
                { invoiceNumber: { contains: search } },
                { order: { orderNumber: { contains: search } } },
              ],
            }
          : {}),
      },
      include: {
        order: { select: { orderNumber: true, orderType: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const waiterIds = new Set<string>();
    for (const inv of invoices as any[]) {
      if (inv.waiterId) waiterIds.add(inv.waiterId);
    }

    const waiters = waiterIds.size
      ? await this.prisma.client.user.findMany({
          where: { id: { in: Array.from(waiterIds) } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const waiterMap = new Map(waiters.map((w: any) => [w.id, `${w.firstName}${w.lastName ? ' ' + w.lastName : ''}`]));

    return (invoices as any[]).map((inv) => ({
      id: inv.id,
      orderNumber: inv.order?.orderNumber ?? '—',
      orderType: inv.order?.orderType ?? null,
      invoiceNumber: inv.invoiceNumber,
      saleDate: inv.createdAt?.toISOString() ?? '',
      time: new Date(inv.createdAt).toLocaleTimeString(),
      subtotal: dec(inv.subtotal).plus(dec(inv.discountTotal ?? 0)).toFixed(2),
      discount: dec(inv.discountTotal).toFixed(2),
      discountType: inv.discountType ?? 'percentage',
      discountValue: dec(inv.discountValue).toFixed(2),
      discountReason: inv.discountReason ?? null,
      totalAmount: dec(inv.totalAmount).toFixed(2),
      waiterName: inv.waiterId ? (waiterMap.get(inv.waiterId) ?? null) : null,
    }));
  }

  /**
   * Cashier report — one row per invoice showing cashier sales.
   * Columns: cashier, order #, invoice #, sales amount, payment method, received.
   *
   * @param waiterId - optional filter by cashier user ID.
   * @param search - optional text search on invoice or order number.
   * @param paymentMethod - optional filter by payment mode.
   */
  async cashierReport(fromDate: string, toDate: string, waiterId?: string, search?: string, paymentMethod?: string, orderType?: string) {
    const organizationId = this.tenant.organizationId;
    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid fromDate/toDate');
    }
    end.setHours(23, 59, 59, 999);

    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        organizationId,
        status: { in: ['posted', 'paid'] },
        createdAt: { gte: start, lte: end },
        ...(waiterId ? { waiterId } : {}),
        ...(paymentMethod ? { paymentMode: paymentMethod as any } : {}),
        ...(orderType ? { order: { orderType: orderType as any } } : {}),
        ...(search
          ? {
              OR: [
                { invoiceNumber: { contains: search } },
                { order: { orderNumber: { contains: search } } },
              ],
            }
          : {}),
      },
      include: {
        order: { select: { orderNumber: true, orderType: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const cashierIds = new Set<string>();
    for (const inv of invoices as any[]) {
      if (inv.waiterId) cashierIds.add(inv.waiterId);
    }

    const cashiers = cashierIds.size
      ? await this.prisma.client.user.findMany({
          where: { id: { in: Array.from(cashierIds) } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const cashierMap = new Map(cashiers.map((c: any) => [c.id, `${c.firstName}${c.lastName ? ' ' + c.lastName : ''}`]));

    return (invoices as any[]).map((inv) => ({
      cashierName: inv.waiterId ? (cashierMap.get(inv.waiterId) ?? null) : null,
      orderNumber: inv.order?.orderNumber ?? '—',
      orderType: inv.order?.orderType ?? null,
      invoiceNumber: inv.invoiceNumber,
      time: new Date(inv.createdAt).toLocaleTimeString(),
      salesAmount: dec(inv.totalAmount).toFixed(2),
      discount: dec(inv.discountTotal).toFixed(2),
      discountType: inv.discountType ?? 'percentage',
      discountValue: dec(inv.discountValue).toFixed(2),
      discountReason: inv.discountReason ?? null,
      paymentMethod: inv.paymentMode ?? null,
      received: dec(inv.amountPaid).toFixed(2),
    }));
  }

  /**
   * Cashier shift summary — one row per cash session in a date range.
   * Columns: shift (register + opened), cashier, opening cash, sales,
   * expected cash, actual cash, difference.
   *
   * @param cashierId - optional user ID to filter sessions by cashier.
   */
  async cashierShiftSummary(fromDate: string, toDate: string, cashierId?: string) {
    const organizationId = this.tenant.organizationId;
    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid fromDate/toDate');
    }
    end.setHours(23, 59, 59, 999);

    const sessions = await this.prisma.client.cashSession.findMany({
      where: {
        organizationId,
        openedAt: { gte: start, lte: end },
        ...(cashierId ? { userId: cashierId } : {}),
      },
      include: {
        cashRegister: { select: { code: true, name: true } },
        movements: true,
      },
      orderBy: { openedAt: 'desc' },
    });

    // Resolve cashier names
    const userIds = new Set(sessions.map((s: any) => s.userId).filter(Boolean));
    const users = userIds.size
      ? await this.prisma.client.user.findMany({
          where: { id: { in: Array.from(userIds) } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const userMap = new Map(users.map((u: any) => [u.id, `${u.firstName}${u.lastName ? ' ' + u.lastName : ''}`]));

    return (sessions as any[]).map((s) => {
      const registerLabel = s.cashRegister ? `${s.cashRegister.code} - ${s.cashRegister.name}` : s.cashRegisterId;
      const shift = `${registerLabel} · ${new Date(s.openedAt).toLocaleDateString()} ${new Date(s.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

      let cashCollected = dec(0);
      let cashRefunds = dec(0);
      let payIns = dec(0);
      let payOuts = dec(0);
      for (const m of s.movements ?? []) {
        const amt = dec(m.amount);
        if (m.movementType === 'sale') cashCollected = cashCollected.plus(amt);
        else if (m.movementType === 'refund') cashRefunds = cashRefunds.plus(amt);
        else if (m.movementType === 'pay_in') payIns = payIns.plus(amt);
        else if (m.movementType === 'pay_out') payOuts = payOuts.plus(amt);
      }

      const openingCash = dec(s.openingFloat);
      const expectedCash = openingCash.plus(cashCollected).minus(cashRefunds).plus(payIns).minus(payOuts);
      const actualCash = s.closingCounted != null ? dec(s.closingCounted) : null;
      const difference = actualCash != null ? actualCash.minus(expectedCash) : null;

      return {
        shift,
        cashierName: userMap.get(s.userId) ?? null,
        openingCash: openingCash.toFixed(2),
        sales: cashCollected.toFixed(2),
        expectedCash: expectedCash.toFixed(2),
        actualCash: actualCash?.toFixed(2) ?? null,
        difference: difference?.toFixed(2) ?? null,
      };
    });
  }

  /**
   * Waiter report — one row per line item grouped by waiter.
   * Columns: waiter, order #, table, item, qty, unit price, discount, total, date.
   *
   * @param waiterId - optional filter by waiter user ID.
   */
  async waiterReport(fromDate: string, toDate: string, waiterId?: string, orderType?: string) {
    const organizationId = this.tenant.organizationId;
    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid fromDate/toDate');
    }
    end.setHours(23, 59, 59, 999);

    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        organizationId,
        status: { in: ['posted', 'paid'] },
        createdAt: { gte: start, lte: end },
        ...(waiterId ? { waiterId } : {}),
        ...(orderType ? { order: { orderType: orderType as any } } : {}),
      },
      include: {
        items: true,
        order: { select: { orderNumber: true, tableId: true, orderType: true } },
      },
    });

    // Collect IDs for lookup
    const waiterIds = new Set<string>();
    const tableIds = new Set<string>();
    for (const inv of invoices as any[]) {
      if (inv.waiterId) waiterIds.add(inv.waiterId);
      if (inv.order?.tableId) tableIds.add(inv.order.tableId);
    }

    // Resolve waiter names
    const waiters = waiterIds.size
      ? await this.prisma.client.user.findMany({
          where: { id: { in: Array.from(waiterIds) } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const waiterMap = new Map(waiters.map((w: any) => [w.id, `${w.firstName}${w.lastName ? ' ' + w.lastName : ''}`]));

    // Resolve table names
    const tables = tableIds.size
      ? await this.prisma.client.posTable.findMany({ where: { id: { in: Array.from(tableIds) } }, select: { id: true, name: true } })
      : [];
    const tableMap = new Map(tables.map((t: any) => [t.id, t.name]));

    const rows: Array<{
      waiterName: string | null;
      orderNumber: string;
      tableName: string | null;
      item: string;
      quantity: string;
      unitPrice: string;
      discountPercent: string;
      discountType: string;
      discountAmount: string;
      discountReason: string | null;
      total: string;
      date: string;
      time: string;
      orderType: string | null;
    }> = [];

    for (const inv of invoices as any[]) {
      const orderNumber = inv.order?.orderNumber ?? '—';
      const orderType = inv.order?.orderType ?? null;
      const tableName = inv.order?.tableId ? (tableMap.get(inv.order.tableId) ?? null) : null;
      const waiterName = inv.waiterId ? (waiterMap.get(inv.waiterId) ?? null) : null;
      const invoiceTime = new Date(inv.createdAt).toLocaleTimeString();
      for (const it of inv.items ?? []) {
        rows.push({
          waiterName,
          orderNumber,
          orderType,
          tableName,
          item: it.description,
          quantity: dec(it.quantity).toFixed(2),
          unitPrice: dec(it.unitPrice).toFixed(2),
          discountPercent: dec(it.discountPercent).toFixed(2),
          discountType: it.discountType ?? 'percentage',
          discountAmount: dec(it.discountAmount).toFixed(2),
          discountReason: it.discountReason ?? null,
          total: dec(it.subtotal).toFixed(2),
          date: inv.createdAt?.toISOString() ?? '',
          time: invoiceTime,
        });
      }
    }

    return rows;
  }

  /**
   * Order report — one row per order in a date range.
   * Columns: order number, date, table, waiter, customer, status, total.
   *
   * @param orderType - optional filter: 'dine_in' | 'takeaway' | 'delivery'
   * @param status - optional filter for order status (defaults to all non-cancelled)
   */
  async orderReport(fromDate: string, toDate: string, orderType?: string, status?: string) {
    const organizationId = this.tenant.organizationId;
    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid fromDate/toDate');
    }
    end.setHours(23, 59, 59, 999);

    const orderStatus = status ?? 'draft';
    const orders = await this.prisma.client.order.findMany({
      where: {
        organizationId,
        status: { not: 'cancelled' },
        ...(orderType ? { orderType: orderType as any } : {}),
        ...(status && status !== 'draft' ? { status: toCanonicalOrderStatus(status) as any } : {}),
        createdAt: { gte: start, lte: end },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Resolve table names
    const tableIds = new Set(orders.map((o: any) => o.tableId).filter(Boolean));
    const tables = tableIds.size
      ? await this.prisma.client.posTable.findMany({ where: { id: { in: Array.from(tableIds) } }, select: { id: true, name: true } })
      : [];
    const tableMap = new Map(tables.map((t: any) => [t.id, t.name]));

    // Resolve waiter names
    const waiterIds = new Set(orders.map((o: any) => o.waiterId).filter(Boolean));
    const waiters = waiterIds.size
      ? await this.prisma.client.user.findMany({ where: { id: { in: Array.from(waiterIds) } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const waiterMap = new Map(waiters.map((w: any) => [w.id, `${w.firstName}${w.lastName ? ' ' + w.lastName : ''}`]));

    // Resolve customer (partner) names
    const partnerIds = new Set(orders.map((o: any) => o.partnerId).filter(Boolean));
    const partners = partnerIds.size
      ? await this.prisma.client.partner.findMany({ where: { id: { in: Array.from(partnerIds) } }, select: { id: true, name: true } })
      : [];
    const partnerMap = new Map(partners.map((p: any) => [p.id, p.name]));

    return (orders as any[]).map((o) => ({
      orderNumber: o.orderNumber,
      orderType: o.orderType ?? null,
      time: new Date(o.createdAt).toLocaleTimeString(),
      date: o.createdAt?.toISOString() ?? '',
      tableName: o.tableId ? (tableMap.get(o.tableId) ?? null) : null,
      waiterName: o.waiterId ? (waiterMap.get(o.waiterId) ?? null) : null,
      customerName: o.partnerId ? (partnerMap.get(o.partnerId) ?? null) : null,
      status: o.status,
      totalAmount: dec(o.totalAmount).toFixed(2),
    }));
  }

  /**
   * Sold items detail report — every line item in a date range.
   * Columns: order number, invoice number, sale date, item, unit price,
   * discount, quantity, total amount, waiter.
   *
   * @param categoryId - optional filter by category.
   * @param waiterId - optional filter by waiter user ID.
   */
  async soldItems(fromDate: string, toDate: string, categoryId?: string, waiterId?: string, orderType?: string) {
    const organizationId = this.tenant.organizationId;
    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Invalid fromDate/toDate');
    }
    end.setHours(23, 59, 59, 999);

    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        organizationId,
        status: { in: ['posted', 'paid'] },
        createdAt: { gte: start, lte: end },
        ...(waiterId ? { waiterId } : {}),
        ...(orderType ? { order: { orderType: orderType as any } } : {}),
      },
      include: {
        items: true,
        order: { select: { orderNumber: true, orderType: true } },
      },
    });

    // Collect unique waiter IDs
    const waiterIds = new Set<string>();
    for (const inv of invoices as any[]) {
      if (inv.waiterId) waiterIds.add(inv.waiterId);
    }

    const waiters = waiterIds.size
      ? await this.prisma.client.user.findMany({
          where: { id: { in: Array.from(waiterIds) } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const waiterMap = new Map(waiters.map((w: any) => [w.id, `${w.firstName}${w.lastName ? ' ' + w.lastName : ''}`]));

    // Collect all product IDs from invoice items
    const productIds = new Set<string>();
    for (const inv of invoices as any[]) {
      for (const it of inv.items ?? []) {
        if (it.productId) productIds.add(it.productId);
      }
    }

    // Build product → category lookup
    const products = productIds.size
      ? await this.prisma.client.product.findMany({
          where: { id: { in: Array.from(productIds) } },
          include: { category: { select: { name: true } } },
        })
      : [];
    const productMap = new Map(
      products.map((p: any) => [
        p.id,
        {
          name: p.name,
          productCategoryName: p.category?.name ?? null,
          categoryId: p.category?.id ?? null,
        },
      ]),
    );

    // Build menuItem → menuCategory lookup (fallback for menu-driven sales)
    const menuItemIds = new Set<string>();
    for (const inv of invoices as any[]) {
      for (const it of inv.items ?? []) {
        const mid = it.menuItemId;
        if (mid) menuItemIds.add(mid);
      }
    }
    const menuItems = menuItemIds.size
      ? await this.prisma.client.menuItem.findMany({
          where: { id: { in: Array.from(menuItemIds) } },
          include: { category: { select: { name: true } } },
        })
      : [];
    const menuItemMap = new Map(
      menuItems.map((mi: any) => [mi.id, mi.category?.name ?? null]),
    );

    // If category filter is active, resolve allowed product IDs (from product)
    const allowedProductIds = categoryId
      ? new Set(products.filter((p: any) => p.categoryId === categoryId).map((p: any) => p.id))
      : null;
    const allowedMenuItemIds = categoryId
      ? new Set(menuItems.filter((mi: any) => mi.categoryId === categoryId).map((mi: any) => mi.id))
      : null;

    const rows: Array<{
      orderNumber: string;
      invoiceNumber: string;
      saleDate: string;
      time: string;
      item: string;
      unitPrice: string;
      discountPercent: string;
      discountType: string;
      discountAmount: string;
      discountReason: string | null;
      quantity: string;
      totalAmount: string;
      waiterName: string | null;
      categoryName: string | null;
      orderType: string | null;
    }> = [];

    for (const inv of invoices as any[]) {
      const orderNumber = inv.order?.orderNumber ?? '—';
      const orderType = inv.order?.orderType ?? null;
      const invoiceTime = new Date(inv.createdAt).toLocaleTimeString();
      for (const it of inv.items ?? []) {
        const prod = it.productId ? productMap.get(it.productId) : null;
        const miCat = it.menuItemId ? menuItemMap.get(it.menuItemId) : null;
        const categoryName = prod?.productCategoryName ?? miCat ?? 'Uncategorised';

        // Apply category filter — skip items whose category doesn't match
        if (allowedProductIds && allowedMenuItemIds) {
          if (it.productId && allowedProductIds.has(it.productId)) continue;
          if (it.menuItemId && allowedMenuItemIds.has(it.menuItemId)) continue;
        } else if (allowedProductIds) {
          if (it.productId && !allowedProductIds.has(it.productId)) continue;
        } else if (allowedMenuItemIds) {
          if (it.menuItemId && !allowedMenuItemIds.has(it.menuItemId)) continue;
        }

        rows.push({
          orderNumber,
          orderType,
          invoiceNumber: inv.invoiceNumber,
          saleDate: inv.createdAt?.toISOString() ?? '',
          time: invoiceTime,
          item: it.description,
          unitPrice: dec(it.unitPrice).toFixed(2),
          discountPercent: dec(it.discountPercent).toFixed(2),
          discountType: it.discountType ?? 'percentage',
          discountAmount: dec(it.discountAmount).toFixed(2),
          discountReason: it.discountReason ?? null,
          quantity: dec(it.quantity).toFixed(2),
          totalAmount: dec(it.total).toFixed(2),
          waiterName: inv.waiterId ? (waiterMap.get(inv.waiterId) ?? null) : null,
          categoryName,
        });
      }
    }

    return rows;
  }

  /** Retrieve a frozen Z-report snapshot for reprint. */
    async getZReportSnapshot(cashSessionId: string) {
      const organizationId = this.tenant.organizationId;
      const snap = await this.prisma.client.posReportSnapshot.findFirst({
        where: { organizationId, cashSessionId },
      });
      if (!snap) throw new NotFoundException('No Z-report snapshot for this session');
      return snap;
    }

    /**
     * Items sold grouped by item group (category) — aggregated quantities and totals.
     * Returns: array of { groupName, totalQuantity, totalAmount, itemCount }
     * 
     * @param fromDate - start date (YYYY-MM-DD)
     * @param toDate - end date (YYYY-MM-DD)
     * @param orderType - optional filter: 'dine_in' | 'takeaway' | 'delivery'
     */
    async itemsByGroup(fromDate: string, toDate: string, orderType?: string) {
      const organizationId = this.tenant.organizationId;
      const start = new Date(fromDate);
      const end = new Date(toDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new BadRequestException('Invalid fromDate/toDate');
      }
      end.setHours(23, 59, 59, 999);

      // Get all POS invoices in range
      const invoices = await this.prisma.client.invoice.findMany({
        where: {
          organizationId,
          status: { in: ['posted', 'paid'] },
          createdAt: { gte: start, lte: end },
          ...(orderType ? { order: { orderType: orderType as any } } : {}),
        },
        include: { items: true },
      });

      // Collect product IDs and menu item IDs
      const productIds = new Set<string>();
      const menuItemIds = new Set<string>();
      for (const inv of invoices as any[]) {
        for (const it of inv.items ?? []) {
          if (it.productId) productIds.add(it.productId);
          if (it.menuItemId) menuItemIds.add(it.menuItemId);
        }
      }

      // Build product → category lookup
      const products = productIds.size
        ? await this.prisma.client.product.findMany({
            where: { id: { in: Array.from(productIds) } },
            include: { category: { select: { id: true, name: true } } },
          })
        : [];
      const productMap = new Map(
        products.map((p: any) => [
          p.id,
          {
            name: p.name,
            categoryId: p.category?.id ?? null,
            categoryName: p.category?.name ?? null,
          },
        ]),
      );

      // Build menuItem → menuCategory lookup
      const menuItems = menuItemIds.size
        ? await this.prisma.client.menuItem.findMany({
            where: { id: { in: Array.from(menuItemIds) } },
            include: { category: { select: { id: true, name: true } } },
          })
        : [];
      const menuItemMap = new Map(
        menuItems.map((mi: any) => [
          mi.id,
          {
            categoryId: mi.category?.id ?? null,
            categoryName: mi.category?.name ?? null,
          },
        ]),
      );

      // Aggregate by category
      const groupMap = new Map<
        string,
        {
          groupName: string;
          groupId: string | null;
          totalQuantity: Money;
          totalAmount: Money;
          itemCount: number;
        }
      >();

      for (const inv of invoices as any[]) {
        for (const it of inv.items ?? []) {
          let groupId: string | null = null;
          let groupName = 'Uncategorised';

          if (it.productId) {
            const prod = productMap.get(it.productId);
            if (prod) {
              groupId = prod.categoryId;
              groupName = prod.categoryName ?? 'Uncategorised';
            }
          } else if (it.menuItemId) {
            const mi = menuItemMap.get(it.menuItemId);
            if (mi) {
              groupId = mi.categoryId;
              groupName = mi.categoryName ?? 'Uncategorised';
            }
          }

          const key = groupId ?? 'uncategorised';
          const bucket = groupMap.get(key) ?? {
            groupName,
            groupId,
            totalQuantity: dec(0),
            totalAmount: dec(0),
            itemCount: 0,
          };

          bucket.totalQuantity = bucket.totalQuantity.plus(dec(it.quantity));
          bucket.totalAmount = bucket.totalAmount.plus(dec(it.total ?? 0));
          bucket.itemCount += 1;
          groupMap.set(key, bucket);
        }
      }

      // Sort by total amount descending
      return Array.from(groupMap.values())
        .sort((a, b) => b.totalAmount.minus(a.totalAmount).toNumber())
        .map((g) => ({
          groupId: g.groupId,
          groupName: g.groupName,
          totalQuantity: g.totalQuantity.toFixed(2),
          totalAmount: g.totalAmount.toFixed(2),
          itemCount: g.itemCount,
        }));
    }

    // ─── helpers ─────────────────────────────────────────────────────────────
  private async resolveSession(organizationId: string, cashSessionId?: string) {
    if (cashSessionId) {
      return this.prisma.client.cashSession.findFirst({ where: { id: cashSessionId, organizationId } });
    }
    return this.prisma.client.cashSession.findFirst({
      where: { organizationId, status: 'open' },
      orderBy: { openedAt: 'desc' },
    });
  }

  private async sessionStatus(id: string): Promise<string> {
    const s = await this.prisma.client.cashSession.findFirst({ where: { id }, select: { status: true } });
    return s?.status ?? 'unknown';
  }
}
