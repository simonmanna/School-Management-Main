import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { OPEN_COLLECTABLE_FEE_WHERE } from './fee-document.constants';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import { PaymentService } from '../../invoicing/payment/payment.service';
import { dec, ZERO } from '../../../kernel/common/money';
import { FinanceControlsService } from './finance-controls.service';
import { AccountResolverService } from '../../accounting/posting/account-resolver.service';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { DmsTypeResolver } from '../../documents/dms-type-resolver.service';
import { SCHOOL_ACCOUNTS } from './school-accounts';

/**
 * Reversal of settled money (Phase 3 of the Fees production-hardening).
 *
 * FINANCIAL_INVARIANTS §Immutability:
 *
 *     Posted financial records are immutable. Corrections are performed only
 *     through compensating/reversal transactions.
 *     A posted PaymentAllocation is never edited. Reallocation =
 *         reverse original allocation → create replacement allocation.
 *
 * Before this, no reversal existed at all: `PaymentAllocation` had no reversal
 * representation, so a mis-allocated receipt could not be corrected and an
 * ALLOCATED payment could not be refunded (P1-C). The refund entitlement covers
 * only unallocated cash and refundable credits, so a parent who paid in full and
 * was then owed money back had no path through the system.
 *
 * ─── Three distinct state machines, deliberately not merged ───
 *
 *   A. CREDIT REFUND      — a FeeCredit is paid out. No allocation involved.
 *                           Lives in SchoolPaymentService.refundFee (P0-C).
 *   B. ALLOCATION REVERSAL — the payment stays; its allocation to one invoice is
 *                           undone. AR is restored and the payment's
 *                           unallocated balance rises. This service.
 *   C. PAYMENT REVERSAL   — the payment itself was wrong (cash never arrived).
 *                           Every allocation is reversed, then the payment and
 *                           its cash movement. This service.
 *
 * B is not a refund: no money leaves the drawer. C is not a refund either — a
 * refund returns money that WAS received; a payment reversal unwinds a receipt
 * that never should have existed. Collapsing them would make the cash position
 * unauditable.
 *
 * The REVERSAL ROW is authoritative. `PaymentAllocation.status` is a cached
 * projection of "does a PaymentAllocationReversal exist for me", exactly as
 * `FeeCredit.remaining` projects `FeeCreditAllocation` under ADR-013 — never the
 * record of truth, and never edited in place to mean something else.
 */
