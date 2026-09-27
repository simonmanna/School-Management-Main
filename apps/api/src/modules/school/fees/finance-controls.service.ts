import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import { AccountResolverService } from '../../accounting/posting/account-resolver.service';
import { dec, ZERO, type Money } from '../../../kernel/common/money';
import { SchoolFinanceQueryService } from './school-finance-query.service';
import { POSTED_FEE_WHERE } from './fee-document.constants';
import { SCHOOL_ACCOUNTS } from './school-accounts';
import { lockTermExclusive, lockTermsOpen } from './term-close-gate';

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
    /** Optional consistency check only — the pupil is derived from the invoice (audit F04). */
    studentProfileId?: string;
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
    if (!dto.reason?.trim()) throw new BadRequestException('Give the reason for the adjustment.');
    const doc = await this.prisma.client.document.findFirst({ where: { id: dto.documentId, organizationId } });
    if (!doc) throw new NotFoundException(`Document ${dto.documentId} not found`);
    // Audit F04 (I-003, I-022): an adjustment belongs to the invoice's pupil, and
    // only a live school-fee invoice can be adjusted.
    const eligible = await this.prisma.client.document.findFirst({
      where: { AND: [{ id: doc.id, organizationId }, POSTED_FEE_WHERE] },
      select: { id: true },
    });
    if (!eligible) {
      throw new BadRequestException(
        `${doc.documentNumber ?? 'That document'} is not a posted school-fee invoice (it is ${doc.status}), so it cannot be adjusted.`,
      );
    }
    const studentProfileId = await this.pupilOfDocument(doc);
    if (!studentProfileId) {
      throw new BadRequestException(`${doc.documentNumber ?? 'That invoice'} is not linked to a pupil, so it cannot be adjusted.`);
    }
    if (dto.studentProfileId && dto.studentProfileId !== studentProfileId) {
      throw new BadRequestException(
        `${doc.documentNumber ?? 'That invoice'} belongs to a different pupil. An adjustment is always recorded against the invoice's own pupil.`,
      );
    }
    await this.assertDocumentsPeriodOpen([doc.id]);

    const code = await this.sequence.next(`feeadjustment:${new Date().getUTCFullYear()}`, { prefix: 'ADJ-', padding: 6 });
    const row = await this.prisma.client.feeAdjustment.create({
      data: {
        organizationId,
        code,
        studentProfileId,
        documentId: dto.documentId,
        direction: dto.direction,
        amount: dec(dto.amount),
        reason: dto.reason.trim(),
        status: 'pending_approval',
        createdById: this.tenant.userId ?? null,
      },
    });
    await this.audit.record({ entity: 'FeeAdjustment', entityId: row.id, action: 'create', newValues: row });
    return row;
  }

  /**
   * The pupil a fee document belongs to: its SchoolFeeInvoice for tuition, the
   * source invoice's for a penalty, otherwise the pupil whose billing partner it
   * was raised against.
   */
  private async pupilOfDocument(doc: { id: string; partnerId: string | null; sourceType: string | null; sourceId: string | null }): Promise<string | null> {
    const db = this.prisma.client;
    const direct = await db.schoolFeeInvoice.findFirst({ where: { documentId: doc.id }, select: { studentProfileId: true } });
    if (direct) return direct.studentProfileId;
    if (doc.sourceType === 'school_penalty' && doc.sourceId) {
      const src = await db.schoolFeeInvoice.findFirst({ where: { documentId: doc.sourceId }, select: { studentProfileId: true } });
      if (src) return src.studentProfileId;
    }
    if (!doc.partnerId) return null;
    const pupils = await db.studentProfile.findMany({ where: { partnerId: doc.partnerId }, select: { id: true }, take: 2 });
    return pupils.length === 1 ? pupils[0].id : null;
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
    const seen = await this.prisma.client.feeAdjustment.findFirst({ where: { id, organizationId } });
    if (!seen) throw new NotFoundException(`Adjustment ${id} not found`);

    return this.prisma.client.$transaction(async (tx: any) => {
      // Audit F03 (I-020): the status read that decides whether to post is made
      // under a row lock INSIDE the posting transaction. Two approvals used to
      // both read 'pending_approval' before either began, and both posted.
      await tx.$queryRawUnsafe(`SELECT id FROM "FeeAdjustment" WHERE id = $1 FOR UPDATE`, id);
      const adj = await tx.feeAdjustment.findFirst({ where: { id, organizationId } });
      if (!adj) throw new NotFoundException(`Adjustment ${id} not found`);
      // A replay of an approval that already posted returns the original.
      if (adj.status === 'posted') return adj;
      if (adj.status !== 'pending_approval') {
        throw new BadRequestException(`Adjustment ${adj.code} is ${adj.status}, not pending_approval`);
      }
      if (approverId && adj.createdById && approverId === adj.createdById) {
        throw new BadRequestException('The user who created an adjustment cannot approve it (maker-checker).');
      }

      // The invoice row is locked too, so two DIFFERENT adjustments to one
      // invoice apply one after the other instead of overwriting each other's
      // residual.
      await tx.$queryRawUnsafe(`SELECT id FROM "Document" WHERE id = $1 FOR UPDATE`, adj.documentId);
      const doc = await tx.document.findFirst({ where: { id: adj.documentId!, organizationId } });
      if (!doc) throw new NotFoundException(`Document ${adj.documentId} not found`);

      // P1-B / F05: the invoice's term must be open, checked under the close lock.
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
          // Ledger-level idempotency: one adjustment can only ever post once.
          postingKey: `school_fee_adjustment:${adj.id}`,
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

  /**
   * Throw if the term is closed. Without `tx` this is an early, friendly check
   * only; a posting must ALSO call it with its transaction (or `lockTermsOpen`),
   * which holds the close lock until commit (audit F05, I-021).
   */
  async assertTermOpen(termId: string | null | undefined, tx?: any): Promise<void> {
    if (!termId) return;
    if (tx) return lockTermsOpen(tx, this.tenant.organizationId, [termId]);
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
    // Inside a transaction, hold each term's close lock until commit so a
    // concurrent close cannot slip between this check and the write (F05).
    if (tx) {
      for (const t of [...termIds].sort()) {
        await tx.$queryRawUnsafe(
          'SELECT 1 AS ok FROM pg_advisory_xact_lock_shared(hashtextextended($1, 0))',
          `term-close:${organizationId}:${t}`,
        );
      }
    }

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
  private async termDocuments(termId: string, db: any = this.prisma.client) {
    const tuition = await db.schoolFeeInvoice.findMany({
      where: { termId },
      select: { documentId: true },
    });
    const tuitionIds = tuition.map((t: any) => t.documentId as string);
    return db.document.findMany({
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
  async termTotalsSnapshot(termId: string, db: any = this.prisma.client) {
    const term = await db.term.findFirst({
      where: { id: termId },
      select: { id: true, name: true, academicYearId: true },
    });
    if (!term) throw new NotFoundException(`Term ${termId} not found`);

    const docs: any[] = await this.termDocuments(termId, db);
    const docIds = docs.map((d: any) => d.id);

    const [collectedAgg, creditedAgg, adjustments] = await Promise.all([
      db.paymentAllocation.aggregate({
        where: { documentId: { in: docIds }, status: 'posted' },
        _sum: { amount: true },
      }),
      db.feeCreditAllocation.aggregate({
        where: { documentId: { in: docIds }, status: 'posted' },
        _sum: { amount: true },
      }),
      db.feeAdjustment.findMany({
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
      (t: Money, a: any) => (a.direction === 'debit' ? t.plus(dec(a.amount)) : t.minus(dec(a.amount))),
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
    //
    // F05: the snapshot and the close row are written under the term's
    // EXCLUSIVE close lock. Every posting holds the shared lock for its whole
    // transaction, so none can land between the snapshot and the close.
    const { row, snapshot } = await this.prisma.client.$transaction(
      async (tx: any) => {
        await lockTermExclusive(tx, organizationId, termId);
        const snap = await this.termTotalsSnapshot(termId, tx);
        const now = new Date();
        const fields = {
          status: 'closed',
          academicYearId: snap.academicYearId,
          closedById,
          closedAt: now,
          snapshotAt: now,
          snapshot: snap as any,
        };
        const saved = await tx.termFinancialClose.upsert({
          where: { organizationId_termId: { organizationId, termId } },
          create: { organizationId, termId, ...fields },
          update: fields,
        });
        return { row: saved, snapshot: snap };
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
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
    if (!reason?.trim()) {
      throw new BadRequestException('Give the reason for reopening a closed term; it is part of the record.');
    }
    const row = await this.prisma.client.$transaction(async (tx: any) => {
      await lockTermExclusive(tx, organizationId, termId);
      return tx.termFinancialClose.update({
        where: { id: existing.id },
        data: { status: 'open', reopenedById, reopenedAt: new Date(), reopenReason: reason.trim() },
      });
    });
    await this.audit.record({ entity: 'TermFinancialClose', entityId: row.id, action: 'update', newValues: { event: 'reopen', termId, reason } });
    this.events.publish('school.fee.term.reopened', { organizationId, termId, reopenedById: reopenedById ?? 'system', reason });
    return row;
  }
}
