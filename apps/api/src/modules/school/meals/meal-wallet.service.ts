/**
 * Meals V1.5 — cafeteria wallet with an immutable ledger.
 *
 * `MealAccount.balance` is a CACHED read; `MealAccountTransaction` is the source
 * of truth. Every mutation appends a ledger row and recomputes the cached
 * balance in the same transaction. Idempotent on `reference` (replay-safe).
 *
 * NOTE: this is stored-value bookkeeping only — no GL yet. V2 routes top-ups
 * through PaymentService (Dr Cash / Cr Stored-Value Liability) and recognises
 * revenue on consumption (Dr Liability / Cr Cafeteria Revenue).
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountResolverService } from '../../accounting/posting/account-resolver.service';
import { EVENTS } from '@erp/shared';
import type { WalletTopUpDto, WalletPurchaseDto, WalletAdjustDto } from './dto.types';
import { SCHOOL_ACCOUNTS } from '../fees/school-accounts';

@Injectable()
export class MealWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly posting: PostingService,
    private readonly accounts: AccountResolverService,
  ) {}

  /**
   * Stored-value GL (V2). A top-up is NOT revenue — Dr Cash / Cr Stored-Value
   * Liability; a consumption recognises revenue — Dr Liability / Cr Cafeteria
   * Revenue. Capability-gated: only posts when accounting is configured (the
   * required journal exists). Ledger-only orgs (dev / no COA) skip GL cleanly.
   * Returns the JournalEntry id, or null when skipped. Runs inside the caller tx.
   */
  private async postGl(
    tx: any,
    kind: 'topup' | 'consume',
    amount: Prisma.Decimal,
    ref: { mealAccountId: string; txnId: string; partnerId?: string | null },
  ): Promise<string | null> {
    const journalCode = kind === 'topup' ? 'CASH' : 'SALES';
    const journal = await tx.journal.findFirst({ where: { code: journalCode } });
    if (!journal) return null; // accounting not configured — ledger-only.

    const liabilityId = await this.accounts.ensureByCode(SCHOOL_ACCOUNTS.mealStoredValue.code, SCHOOL_ACCOUNTS.mealStoredValue,
      tx,
    );

    let lines: any[];
    if (kind === 'topup') {
      const cashId =
        (await this.accounts.byMappingOptional('default_cash', tx)) ??
        (await this.accounts.oneByCategory('cash'));
      if (!cashId) return null; // no cash account — ledger-only.
      lines = [
        { accountId: cashId, debit: amount.toString(), description: 'Cafeteria wallet top-up' },
        { accountId: liabilityId, credit: amount.toString(), description: 'Cafeteria stored value' },
      ];
    } else {
      const revenueId = await this.accounts.ensureByCode(SCHOOL_ACCOUNTS.mealRevenue.code, SCHOOL_ACCOUNTS.mealRevenue,
        tx,
      );
      lines = [
        { accountId: liabilityId, debit: amount.toString(), description: 'Cafeteria stored value drawdown' },
        { accountId: revenueId, credit: amount.toString(), description: 'Cafeteria revenue' },
      ];
    }

    const entry = await this.posting.post(
      {
        journalCode,
        date: new Date(),
        description: kind === 'topup' ? 'Cafeteria wallet top-up' : 'Cafeteria consumption',
        sourceType: kind === 'topup' ? 'meal_wallet_topup' : 'meal_wallet_consume',
        sourceId: ref.mealAccountId,
        postingKey: `meal_wallet:${ref.txnId}`,
        lines,
      },
      tx,
    );
    // Trace the ledger row back to its journal entry.
    await tx.mealAccountTransaction.updateMany({
      where: { id: ref.txnId },
      data: { sourceType: 'journal_entry', sourceId: entry.id },
    });
    return entry.id;
  }

  /** Replay guard: a prior transaction with the same reference returns as-is. */
  private async findByReference(tx: any, mealAccountId: string, reference?: string) {
    if (!reference) return null;
    return tx.mealAccountTransaction.findFirst({ where: { mealAccountId, reference } });
  }

  /** Deposit into (or create) a student's wallet. */
  async topUp(dto: WalletTopUpDto) {
    const organizationId = this.tenant.organizationId;
    const amount = new Prisma.Decimal(dto.amount);
    const kind = dto.type ?? 'top_up';

    const account = await this.prisma.client.$transaction(async (tx: any) => {
      const acc = await tx.mealAccount.upsert({
        where: { studentProfileId: dto.studentProfileId },
        create: { organizationId, studentProfileId: dto.studentProfileId, mealPlanId: dto.mealPlanId, balance: 0 },
        update: {},
      });

      const replay = await this.findByReference(tx, acc.id, dto.reference);
      if (replay) return { ...acc, _replayed: true };

      const balanceAfter = new Prisma.Decimal(acc.balance).plus(amount);
      await tx.mealAccount.updateMany({ where: { id: acc.id }, data: { balance: balanceAfter } });
      const ledgerTxn = await tx.mealAccountTransaction.create({
        data: {
          organizationId,
          mealAccountId: acc.id,
          type: kind,
          amount,
          balanceAfter,
          reference: dto.reference ?? null,
          paymentId: dto.paymentId ?? null,
          recordedById: this.tenant.userId ?? null,
        },
      });
      // Keep the legacy MealPurchase mirror for top-ups so existing reports stay
      // intact, and post the stored-value liability GL (Dr Cash / Cr Liability).
      if (kind === 'top_up') {
        await tx.mealPurchase.create({
          data: { organizationId, mealAccountId: acc.id, amount, description: 'Top-up', paymentId: dto.paymentId ?? null },
        });
        await this.postGl(tx, 'topup', amount, { mealAccountId: acc.id, txnId: ledgerTxn.id });
      }
      return { ...acc, balance: balanceAfter, _replayed: false };
    });

    if (!(account as any)._replayed) {
      this.events.publish(EVENTS.SchoolMealTopUp, {
        organizationId,
        mealAccountId: account.id,
        amount: amount.toString(),
      });
    }
    return account;
  }

  /** Debit a completed cafeteria sale/consumption from the wallet. */
  async purchase(dto: WalletPurchaseDto) {
    const organizationId = this.tenant.organizationId;
    const amount = new Prisma.Decimal(dto.amount);
    return this.prisma.client.$transaction(async (tx: any) => {
      const acc = await tx.mealAccount.findFirst({ where: { id: dto.mealAccountId } });
      if (!acc) throw new NotFoundException(`MealAccount ${dto.mealAccountId} not found`);

      const replay = await this.findByReference(tx, acc.id, dto.reference);
      if (replay) return replay;

      const balance = new Prisma.Decimal(acc.balance);
      if (balance.lessThan(amount)) throw new BadRequestException('Insufficient balance');
      const balanceAfter = balance.minus(amount);
      await tx.mealAccount.updateMany({ where: { id: acc.id }, data: { balance: balanceAfter } });
      await tx.mealPurchase.create({
        data: { organizationId, mealAccountId: acc.id, amount, description: dto.description, paymentId: dto.paymentId ?? null },
      });
      const ledgerTxn = await tx.mealAccountTransaction.create({
        data: {
          organizationId,
          mealAccountId: acc.id,
          type: 'purchase',
          amount: amount.negated(),
          balanceAfter,
          reference: dto.reference ?? null,
          paymentId: dto.paymentId ?? null,
          notes: dto.description,
          recordedById: this.tenant.userId ?? null,
        },
      });
      // Revenue recognition on consumption: Dr Stored-Value Liability / Cr Revenue.
      await this.postGl(tx, 'consume', amount, { mealAccountId: acc.id, txnId: ledgerTxn.id });
      return ledgerTxn;
    });
  }

  /** Signed adjustment (positive credits, negative debits) or a refund helper. */
  async adjust(dto: WalletAdjustDto, type: 'adjustment' | 'refund' = 'adjustment') {
    const organizationId = this.tenant.organizationId;
    const delta = new Prisma.Decimal(dto.amount);
    return this.prisma.client.$transaction(async (tx: any) => {
      const acc = await tx.mealAccount.findFirst({ where: { id: dto.mealAccountId } });
      if (!acc) throw new NotFoundException(`MealAccount ${dto.mealAccountId} not found`);

      const replay = await this.findByReference(tx, acc.id, dto.reference);
      if (replay) return replay;

      const balanceAfter = new Prisma.Decimal(acc.balance).plus(delta);
      if (balanceAfter.lessThan(0)) throw new BadRequestException('Adjustment would overdraw the wallet');
      await tx.mealAccount.updateMany({ where: { id: acc.id }, data: { balance: balanceAfter } });
      return tx.mealAccountTransaction.create({
        data: {
          organizationId,
          mealAccountId: acc.id,
          type,
          amount: delta,
          balanceAfter,
          reference: dto.reference ?? null,
          notes: dto.reason,
          recordedById: this.tenant.userId ?? null,
        },
      });
    });
  }

  history(mealAccountId: string) {
    return this.prisma.client.mealAccountTransaction.findMany({
      where: { mealAccountId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Student wallet summary: account + recent ledger (for the 360° profile). */
  async byStudent(studentProfileId: string) {
    const account = await this.prisma.client.mealAccount.findFirst({
      where: { studentProfileId },
      include: { mealPlan: true },
    });
    if (!account) return { exists: false, id: null, balance: 0, mealPlan: null, transactions: [] };
    const transactions = await this.prisma.client.mealAccountTransaction.findMany({
      where: { mealAccountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { exists: true, id: account.id, balance: account.balance, mealPlan: account.mealPlan, transactions };
  }

  /** Reconciliation: opening + Σ ledger = cached balance (must tie exactly). */
  async reconcile(mealAccountId: string) {
    const acc = await this.prisma.client.mealAccount.findFirst({ where: { id: mealAccountId } });
    if (!acc) throw new NotFoundException(`MealAccount ${mealAccountId} not found`);
    const txns = await this.prisma.client.mealAccountTransaction.findMany({ where: { mealAccountId } });

    const sum = { top_up: new Prisma.Decimal(0), purchase: new Prisma.Decimal(0), refund: new Prisma.Decimal(0), adjustment: new Prisma.Decimal(0), reversal: new Prisma.Decimal(0) };
    let ledgerBalance = new Prisma.Decimal(0);
    for (const t of txns) {
      ledgerBalance = ledgerBalance.plus(t.amount);
      (sum as any)[t.type] = (sum as any)[t.type].plus(t.amount);
    }
    const cached = new Prisma.Decimal(acc.balance);
    return {
      mealAccountId,
      cachedBalance: cached.toString(),
      ledgerBalance: ledgerBalance.toString(),
      reconciled: cached.equals(ledgerBalance),
      totals: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v.toString()])),
    };
  }
}
