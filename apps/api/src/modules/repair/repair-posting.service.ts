import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { PosInvoiceService } from '../pos/billing/pos-invoice.service';
import { NotificationsService } from '../../kernel/notifications/notifications.service';
import { ModuleRegistry } from '../../kernel/module-loader/module-registry.service';

/**
 * RepairPostingService — the financial spine of a repair order.
 *
 * Billing rides the standard Order → Invoice spine exactly like rental fees:
 * one Order (transactionKind `repair`, repairOrderId set) + one Invoice via
 * PosInvoiceService. Labour lines are service products (never stock); part
 * lines are the spare-part products with repairOrderLineId set — the POS
 * engine never re-issues them because the repair parts service already
 * relieved stock at issue-time (see pos-invoice.service.ts skip filters).
 */
@Injectable()
export class RepairPostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly seq: SequenceService,
    private readonly posInvoice: PosInvoiceService,
    private readonly notifications: NotificationsService,
    private readonly modules: ModuleRegistry,
  ) {}

  /**
   * Bill an approved repair order from its approved quotation.
   *
   * `lines` (optional) overrides the quotation lines; by default the approved
   * quotation's lines are used. Labour lines resolve their billing product
   * from the labour type's productId; parts use their productId directly.
   *
   * Returns { orderId, invoiceId, order, invoice }.
   */
  async billRepair(
    repairOrderId: string,
    input: {
      paymentMode?: 'cash' | 'card' | 'mobile_money' | 'mixed' | 'credit';
      tenders?: Array<{ method: string; amount: number; reference?: string }>;
      occurredAt?: string;
      branchId?: string;
      lines?: Array<{
        kind: 'labour' | 'part';
        description: string;
        productId: string;
        quantity?: number;
        unitPrice?: number;
        taxId?: string | null;
      }>;
    } = {},
  ) {
    const orgId = this.tenant.organizationId;
    const order = await this.prisma.client.repairOrder.findFirst({
      where: { id: repairOrderId, organizationId: orgId },
    });
    if (!order) throw new NotFoundException('Repair order not found');
    if (order.status === 'cancelled' || order.status === 'closed')
      throw new BadRequestException('Repair order is closed/cancelled — cannot bill');
    if (order.orderId || order.invoiceId)
      throw new BadRequestException('Repair order already billed');

    let lines: any[] | undefined = input.lines;
    if (!lines) {
      const quotation = order.quotationId
        ? await this.prisma.client.repairQuotation.findFirst({
            where: { id: order.quotationId, organizationId: orgId, status: 'approved' },
            include: { lines: { orderBy: { lineNumber: 'asc' } } },
          })
        : null;
      if (!quotation) {
        const anyApproved = await this.prisma.client.repairQuotation.findFirst({
          where: { repairOrderId, organizationId: orgId, status: 'approved' },
          include: { lines: { orderBy: { lineNumber: 'asc' } } },
          orderBy: { createdAt: 'desc' },
        });
        if (!anyApproved) throw new BadRequestException('No approved quotation to bill — approve one first');
        lines = anyApproved.lines;
      } else {
        lines = quotation.lines;
      }
      lines = lines.map((l) => ({
        kind: l.kind as 'labour' | 'part',
        description: l.description,
        productId: l.productId,
        labourTypeId: l.labourTypeId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        taxId: l.taxId,
      }));
    }

    // Resolve billing products: labour lines need the labour type's service
    // product; part lines already carry productId.
    const resolved: Array<{
      productId: string;
      description: string;
      quantity: number;
      unitPrice: number;
      taxId?: string | null;
      repairFeeType: 'labour' | 'part';
    }> = [];
    for (const l of lines) {
      let productId = l.productId;
      if (!productId && l.kind === 'labour') {
        // Prefer the labour type id captured on the line; fall back to a
        // case-insensitive name match for lines created without the id.
        const lt = l.labourTypeId
          ? await this.prisma.client.repairLabourType.findFirst({
              where: { id: l.labourTypeId, organizationId: orgId },
            })
          : await this.prisma.client.repairLabourType.findFirst({
              where: { organizationId: orgId, name: { equals: l.description, mode: 'insensitive' } },
            });
        productId = lt?.productId ?? '';
      }
      if (!productId) {
        throw new BadRequestException(
          `Line "${l.description}" has no billable product — labour types need a billing product; parts need a productId`,
        );
      }
      const qty = Number(l.quantity ?? 1);
      if (!(qty > 0)) throw new BadRequestException(`Line "${l.description}": quantity must be positive`);
      const unitPrice = Number(l.unitPrice ?? 0);
      resolved.push({
        productId,
        description: l.description,
        quantity: qty,
        unitPrice,
        taxId: l.taxId ?? null,
        repairFeeType: l.kind,
      });
    }
    if (resolved.length === 0) throw new BadRequestException('No billable lines');

    const orderNumber = await this.seq.next('pos_order', { prefix: 'OR-', padding: 6 });
    // Invoice.partnerId is required — walk-in repairs with no customer on the
    // order fall back to the org's WALKIN partner (same convention as the POS).
    let partnerId = order.partnerId;
    if (!partnerId) {
      const walkIn = await this.prisma.client.partner.findFirst({ where: { organizationId: orgId, code: 'WALKIN' } });
      partnerId = walkIn?.id ?? (
        await this.prisma.client.partner.create({
          data: {
            organizationId: orgId,
            code: 'WALKIN',
            name: 'Walk-in Customer',
            isCustomer: true,
            isCompany: false,
          },
        })
      ).id;
    }
    const createdOrder = await this.prisma.client.$transaction(async (tx: any) => {
      this.modules.assertKnownOrderKind('repair'); // Phase D: validated against the registry, not a shared enum.
      const o = await tx.order.create({
        data: {
          organizationId: orgId,
          orderNumber,
          orderType: 'takeaway',
          status: 'confirmed',
          partnerId,
          branchId: input.branchId ?? order.branchId ?? null,
          notes: `Repair ${order.repairNumber}`,
          transactionKind: 'repair',
          // Polymorphic source document (Phase D) + deprecated `repairOrderId`,
          // dual-written for one release.
          sourceDocumentType: 'repair_order',
          sourceDocumentId: order.id,
          repairOrderId: order.id,
          items: {
            create: resolved.map((l, idx) => ({
              organizationId: orgId,
              productId: l.productId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountPercent: 0,
              discountType: 'percentage',
              discountAmount: 0,
              taxId: l.taxId ?? null,
              taxInclusive: false,
              lineNumber: idx,
              repairOrderLineId: order.id,
              repairFeeType: l.repairFeeType,
            })),
          },
        },
      });
      await tx.repairOrder.update({
        where: { id: order.id },
        data: { orderId: o.id, updatedBy: this.tenant.userId },
      });
      return o;
    });

    const invoice = await this.posInvoice.generateInvoice(
      createdOrder.id,
      {
        paymentMode: input.paymentMode ?? 'cash',
        occurredAt: input.occurredAt,
      },
      undefined,
    );

    await this.prisma.client.repairOrder.update({
      where: { id: order.id },
      data: {
        invoiceId: invoice.id,
        labourTotal: resolved.filter((l) => l.repairFeeType === 'labour').reduce((s, l) => s + l.unitPrice * l.quantity, 0),
        partsTotal: resolved.filter((l) => l.repairFeeType === 'part').reduce((s, l) => s + l.unitPrice * l.quantity, 0),
        taxTotal: Number(invoice.taxAmount ?? 0) || 0,
        totalAmount: Number(invoice.grandTotal ?? invoice.total ?? 0) || resolved.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
        updatedBy: this.tenant.userId,
      },
    });

    await this.notifications.send({
      organizationId: orgId,
      channel: 'in_app',
      category: 'repair',
      title: `Repair billed — ${invoice.invoiceNumber ?? invoice.id}`,
      body: `${order.repairNumber} invoiced (${resolved.length} lines)`,
      payload: { repairOrderId: order.id, invoiceId: invoice.id, repairNumber: order.repairNumber },
    });

    return { orderId: createdOrder.id, invoiceId: invoice.id, order: createdOrder, invoice };
  }

  /** Record payment tenders against the repair invoice (settlement flow). */
  async receivePayment(
    invoiceId: string,
    dto: {
      tenders?: Array<{ method: string; amount: number; reference?: string }>;
      paymentMethod?: string;
      amountTendered?: number;
      cashSessionId?: string;
    },
  ) {
    return this.posInvoice.receivePayment(invoiceId, {
      tenders: dto.tenders?.map((t) => ({
        method: t.method as any,
        amount: t.amount,
        reference: t.reference,
      })),
      paymentMethod: dto.paymentMethod as any,
      amountTendered: dto.amountTendered,
      cashSessionId: dto.cashSessionId,
    });
  }
}
