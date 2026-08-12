import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PaginationQuery } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { WorkflowService } from '../../../kernel/workflow/workflow.service';
import { DocumentBuilderService } from '../document/document-builder.service';
import { CreateVendorBillDto } from './dto/vendor-bill.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Vendor bills / expenses (Accounts Payable). Status transitions (post/cancel)
 * go through the WorkflowService (ADR-007). This service handles only the
 * non-status CRUD: list, get, create, update.
 *
 * The vendor_bill workflow's `post` side effect:
 *   - For stockable lines: calls StockService.receiveFromBill (Dr Stock / Cr GRNI)
 *   - For all lines:      calls PostingService.post with GRNI for stockable + Expense for the rest + VAT
 *   - The GRNI pair nets to Dr Stock / Cr AP at the org level.
 */
@Injectable()
export class VendorBillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly workflow: WorkflowService,
    private readonly builder: DocumentBuilderService,
  ) {}

  async list(query: PaginationQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));
    const where: any = { documentType: 'vendor_bill' };
    if (query.search) {
      where.OR = [
        { documentNumber: { contains: query.search, mode: 'insensitive' } },
        { reference: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.client.document.findMany({
        where,
        include: { partner: true, _count: { select: { lines: true } } },
        orderBy: { createdAt: 'desc' },
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

  async create(dto: CreateVendorBillDto) {
    return this.builder.createDocument(this.prisma.client, 'vendor_bill', dto, dto.lines);
  }

  async update(id: string, dto: CreateVendorBillDto) {
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

  async post(id: string) {
    const doc = await this.prisma.client.document.findFirst({
      where: { id, documentType: 'vendor_bill' },
      include: { lines: true },
    });
    if (!doc) throw new NotFoundException('Vendor bill not found');

    await this.workflow.transition({
      entityType: 'vendor_bill',
      entityId: id,
      action: 'post',
      entity: doc,
    });

    this.events.publish('bill.posted', {
      organizationId: this.tenant.organizationId,
      documentId: doc.id,
      documentNumber: doc.documentNumber,
    });
    return this.prisma.client.document.findFirst({ where: { id }, include: { lines: true, partner: true } });
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
}