@Injectable()
export class PaymentAllocationReversalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly posting: PostingService,
    private readonly accounts: AccountDeterminationService,
    private readonly payments: PaymentService,
    private readonly controls: FinanceControlsService,
    // Re-audit #3 P0-2: a bounced receipt must also unwind the credit it funded.
    private readonly resolver: AccountResolverService,
    private readonly sequence: SequenceService,
    private readonly dmsTypes: DmsTypeResolver,
  ) {}

  /**
   * B · Reverse one posted allocation.
   *
   * Restores the invoice's receivable, decrements the document's cached
   * `amountPaid`, and returns the value to the payment's unallocated balance so
   * it can be re-allocated or refunded.
   *
   * Posts NO journal entry. The receipt already credited AR for its whole
   * amount when it was taken, and allocating it to an invoice posted nothing —
   * so un-allocating it has nothing to compensate. The ledger identity
   * `GL AR = open residual − unallocated receipts` holds on both sides: the
   * residual and the unallocated pot rise by the same amount. Money leaving the
   * school is a refund (its own outbound payment and journal); a receipt that
   * never should have existed is `reversePayment`. This used to post
   * Dr AR / Cr Cash here, which double-counted a payment reversal and moved
   * cash in the GL on every reallocation although none left the drawer.
   *
   * The original `PaymentAllocation` row is never touched except to update its
   * cached `status`; the reversal row carries the reason and actor.
   */
  async reverseAllocation(allocationId: string, reason: string, tx?: any) {
    if (!reason?.trim()) {
      throw new BadRequestException('A reversal must carry a reason — it is the audit trail.');
    }
    const run = async (db: any) => {
      const organizationId = this.tenant.organizationId;
      const alloc = await db.paymentAllocation.findFirst({
        where: { id: allocationId, organizationId },
        include: { payment: true },
      });
      if (!alloc) throw new NotFoundException(`Allocation ${allocationId} not found`);
      if (!alloc.documentId) {
        throw new BadRequestException(
          'This allocation targets a POS invoice, not an AR document; reverse it through the POS refund flow.',
        );
      }
      if (alloc.status === 'reversed') {
        // Idempotent: a second call returns the existing reversal rather than
        // restoring AR twice. The unique index on paymentAllocationId is the
        // database-level guarantee behind this (§Concurrency).
        const existing = await db.paymentAllocationReversal.findFirst({
          where: { paymentAllocationId: alloc.id },
        });
        return { reversal: existing, alreadyReversed: true };
      }

      // P1-B: restoring AR on this document is a posting against its term.
      await this.controls.assertDocumentsPeriodOpen([alloc.documentId], db);

      // Wave 18: lock the document, then the payment (the order collect and
      // refund use), and re-read both. A collect against this invoice or a
      // refund drawing on this payment used to be lost-updated by the absolute
      // writes below.
      await db.$queryRawUnsafe(
        `SELECT id FROM "Document" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`,
        alloc.documentId,
        organizationId,
      );
      await db.$queryRawUnsafe(
        `SELECT id FROM "Payment" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`,
        alloc.paymentId,
        organizationId,
      );
      const current = await db.paymentAllocation.findFirst({ where: { id: alloc.id }, select: { status: true } });
      if (current?.status === 'reversed') {
        const existing = await db.paymentAllocationReversal.findFirst({ where: { paymentAllocationId: alloc.id } });
        return { reversal: existing, alreadyReversed: true };
      }

      const doc = await db.document.findFirst({ where: { id: alloc.documentId, organizationId } });
      if (!doc) throw new NotFoundException(`Document ${alloc.documentId} not found`);

      const amount = dec(alloc.amount);
      const restoredResidual = dec(doc.amountResidual).plus(amount);
      const reducedPaid = dec(doc.amountPaid).minus(amount);
      if (reducedPaid.lessThan(ZERO)) {
        throw new BadRequestException(
          `Reversing ${amount.toString()} would drive amountPaid negative on ${doc.documentNumber} — ` +
            'the cached projection disagrees with the allocation subledger. Reconcile before reversing.',
        );
      }

      await db.document.update({
        where: { id: doc.id },
        data: {
          amountPaid: reducedPaid,
          amountResidual: restoredResidual,
          paymentStatus: restoredResidual.greaterThanOrEqualTo(dec(doc.totalAmount)) ? 'not_paid' : 'partial',
          // A document promoted to 'paid' on settlement returns to 'posted':
          // it is billed and outstanding again.
          status: doc.status === 'paid' ? 'posted' : doc.status,
        },
      });

      // The value returns to the payment's unallocated pot — it is still the
      // school's cash, just no longer settling this invoice.
      await db.payment.update({
        where: { id: alloc.paymentId },
        data: {
          allocatedAmount: { decrement: amount },
          unallocatedAmount: { increment: amount },
        },
      });

      const reversal = await db.paymentAllocationReversal.create({
        data: {
          organizationId,
          paymentAllocationId: alloc.id,
          amount,
          reason: reason.trim(),
          journalEntryId: null,
          reversedById: this.tenant.userId ?? null,
        },
      });
      // Cached projection, written last so it can never be true without the row.
      await db.paymentAllocation.update({ where: { id: alloc.id }, data: { status: 'reversed' } });

      await this.audit.recordInTx(db, {
        entity: 'PaymentAllocation',
        entityId: alloc.id,
        action: 'reverse',
        newValues: { amount: amount.toString(), reason },
      });
      this.events.publish('school.fee.allocation.reversed', {
        organizationId,
        allocationId: alloc.id,
        paymentId: alloc.paymentId,
        documentId: doc.id,
        amount: amount.toString(),
        reason,
      });

      return { reversal, alreadyReversed: false, documentId: doc.id, amount: amount.toString() };
    };

    return tx ? run(tx) : this.prisma.client.$transaction(run);
  }

  /**
   * B′ · Correct a mis-allocation: reverse every posted allocation on a payment,
   * then create the replacement set.
   *
   * This is the ONLY correct way to change where a receipt was applied. Editing
   * the allocation rows would leave the GL describing a settlement that no
   * longer matches the subledger, with nothing recording that it changed.
   */
  async reallocate(
    paymentId: string,
    newAllocations: Array<{ documentId: string; amount: number }>,
    reason: string,
    /** D4: an approved correction runs inside the transaction that claims it. */
    externalTx?: any,
  ) {
    const organizationId = this.tenant.organizationId;
    const run = async (tx: any) => {
      const payment = await tx.payment.findFirst({ where: { id: paymentId, organizationId } });
      if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);

      const posted = await tx.paymentAllocation.findMany({
        where: { organizationId, paymentId, status: 'posted' },
      });
      for (const alloc of posted) {
        await this.reverseAllocation(alloc.id, `Reallocation: ${reason}`, tx);
      }

      // Re-read: the reversals above returned value to the unallocated pot.
      const refreshed = await tx.payment.findFirst({ where: { id: paymentId } });
      const requested = newAllocations.reduce((t, a) => t.plus(dec(a.amount)), ZERO as Prisma.Decimal);
      if (requested.greaterThan(dec(refreshed.unallocatedAmount))) {
        throw new BadRequestException(
          `Reallocation of ${requested.toString()} exceeds the payment's available ` +
            `${refreshed.unallocatedAmount}. Reversals restored value first, so this is the true ceiling.`,
        );
      }

      // Only this payer's open fee invoices (re-audit #7). The payment writer
      // accepts any document, so a draft, cancelled, non-fee or other
      // family's invoice used to absorb real money. Moving a receipt to a
      // different pupil is a reversal and a new receipt, not a reallocation.
      const ids = [...new Set(newAllocations.map((a) => a.documentId))];
      const eligible = await tx.document.findMany({
        where: { ...OPEN_COLLECTABLE_FEE_WHERE, id: { in: ids }, organizationId, partnerId: payment.partnerId },
        select: { id: true },
      });
      if (eligible.length !== ids.length) {
        const ok = new Set(eligible.map((d: { id: string }) => d.id));
        throw new BadRequestException(
          `Only open fee invoices of the same payer can receive this payment (not: ${ids.filter((id) => !ok.has(id)).join(', ')}). ` +
            'To move money to another pupil, reverse the payment and record a new one.',
        );
      }

      await this.controls.assertDocumentsPeriodOpen(ids, tx);

      // Reuse the single payment writer's allocation semantics rather than
      // hand-rolling document maths here (ADR-011 §4).
      const created = await this.payments.allocateExisting(
        { paymentId, allocations: newAllocations },
        tx,
      );

      await this.audit.recordInTx(tx, {
        entity: 'Payment',
        entityId: paymentId,
        action: 'reallocate',
        newValues: { reversed: posted.length, created: newAllocations.length, reason },
      });
      return { paymentId, reversed: posted.length, allocations: created };
    };
    return externalTx ? run(externalTx) : this.prisma.client.$transaction(run);
  }

  /**
   * C · Reverse a whole payment — a receipt that should never have existed
   * (keyed in against the wrong student, or recording cash that never arrived).
   *
   * Distinct from a refund: no money is returned, because none was received.
   * Every allocation is reversed first, then the payment is cancelled and its
   * cash movement compensated.
   */
  async reversePayment(paymentId: string, reason: string, externalTx?: any) {
    if (!reason?.trim()) {
      throw new BadRequestException('A payment reversal must carry a reason — it is the audit trail.');
    }
    const organizationId = this.tenant.organizationId;
    const run = async (tx: any) => {
      // Wave 18: lock the allocated documents (id order) then the payment, so
      // two reversals of one receipt serialize and the second sees it
      // cancelled — instead of both reversing the journal and both writing
      // compensating cash movements.
      await tx.$queryRawUnsafe(
        `SELECT d.id FROM "Document" d
           JOIN "PaymentAllocation" a ON a."documentId" = d.id
          WHERE a."paymentId" = $1 AND a."organizationId" = $2
          ORDER BY d.id
          FOR UPDATE OF d`,
        paymentId,
        organizationId,
      );
      await tx.$queryRawUnsafe(
        `SELECT id FROM "Payment" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE`,
        paymentId,
        organizationId,
      );
      const payment = await tx.payment.findFirst({ where: { id: paymentId, organizationId } });
      if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
      if (payment.status === 'cancelled') {
        return { paymentId, alreadyReversed: true };
      }
      if (payment.direction && payment.direction !== 'inbound') {
        // A refund payout is money that left; "it never arrived" does not apply.
        throw new BadRequestException(
          'Only a receipt can be reversed as never received. A refund payout is corrected with a new receipt.',
        );
      }

      const posted = await tx.paymentAllocation.findMany({
        where: { organizationId, paymentId, status: 'posted' },
      });

      // Re-audit #3 P0-2 - what this receipt funded beyond its allocations.
      // Read BEFORE the allocation reversals below move value back into the
      // unallocated pot. Of the receipt's amount, whatever is not allocated,
      // not still unallocated and not converted to a credit was refunded in
      // cash: money the family was paid out of a receipt that never arrived.
      const fundedCredits = await tx.feeCredit.findMany({
        where: { organizationId, sourcePaymentId: paymentId, status: { not: 'reversed' } },
        orderBy: { createdAt: 'asc' },
      });
      const allocatedBefore = posted.reduce((t: Prisma.Decimal, a: any) => t.plus(dec(a.amount)), ZERO);
      const creditedBefore = fundedCredits.reduce((t: Prisma.Decimal, c: any) => t.plus(dec(c.amount)), ZERO);
      const refundedCash = Prisma.Decimal.max(
        ZERO,
        dec(payment.amount ?? 0).minus(allocatedBefore).minus(dec(payment.unallocatedAmount ?? 0)).minus(creditedBefore),
      );
      for (const alloc of posted) {
        await this.reverseAllocation(alloc.id, `Payment reversed: ${reason}`, tx);
      }

      // The receipt's own journal entry is reversed by the posting engine, which
      // writes a compensating entry rather than deleting the original. This is
      // the ONLY ledger movement of a payment reversal: the allocation reversals
      // above post nothing, so the receipt's Dr Cash / Cr AR is undone exactly
      // once.
      if (payment.journalEntryId) {
        await this.posting.reverse(
          payment.journalEntryId,
          { description: `Payment reversed · ${payment.paymentNumber} · ${reason}` },
          tx,
        );
      }

      const cancelled = await tx.payment.updateMany({
        where: { id: paymentId, status: { not: 'cancelled' } },
        data: { status: 'cancelled', allocatedAmount: ZERO, unallocatedAmount: ZERO },
      });
      if (cancelled.count === 0) throw new ConflictException('Payment was reversed concurrently');

      // Owner decision D2 (2026-09-25): unspent credit is voided; what the
      // credit already settled re-opens on those invoices; what was paid out in
      // cash becomes a receivable on the family's account.
      const unwound = await this.unwindFundedCredits(tx, fundedCredits, reason, payment.partnerId);
      const recoveryAmount = refundedCash.plus(unwound.refunded);
      const recovery = recoveryAmount.greaterThan(ZERO)
        ? await this.raiseRecoveryCharge(tx, payment, recoveryAmount, reason)
        : null;

      // The drawer never actually held this money, so the cash movement that
      // said it did must be compensated too or the Z-report overstates the till.
      const movements = await tx.cashMovement.findMany({ where: { organizationId, paymentId } });
      for (const m of movements) {
        // A closed session's Z-report is final: the compensation goes to a
        // drawer that is still open — the original if it is, else the
        // reverser's own.
        const cashSessionId = await this.openSessionFor(tx, m.cashSessionId);
        await tx.cashMovement.create({
          data: {
            organizationId,
            cashSessionId,
            paymentId: m.paymentId,
            movementType: m.movementType,
            // A compensating NEGATIVE movement, not a deletion: the session's
            // Z-report must show both that the money was recorded and that it
            // was taken back out, or the till history stops being an audit trail.
            amount: dec(m.amount).negated(),
            reason: `Reversal of movement ${m.id}: ${reason.trim()}`,
            performedBy: this.tenant.userId ?? null,
          },
        });
      }

      await this.audit.recordInTx(tx, {
        entity: 'Payment',
        entityId: paymentId,
        action: 'reverse',
        newValues: {
          reason,
          reversedAllocations: posted.length,
          voidedCredits: unwound.creditIds,
          reopenedByCredit: unwound.reopened.toString(),
          recoveryDocumentId: recovery?.id ?? null,
        },
      });
      this.events.publish('school.fee.payment.reversed', {
        organizationId,
        paymentId,
        reason,
        reversedAllocations: posted.length,
      });
      return {
        paymentId,
        alreadyReversed: false,
        reversedAllocations: posted.length,
        voidedCredits: unwound.creditIds.length,
        recoveryDocumentId: recovery?.id ?? null,
        recoveryAmount: recoveryAmount.toString(),
      };
    };
    return externalTx ? run(externalTx) : this.prisma.client.$transaction(run);
  }

  /**
   * Re-audit #3 P0-2. Undo the credits a reversed receipt funded.
   *
   * For each credit: every posted drawdown is reversed (Dr AR / Cr Fee-Credit
   * Liability; the invoice it settled is outstanding again), then the credit's
   * whole unrefunded value is voided (Dr Liability / Cr AR, the mirror of
   * `createCredit`). The part already refunded is returned so the caller can
   * raise it as a receivable; the liability for it was discharged by the payout.
   */
  /** The open session a compensating cash movement goes to (see reversePayment). */
  private async openSessionFor(tx: any, originalSessionId: string): Promise<string> {
    const organizationId = this.tenant.organizationId;
    await tx.$queryRawUnsafe(`SELECT id FROM "CashSession" WHERE id = $1 FOR SHARE`, originalSessionId);
    const original = await tx.cashSession.findFirst({ where: { id: originalSessionId, organizationId } });
    if (original?.status === 'open') return original.id;
    const userId = this.tenant.userId;
    const own = userId
      ? await tx.cashSession.findFirst({
          where: { organizationId, userId, status: 'open' },
          orderBy: { openedAt: 'desc' },
        })
      : null;
    if (!own) {
      throw new BadRequestException(
        'The cash session that took this receipt is closed. Open your own drawer to record the reversal in it.',
      );
    }
    await tx.$queryRawUnsafe(`SELECT id FROM "CashSession" WHERE id = $1 FOR SHARE`, own.id);
    return own.id;
  }

  private async unwindFundedCredits(tx: any, credits: any[], reason: string, partnerId: string) {
    const organizationId = this.tenant.organizationId;
    const out = { creditIds: [] as string[], reopened: ZERO, refunded: ZERO };
    if (credits.length === 0) return out;
    const arAccount = await this.accounts.receivableAccount(null, tx);
    const liability = await this.resolver.ensureByCode(SCHOOL_ACCOUNTS.feeCredit.code, SCHOOL_ACCOUNTS.feeCredit, tx);

    for (const credit of credits) {
      const drawdowns = await tx.feeCreditAllocation.findMany({
        where: { organizationId, feeCreditId: credit.id, status: 'posted' },
      });
      await this.controls.assertDocumentsPeriodOpen(drawdowns.map((d: any) => d.documentId), tx);
      let drawn = ZERO;
      for (const d of drawdowns) {
        const amount = dec(d.amount);
        const doc = await tx.document.findFirst({ where: { id: d.documentId, organizationId } });
        if (!doc) throw new NotFoundException(`Document ${d.documentId} not found`);
        const residual = dec(doc.amountResidual).plus(amount);
        await tx.document.update({
          where: { id: doc.id },
          data: {
            amountResidual: residual,
            paymentStatus: residual.greaterThanOrEqualTo(dec(doc.totalAmount)) ? 'not_paid' : 'partial',
            status: doc.status === 'paid' ? 'posted' : doc.status,
          },
        });
        await this.posting.post(
          {
            journalCode: 'GEN',
            date: new Date(),
            description: `Credit drawdown reversed · ${credit.code} · ${doc.documentNumber}`,
            sourceType: 'school_fee_credit_apply_reversal',
            sourceId: d.id,
            lines: [
              { accountId: arAccount, debit: amount.toString(), partnerId, description: 'AR re-opened: funding receipt reversed' },
              { accountId: liability, credit: amount.toString(), description: 'Fee credit drawdown reversed' },
            ],
          },
          tx,
        );
        await tx.feeCreditAllocation.update({
          where: { id: d.id },
          data: { status: 'reversed', reversedById: this.tenant.userId ?? null },
        });
        drawn = drawn.plus(amount);
      }

      const voidable = dec(credit.remaining).plus(drawn);
      if (voidable.greaterThan(ZERO)) {
        await this.posting.post(
          {
            journalCode: 'GEN',
            date: new Date(),
            description: `Fee credit voided · ${credit.code} · ${reason.trim()}`,
            sourceType: 'school_fee_credit_void',
            sourceId: credit.id,
            lines: [
              { accountId: liability, debit: voidable.toString(), description: 'Fee credit voided' },
              { accountId: arAccount, credit: voidable.toString(), partnerId, description: 'Funding receipt reversed' },
            ],
          },
          tx,
        );
      }
      // Conditional on the value read above, so a concurrent drawdown or refund
      // of this credit aborts the reversal instead of being silently lost.
      const claimed = await tx.feeCredit.updateMany({
        where: { id: credit.id, remaining: credit.remaining, status: { not: 'reversed' } },
        data: { remaining: ZERO, isActive: false, status: 'reversed' },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          `Fee credit ${credit.code} changed while this payment was being reversed. Nothing was reversed; retry.`,
        );
      }
      out.creditIds.push(credit.id);
      out.reopened = out.reopened.plus(drawn);
      out.refunded = out.refunded.plus(
        Prisma.Decimal.max(ZERO, dec(credit.amount).minus(dec(credit.remaining)).minus(drawn)),
      );
    }
    return out;
  }

  /**
   * Re-audit #3 P0-2 / D2. Money refunded out of a receipt that never arrived is
   * owed back by the family. The receipt reversal has already put it on GL AR
   * (Dr AR / Cr Cash for the full receipt), so this document posts NO journal:
   * it is the subledger row that makes the student balance agree with GL AR.
   */
  private async raiseRecoveryCharge(tx: any, payment: any, amount: Prisma.Decimal, reason: string) {
    const organizationId = this.tenant.organizationId;
    const now = new Date();
    const documentNumber = await this.sequence.next(
      `feeinvoice:${now.getUTCFullYear()}`,
      { prefix: 'REC-', padding: 6 },
      tx,
    );
    const doc = await tx.document.create({
      data: {
        organizationId,
        documentNumber,
        documentType: 'sales_invoice',
        documentTypeId: await this.dmsTypes.resolveIdByCode('sales_invoice', tx),
        partnerId: payment.partnerId,
        issueDate: now,
        dueDate: now,
        status: 'posted',
        paymentStatus: 'not_paid',
        postedAt: now,
        reference: `RECOVERY-${payment.paymentNumber}`,
        notes: `Refunded from receipt ${payment.paymentNumber}, which was reversed: ${reason.trim()}`,
        sourceType: 'school_payment_recovery',
        sourceId: payment.id,
        subtotal: amount,
        totalAmount: amount,
        amountResidual: amount,
      },
    });
    await tx.documentLine.create({
      data: {
        organizationId,
        documentId: doc.id,
        description: `Refund paid out of reversed receipt ${payment.paymentNumber}`,
        quantity: 1,
        unitPrice: amount,
        discountPercent: 0,
        lineNumber: 1,
        subtotal: amount,
        total: amount,
        taxAmount: 0,
      },
    });
    return doc;
  }
}
