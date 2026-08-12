import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PaginationQuery } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { WorkflowService } from '../../../kernel/workflow/workflow.service';
import { DocumentBuilderService } from '../document/document-builder.service';
import { ThreeWayMatchService } from '../../../kernel/three-way-match/three-way-match.service';
import { ApprovalsService } from '../../../kernel/approvals/approvals.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { CreateVendorBillDto } from './dto/vendor-bill.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Vendor bills / expenses (Accounts Payable). Status transitions (post/cancel)
 * go through the WorkflowService (ADR-007).
 *
 * Hardening (F.7):
 *   - Posting a bill first validates three-way match against all linked POs.
 *     If any line is `blocked`, the bill cannot be posted without an
 *     explicit override permission (`three_way_match:override`).
 *   - On create, if any `ApprovalPolicy` is registered for entityType
 *     `vendor_bill` with an `approverPermissions` set, the bill is submitted
 *     for approval instead of being immediately postable.
 *   - Posting runs inside a single transaction with the document write +
 *     stock-in + GL post. The whole chain rolls back on any failure.
 */
@Injectable()
export class VendorBillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly workflow: WorkflowService,
    private readonly builder: DocumentBuilderService,
    private readonly twm: ThreeWayMatchService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PaginationQuery & { sort?: string; branchId?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));
    const where: any = { documentType: 'vendor_bill' };
    if (query.search) {
      where.OR = [
        { documentNumber: { contains: query.search, mode: 'insensitive' } },
        { reference: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.branchId) {
      where.branchId = query.branchId;
    }
    const orderBy = this.parseSort(query.sort);
    const [data, total] = await Promise.all([
      this.prisma.client.document.findMany({
        where,
        include: { partner: true, _count: { select: { lines: true } } },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.document.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  findOne(id: string) {
    return this.prisma.client.document.findFirst({
      where: { id, documentType: 'vendor_bill' },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, partner: true, allocations: true },
    });
  }

  /**
   * Create a vendor bill. If an approval policy exists for vendor_bill with
   * approver permissions, the bill is held in `submitted` state pending
   * approval rather than immediately being postable.
   */
  async create(dto: CreateVendorBillDto) {
    this.validateDates(dto.issueDate, dto.dueDate);
    const doc = await this.builder.createDocument(this.prisma.client, 'vendor_bill', dto, dto.lines);
    const amount = Number(doc.totalAmount);
    const request = await this.approvals.requestApproval({
      entityType: 'vendor_bill',
      entityId: doc.id,
      snapshot: {
        amount,
        partnerId: doc.partnerId,
        documentNumber: doc.documentNumber,
        createdBy: this.tenant.userId,
      },
    });
    if (request) {
      // Held in pending approval — do not allow posting until approved.
      await this.audit.record({
        entity: 'VendorBill',
        entityId: doc.id,
        action: 'create',
        newValues: { documentNumber: doc.documentNumber, approvalRequestId: request.id, status: 'pending_approval' },
      });
    }
    return { ...doc, approvalRequestId: request?.id ?? null };
  }

  async update(id: string, dto: CreateVendorBillDto) {
    this.validateDates(dto.issueDate, dto.dueDate);
    return this.prisma.client.$transaction(async (tx: any) => {
      const doc = await tx.document.findFirst({ where: { id, documentType: 'vendor_bill' } });
      if (!doc) throw new NotFoundException('Vendor bill not found');
      if (doc.status !== 'draft') throw new BadRequestException('Only draft bills can be edited');

      await tx.documentLine.deleteMany({ where: { documentId: id } });
      const totals = await this.builder.prepareLines(tx, dto.lines);
      const organizationId = this.tenant.organizationId;

      await tx.document.updateMany({
        where: { id },
        data: {
          partnerId: dto.partnerId,
          issueDate: new Date(dto.issueDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          currencyId: dto.currencyId ?? null,
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

  /**
   * Post a vendor bill. Validates:
   *   1. Three-way match: every linked PO must be matched (or have explicit
   *      override permission `three_way_match:override`).
   *   2. Approval: every pending approval request for this bill must be
   *      approved (the bill must not be sitting in `pending_approval`).
   *
   * Then runs the canonical posting path (WorkflowService.transition), which
   * emits the GL effect (Dr Expense/Stock, Cr AP + VAT) inside a single
   * transaction.
   */
  async post(id: string, options: { override3WM?: boolean; overrideApproval?: boolean } = {}) {
    const orgId = this.tenant.organizationId;
    const userId = this.tenant.userId;

    const doc = await this.prisma.client.document.findFirst({
      where: { id, organizationId: orgId, documentType: 'vendor_bill' },
      include: { lines: true },
    });
    if (!doc) throw new NotFoundException('Vendor bill not found');

    // 1. Three-way match guard.
    const links = await this.prisma.raw.vendorBillLink.findMany({
      where: { organizationId: orgId, vendorBillId: id },
    });
    if (links.length > 0) {
      const validation = await this.twm.validateBillForPosting(id);
      if (!validation.ok && !options.override3WM) {
        const blocked = validation.matches.filter((m: any) => m.status === 'blocked');
        throw new ForbiddenException(
          `Three-way match failed: ${blocked.length} line(s) blocked. Resolve the mismatches or post with override (requires three_way_match:override permission).`,
        );
      }
      if (!options.override3WM) {
        // Record approval for the gate.
        await this.audit.record({
          entity: 'VendorBill',
          entityId: id,
          action: 'update',
          newValues: { threeWayMatchOk: true, blockedCount: 0 },
        });
      } else {
        // Audit the override so it shows up in the compliance trail.
        const permissions = this.tenant.permissions ?? [];
        if (!permissions.includes('three_way_match:override')) {
          throw new ForbiddenException('You do not have three_way_match:override permission');
        }
        await this.audit.record({
          entity: 'VendorBill',
          entityId: id,
          action: 'update',
          newValues: { threeWayMatchOverride: true, approver: userId },
        });
      }
    }

    // 2. Approval gate.
    const pending = await this.prisma.raw.approvalRequest.findFirst({
      where: { organizationId: orgId, entityType: 'vendor_bill', entityId: id, status: 'pending' },
    });
    if (pending && !options.overrideApproval) {
      throw new ForbiddenException(
        'This bill is awaiting approval. Wait for approval or post with override.',
      );
    }
    if (pending && options.overrideApproval) {
      const permissions = this.tenant.permissions ?? [];
      if (!permissions.includes('approvals:decide')) {
        throw new ForbiddenException('You do not have approvals:decide permission');
      }
      await this.prisma.raw.approvalRequest.update({
        where: { id: pending.id },
        data: { status: 'approved', decidedAt: new Date() },
      });
      await this.audit.record({
        entity: 'ApprovalRequest',
        entityId: pending.id,
        action: 'approve',
      });
    }

    // 3. Canonical posting via the workflow engine.
    await this.workflow.transition({
      entityType: 'vendor_bill',
      entityId: id,
      action: 'post',
      entity: doc,
    });

    // 4. Re-validate three-way match after posting (so denorm reflects state).
    for (const link of links) {
      await this.twm.recomputeForOrder(link.purchaseOrderId);
    }

    this.events.publish('bill.posted', {
      organizationId: orgId,
      documentId: doc.id,
      documentNumber: doc.documentNumber,
    });
    return this.prisma.client.document.findFirst({
      where: { id },
      include: { lines: true, partner: true },
    });
  }

  /** Void: reverse the posting (corrections via reversal, never edits). */
  async cancel(id: string) {
    const doc = await this.prisma.client.document.findFirst({
      where: { id, documentType: 'vendor_bill' },
      include: { allocations: true },
    });
    if (!doc) throw new NotFoundException('Vendor bill not found');
    if (doc.status === 'cancelled') return doc;

    await this.workflow.transition({
      entityType: 'vendor_bill',
      entityId: id,
      action: 'cancel',
      entity: doc,
    });

    this.events.publish('bill.cancelled', {
      organizationId: this.tenant.organizationId,
      documentId: doc.id,
      documentNumber: doc.documentNumber,
    });
    return this.prisma.client.document.findFirst({ where: { id } });
  }

  private validateDates(issueDate: string, dueDate?: string) {
    const now = new Date();
    const issue = new Date(issueDate);
    if (issue > now) {
      throw new BadRequestException('Issue date cannot be in the future');
    }
    if (dueDate) {
      const due = new Date(dueDate);
      if (due < issue) {
        throw new BadRequestException('Due date cannot be earlier than issue date');
      }
    }
  }

  async ledger(partnerId: string) {
    const bills = await this.prisma.client.document.findMany({
      where: { organizationId: this.tenant.organizationId, partnerId, documentType: 'vendor_bill', status: { in: ['draft', 'posted', 'cancelled'] } },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
      orderBy: { issueDate: 'asc' },
    });
    const payments = await this.prisma.client.payment.findMany({
      where: { organizationId: this.tenant.organizationId, partnerId, direction: 'outbound', status: { in: ['posted', 'cancelled'] } },
      orderBy: { paymentDate: 'asc' },
    });
    const items: any[] = [];
    for (const b of bills) {
      items.push({
        id: b.id,
        date: b.issueDate,
        type: 'bill',
        reference: b.documentNumber,
        description: (b.lines?.[0]?.description as string) ?? b.notes ?? 'Bill',
        debit: Number(b.totalAmount),
        credit: 0,
        residual: Number(b.amountResidual),
        status: b.status,
      });
    }
    for (const p of payments) {
      items.push({
        id: p.id,
        date: p.paymentDate,
        type: p.status === 'cancelled' ? 'payment_void' : 'payment',
        reference: p.paymentNumber,
        description: `Payment (${p.paymentMethod})`,
        debit: 0,
        credit: Number(p.amount),
        status: p.status,
      });
    }
    items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let running = 0;
    const transactions = items.map((it) => {
      running = running + it.debit - it.credit;
      return { ...it, balance: running };
    });
    const openingBalance = transactions.length > 0 ? transactions[0].balance - transactions[0].debit + transactions[0].credit : 0;
    return { openingBalance, closingBalance: running, transactions };
  }

  /**
   * Parse the `?sort=` query param. Format: `field:asc` or `field:desc`.
   * Multiple sorts: `?sort=status:asc,createdAt:desc`. Whitelisted to known
   * fields. Unrecognized values fall back to `createdAt:desc`.
   */
  private parseSort(sort?: string): any {
    const DEFAULT = { createdAt: 'desc' as const };
    if (!sort) return DEFAULT;
    const FIELDS = new Set([
      'createdAt', 'updatedAt', 'issueDate', 'dueDate', 'documentNumber',
      'totalAmount', 'amountResidual', 'status', 'reference',
    ]);
    const items = sort.split(',').slice(0, 3);
    const parsed: any = {};
    for (const item of items) {
      const [field, dir = 'asc'] = item.split(':');
      if (!FIELDS.has(field)) continue;
      parsed[field] = dir === 'desc' ? 'desc' : 'asc';
    }
    return Object.keys(parsed).length ? parsed : DEFAULT;
  }
}
