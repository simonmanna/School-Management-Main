import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import { PaymentService } from '../../invoicing/payment/payment.service';
import { dec, ZERO } from '../../../kernel/common/money';
import { FinanceControlsService } from './finance-controls.service';

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
          allocatedAmount: dec(alloc.payment.allocatedAmount).minus(amount),
          unallocatedAmount: dec(alloc.payment.unallocatedAmount).plus(amount),
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
  ) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
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

      await this.controls.assertDocumentsPeriodOpen(
        newAllocations.map((a) => a.documentId),
        tx,
      );

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
    });
  }

  /**
   * C · Reverse a whole payment — a receipt that should never have existed
   * (keyed in against the wrong student, or recording cash that never arrived).
   *
   * Distinct from a refund: no money is returned, because none was received.
   * Every allocation is reversed first, then the payment is cancelled and its
   * cash movement compensated.
   */
  async reversePayment(paymentId: string, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A payment reversal must carry a reason — it is the audit trail.');
    }
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const payment = await tx.payment.findFirst({ where: { id: paymentId, organizationId } });
      if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
      if (payment.status === 'cancelled') {
        return { paymentId, alreadyReversed: true };
      }

      const posted = await tx.paymentAllocation.findMany({
        where: { organizationId, paymentId, status: 'posted' },
      });
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

      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'cancelled', allocatedAmount: ZERO, unallocatedAmount: ZERO },
      });

      // The drawer never actually held this money, so the cash movement that
      // said it did must be compensated too or the Z-report overstates the till.
      const movements = await tx.cashMovement.findMany({ where: { organizationId, paymentId } });
      for (const m of movements) {
        await tx.cashMovement.create({
          data: {
            organizationId,
            cashSessionId: m.cashSessionId,
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
        newValues: { reason, reversedAllocations: posted.length },
      });
      this.events.publish('school.fee.payment.reversed', {
        organizationId,
        paymentId,
        reason,
        reversedAllocations: posted.length,
      });
      return { paymentId, alreadyReversed: false, reversedAllocations: posted.length };
    });
  }
}
