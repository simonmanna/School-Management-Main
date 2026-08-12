import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaginationQuery, PaymentDirection, PaymentStatus } from '@erp/shared';
import { dec, round, ZERO } from '../../../kernel/common/money';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import { CashSessionService } from '../../accounting/treasury/cash-session.service';
import { WorkflowService } from '../../../kernel/workflow/workflow.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { CreatePaymentDto } from './dto/payment.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Customer receipts (inbound) and supplier payments (outbound). Posting:
 *   inbound  -> Dr Cash/Bank  / Cr Accounts Receivable
 *   outbound -> Dr Accounts Payable / Cr Cash/Bank
 * Allocations settle the matching documents (invoices / bills) by reducing
 * their residual. Voiding reverses the journal and restores every residual.
 *
 * Cash payments may pass `cashSessionId` so the matching CashMovement is
 * written in the same transaction — the session's Z-report reconciles.
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
    private readonly posting: PostingService,
    private readonly determination: AccountDeterminationService,
    private readonly cashSessions: CashSessionService,
    private readonly workflow: WorkflowService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PaginationQuery, direction?: PaymentDirection) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 25));
    const where: any = {};
    if (direction) where.direction = direction;
    if (query.search) {
      where.OR = [
        { paymentNumber: { contains: query.search, mode: 'insensitive' } },
        { reference: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.client.payment.findMany({
        where,
        include: { partner: true, _count: { select: { allocations: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.payment.count({ where }),
    ]);
    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  findOne(id: string) {
    return this.prisma.client.payment.findFirst({
      where: { id },
      include: { partner: true, allocations: { include: { document: true } } },
    });
  }

  createReceipt(dto: CreatePaymentDto) {
    return this.record(dto, 'inbound');
  }

  createSupplierPayment(dto: CreatePaymentDto) {
    return this.record(dto, 'outbound');
  }

  private async record(dto: CreatePaymentDto, direction: PaymentDirection) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const organizationId = this.tenant.organizationId;
      const partner = await tx.partner.findFirst({ where: { id: dto.partnerId } });
      if (!partner) throw new BadRequestException('Partner not found');

      const amount = round(dec(dto.amount), 6);
      const method = dto.paymentMethod ?? 'cash';
      const cashAccount =
        dto.accountId ?? (await this.determination.mapped(method === 'bank' ? 'default_bank' : 'default_cash', tx));
      const counterAccount =
        direction === 'inbound'
          ? await this.determination.receivableAccount(partner, tx)
          : await this.determination.payableAccount(partner, tx);
      const journalCode = method === 'bank' ? 'BANK' : 'CASH';

      const year = new Date(dto.paymentDate).getUTCFullYear();
      const seq =
        direction === 'inbound'
          ? { key: `payment:${year}`, prefix: `PAY-${year}-` }
          : { key: `supplier-payment:${year}`, prefix: `PV-${year}-` };
      const paymentNumber = await this.sequence.next(seq.key, { prefix: seq.prefix, padding: 6 }, tx);

      const payment = await tx.payment.create({
        data: {
          organizationId,
          paymentNumber,
          direction,
          partnerId: dto.partnerId,
          paymentDate: new Date(dto.paymentDate),
          paymentMethod: method,
          accountId: cashAccount,
          amount,
          allocatedAmount: ZERO,
          unallocatedAmount: amount,
          reference: dto.reference ?? null,
          status: 'posted',
        },
      });

      const lines =
        direction === 'inbound'
          ? [
              { accountId: cashAccount, debit: amount.toString() },
              { accountId: counterAccount, credit: amount.toString(), partnerId: dto.partnerId },
            ]
          : [
              { accountId: counterAccount, debit: amount.toString(), partnerId: dto.partnerId },
              { accountId: cashAccount, credit: amount.toString() },
            ];

      const verb = direction === 'inbound' ? 'Receipt' : 'Payment';
      const entry = await this.posting.post(
        {
          journalCode,
          date: dto.paymentDate,
          description: `${verb} ${paymentNumber} · ${partner.name}`,
          sourceType: 'payment',
          sourceId: payment.id,
          lines,
        },
        tx,
      );
      await tx.payment.updateMany({ where: { id: payment.id }, data: { journalEntryId: entry.id } });

      let allocatedTotal = ZERO;
      for (const alloc of dto.allocations ?? []) {
        const allocAmount = round(dec(alloc.amount), 6);
        if (allocAmount.lessThanOrEqualTo(0)) continue;

        const doc = await tx.document.findFirst({ where: { id: alloc.documentId } });
        if (!doc) throw new BadRequestException(`Document ${alloc.documentId} not found`);

        await tx.paymentAllocation.create({
          data: { organizationId, paymentId: payment.id, documentId: doc.id, amount: allocAmount },
        });

        const newPaid = (doc.amountPaid as Prisma.Decimal).plus(allocAmount);
        const newResidual = (doc.amountResidual as Prisma.Decimal).minus(allocAmount);
        const paymentStatus = this.residualStatus(doc.totalAmount, newResidual);
        await tx.document.updateMany({
          where: { id: doc.id },
          data: {
            amountPaid: newPaid,
            amountResidual: newResidual,
            paymentStatus,
            status: newResidual.lessThanOrEqualTo(0) ? 'paid' : doc.status,
          },
        });

        allocatedTotal = allocatedTotal.plus(allocAmount);
        this.events.publish('payment.allocated', {
          organizationId,
          paymentId: payment.id,
          documentId: doc.id,
          amount: allocAmount.toString(),
        });
        if (direction === 'inbound' && newResidual.lessThanOrEqualTo(0)) {
          this.events.publish('invoice.paid', {
            organizationId,
            documentId: doc.id,
            documentNumber: doc.documentNumber,
          });
        }
      }

      if (allocatedTotal.greaterThan(amount)) {
        throw new BadRequestException('Allocated amount exceeds the payment amount');
      }

      await tx.payment.updateMany({
        where: { id: payment.id },
        data: { allocatedAmount: allocatedTotal, unallocatedAmount: amount.minus(allocatedTotal) },
      });

      // Cash-session link: when method=cash and a session is provided, write
      // a CashMovement row inside the same transaction so the session's
      // Z-report reconciles with the ledger.
      if (method === 'cash' && dto.cashSessionId) {
        const session = await tx.cashSession.findFirst({
          where: { id: dto.cashSessionId, organizationId },
        });
        if (!session) throw new BadRequestException('Cash session not found');
        if (session.status !== 'open') throw new BadRequestException('Cash session is not open');
        await this.cashSessions.recordSaleOrRefund(
          tx,
          dto.cashSessionId,
          payment.id,
          direction === 'inbound' ? 'sale' : 'refund',
          amount,
        );
      }

      await this.audit.recordInTx(tx, {
        entity: 'Payment',
        entityId: payment.id,
        action: 'create',
        newValues: {
          paymentNumber: payment.paymentNumber,
          direction,
          amount: amount.toString(),
          partnerId: payment.partnerId,
        },
      });

      this.events.publish('payment.received', {
        organizationId,
        paymentId: payment.id,
        amount: amount.toString(),
      });
      return tx.payment.findFirst({
        where: { id: payment.id },
        include: { partner: true, allocations: { include: { document: true } } },
      });
    });
  }

  /** Void a posted payment: reverse its journal entry and restore every residual. */
  async void(id: string) {
    const payment = await this.prisma.client.payment.findFirst({
      where: { id },
      include: { allocations: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'cancelled') return payment;

    await this.workflow.transition({
      entityType: 'payment',
      entityId: id,
      action: 'void',
      entity: payment,
    });

    this.events.publish('payment.voided', {
      organizationId: this.tenant.organizationId,
      paymentId: payment.id,
      amount: (payment.amount as Prisma.Decimal).toString(),
    });
    return this.prisma.client.payment.findFirst({ where: { id } });
  }

  private residualStatus(total: Prisma.Decimal, residual: Prisma.Decimal): PaymentStatus {
    if (residual.lessThanOrEqualTo(0)) return residual.lessThan(0) ? 'overpaid' : 'paid';
    if (residual.lessThan(total)) return 'partial';
    return 'not_paid';
  }
}
