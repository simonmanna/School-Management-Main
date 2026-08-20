import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import { AccountResolverService } from '../../accounting/posting/account-resolver.service';
import { dec, ZERO } from '../../../kernel/common/money';
import { SchoolFinanceQueryService } from './school-finance-query.service';

/**
 * Finance controls (A2 FeeAdjustment, A4.1 TermFinancialClose).
 *
 * FeeAdjustment is the typed escape hatch (P1-13): any balance change not
 * explained by invoice/payment/waiver/credit/refund/write-off must be one of
 * these, so a bare `amountResidual -= x` is never the mechanism. An adjustment
 * always targets a Document and moves BOTH its residual and the GL AR leg, so
 * the subledger and the general ledger never diverge (reconciliation holds).
 *
 * TermFinancialClose is a SCHOOL-domain control, deliberately separate from the
 * accounting fiscal period. Closing a term must not close the org's books while
 * POS, Inventory and Payroll share the same engine — postings stay governed by
 * the posting date's FiscalPeriod. Both gates must pass.
 */
@Injectable()
export class FinanceControlsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
    private readonly posting: PostingService,
    private readonly accounts: AccountDeterminationService,
    private readonly resolver: AccountResolverService,
    private readonly finance: SchoolFinanceQueryService,
  ) {}

  /* ───────────────────────── FeeAdjustment ───────────────────────── */

  async createAdjustment(dto: {
    studentProfileId: string;
    documentId: string;
    direction: 'debit' | 'credit';
    amount: number;
    reason: string;
  }) {
    const organizationId = this.tenant.organizationId;
    if (dto.direction !== 'debit' && dto.direction !== 'credit') {
      throw new BadRequestException("direction must be 'debit' or 'credit'");
    }
    if (dec(dto.amount).lessThanOrEqualTo(ZERO)) throw new BadRequestException('amount must be positive');
    const doc = await this.prisma.client.document.findFirst({ where: { id: dto.documentId, organizationId } });
    if (!doc) throw new NotFoundException(`Document ${dto.documentId} not found`);

    const code = await this.sequence.next(`feeadjustment:${new Date().getUTCFullYear()}`, { prefix: 'ADJ-', padding: 6 });
    const row = await this.prisma.client.feeAdjustment.create({
      data: {
        organizationId,
        code,
        studentProfileId: dto.studentProfileId,
        documentId: dto.documentId,
        direction: dto.direction,
        amount: dec(dto.amount),
        reason: dto.reason,
        status: 'pending_approval',
        createdById: this.tenant.userId ?? null,
      },
    });
    await this.audit.record({ entity: 'FeeAdjustment', entityId: row.id, action: 'create', newValues: row });
    return row;
  }

  listAdjustments(studentProfileId?: string, status?: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.feeAdjustment.findMany({
      where: { organizationId, ...(studentProfileId ? { studentProfileId } : {}), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve + post an adjustment. Maker-checker: approver ≠ creator. Moves the
   * Document residual and posts the matching GL leg atomically.
   *   debit  (student owes more): Dr AR / Cr Fee Adjustment Income
   *   credit (student owes less): Dr Fee Adjustment Expense / Cr AR
   */
  async approveAdjustment(id: string) {
    const organizationId = this.tenant.organizationId;
    const approverId = this.tenant.userId ?? null;
    const adj = await this.prisma.client.feeAdjustment.findFirst({ where: { id, organizationId } });
    if (!adj) throw new NotFoundException(`Adjustment ${id} not found`);
    if (adj.status === 'posted') return adj;
    if (adj.status !== 'pending_approval') {
      throw new BadRequestException(`Adjustment ${adj.code} is ${adj.status}, not pending_approval`);
    }
    if (approverId && adj.createdById && approverId === adj.createdById) {
      throw new BadRequestException('The user who created an adjustment cannot approve it (maker-checker).');
    }

    return this.prisma.client.$transaction(async (tx: any) => {
      const doc = await tx.document.findFirst({ where: { id: adj.documentId!, organizationId } });
      if (!doc) throw new NotFoundException(`Document ${adj.documentId} not found`);
      const amount = dec(adj.amount);
      const isDebit = adj.direction === 'debit';

      const newResidual = isDebit
        ? dec(doc.amountResidual).plus(amount)
        : dec(doc.amountResidual).minus(amount);
      if (newResidual.lessThan(ZERO)) {
        throw new BadRequestException(
          `Credit adjustment ${amount.toString()} exceeds document residual ${doc.amountResidual}.`,
        );
      }
      await tx.document.update({
        where: { id: doc.id },
        data: {
          amountResidual: newResidual,
          paymentStatus: newResidual.lessThanOrEqualTo(ZERO) ? 'paid' : 'partial',
        },
      });

      const arAccount = await this.accounts.receivableAccount(null, tx);
      const adjIncome = await this.resolver.ensureByCode(
        'FEE-ADJ-INC',
        { name: 'Fee Adjustment Income', categoryKey: 'revenue', mappingKey: 'fee_adjustment_income' },
        tx,
      );
      const adjExpense = await this.resolver.ensureByCode(
        'FEE-ADJ-EXP',
        { name: 'Fee Adjustment Expense', categoryKey: 'expense', mappingKey: 'fee_adjustment_expense' },
        tx,
      );
      const lines = isDebit
        ? [
            { accountId: arAccount, debit: amount.toString(), partnerId: doc.partnerId, description: `Adjustment ${adj.code}` },
            { accountId: adjIncome, credit: amount.toString(), description: 'Fee adjustment income' },
          ]
        : [
            { accountId: adjExpense, debit: amount.toString(), description: 'Fee adjustment expense' },
            { accountId: arAccount, credit: amount.toString(), partnerId: doc.partnerId, description: `Adjustment ${adj.code}` },
          ];
      const entry = await this.posting.post(
        {
          journalCode: 'GEN',
          date: new Date(),
          description: `Fee adjustment · ${adj.code}`,
          sourceType: 'school_fee_adjustment',
          sourceId: adj.id,
          lines,
        },
        tx,
      );

      const updated = await tx.feeAdjustment.update({
        where: { id: adj.id },
        data: { status: 'posted', approvedById: approverId, approvedAt: new Date(), journalEntryId: entry.id },
      });
      await this.audit.recordInTx(tx, { entity: 'FeeAdjustment', entityId: adj.id, action: 'post', newValues: { journalEntryId: entry.id } });
      this.events.publish('school.fee.adjustment.posted', {
        organizationId,
        adjustmentId: adj.id,
        studentProfileId: adj.studentProfileId,
        direction: adj.direction,
        amount: amount.toString(),
      });
      return updated;
    });
  }

  async rejectAdjustment(id: string, reason?: string) {
    const organizationId = this.tenant.organizationId;
    const adj = await this.prisma.client.feeAdjustment.findFirst({ where: { id, organizationId } });
    if (!adj) throw new NotFoundException(`Adjustment ${id} not found`);
    const updated = await this.prisma.client.feeAdjustment.update({
      where: { id: adj.id },
      data: { status: 'rejected', rejectionReason: reason ?? null },
    });
    await this.audit.record({ entity: 'FeeAdjustment', entityId: adj.id, action: 'reject', newValues: { reason } });
    return updated;
  }

  /* ───────────────────── TermFinancialClose (A4.1) ───────────────────── */

  /** Whether the term is closed for new school-fee transactions. */
  async isTermClosed(termId: string): Promise<boolean> {
    const organizationId = this.tenant.organizationId;
    const row = await this.prisma.client.termFinancialClose.findFirst({ where: { organizationId, termId } });
    return row?.status === 'closed';
  }

  /** Throw if the term is closed — called by collection / billing entry points. */
  async assertTermOpen(termId: string | null | undefined): Promise<void> {
    if (!termId) return;
    if (await this.isTermClosed(termId)) {
      throw new BadRequestException(
        `Term ${termId} is financially closed. Reopen it (maker-checker) before posting fee transactions.`,
      );
    }
  }

  getTermCloseStatus(termId: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.termFinancialClose.findFirst({ where: { organizationId, termId } });
  }

  /** Close a term: freeze a totals snapshot; block further fee postings. */
  async closeTerm(termId: string) {
    const organizationId = this.tenant.organizationId;
    const closedById = this.tenant.userId ?? null;

    // Snapshot the term's fee totals at close for the reporting record. Purely
    // informational — best-effort so a slow or partial aggregate can never block
    // the close itself, which is the actual control.
    let snapshot: any = { closedAt: new Date().toISOString() };
    try {
      const students = await this.prisma.client.studentProfile.findMany({
        where: { organizationId },
        select: { id: true },
        take: 5000,
      });
      let billed = 0, collected = 0, waived = 0, credited = 0, balance = 0;
      for (const s of students) {
        const b = await this.finance.studentBalance(s.id).catch(() => null);
        if (!b) continue;
        billed += b.billed; collected += b.collected; waived += b.waived;
        credited += b.credited; balance += b.balance;
      }
      snapshot = { billed, collected, waived, credited, balance, closedAt: new Date().toISOString() };
    } catch {
      // snapshot stays the minimal marker
    }

    const row = await this.prisma.client.termFinancialClose.upsert({
      where: { organizationId_termId: { organizationId, termId } },
      create: { organizationId, termId, status: 'closed', closedById, closedAt: new Date(), snapshot },
      update: { status: 'closed', closedById, closedAt: new Date(), snapshot },
    });
    await this.audit.record({ entity: 'TermFinancialClose', entityId: row.id, action: 'update', newValues: { event: 'close', termId, snapshot } });
    this.events.publish('school.fee.term.closed', { organizationId, termId, closedById: closedById ?? 'system' });
    return row;
  }

  /** Reopen a closed term (maker-checker: the reopener must differ from closer). */
  async reopenTerm(termId: string, reason?: string) {
    const organizationId = this.tenant.organizationId;
    const reopenedById = this.tenant.userId ?? null;
    const existing = await this.prisma.client.termFinancialClose.findFirst({ where: { organizationId, termId } });
    if (!existing || existing.status !== 'closed') {
      throw new BadRequestException(`Term ${termId} is not closed`);
    }
    if (reopenedById && existing.closedById && reopenedById === existing.closedById) {
      throw new BadRequestException('The user who closed a term cannot reopen it (maker-checker).');
    }
    const row = await this.prisma.client.termFinancialClose.update({
      where: { id: existing.id },
      data: { status: 'open', reopenedById, reopenedAt: new Date(), reopenReason: reason ?? null },
    });
    await this.audit.record({ entity: 'TermFinancialClose', entityId: row.id, action: 'update', newValues: { event: 'reopen', termId, reason } });
    this.events.publish('school.fee.term.reopened', { organizationId, termId, reopenedById: reopenedById ?? 'system', reason });
    return row;
  }
}
