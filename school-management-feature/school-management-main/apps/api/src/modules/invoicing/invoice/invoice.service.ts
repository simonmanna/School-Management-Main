import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PaginationQuery } from '@erp/shared';
import { dec } from '../../../kernel/common/money';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { WorkflowService } from '../../../kernel/workflow/workflow.service';
import { DocumentBuilderService } from '../document/document-builder.service';
import { CreateInvoiceDto } from './dto/invoice.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

@Injectable()
export class InvoiceService {
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
    const where: any = { documentType: 'sales_invoice' };
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
      where: { id, documentType: 'sales_invoice' },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, partner: true, allocations: true },
    });
  }

  async create(dto: CreateInvoiceDto) {
    const doc = await this.builder.createDocument(this.prisma.client, 'sales_invoice', dto, dto.lines);
    this.events.publish('invoice.created', {
      organizationId: this.tenant.organizationId,
      documentId: doc.id,
      documentNumber: doc.documentNumber,
    });
    return doc;
  }

  async update(id: string, dto: CreateInvoiceDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const doc = await tx.document.findFirst({ where: { id, documentType: 'sales_invoice' } });
      if (!doc) throw new NotFoundException('Invoice not found');
      if (doc.status !== 'draft') throw new BadRequestException('Only draft invoices can be edited');

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
          exchangeRate: dec(dto.exchangeRate ?? 1),
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
      where: { id, documentType: 'sales_invoice' },
      include: { lines: true },
    });
    if (!doc) throw new NotFoundException('Invoice not found');

    const result = await this.workflow.transition({
      entityType: 'invoice',
      entityId: id,
      action: 'post',
      entity: doc,
    });

    this.events.publish('invoice.posted', {
      organizationId: this.tenant.organizationId,
      documentId: doc.id,
      documentNumber: doc.documentNumber,
    });
    return this.prisma.client.document.findFirst({ where: { id }, include: { lines: true, partner: true } });
  }

  async cancel(id: string) {
    const doc = await this.prisma.client.document.findFirst({
      where: { id, documentType: 'sales_invoice' },
      include: { allocations: true },
    });
    if (!doc) throw new NotFoundException('Invoice not found');
    if (doc.status === 'cancelled') return doc;

    await this.workflow.transition({
      entityType: 'invoice',
      entityId: id,
      action: 'cancel',
      entity: doc,
    });

    this.events.publish('invoice.cancelled', {
      organizationId: this.tenant.organizationId,
      documentId: doc.id,
      documentNumber: doc.documentNumber,
    });
    return this.prisma.client.document.findFirst({ where: { id } });
  }
}
