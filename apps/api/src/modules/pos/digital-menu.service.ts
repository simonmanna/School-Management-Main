/**
 * POS F — Digital Menu service (Phase 1 MVP).
 *
 * Customer-facing ordering channel. The flow:
 *
 *   1. Admin / cashier creates a MenuQrSession for a table:
 *        POST /pos/menu/sessions  { branchId, tableNumber, expiresInHours? }
 *      → returns { token, url, qrSvg? }
 *   2. The QR encodes the URL `…/menu/:branchId/:tableId?token=…`
 *   3. Customer opens the URL in a mobile browser. No login.
 *   4. Frontend calls GET /menu/public/catalog?token=… → menu JSON
 *   5. Customer adds items, customizes, places an order:
 *        POST /menu/public/orders  { token, customerName, phone, items, payment }
 *   6. Backend:
 *        - creates a sales_invoice Document (sourceType='online_menu')
 *        - creates the matching Payment(s)
 *        - decrements stock (same as a cashier sale)
 *        - creates KDS tickets (same as a cashier sale)
 *        - creates an OnlineOrder row linked to the invoice
 *   7. Customer tracks the order:
 *        GET /menu/public/orders/:id/track?token=…
 *   8. Cashier sees the order in the terminal under "Online orders" queue
 *      and the KDS screens light up.
 *
 * Loyalty: when the customer supplies a phone number that matches an
 * existing Partner, the sale earns points through PosLoyaltyService.
 *
 * Payment: the customer can pay on delivery (cash_on_pickup), on the menu
 * (mobile_money / card / wallet via gateway stub). The MVP implements
 * mobile_money as a record-only flow; a real gateway can be added later.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { PosLoyaltyService } from './pos-loyalty.service';
import { PosService } from './pos.service';
import PDFDocument = require('pdfkit');
import { randomBytes } from 'node:crypto';

@Injectable()
export class DigitalMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly loyalty: PosLoyaltyService,
    private readonly pos: PosService,
  ) {}

  /* ============== QR sessions (admin) ============== */

  /** Create a new QR session for a table. The token is what the customer-facing
   *  menu page submits to prove it scanned the right QR. */
  async createSession(args: { branchId: string; tableNumber?: string; expiresInHours?: number; customerName?: string; customerPhone?: string }): Promise<any> {
    const orgId = this.tenant.organizationId;
    const token = randomBytes(16).toString('base64url');
    const expiresAt = new Date(Date.now() + (args.expiresInHours ?? 6) * 60 * 60_000);
    const session = await this.prisma.client.menuQrSession.create({
      data: {
        organizationId: orgId,
        branchId: args.branchId,
        tableNumber: args.tableNumber,
        token,
        expiresAt,
      },
    });
    await this.audit.record({
      entity: 'MenuQrSession',
      entityId: session.id,
      action: 'create',
      newValues: { branchId: args.branchId, tableNumber: args.tableNumber, expiresAt },
    });
    return session;
  }

  async listSessions(branchId?: string): Promise<any[]> {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.menuQrSession.findMany({
      where: {
        organizationId: orgId,
        ...(branchId ? { branchId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async revokeSession(id: string): Promise<void> {
    const orgId = this.tenant.organizationId;
    await this.prisma.client.menuQrSession.updateMany({
      where: { id, organizationId: orgId },
      data: { isActive: false },
    });
  }

  /* ============== Public catalog (no auth) ============== */

  /** Validate a token and return the active session + the public catalog
   *  (categories + products + combos). Marks the session as recently used. */
  async getPublicCatalog(token: string): Promise<{
    session: any;
    orgName: string;
    branchName: string;
    categories: any[];
    products: any[];
    combos: any[];
  }> {
    const session = await this.prisma.raw.menuQrSession.findUnique({ where: { token } });
    if (!session || !session.isActive || session.expiresAt < new Date()) {
      throw new NotFoundException('This menu link has expired. Please ask staff for a new QR.');
    }
    await this.prisma.raw.menuQrSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });

    // Resolve org + branch names for the header.
    const org = await this.prisma.raw.organization.findUnique({ where: { id: session.organizationId } });
    const branch = await this.prisma.raw.branch.findFirst({
      where: { id: session.branchId, organizationId: session.organizationId },
    });

    // Public catalog = only active, in-stock-ish products.
    const products = await this.prisma.client.product.findMany({
      where: { organizationId: session.organizationId, isActive: true },
      include: {
        category: true,
        stockItems: { where: { locationId: { in: await this.warehouseIdsForBranch(session.branchId) } } },
      },
      orderBy: { name: 'asc' },
    });
    const categories = await this.prisma.client.productCategory.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { name: 'asc' },
    });
    const combos = await this.prisma.client.combo.findMany({
      where: { organizationId: session.organizationId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: { items: { include: { product: true } } },
    });

    const publicProducts = (products as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: Number(p.salesPrice ?? 0),
      imageUrl: p.imageUrl,
      categoryId: p.categoryId,
      categoryName: p.category?.name,
      station: p.station,
      productType: p.productType,
      // In stock if any tracked location has quantity > 0.
      inStock: p.trackInventory
        ? p.stockItems.some((s: any) => Number(s.quantity) > 0)
        : true,
    }));

    const publicCombos = (combos as any[]).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      price: Number(c.price),
      imageUrl: c.imageUrl,
      items: c.items.map((it: any) => ({
        productId: it.productId,
        productName: it.product?.name,
        quantity: it.quantity,
      })),
    }));

    return {
      session: { id: session.id, branchId: session.branchId, tableNumber: session.tableNumber },
      orgName: org?.name ?? 'Cafe',
      branchName: branch?.name ?? 'Main',
      categories,
      products: publicProducts,
      combos: publicCombos,
    };
  }

  /* ============== Place order (no auth) ============== */

  /** Place an order from the digital menu. The "magic" is that this internally
   *  calls the same PosService.checkout the cashier uses — so all the
   *  accounting, stock, KDS, loyalty logic is shared. */
  async placeOrder(args: {
    token: string;
    customerName: string;
    customerPhone?: string;
    customerEmail?: string;
    orderType?: 'dine_in' | 'takeaway' | 'pickup';
    notes?: string;
    lines: Array<{ productId: string; quantity: number; unitPrice: number; description: string; modifiers?: any[]; comboId?: string }>;
    tenders: Array<{ method: 'mobile_money' | 'card' | 'cash_on_pickup' | 'wallet' | 'qr'; amount: number; reference?: string }>;
  }): Promise<any> {
    const session = await this.prisma.raw.menuQrSession.findUnique({ where: { token: args.token } });
    if (!session || !session.isActive || session.expiresAt < new Date()) {
      throw new BadRequestException('Menu link expired');
    }
    if (!args.lines?.length) throw new BadRequestException('Cart is empty');
    if (!args.customerName?.trim()) throw new BadRequestException('Customer name is required');
    const total = args.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    if (total <= 0) throw new BadRequestException('Order total is zero');

    // 1) Create the partner (or reuse by phone) and the sales invoice.
    const partner = await this.findOrCreateCustomer(session.organizationId, args.customerName, args.customerPhone, args.customerEmail);
    const orgId = session.organizationId;
    const tendered = args.tenders.reduce((s, t) => s + Number(t.amount), 0);
    if (Math.abs(tendered - total) > 0.01) {
      throw new BadRequestException('Tenders do not cover the total');
    }

    // 2) Drive the same PosService.checkout that the cashier uses. This
    //    posts the invoice, records payments, decrements stock, creates
    //    KDS tickets, and awards loyalty points — all in one call.
    const checkoutResult = await this.pos.checkout({
      partnerId: partner.id,
      branchId: session.branchId,
      lines: args.lines,
      tenders: args.tenders.map((t) => ({ method: this.mapPaymentMethod(t.method), amount: t.amount, reference: t.reference })),
      reference: `Online order from ${session.tableNumber ? 'table ' + session.tableNumber : 'web'}`,
      notes: args.notes,
    } as any);

    // 3) Create the OnlineOrder row.
    const onlineOrder = await this.prisma.client.onlineOrder.create({
      data: {
        organizationId: orgId,
        sessionId: session.id,
        customerName: args.customerName,
        customerPhone: args.customerPhone,
        customerEmail: args.customerEmail,
        orderType: args.orderType ?? 'dine_in',
        items: args.lines as any,
        subtotal: total,
        taxAmount: 0,
        totalAmount: total,
        invoiceId: (checkoutResult as any).invoiceId,
        paymentMethod: args.tenders[0]?.method ?? 'cash_on_pickup',
        paymentRef: args.tenders[0]?.reference,
        status: 'received',
        notes: args.notes,
      },
    });

    return {
      onlineOrderId: onlineOrder.id,
      orderNumber: (checkoutResult as any).invoiceNumber,
      total,
      change: (checkoutResult as any).change ?? 0,
      status: onlineOrder.status,
    };
  }

  /* ============== Order tracking (no auth) ============== */

  /** Public tracking endpoint. Returns the order's current status + items.
   *  No auth — the customer scans the QR on the receipt / order page. */
  async trackOrder(orderId: string, token: string): Promise<any> {
    const order = await this.prisma.raw.onlineOrder.findFirst({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.sessionId) {
      const session = await this.prisma.raw.menuQrSession.findFirst({ where: { id: order.sessionId } });
      if (!session || session.token !== token) throw new NotFoundException('Invalid tracking token');
    }
    return {
      id: order.id,
      orderNumber: order.invoiceId,
      status: order.status,
      total: Number(order.totalAmount),
      items: order.items,
      notes: order.notes,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  /** Cashier/manager updates the status (e.g. mark ready, served). */
  async updateOrderStatus(orderId: string, status: 'received' | 'accepted' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled'): Promise<any> {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.onlineOrder.update({
      where: { id: orderId },
      data: { status: status as any },
    });
  }

  /** List online orders for the cashier (or for analytics later). */
  async listOnlineOrders(status?: string, limit = 50): Promise<any[]> {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.onlineOrder.findMany({
      where: {
        organizationId: orgId,
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /* ============== helpers ============== */

  private async findOrCreateCustomer(orgId: string, name: string, phone?: string, email?: string): Promise<any> {
    // Try to find by phone first (most stable), then by email.
    if (phone) {
      const existing = await this.prisma.client.partner.findFirst({ where: { organizationId: orgId, phone } });
      if (existing) return existing;
    }
    if (email) {
      const existing = await this.prisma.client.partner.findFirst({ where: { organizationId: orgId, email } });
      if (existing) return existing;
    }
    // Otherwise create a new partner.
    const code = `CUST-${Date.now().toString(36).toUpperCase()}`;
    return this.prisma.client.partner.create({
      data: {
        organizationId: orgId,
        code,
        name: name.trim(),
        phone: phone?.trim(),
        email: email?.trim(),
        isCustomer: true,
        isCompany: false,
      },
    });
  }

  private async warehouseIdsForBranch(branchId: string): Promise<string[]> {
    // For Phase 1 MVP: every branch shares the same warehouse. The branch
    // table is light — we just return all active warehouse locations.
    const orgId = this.tenant.organizationId;
    const wh = await this.prisma.client.inventoryLocation.findMany({
      where: { organizationId: orgId, type: 'warehouse', isActive: true },
    });
    return wh.map((w) => w.id);
  }

  private mapPaymentMethod(m: 'mobile_money' | 'card' | 'cash_on_pickup' | 'wallet' | 'qr'): 'cash' | 'bank' | 'card' | 'mobile_money' | 'store_credit' {
    if (m === 'cash_on_pickup') return 'cash';
    if (m === 'mobile_money') return 'mobile_money';
    return 'card';
  }
}