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
import { POSTED_FEE_WHERE } from './fee-document.constants';
import { SCHOOL_ACCOUNTS } from './school-accounts';

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

      // P1-B: an adjustment moves this document's residual and its GL AR leg,
      // so the term the document belongs to must be open — regardless of when
      // the adjustment itself was raised.
      await this.assertDocumentsPeriodOpen([doc.id], tx);

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
      const adjIncome = await this.resolver.ensureByCode(SCHOOL_ACCOUNTS.feeAdjustmentIncome.code, SCHOOL_ACCOUNTS.feeAdjustmentIncome,
        tx,
      );
      const adjExpense = await this.resolver.ensureByCode(SCHOOL_ACCOUNTS.feeAdjustmentExpense.code, SCHOOL_ACCOUNTS.feeAdjustmentExpense,
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
    // Re-audit #3 P1-10: only a pending adjustment can be rejected. A posted one
    // has already moved the invoice residual and the GL; flipping its status to
    // 'rejected' dropped it from the balance while the ledger still carried it.
    // Claimed conditionally so a concurrent approve and reject cannot both win.
    const claimed = await this.prisma.client.feeAdjustment.updateMany({
      where: { id: adj.id, status: 'pending_approval' },
      data: { status: 'rejected', rejectionReason: reason ?? null },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException(`Adjustment ${adj.code} is ${adj.status}, not pending_approval`);
    }
    const updated = await this.prisma.client.feeAdjustment.findFirst({ where: { id: adj.id } });
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

  /**
   * P1-B · period control on every AFFECTED document, not the requested one.
   *
   * `assertTermOpen` checks the term a caller names. That is necessary but not
   * sufficient: a payment taken in Term 2 can be allocated to a Term 1 invoice,
   * a waiver can forgive a closed term's receivable, and a credit can be drawn
   * against one — all while the request names an open term. Each of those posts
   * into a closed period through the back door.
   *
   * FINANCIAL_INVARIANTS §Period control:
   *   "A mutation validates the period of EVERY document it touches — never
   *    only the period named in the request."
   *
   * Resolution runs through SchoolFeeInvoice, which carries the termId; a
   * document with no school invoice (a penalty raised outside the invoice
   * model, say) has no school term to close and is not blocked here — the
   * accounting FiscalPeriod still governs its posting date.
   *
   * `tx` is accepted so the check runs inside the caller's transaction and
   * cannot race a concurrent close.
   */
  async assertDocumentsPeriodOpen(documentIds: string[], tx?: any): Promise<void> {
    const ids = [...new Set(documentIds.filter(Boolean))];
    if (ids.length === 0) return;
    const organizationId = this.tenant.organizationId;
    const db = tx ?? this.prisma.client;
    const termByDoc = await this.termsOfDocuments(ids, db);
    const termIds = [...new Set(termByDoc.values())];
    if (termIds.length === 0) return;

    const closes = await db.termFinancialClose.findMany({
      where: { organizationId, termId: { in: termIds }, status: 'closed' },
      select: { termId: true },
    });
    if (closes.length === 0) return;

    const closedTermIds = new Set(closes.map((c: any) => c.termId));
    const blocked = ids.filter((id) => closedTermIds.has(termByDoc.get(id) ?? ''));
    if (blocked.length === 0) return;
    const docs = await db.document.findMany({ where: { id: { in: blocked } }, select: { documentNumber: true } });
    throw new BadRequestException(
      `This would post against ${blocked.length} invoice(s) in a financially closed term ` +
        `(${docs.map((d: any) => d.documentNumber).slice(0, 5).join(', ')}). ` +
        'Reopen the term (maker-checker) before posting.',
    );
  }

  /**
   * The academic term each fee document belongs to. Tuition carries it on its
   * SchoolFeeInvoice; a penalty inherits its source invoice's term; meal and
   * transport invoices carry it in their term reference. Admission fees are
   * not term-bound.
   */
  async termsOfDocuments(documentIds: string[], db: any = this.prisma.client): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (documentIds.length === 0) return out;
    const docs = await db.document.findMany({
      where: { id: { in: documentIds } },
      select: { id: true, sourceType: true, sourceId: true, reference: true },
    });
    const penaltySources = docs
      .filter((d: any) => d.sourceType === 'school_penalty' && d.sourceId)
      .map((d: any) => d.sourceId as string);
    const sfis = await db.schoolFeeInvoice.findMany({
      where: { documentId: { in: [...documentIds, ...penaltySources] } },
      select: { documentId: true, termId: true },
    });
    const sfiTerm = new Map<string, string>(
      sfis.filter((r: any) => r.termId).map((r: any) => [r.documentId as string, r.termId as string]),
    );
    for (const d of docs) {
      const direct = sfiTerm.get(d.id);
      const viaSource = d.sourceType === 'school_penalty' && d.sourceId ? sfiTerm.get(d.sourceId) : undefined;
      const viaRef = /^(MEALS|TRANSPORT)-(.+)$/.exec(d.reference ?? '')?.[2];
      const term = direct ?? viaSource ?? viaRef;
      if (term) out.set(d.id, term);
    }
    return out;
  }

  getTermCloseStatus(termId: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.termFinancialClose.findFirst({ where: { organizationId, termId } });
  }

  /** Every financially active fee document that belongs to a term. */
  private async termDocuments(termId: string) {
    const tuition = await this.prisma.client.schoolFeeInvoice.findMany({
      where: { termId },
      select: { documentId: true },
    });
    const tuitionIds = tuition.map((t) => t.documentId);
    return this.prisma.client.document.findMany({
      where: {
        ...POSTED_FEE_WHERE,
        OR: [
          { id: { in: tuitionIds } },
          { sourceType: 'school_penalty', sourceId: { in: tuitionIds } },
          { sourceType: 'school_meal', reference: `MEALS-${termId}` },
          { sourceType: 'school_transport', reference: `TRANSPORT-${termId}` },
        ],
      },
      select: { id: true, partnerId: true, sourceType: true, totalAmount: true, amountResidual: true, amountWaived: true },
    });
  }

  /**
   * Term-scoped fee totals. Every figure is restricted to the term's own
   * documents and to rows in a valid state: posted allocations (reversed ones
   * excluded), posted credit allocations, the waived share recorded on each
   * document, and posted adjustments against those documents. `balance` is transaction-derived;
   * `residual` is the sum of stored residuals — they must agree.
   *
   * Throws rather than returning partial totals: the result is frozen as the
   * permanent record of a closed term.
   */
  async termTotalsSnapshot(termId: string) {
    const term = await this.prisma.client.term.findFirst({
      where: { id: termId },
      select: { id: true, name: true, academicYearId: true },
    });
    if (!term) throw new NotFoundException(`Term ${termId} not found`);

    const docs = await this.termDocuments(termId);
    const docIds = docs.map((d) => d.id);

    const [collectedAgg, creditedAgg, adjustments] = await Promise.all([
      this.prisma.client.paymentAllocation.aggregate({
        where: { documentId: { in: docIds }, status: 'posted' },
        _sum: { amount: true },
      }),
      this.prisma.client.feeCreditAllocation.aggregate({
        where: { documentId: { in: docIds }, status: 'posted' },
        _sum: { amount: true },
      }),
      this.prisma.client.feeAdjustment.findMany({
        where: { documentId: { in: docIds }, status: 'posted' },
        select: { direction: true, amount: true },
      }),
    ]);

    const billed = docs.reduce((t, d) => t.plus(dec(d.totalAmount)), ZERO);
    const residual = docs.reduce((t, d) => t.plus(dec(d.amountResidual)), ZERO);
    const collected = dec(collectedAgg._sum.amount ?? 0);
    const credited = dec(creditedAgg._sum.amount ?? 0);
    // Waivers (incl. bad-debt write-offs) spread across a student's invoices;
    // each invoice records its share in amountWaived, which is term-attributable.
    const waived = docs.reduce((t, d) => t.plus(dec(d.amountWaived ?? 0)), ZERO);
    const adjusted = adjustments.reduce(
      (t, a) => (a.direction === 'debit' ? t.plus(dec(a.amount)) : t.minus(dec(a.amount))),
      ZERO,
    );
    const balance = billed.minus(collected).minus(credited).minus(waived).plus(adjusted);

    const bySource: Record<string, { invoices: number; billed: number; outstanding: number }> = {};
    for (const d of docs) {
      const k = d.sourceType ?? 'other';
      const row = (bySource[k] ??= { invoices: 0, billed: 0, outstanding: 0 });
      row.invoices += 1;
      row.billed += Number(d.totalAmount);
      row.outstanding += Number(d.amountResidual);
    }

    return {
      termId,
      termName: term.name,
      academicYearId: term.academicYearId,
      billed: billed.toNumber(),
      collected: collected.toNumber(),
      credited: credited.toNumber(),
      waived: waived.toNumber(),
      adjusted: adjusted.toNumber(),
      balance: balance.toNumber(),
      residual: residual.toNumber(),
      residualVariance: residual.minus(balance).toNumber(),
      studentCount: new Set(docs.map((d) => d.partnerId)).size,
      invoiceCount: docs.length,
      bySource,
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Close a term: freeze a totals snapshot; block further fee postings.
   *
   * Fail-closed (P1-J): if the snapshot cannot be computed, the term stays open
   * rather than closing with an unreconcilable placeholder.
   */
  async closeTerm(termId: string) {
    const organizationId = this.tenant.organizationId;
    const closedById = this.tenant.userId ?? null;

    // P1-J: the snapshot is FAIL-CLOSED.
    //
    // This used to be wrapped in `catch {}` and described as "best-effort so a
    // slow or partial aggregate can never block the close". That has it exactly
    // backwards: the frozen totals ARE the record of what the books said at
    // close, and a term closed with a placeholder marker is a term nobody can
    // ever reconcile back to. If the totals cannot be computed, the correct
    // outcome is that the term does not close.
    //
    // P2-E: computed by grouped aggregates rather than an N+1 loop over up to
    // 5000 students, which is also why it could time out in the first place.
    const snapshot = await this.termTotalsSnapshot(termId);
    const now = new Date();
    const fields = {
      status: 'closed',
      academicYearId: snapshot.academicYearId,
      closedById,
      closedAt: now,
      snapshotAt: now,
      snapshot: snapshot as any,
    };

    const row = await this.prisma.client.termFinancialClose.upsert({
      where: { organizationId_termId: { organizationId, termId } },
      create: { organizationId, termId, ...fields },
      update: fields,
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
