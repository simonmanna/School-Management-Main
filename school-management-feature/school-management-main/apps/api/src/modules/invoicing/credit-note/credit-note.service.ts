import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaginationQuery } from '@erp/shared';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { PostingService } from '../../accounting/posting/posting.service';
import type { PostingLineInput } from '../../accounting/posting/posting.types';
import { DocumentBuilderService } from '../document/document-builder.service';
import { CreateCreditNoteDto } from './dto/credit-note.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

@Injectable()
export class CreditNoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly posting: PostingService,
    private readonly builder: DocumentBuilderService,
  ) {}

  async list(query: PaginationQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));
    const where: any = { documentType: 'credit_note' };
    if (query.search) {
      where.OR = [{ documentNumber: { contains: query.search, mode: 'insensitive' } }];
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
      where: { id, documentType: 'credit_note' },
      include: { lines: { orderBy: { lineNumber: 'asc' } }, partner: true },
    });
  }

  create(dto: CreateCreditNoteDto) {
    return this.builder.createDocument(this.prisma.client, 'credit_note', dto, dto.lines);
  }

  async post(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const cn = await tx.document.findFirst({
        where: { id, documentType: 'credit_note' },
        include: { lines: true },
      });
      if (!cn) throw new NotFoundException('Credit note not found');
      if (cn.status === 'posted' || cn.status === 'paid') {
        throw new BadRequestException('Credit note is already posted');
      }
      if (cn.status === 'cancelled') throw new BadRequestException('Credit note is cancelled');

      const { counterAccount, itemByAccount, taxByAccount } = await this.builder.groupForPosting(tx, cn, 'sales');

      // Reverse of an invoice: debit Revenue + Tax, credit AR.
      const lines: PostingLineInput[] = [];
      for (const [accountId, amount] of itemByAccount) {
        lines.push({ accountId, debit: amount.toString(), partnerId: cn.partnerId, description: 'Revenue (credit)' });
      }
      for (const [accountId, amount] of taxByAccount) {
        lines.push({ accountId, debit: amount.toString(), description: 'Tax (credit)' });
      }
      lines.push({
        accountId: counterAccount,
        credit: cn.totalAmount.toString(),
        partnerId: cn.partnerId,
        description: `Credit note ${cn.documentNumber}`,
      });

      const entry = await this.posting.post(
        {
          journalCode: 'SALES',
          date: cn.issueDate,
          description: `Credit note ${cn.documentNumber}`,
          currencyId: cn.currencyId ?? undefined,
          exchangeRate: Number(cn.exchangeRate),
          sourceType: 'credit_note',
          sourceId: cn.id,
          lines,
        },
        tx,
      );

      await tx.document.updateMany({
        where: { id: cn.id },
        data: {
          status: 'posted',
          postedAt: new Date(),
          postedBy: this.tenant.userId ?? null,
          journalEntryId: entry.id,
          amountResidual: 0,
        },
      });

      // Apply the credit against the original invoice's open balance.
      if (cn.reversedDocumentId) {
        const inv = await tx.document.findFirst({
          where: { id: cn.reversedDocumentId, documentType: 'sales_invoice' },
        });
        if (inv && (inv.status === 'posted' || inv.status === 'paid')) {
          const residual = inv.amountResidual as Prisma.Decimal;
          const total = cn.totalAmount as Prisma.Decimal;
          const reduce = total.greaterThan(residual) ? residual : total;
          if (reduce.greaterThan(0)) {
            const newResidual = residual.minus(reduce);
            const paid = newResidual.lessThanOrEqualTo(0);
            await tx.document.updateMany({
              where: { id: inv.id },
              data: {
                amountResidual: newResidual,
                paymentStatus: paid ? 'paid' : 'partial',
                status: paid ? 'paid' : inv.status,
              },
            });
          }
        }
      }

      this.events.publish('creditnote.issued', {
        organizationId: this.tenant.organizationId,
        documentId: cn.id,
        documentNumber: cn.documentNumber,
      });
      return tx.document.findFirst({ where: { id: cn.id }, include: { lines: true, partner: true } });
    });
  }
}
