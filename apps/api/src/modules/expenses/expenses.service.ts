import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../kernel/events/event-bus';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { ApprovalsService } from '../../kernel/approvals/approvals.service';
import { PostingService } from '../accounting/posting/posting.service';
import {
  ApproveExpenseDto,
  CreateExpenseDto,
  PayExpenseDto,
  UpdateExpenseDto,
  VoidExpenseDto,
} from './dto/expense.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ListQuery {
  page?: number | string;
  limit?: number | string;
  categoryId?: string;
  status?: string;
  paymentType?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  supplierId?: string;
}

const PaymentStatus = { UNPAID: 'UNPAID', PARTIALLY_PAID: 'PARTIALLY_PAID', PAID: 'PAID' } as const;

/** Map a payment method to the journal it should post through. */
function journalForMethod(method?: string): string {
  switch ((method ?? '').toUpperCase()) {
    case 'CASH':
      return 'CASH';
    case 'BANK_TRANSFER':
    case 'MTN_MOBILE_MONEY':
    case 'AIRTEL_MONEY':
    case 'CHEQUE':
      return 'BANK';
    default:
      return 'GEN';
  }
}

/**
 * Standalone expenses (petty-cash / operating). Lifecycle:
 *   create(CREDIT) → APPROVED/UNPAID   create(CASH) → POSTED/PAID (+GL)
 *   approve  DRAFT → APPROVED          reject DRAFT → REJECTED
 *   pay      → records ExpensePayment, posts Dr expense / Cr cash-bank, sets
 *             PARTIALLY_PAID|PAID and POSTED
 *   void     → reverses every posted payment JE, marks VOID
 *
 * GL posting is best-effort: if no postable expense/cash account can be
 * resolved (un-configured COA), the payment is still recorded with a null
 * journalEntryId so the feature works on a fresh install.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
    private readonly posting: PostingService,
  ) {}

  // ─── Reads ────────────────────────────────────────────────────────────────

  async list(query: ListQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 15));
    const where: any = {};
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.status) where.status = query.status;
    if (query.paymentType) where.paymentType = query.paymentType;
    if (query.dateFrom || query.dateTo) {
      where.expenseDate = {};
      if (query.dateFrom) where.expenseDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.expenseDate.lte = new Date(`${query.dateTo}T23:59:59.999Z`);
    }
    if (query.search) {
      const s = query.search;
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { expenseCode: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { categoryName: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.expense.findMany({
        where,
        include: { category: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.client.expense.count({ where }),
    ]);

    const data = await this.decorate(rows);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const exp = await this.prisma.client.expense.findFirst({
      where: { id },
      include: { category: true, payments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!exp) throw new NotFoundException('Expense not found');
    return (await this.decorate([exp]))[0];
  }

  async stats(dateFrom?: string, dateTo?: string) {
    const where: any = { status: { notIn: ['VOID', 'CANCELLED', 'REJECTED'] } };
    if (dateFrom || dateTo) {
      where.expenseDate = {};
      if (dateFrom) where.expenseDate.gte = new Date(dateFrom);
      if (dateTo) where.expenseDate.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }

    const rows = await this.prisma.client.expense.findMany({ where });
    const num = (d: any) => Number(d ?? 0);

    let grandTotal = 0;
    let totalUnpaid = 0;
    let totalUnpaidCount = 0;
    let totalPartiallyPaid = 0;
    let totalPartiallyPaidCount = 0;
    let totalPaid = 0;
    let totalPaidCount = 0;
    let outstandingAmount = 0;
    let outstandingCount = 0;
    const byCat = new Map<string, { amount: number; count: number }>();
    const bySup = new Map<string, { amount: number; count: number }>();

    for (const e of rows) {
      const amount = num(e.amount);
      const paid = num(e.amountPaid);
      grandTotal += amount;
      if (e.paymentStatus === PaymentStatus.UNPAID) {
        totalUnpaid += amount;
        totalUnpaidCount += 1;
      } else if (e.paymentStatus === PaymentStatus.PARTIALLY_PAID) {
        totalPartiallyPaid += amount;
        totalPartiallyPaidCount += 1;
      } else if (e.paymentStatus === PaymentStatus.PAID) {
        totalPaidCount += 1;
      }
      totalPaid += paid;
      if (e.paymentStatus !== PaymentStatus.PAID) {
        outstandingAmount += amount - paid;
        outstandingCount += 1;
      }
      const catKey = e.categoryName ?? '—';
      const c = byCat.get(catKey) ?? { amount: 0, count: 0 };
      c.amount += amount;
      c.count += 1;
      byCat.set(catKey, c);
      if (e.supplierId) {
        const sKey = e.supplierId;
        const s = bySup.get(sKey) ?? { amount: 0, count: 0 };
        s.amount += amount;
        s.count += 1;
        bySup.set(sKey, s);
      }
    }

    // Resolve supplier names for the bySupplier breakdown.
    const supplierIds = [...bySup.keys()];
    const suppliers = supplierIds.length
      ? await this.prisma.client.partner.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, name: true },
        })
      : [];
    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

    return {
      count: rows.length,
      grandTotal,
      totalUnpaid,
      totalUnpaidCount,
      totalPartiallyPaid,
      totalPartiallyPaidCount,
      totalPaid,
      totalPaidCount,
      byCategory: [...byCat.entries()].map(([category, v]) => ({
        category,
        _sum: { amount: v.amount },
        _count: { id: v.count },
      })),
      bySupplier: [...bySup.entries()].map(([id, v]) => ({
        supplierName: supplierName.get(id) ?? 'Unspecified',
        _sum: { amount: v.amount },
        _count: { id: v.count },
      })),
      outstandingPayables: { amount: outstandingAmount, count: outstandingCount },
    };
  }

  async getAudit(id: string) {
    const rows = await this.prisma.client.auditLog.findMany({
      where: { entity: { in: ['Expense', 'ExpensePayment'] }, entityId: id },
      orderBy: { createdAt: 'desc' },
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
    const users = actorIds.length
      ? await this.prisma.client.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const nameById = new Map(
      users.map((u) => [u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email]),
    );
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entity,
      userId: r.actorId,
      userName: r.actorId ? (nameById.get(r.actorId) ?? null) : null,
      reason: (r.newValues as any)?.reason ?? null,
      createdAt: r.createdAt,
    }));
  }

  // ─── Lookups for the form ───────────────────────────────────────────────────

  /** Postable cash / bank / other-asset accounts with a GL-derived balance. */
  async paymentAccounts() {
    const accounts = await this.prisma.client.account.findMany({
      where: {
        category: { isCashEquivalent: true },
        isPostable: true,
        isActive: true,
        deprecatedAt: null,
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: { id: true, name: true, currencyId: true },
    });
    const org = await this.prisma.client.organization
      .findUnique({ where: { id: this.tenant.organizationId } })
      .catch(() => null);
    const baseCurrency = (org as any)?.currencyCode ?? 'UGX';

    const ids = accounts.map((a) => a.id);
    const balances = ids.length
      ? await this.prisma.client.journalLine.groupBy({
          by: ['accountId'],
          where: { accountId: { in: ids } },
          _sum: { baseDebit: true, baseCredit: true },
        })
      : [];
    const balByAccount = new Map(
      balances.map((b) => [b.accountId, Number(b._sum.baseDebit ?? 0) - Number(b._sum.baseCredit ?? 0)]),
    );
    return accounts.map((a) => ({
      id: a.id,
      name: a.name,
      currency: baseCurrency,
      currentBalance: balByAccount.get(a.id) ?? 0,
    }));
  }

  /** Suppliers = partners flagged isSupplier, shaped for the expense form. */
  async suppliers() {
    const rows = await this.prisma.client.partner.findMany({
      where: { isSupplier: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone ?? undefined, contactPerson: undefined }));
  }

  // ─── Writes ─────────────────────────────────────────────────────────────────

  async create(dto: CreateExpenseDto) {
    if (!dto.createdBy) throw new BadRequestException('createdBy is required');
    const isCash = dto.paymentType === 'CASH';
    if (isCash && (!dto.paymentMethod || !dto.accountId)) {
      throw new BadRequestException('Cash expenses require paymentMethod and accountId');
    }

    const category = dto.categoryId
      ? await this.prisma.client.expenseCategory.findFirst({ where: { id: dto.categoryId } })
      : null;
    if (dto.categoryId && !category) throw new BadRequestException('Category not found');

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const year = new Date(dto.expenseDate).getUTCFullYear();
      const expenseCode = await this.sequence.next(
        `expense:${year}`,
        { prefix: 'EXP-', padding: 5 },
        tx,
      );

      const expense = await tx.expense.create({
        data: {
          expenseCode,
          title: dto.title.trim(),
          description: dto.description ?? null,
          amount: dto.amount,
          // Cash expenses post immediately. Credit expenses start DRAFT and are
          // routed through the approval engine below (no workflow ⇒ APPROVED).
          status: isCash ? 'POSTED' : 'DRAFT',
          paymentStatus: PaymentStatus.UNPAID,
          paymentType: dto.paymentType,
          expenseDate: new Date(dto.expenseDate),
          notes: dto.notes ?? null,
          categoryId: category?.id ?? null,
          categoryName: category?.name ?? null,
          supplierId: dto.supplierId || null,
          createdById: dto.createdBy ?? null,
          // A cash expense is created already approved by its raiser.
          approvedById: isCash ? (dto.createdBy ?? null) : null,
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'Expense',
        entityId: expense.id,
        action: 'create',
        newValues: { expenseCode, title: expense.title, amount: dto.amount, paymentType: dto.paymentType },
      });

      if (isCash) {
        await this.recordPayment(
          tx,
          expense,
          {
            paidBy: dto.createdBy!,
            paymentMethod: dto.paymentMethod!,
            accountId: dto.accountId!,
            reference: dto.paymentReference,
          },
          category,
        );
      }

      this.events.publish('expense.created' as any, {
        organizationId: this.tenant.organizationId,
        expenseId: expense.id,
        expenseCode,
      } as any);
      return expense;
    });

    // Credit expenses route through the approval engine. No configured workflow
    // ⇒ checkOrRequestApproval returns null and the expense is auto-approved
    // (legacy behavior). A matching workflow creates a pending ApprovalRequest and
    // the expense stays DRAFT until every applicable step is cleared.
    if (!isCash) {
      const gate = await this.approvals.checkOrRequestApproval({
        entityType: 'expense',
        entityId: created.id,
        snapshot: { amount: Number(dto.amount), categoryId: created.categoryId, title: created.title },
      });
      if (!gate?.needsApproval) {
        await this.prisma.client.expense.updateMany({
          where: { id: created.id },
          data: { status: 'APPROVED', approvedById: created.createdById ?? dto.createdBy ?? null },
        });
      }
    }

    return this.loadDecorated(this.prisma.client, created.id);
  }

  async update(id: string, dto: UpdateExpenseDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const exp = await tx.expense.findFirst({ where: { id, deletedAt: null } });
      if (!exp) throw new NotFoundException('Expense not found');
      if (!['DRAFT', 'APPROVED'].includes(exp.status) || exp.paymentStatus !== PaymentStatus.UNPAID) {
        throw new BadRequestException('Only unpaid draft/approved expenses can be edited');
      }
      const data: any = {};
      if (dto.title !== undefined) data.title = dto.title.trim();
      if (dto.description !== undefined) data.description = dto.description || null;
      if (dto.amount !== undefined) data.amount = dto.amount;
      if (dto.expenseDate !== undefined) data.expenseDate = new Date(dto.expenseDate);
      if (dto.notes !== undefined) data.notes = dto.notes || null;
      if (dto.supplierId !== undefined) data.supplierId = dto.supplierId || null;
      if (dto.paymentType !== undefined) data.paymentType = dto.paymentType;
      if (dto.categoryId !== undefined) {
        const cat = dto.categoryId
          ? await tx.expenseCategory.findFirst({ where: { id: dto.categoryId } })
          : null;
        if (dto.categoryId && !cat) throw new BadRequestException('Category not found');
        data.categoryId = cat?.id ?? null;
        data.categoryName = cat?.name ?? null;
      }
      await tx.expense.updateMany({ where: { id }, data });
      await this.audit.recordInTx(tx, { entity: 'Expense', entityId: id, action: 'update', newValues: data });
      return this.loadDecorated(tx, id);
    });
  }

  async approve(id: string, dto: ApproveExpenseDto) {
    const exp = await this.prisma.client.expense.findFirst({ where: { id, deletedAt: null } });
    if (!exp) throw new NotFoundException('Expense not found');
    if (exp.status !== 'DRAFT') throw new BadRequestException('Only draft expenses can be approved');

    // When the approval engine created a pending request, decide it there — this
    // honors multi-step chains, per-step permissions and SoD. The expense flips to
    // APPROVED only once the whole request resolves (a mid-chain step leaves it DRAFT).
    const pending = await this.prisma.client.approvalRequest.findFirst({
      where: { entityType: 'expense', entityId: id, status: 'pending' },
    });
    if (pending) {
      await this.approvals.decide({ requestId: pending.id, status: 'approved', comment: dto.approvalNotes });
      const after = await this.prisma.client.approvalRequest.findFirst({ where: { id: pending.id } });
      if (after?.status === 'approved') {
        await this.prisma.client.expense.updateMany({
          where: { id },
          data: {
            status: 'APPROVED',
            approvedById: this.tenant.userId ?? dto.approvedBy,
            approvalNotes: dto.approvalNotes ?? null,
          },
        });
      }
      return this.loadDecorated(this.prisma.client, id);
    }

    // Legacy path: no configured workflow / no pending request → inline approve.
    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.expense.updateMany({
        where: { id },
        data: { status: 'APPROVED', approvedById: dto.approvedBy, approvalNotes: dto.approvalNotes ?? null },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Expense',
        entityId: id,
        action: 'approve',
        newValues: { approvedBy: dto.approvedBy, reason: dto.approvalNotes },
      });
      return this.loadDecorated(tx, id);
    });
  }

  async reject(id: string, reason?: string) {
    const exp = await this.prisma.client.expense.findFirst({ where: { id, deletedAt: null } });
    if (!exp) throw new NotFoundException('Expense not found');
    if (exp.status !== 'DRAFT') throw new BadRequestException('Only draft expenses can be rejected');

    const pending = await this.prisma.client.approvalRequest.findFirst({
      where: { entityType: 'expense', entityId: id, status: 'pending' },
    });
    if (pending) {
      // Any rejection resolves the whole request as rejected.
      await this.approvals.decide({ requestId: pending.id, status: 'rejected', comment: reason });
      await this.prisma.client.expense.updateMany({
        where: { id },
        data: { status: 'REJECTED', approvalNotes: reason ?? null },
      });
      return this.loadDecorated(this.prisma.client, id);
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      await tx.expense.updateMany({
        where: { id },
        data: { status: 'REJECTED', approvalNotes: reason ?? null },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Expense',
        entityId: id,
        action: 'reject',
        newValues: { reason },
      });
      return this.loadDecorated(tx, id);
    });
  }

  async pay(id: string, dto: PayExpenseDto) {
    // Block payment until the approval engine clears the expense (no workflow ⇒
    // proceeds; a pending multi-step chain blocks the payout).
    const exp0 = await this.prisma.client.expense.findFirst({
      where: { id, deletedAt: null },
      select: { amount: true },
    });
    if (!exp0) throw new NotFoundException('Expense not found');
    const gate = await this.approvals.checkOrRequestApproval({
      entityType: 'expense',
      entityId: id,
      snapshot: { amount: Number(exp0.amount) },
    });
    if (gate?.needsApproval) {
      throw new BadRequestException(
        `Approval required before paying this expense. Pending approval request ${gate.requestId}.`,
      );
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      const exp = await tx.expense.findFirst({ where: { id, deletedAt: null } });
      if (!exp) throw new NotFoundException('Expense not found');
      if (!['APPROVED', 'POSTED', 'DRAFT'].includes(exp.status)) {
        throw new BadRequestException(`Cannot pay an expense in status ${exp.status}`);
      }
      if (exp.paymentStatus === PaymentStatus.PAID) {
        throw new BadRequestException('Expense is already fully paid');
      }
      const category = exp.categoryId
        ? await tx.expenseCategory.findFirst({ where: { id: exp.categoryId } })
        : null;
      await this.recordPayment(
        tx,
        exp,
        {
          paidBy: dto.paidBy,
          paymentMethod: dto.paymentMethod,
          accountId: dto.accountId,
          reference: dto.reference,
          paymentNotes: dto.paymentNotes,
        },
        category,
      );
      this.events.publish('expense.paid' as any, {
        organizationId: this.tenant.organizationId,
        expenseId: id,
      } as any);
      return this.loadDecorated(tx, id);
    });
  }

  async void(id: string, dto: VoidExpenseDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const exp = await tx.expense.findFirst({ where: { id, deletedAt: null } });
      if (!exp) throw new NotFoundException('Expense not found');
      if (['VOID', 'CANCELLED'].includes(exp.status)) {
        throw new BadRequestException('Expense is already void/cancelled');
      }
      const payments = await tx.expensePayment.findMany({ where: { expenseId: id, status: 'posted' } });
      for (const p of payments) {
        if (p.journalEntryId) {
          await this.posting.reverse(
            p.journalEntryId,
            { description: `Void expense ${exp.expenseCode}: ${dto.voidReason}` },
            tx,
          );
        }
        await tx.expensePayment.updateMany({
          where: { id: p.id },
          data: { status: 'void', voidReason: dto.voidReason },
        });
      }
      await tx.expense.updateMany({
        where: { id },
        data: { status: 'VOID', paymentStatus: PaymentStatus.UNPAID, amountPaid: 0, paidAt: null },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Expense',
        entityId: id,
        action: 'cancel',
        newValues: { reason: dto.voidReason, reversedPayments: payments.length },
      });
      this.events.publish('expense.voided' as any, {
        organizationId: this.tenant.organizationId,
        expenseId: id,
      } as any);
      return this.loadDecorated(tx, id);
    });
  }

  async remove(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const exp = await tx.expense.findFirst({ where: { id, deletedAt: null } });
      if (!exp) throw new NotFoundException('Expense not found');
      if (exp.paymentStatus !== PaymentStatus.UNPAID && exp.status !== 'VOID') {
        throw new BadRequestException('Only unpaid or voided expenses can be deleted');
      }
      await tx.expense.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.recordInTx(tx, { entity: 'Expense', entityId: id, action: 'delete' });
      return { id, deleted: true };
    });
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /**
   * Record a payment that fully settles the residual, post Dr expense / Cr
   * cash-bank (best-effort), and roll the expense's payment state forward.
   */
  private async recordPayment(
    tx: any,
    expense: any,
    input: { paidBy: string; paymentMethod: string; accountId: string; reference?: string; paymentNotes?: string },
    category: any | null,
  ) {
    const residual = Number(expense.amount) - Number(expense.amountPaid ?? 0);
    if (residual <= 0) throw new BadRequestException('Nothing left to pay');

    const debitAccountId = await this.resolveExpenseAccountId(tx, category);
    const creditAccount = await tx.account.findFirst({
      where: { id: input.accountId, isPostable: true, isActive: true },
    });

    let journalEntryId: string | null = null;
    if (debitAccountId && creditAccount) {
      const entry = await this.posting.post(
        {
          journalCode: journalForMethod(input.paymentMethod),
          date: new Date(),
          description: `Expense ${expense.expenseCode} — ${expense.title}`,
          sourceType: 'expense_payment',
          sourceId: expense.id,
          lines: [
            { accountId: debitAccountId, debit: residual, description: expense.title },
            { accountId: creditAccount.id, credit: residual, description: `Paid: ${expense.title}` },
          ],
        },
        tx,
      );
      journalEntryId = entry.id;
    }

    const payment = await tx.expensePayment.create({
      data: {
        expenseId: expense.id,
        amount: residual,
        paymentMethod: input.paymentMethod,
        reference: input.reference ?? null,
        paymentNotes: input.paymentNotes ?? null,
        accountId: input.accountId,
        paidById: input.paidBy,
        journalEntryId,
        status: 'posted',
      },
    });

    const newPaid = Number(expense.amountPaid ?? 0) + residual;
    await tx.expense.updateMany({
      where: { id: expense.id },
      data: {
        amountPaid: newPaid,
        paymentStatus: newPaid >= Number(expense.amount) ? PaymentStatus.PAID : PaymentStatus.PARTIALLY_PAID,
        paidAt: new Date(),
        status: expense.status === 'APPROVED' || expense.status === 'DRAFT' ? 'POSTED' : expense.status,
      },
    });

    await this.audit.recordInTx(tx, {
      entity: 'ExpensePayment',
      entityId: expense.id,
      action: 'post',
      newValues: {
        paymentId: payment.id,
        amount: residual,
        method: input.paymentMethod,
        reason: input.paymentNotes,
        glPosted: Boolean(journalEntryId),
      },
    });
    return payment;
  }

  /** category.ledgerAccountId, else the first postable expense account, else null. */
  private async resolveExpenseAccountId(tx: any, category: any | null): Promise<string | null> {
    if (category?.ledgerAccountId) {
      const acc = await tx.account.findFirst({
        where: { id: category.ledgerAccountId, isPostable: true, isActive: true },
      });
      if (acc) return acc.id;
    }
    // Fall back to the org's configured default expense account rather than
    // "whichever expense account sorts first by code".
    const mapping = await tx.accountMapping.findFirst({ where: { key: 'default_expense' } });
    if (mapping) return mapping.accountId;
    const fallback = await tx.account.findFirst({
      where: {
        category: { classification: 'expense' },
        isPostable: true,
        isActive: true,
        deprecatedAt: null,
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return fallback?.id ?? null;
  }

  private async loadDecorated(tx: any, id: string) {
    const exp = await tx.expense.findFirst({
      where: { id },
      include: { category: true, payments: { orderBy: { createdAt: 'desc' } } },
    });
    return (await this.decorate([exp]))[0];
  }

  /**
   * Shape rows for the frontend: nested supplier / createdBy / approvedBy
   * objects + latest payment method/reference, matching the legacy expense API.
   */
  private async decorate(rows: any[]): Promise<any[]> {
    const supplierIds = [...new Set(rows.map((r) => r.supplierId).filter(Boolean))] as string[];
    const userIds = [
      ...new Set(rows.flatMap((r) => [r.createdById, r.approvedById]).filter(Boolean)),
    ] as string[];

    const [suppliers, users] = await Promise.all([
      supplierIds.length
        ? this.prisma.client.partner.findMany({
            where: { id: { in: supplierIds } },
            select: { id: true, name: true, phone: true },
          })
        : Promise.resolve([]),
      userIds.length
        ? this.prisma.client.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : Promise.resolve([]),
    ]);
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));
    const userById = new Map(users.map((u) => [u.id, u]));
    const asStaff = (uid?: string | null) => {
      if (!uid) return null;
      const u = userById.get(uid);
      if (!u) return null;
      return { staff: { firstName: u.firstName ?? '', lastName: u.lastName ?? '' } };
    };

    return rows.map((r) => {
      const supplier = r.supplierId ? supplierById.get(r.supplierId) : null;
      const latest = (r.payments ?? [])[0];
      return {
        ...r,
        amount: Number(r.amount),
        amountPaid: Number(r.amountPaid ?? 0),
        category: r.category ? { id: r.category.id, name: r.category.name, icon: r.category.icon } : null,
        supplier: supplier
          ? { id: supplier.id, name: supplier.name, phone: supplier.phone ?? undefined, contactPerson: undefined }
          : null,
        createdBy: asStaff(r.createdById),
        approvedBy: asStaff(r.approvedById),
        paymentMethod: latest?.paymentMethod ?? null,
        paymentReference: latest?.reference ?? null,
      };
    });
  }
}
