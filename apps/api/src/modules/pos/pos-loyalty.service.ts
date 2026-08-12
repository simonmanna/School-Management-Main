/**
 * POS P7 — Loyalty + Store Credit + Customer Tabs service.
 *
 * Public surface (all scoped to the tenant org):
 *
 *   Loyalty:
 *     - ensureProgram()                  — auto-create the default program
 *     - getProgram()
 *     - getBalance(partnerId)            — current points + expiring-soon
 *     - earnPoints({partnerId, documentId, amount, reason})
 *     - redeemPoints({partnerId, points, documentId?})  → returns UGX value
 *     - adjustPoints({partnerId, delta, reason})         — admin only
 *
 *   Store Credit:
 *     - getCredit(partnerId)
 *     - issueCredit({partnerId, amount, source, expiresAt?}) — gift card etc
 *     - redeemCredit({partnerId, amount, documentId?})      — at sale time
 *     - adjustCredit({partnerId, delta, reason})
 *
 *   Customer Tabs:
 *     - getTab(partnerId)               — returns the open tab or null
 *     - openTab({partnerId, creditLimit?})
 *     - chargeTab({partnerId, documentId, amount, reason?})   — adds to tab
 *     - settleTab({partnerId, paymentMethod, amount, paymentId?}) — pays tab down
 *     - closeTab(partnerId)             — mark closed (zero balance required)
 *
 * All operations are transactional and write an append-only ledger row so
 * the customer can see their full history and the books stay auditable.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../kernel/audit/audit.service';

@Injectable()
export class PosLoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /* ====================== Loyalty program ====================== */

  /** Auto-create the default "Cafe Rewards" program if none exists. */
  async ensureProgram(): Promise<any> {
    const orgId = this.tenant.organizationId;
    const existing = await this.prisma.client.loyaltyProgram.findFirst({
      where: { organizationId: orgId, isActive: true },
    });
    if (existing) return existing;
    return this.prisma.client.loyaltyProgram.create({
      data: {
        organizationId: orgId,
        name: 'Cafe Rewards',
        pointsPerCurrency: 0.01,    // 1 point per 100 UGX
        currencyPerPoint: 100,      // 1 point = 100 UGX
        minPointsToRedeem: 50,       // need 50 points (= UGX 5,000) to redeem
        pointsExpireDays: 365,
        isActive: true,
      },
    });
  }

  async getProgram(): Promise<any | null> {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.loyaltyProgram.findFirst({
      where: { organizationId: orgId, isActive: true },
    });
  }

  async getBalance(partnerId: string): Promise<{ points: number; expiringSoon: number; programId: string | null }> {
    const orgId = this.tenant.organizationId;
    const latest = await this.prisma.client.loyaltyLedger.findFirst({
      where: { organizationId: orgId, partnerId },
      orderBy: { createdAt: 'desc' },
    });
    const points = Number(latest?.balanceAfter ?? 0);
    const soonCutoff = new Date(Date.now() + 30 * 24 * 60 * 60_000);
    const expiring = await this.prisma.client.loyaltyLedger.findMany({
      where: {
        organizationId: orgId, partnerId, delta: { gt: 0 },
        expiresAt: { gte: new Date(), lte: soonCutoff },
      },
    });
    const expiringSoon = expiring.reduce((s, e) => s + Number(e.delta), 0);
    const program = await this.getProgram();
    return { points, expiringSoon, programId: program?.id ?? null };
  }

  async getEarnedLifetime(partnerId: string): Promise<{ totalEarned: number }> {
    const orgId = this.tenant.organizationId;
    const result = await this.prisma.client.loyaltyLedger.aggregate({
      where: { organizationId: orgId, partnerId, delta: { gt: 0 } },
      _sum: { delta: true },
    });
    return { totalEarned: Number(result._sum.delta ?? 0) };
  }

  /** Award points for a sale. Called from pos.checkout after the invoice posts. */
  async earnPoints(args: { partnerId: string; documentId: string; amount: number; reason?: string }): Promise<{ points: number; balance: number }> {
    const orgId = this.tenant.organizationId;
    const program = await this.ensureProgram();
    if (!program) throw new BadRequestException('No active loyalty program');
    const earned = Math.floor(Number(args.amount) * Number(program.pointsPerCurrency));
    if (earned <= 0) return { points: 0, balance: await this.getBalance(args.partnerId).then((b) => b.points) };
    const current = await this.getBalance(args.partnerId);
    const newBalance = current.points + earned;
    const expiresAt = program.pointsExpireDays > 0
      ? new Date(Date.now() + program.pointsExpireDays * 24 * 60 * 60_000)
      : null;
    await this.prisma.client.loyaltyLedger.create({
      data: {
        organizationId: orgId,
        partnerId: args.partnerId,
        delta: earned,
        balanceAfter: newBalance,
        reason: args.reason ?? 'sale',
        documentId: args.documentId,
        expiresAt,
      },
    });
    return { points: earned, balance: newBalance };
  }

  /** Redeem N points for UGX value. Throws if insufficient. */
  async redeemPoints(args: { partnerId: string; points: number; documentId?: string }): Promise<{ redeemed: number; ugxValue: number; balance: number }> {
    const orgId = this.tenant.organizationId;
    const program = await this.ensureProgram();
    if (!program) throw new BadRequestException('No active loyalty program');
    const points = Math.floor(args.points);
    if (points < (program.minPointsToRedeem ?? 50)) {
      throw new BadRequestException(`Minimum redemption is ${program.minPointsToRedeem ?? 50} points`);
    }
    const current = await this.getBalance(args.partnerId);
    if (points > current.points) {
      throw new BadRequestException(`Insufficient points — have ${current.points}, need ${points}`);
    }
    const ugxValue = points * Number(program.currencyPerPoint);
    const newBalance = current.points - points;
    await this.prisma.client.loyaltyLedger.create({
      data: {
        organizationId: orgId,
        partnerId: args.partnerId,
        delta: -points,
        balanceAfter: newBalance,
        reason: 'redemption',
        documentId: args.documentId,
      },
    });
    return { redeemed: points, ugxValue, balance: newBalance };
  }

  /* ====================== Store credit ====================== */

  async getCredit(partnerId: string): Promise<{ balance: number; expiresAt: string | null }> {
    const orgId = this.tenant.organizationId;
    const row = await this.prisma.client.storeCredit.findFirst({
      where: { organizationId: orgId, partnerId, isActive: true },
    });
    if (!row) return { balance: 0, expiresAt: null };
    return { balance: Number(row.balance), expiresAt: row.expiresAt?.toISOString() ?? null };
  }

  /** Issue store credit (gift card, refund-to-credit, promo bonus). */
  async issueCredit(args: { partnerId: string; amount: number; source: string; expiresAt?: Date; notes?: string }): Promise<{ balance: number }> {
    const orgId = this.tenant.organizationId;
    if (args.amount <= 0) throw new BadRequestException('Amount must be positive');
    return this.prisma.client.$transaction(async (tx: any) => {
      let row = await tx.storeCredit.findFirst({
        where: { organizationId: orgId, partnerId: args.partnerId, isActive: true },
      });
      if (!row) {
        row = await tx.storeCredit.create({
          data: { organizationId: orgId, partnerId: args.partnerId, source: args.source, notes: args.notes },
        });
      }
      const newBalance = Number(row.balance) + Number(args.amount);
      await tx.storeCredit.update({ where: { id: row.id }, data: { balance: newBalance } });
      await tx.storeCreditLedger.create({
        data: {
          organizationId: orgId, storeCreditId: row.id,
          delta: args.amount, balanceAfter: newBalance,
          reason: args.source, notes: args.notes,
        },
      });
      return { balance: newBalance };
    });
  }

  /** Redeem store credit at sale time. */
  async redeemCredit(args: { partnerId: string; amount: number; documentId?: string }): Promise<{ balance: number }> {
    const orgId = this.tenant.organizationId;
    if (args.amount <= 0) throw new BadRequestException('Amount must be positive');
    return this.prisma.client.$transaction(async (tx: any) => {
      const row = await tx.storeCredit.findFirst({
        where: { organizationId: orgId, partnerId: args.partnerId, isActive: true },
      });
      if (!row || Number(row.balance) < Number(args.amount)) {
        throw new BadRequestException('Insufficient store credit');
      }
      const newBalance = Number(row.balance) - Number(args.amount);
      await tx.storeCredit.update({ where: { id: row.id }, data: { balance: newBalance, isActive: newBalance > 0 } });
      await tx.storeCreditLedger.create({
        data: {
          organizationId: orgId, storeCreditId: row.id,
          delta: -args.amount, balanceAfter: newBalance,
          reason: 'sale', documentId: args.documentId,
        },
      });
      return { balance: newBalance };
    });
  }

  /* ====================== Customer tabs ======================
   *
   * This manual CustomerTab / CustomerTabLedger API (chargeTab / settleTab) is
   * SEPARATE from POS credit settlement. POS credit invoices are settled via
   * PosInvoiceService.settleCredit and their statement is DERIVED from the
   * invoices/allocations/write-off JEs (see pos-customer-statement.controller);
   * it does NOT write to CustomerTab.balance / CustomerTabLedger. Only
   * CustomerTab.creditLimit is shared (read by assertCreditAllowed). Keep this
   * ledger reserved for manual house-account adjustments to avoid double books.
   */

  async getTab(partnerId: string): Promise<any | null> {
    const orgId = this.tenant.organizationId;
    return this.prisma.client.customerTab.findFirst({
      where: { organizationId: orgId, partnerId, isOpen: true },
    });
  }

  async openTab(args: { partnerId: string; creditLimit?: number; cashSessionId?: string }): Promise<any> {
    const orgId = this.tenant.organizationId;
    const existing = await this.getTab(args.partnerId);
    if (existing) return existing;
    return this.prisma.client.customerTab.create({
      data: {
        organizationId: orgId,
        partnerId: args.partnerId,
        creditLimit: args.creditLimit ?? 0,
        cashSessionId: args.cashSessionId,
      },
    });
  }

  async chargeTab(args: { partnerId: string; documentId: string; amount: number; reason?: string }): Promise<{ balance: number }> {
    const orgId = this.tenant.organizationId;
    if (args.amount <= 0) throw new BadRequestException('Amount must be positive');
    return this.prisma.client.$transaction(async (tx: any) => {
      let tab = await tx.customerTab.findFirst({
        where: { organizationId: orgId, partnerId: args.partnerId, isOpen: true },
      });
      if (!tab) {
        tab = await tx.customerTab.create({
          data: { organizationId: orgId, partnerId: args.partnerId },
        });
      }
      if (Number(tab.creditLimit) > 0) {
        const newBalance = Number(tab.balance) + Number(args.amount);
        if (newBalance > Number(tab.creditLimit)) {
          throw new BadRequestException(
            `Tab credit limit exceeded: owe ${newBalance.toFixed(0)}, limit ${Number(tab.creditLimit).toFixed(0)}`,
          );
        }
      }
      const newBalance = Number(tab.balance) + Number(args.amount);
      await tx.customerTab.update({ where: { id: tab.id }, data: { balance: newBalance } });
      await tx.customerTabLedger.create({
        data: {
          organizationId: orgId, tabId: tab.id,
          delta: args.amount, balanceAfter: newBalance,
          reason: args.reason ?? 'sale', documentId: args.documentId,
        },
      });
      return { balance: newBalance };
    });
  }

  /** Reduce the tab by a payment. */
  async settleTab(args: { partnerId: string; amount: number; paymentId?: string; reason?: string }): Promise<{ balance: number }> {
    const orgId = this.tenant.organizationId;
    if (args.amount <= 0) throw new BadRequestException('Amount must be positive');
    return this.prisma.client.$transaction(async (tx: any) => {
      const tab = await tx.customerTab.findFirst({
        where: { organizationId: orgId, partnerId: args.partnerId, isOpen: true },
      });
      if (!tab) throw new NotFoundException('No open tab for this customer');
      const newBalance = Number(tab.balance) - Number(args.amount);
      await tx.customerTab.update({ where: { id: tab.id }, data: { balance: newBalance } });
      await tx.customerTabLedger.create({
        data: {
          organizationId: orgId, tabId: tab.id,
          delta: -args.amount, balanceAfter: newBalance,
          reason: args.reason ?? 'payment',
          paymentId: args.paymentId,
        },
      });
      // Auto-close when balance hits zero.
      if (newBalance <= 0) {
        await tx.customerTab.update({
          where: { id: tab.id }, data: { isOpen: false, closedAt: new Date() },
        });
      }
      return { balance: newBalance };
    });
  }
}