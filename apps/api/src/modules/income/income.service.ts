import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../kernel/events/event-bus';
import { SequenceService } from '../../kernel/sequence/sequence.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { PostingService } from '../accounting/posting/posting.service';
import { AccountDeterminationService } from '../accounting/posting/account-determination.service';
import { CreateIncomeDto, UpdateIncomeDto, CancelIncomeDto } from './dto/income.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ListQuery {
  page?: number | string;
  limit?: number | string;
  incomeHeadId?: string;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

const CANCELLED = 'CANCELLED';

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
 * Other Revenue / Income receipts (fine, donation, grant, interest, canteen…).
 * Lifecycle:
 *   create → RECEIVED (cash in hand) and posts Dr cash/bank / Cr revenue (best-effort)
 *   update → allowed while not CANCELLED
 *   cancel → reverses the GL entry (if posted) and sets CANCELLED
 *   remove → soft-delete (blocked if already posted/cancelled)
 *
 * GL posting is best-effort: if no postable cash/revenue account can be resolved
 * (un-configured COA), the receipt is still recorded with a null journalEntryId
 * so the feature works on a fresh install.
 */
@Injectable()
export class IncomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly determination: AccountDeterminationService,
  ) {}

  // ─── Reads ────────────────────────────────────────────────────────────────

  async list(query: ListQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 15));
    const where: any = { deletedAt: null };
    if (query.incomeHeadId) where.incomeHeadId = query.incomeHeadId;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.dateFrom || query.dateTo) {
      where.incomeDate = {};
      if (query.dateFrom) where.incomeDate.gte = new Date(query.dateFrom);
      if (query.dateTo) where.incomeDate.lte = new Date(`${query.dateTo}T23:59:59.999Z`);
    }
    if (query.search) {
      const s = query.search;
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { incomeCode: { contains: s, mode: 'insensitive' } },
        { invoiceNumber: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { incomeHeadName: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.income.findMany({
        where,
        include: { incomeHead: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.client.income.count({ where }),
    ]);

    const data = await this.decorate(rows);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const inc = await this.prisma.client.income.findFirst({
      where: { id, deletedAt: null },
      include: { incomeHead: true },
    });
    if (!inc) throw new NotFoundException('Income not found');
    return (await this.decorate([inc]))[0];
  }

  async stats(dateFrom?: string, dateTo?: string) {
    const where: any = { deletedAt: null, status: { not: CANCELLED } };
    if (dateFrom || dateTo) {
      where.incomeDate = {};
      if (dateFrom) where.incomeDate.gte = new Date(dateFrom);
      if (dateTo) where.incomeDate.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }

    const rows = await this.prisma.client.income.findMany({ where });
    const num = (d: any) => Number(d ?? 0);
    let grandTotal = 0;
    let cashTotal = 0;
    let bankTotal = 0;
    const byHead = new Map<string, { amount: number; count: number }>();

    for (const e of rows) {
      const amount = num(e.amount);
      grandTotal += amount;
      if (e.paymentMethod === 'CASH') cashTotal += amount;
      else bankTotal += amount;
      const key = e.incomeHeadName ?? '—';
      const c = byHead.get(key) ?? { amount: 0, count: 0 };
      c.amount += amount;
      c.count += 1;
      byHead.set(key, c);
    }

    return {
      count: rows.length,
      grandTotal,
      cashTotal,
      bankTotal,
      byHead: [...byHead.entries()].map(([head, v]) => ({
        head,
        _sum: { amount: v.amount },
        _count: { id: v.count },
      })),
    };
  }

  async getAudit(id: string) {
    const rows = await this.prisma.client.auditLog.findMany({
      where: { entity: { in: ['Income'] }, entityId: id },
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
  async receiptAccounts() {
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

    const ids = accounts.map((a: any) => a.id);
    const balances = ids.length
      ? await this.prisma.client.journalLine.groupBy({
          by: ['accountId'],
          where: { accountId: { in: ids } },
          _sum: { baseDebit: true, baseCredit: true },
        })
      : [];
    const balByAccount = new Map(
      balances.map((b: any) => [b.accountId, Number(b._sum.baseDebit ?? 0) - Number(b._sum.baseCredit ?? 0)]),
    );
    return accounts.map((a: any) => ({
      id: a.id,
      name: a.name,
      currency: baseCurrency,
      currentBalance: balByAccount.get(a.id) ?? 0,
    }));
  }

  // ─── Writes ─────────────────────────────────────────────────────────────────

  async create(dto: CreateIncomeDto) {
    if (!dto.receivedById) throw new BadRequestException('receivedById is required');

    const head = dto.incomeHeadId
      ? await this.prisma.client.incomeHead.findFirst({ where: { id: dto.incomeHeadId, deletedAt: null } })
      : null;
    if (dto.incomeHeadId && !head) throw new BadRequestException('Income head not found');

    const created = await this.prisma.client.$transaction(async (tx: any) => {
      const year = new Date(dto.incomeDate).getUTCFullYear();
      const incomeCode = await this.sequence.next(
        `income:${year}`,
        { prefix: 'INC-', padding: 5 },
        tx,
      );

      const income = await tx.income.create({
        data: {
          incomeCode,
          name: dto.name.trim(),
          description: dto.description ?? null,
          invoiceNumber: dto.invoiceNumber ?? null,
          amount: dto.amount,
          incomeDate: new Date(dto.incomeDate),
          incomeHeadId: head?.id ?? null,
          incomeHeadName: head?.name ?? null,
          paymentMethod: dto.paymentMethod,
          accountId: dto.accountId ?? null,
          attachmentId: dto.attachmentId ?? null,
          status: 'RECEIVED',
          receivedById: dto.receivedById ?? null,
        },
      });

      await this.audit.recordInTx(tx, {
        entity: 'Income',
        entityId: income.id,
        action: 'create',
        newValues: { incomeCode, name: income.name, amount: dto.amount, paymentMethod: dto.paymentMethod },
      });

      await this.postReceipt(tx, income, head);

      this.events.publish('income.created' as any, {
        organizationId: this.tenant.organizationId,
        incomeId: income.id,
        incomeCode,
      } as any);
      return income;
    });

    return this.loadDecorated(this.prisma.client, created.id);
  }

  async update(id: string, dto: UpdateIncomeDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const inc = await tx.income.findFirst({ where: { id, deletedAt: null } });
      if (!inc) throw new NotFoundException('Income not found');
      if (inc.status === CANCELLED) {
        throw new BadRequestException('Cancelled income cannot be edited');
      }
      // Editing a posted receipt is not allowed (would orphan the GL entry); only
      // drafts/unposted receipts are mutable. Our receipts are RECEIVED+posted on
      // create, so in practice this blocks edits — matching audit-grade money rules.
      if (inc.journalEntryId) {
        throw new BadRequestException('Posted income cannot be edited — cancel and re-enter instead');
      }

      const data: any = {};
      if (dto.name !== undefined) data.name = dto.name.trim();
      if (dto.description !== undefined) data.description = dto.description || null;
      if (dto.invoiceNumber !== undefined) data.invoiceNumber = dto.invoiceNumber || null;
      if (dto.amount !== undefined) data.amount = dto.amount;
      if (dto.incomeDate !== undefined) data.incomeDate = new Date(dto.incomeDate);
      if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;
      if (dto.accountId !== undefined) data.accountId = dto.accountId || null;
      if (dto.attachmentId !== undefined) data.attachmentId = dto.attachmentId || null;
      if (dto.incomeHeadId !== undefined) {
        const head = dto.incomeHeadId
          ? await tx.incomeHead.findFirst({ where: { id: dto.incomeHeadId, deletedAt: null } })
          : null;
        if (dto.incomeHeadId && !head) throw new BadRequestException('Income head not found');
        data.incomeHeadId = head?.id ?? null;
        data.incomeHeadName = head?.name ?? null;
      }
      await tx.income.updateMany({ where: { id }, data });
      await this.audit.recordInTx(tx, { entity: 'Income', entityId: id, action: 'update', newValues: data });
      return this.loadDecorated(tx, id);
    });
  }

  async cancel(id: string, dto: CancelIncomeDto) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const inc = await tx.income.findFirst({ where: { id, deletedAt: null } });
      if (!inc) throw new NotFoundException('Income not found');
      if (inc.status === CANCELLED) throw new BadRequestException('Income is already cancelled');

      if (inc.journalEntryId) {
        await this.posting.reverse(
          inc.journalEntryId,
          { description: `Cancel income ${inc.incomeCode}: ${dto.cancelReason}` },
          tx,
        );
      }
      await tx.income.updateMany({
        where: { id },
        data: { status: CANCELLED, journalEntryId: null },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Income',
        entityId: id,
        action: 'cancel',
        newValues: { reason: dto.cancelReason, reversed: Boolean(inc.journalEntryId) },
      });
      this.events.publish('income.cancelled' as any, {
        organizationId: this.tenant.organizationId,
        incomeId: id,
      } as any);
      return this.loadDecorated(tx, id);
    });
  }

  async remove(id: string) {
    return this.prisma.client.$transaction(async (tx: any) => {
      const inc = await tx.income.findFirst({ where: { id, deletedAt: null } });
      if (!inc) throw new NotFoundException('Income not found');
      if (inc.journalEntryId) {
        throw new BadRequestException('Posted income cannot be deleted — cancel it first');
      }
      await tx.income.updateMany({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.recordInTx(tx, { entity: 'Income', entityId: id, action: 'delete' });
      return { id, deleted: true };
    });
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /**
   * Post Dr cash/bank (the receipt account) / Cr revenue (head GL account, else
   * the `other_revenue` mapping). Best-effort: null journalEntryId if no
   * postable accounts resolve.
   */
  private async postReceipt(tx: any, income: any, head: any | null): Promise<void> {
    const creditAccountId = head?.ledgerAccountId
      ? await this.resolveRevenueAccount(tx, head.ledgerAccountId)
      : await this.resolveRevenueAccount(tx, null);

    const debitAccount = income.accountId
      ? await tx.account.findFirst({ where: { id: income.accountId, isPostable: true, isActive: true } })
      : null;
    const debitAccountId = debitAccount?.id ?? null;

    if (!creditAccountId || !debitAccountId) return; // best-effort GL

    const entry = await this.posting.post(
      {
        journalCode: journalForMethod(income.paymentMethod),
        date: income.incomeDate,
        description: `Income ${income.incomeCode} — ${income.name}`,
        sourceType: 'income',
        sourceId: income.id,
        lines: [
          { accountId: debitAccountId, debit: Number(income.amount), description: income.name },
          { accountId: creditAccountId, credit: Number(income.amount), description: `Received: ${income.name}` },
        ],
      },
      tx,
    );
    await tx.income.updateMany({ where: { id: income.id }, data: { journalEntryId: entry.id, status: 'RECEIVED' } });
  }

  /** head GL account (validated) else the `other_revenue` account mapping. */
  private async resolveRevenueAccount(tx: any, headLedgerId?: string | null): Promise<string | null> {
    if (headLedgerId) {
      const acc = await tx.account.findFirst({
        where: { id: headLedgerId, isPostable: true, isActive: true },
      });
      if (acc) return acc.id;
    }
    const mapping = await tx.accountMapping.findFirst({ where: { key: 'other_revenue' } });
    if (mapping?.accountId) {
      const acc = await tx.account.findFirst({
        where: { id: mapping.accountId, isPostable: true, isActive: true },
      });
      if (acc) return acc.id;
    }
    return null;
  }

  private async loadDecorated(tx: any, id: string) {
    const inc = await tx.income.findFirst({
      where: { id },
      include: { incomeHead: true },
    });
    return (await this.decorate([inc]))[0];
  }

  /** Shape rows for the frontend: nested incomeHead + receivedBy staff. */
  private async decorate(rows: any[]): Promise<any[]> {
    const userIds = [...new Set(rows.map((r) => r.receivedById).filter(Boolean))] as string[];
    const users = userIds.length
      ? await this.prisma.client.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const userById = new Map(users.map((u: any) => [u.id, u]));
    const asStaff = (uid?: string | null) => {
      if (!uid) return null;
      const u = userById.get(uid);
      if (!u) return null;
      return { staff: { firstName: u.firstName ?? '', lastName: u.lastName ?? '' } };
    };

    return rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      incomeHead: r.incomeHead
        ? { id: r.incomeHead.id, name: r.incomeHead.name, icon: r.incomeHead.icon }
        : null,
      receivedBy: asStaff(r.receivedById),
    }));
  }
}
