import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { dec, ZERO } from '../../../kernel/common/money';
import { PostingService } from '../../accounting/posting/posting.service';
import { PaymentService } from '../../invoicing/payment/payment.service';
import { BillingService } from './billing.service';
import { FinanceControlsService } from './finance-controls.service';
import { PaymentAllocationReversalService } from './allocation-reversal.service';

/**
 * Wave 17 (audit R05) — revise an already-billed term invoice to the fee
 * structure's current published version.
 *
 * Billing identity is deliberately rigid: one `TERM-<termId>` document per
 * pupil per schedule, one SchoolFeeInvoice per pupil/term/version. That stops
 * double billing, and it also left a school with no supported way to apply a
 * fee change to pupils already billed. This is that way. It runs only as an
 * approved fee correction (maker-checker, FinanceCorrectionRequestService),
 * and in ONE transaction:
 *
 *   1. every payment allocation on the old invoice is reversed (the money
 *      returns to its receipt's unallocated balance — no cash moves);
 *   2. the old invoice is credited in full: its sales journal is reversed, the
 *      Document is cancelled and the SchoolFeeInvoice voided — both remain on
 *      record with this correction as the reason;
 *   3. the pupil is billed at the current version under a new document
 *      reference (`TERM-<termId>-V<versionId>`), so the identity index still
 *      forbids any second invoice for that version;
 *   4. the freed receipts are applied to the new invoice, oldest first; any
 *      excess stays on the receipt as an unallocated overpayment for the
 *      bursar to credit or refund.
 *
 * Refused, with the reason, when the term or any affected document's period is
 * closed, when the invoice is already on the current version, or when anything
 * other than receipts (a waiver, a fee credit, an adjustment) has settled part
 * of it — those must be reversed through their own correction first, so this
 * never has to guess how to unwind them.
 */
@Injectable()
export class FeeRebillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly payments: PaymentService,
    private readonly billing: BillingService,
    private readonly controls: FinanceControlsService,
    private readonly reversals: PaymentAllocationReversalService,
  ) {}

  /** Checks a rebill request can be filed (the same checks run again on approval). */
  async assertRebillable(schoolFeeInvoiceId: string) {
    const sfi = await this.prisma.client.schoolFeeInvoice.findFirst({ where: { id: schoolFeeInvoiceId } });
    if (!sfi) throw new NotFoundException(`Invoice ${schoolFeeInvoiceId} not found`);
    await this.target(this.prisma.client, sfi);
  }

  async rebill(tx: any, schoolFeeInvoiceId: string, reason: string) {
    const organizationId = this.tenant.organizationId;
    // Two approvals racing on one invoice: the second waits, then sees it voided.
    await tx.$queryRawUnsafe(`SELECT id FROM "SchoolFeeInvoice" WHERE id = $1 FOR UPDATE`, schoolFeeInvoiceId);
    const sfi = await tx.schoolFeeInvoice.findFirst({ where: { id: schoolFeeInvoiceId } });
    if (!sfi) throw new NotFoundException(`Invoice ${schoolFeeInvoiceId} not found`);
    const { doc, schedule, versionId } = await this.target(tx, sfi);

    await this.controls.assertTermOpen(sfi.termId, tx);
    await this.controls.assertDocumentsPeriodOpen([doc.id], tx);

    // 1. Un-apply every receipt from the old invoice.
    const allocations = await tx.paymentAllocation.findMany({
      where: { organizationId, documentId: doc.id, status: 'posted' },
      orderBy: { createdAt: 'asc' },
    });
    const freed: Array<{ paymentId: string; amount: Prisma.Decimal }> = [];
    for (const a of allocations) {
      await this.reversals.reverseAllocation(a.id, `Fee revision: ${reason}`, tx);
      const prev = freed.find((f) => f.paymentId === a.paymentId);
      if (prev) prev.amount = prev.amount.plus(dec(a.amount));
      else freed.push({ paymentId: a.paymentId, amount: dec(a.amount) });
    }

    // Only receipts may have settled it; anything else must be unwound first.
    const after = await tx.document.findFirst({ where: { id: doc.id } });
    const total = dec(after.totalAmount);
    if (!dec(after.amountResidual).equals(total) || dec(after.amountWaived ?? 0).greaterThan(ZERO)) {
      throw new BadRequestException(
        `${after.documentNumber} has been partly settled by something other than a receipt (a waiver, fee credit or ` +
          'adjustment). Reverse that first, then revise the invoice.',
      );
    }

    // 2. Credit the old invoice in full and keep it on record.
    if (!after.journalEntryId) throw new BadRequestException(`${after.documentNumber} has no posted journal to reverse.`);
    const reversal = await this.posting.reverse(
      after.journalEntryId,
      { date: new Date(), description: `Fee revision credit · ${after.documentNumber}` },
      tx,
    );
    await tx.document.update({
      where: { id: doc.id },
      data: {
        status: 'cancelled',
        amountResidual: new Prisma.Decimal(0),
        notes: `${after.notes ?? ''}\nCredited on fee revision (${reason}).`.trim(),
      },
    });
    await tx.schoolFeeInvoice.update({ where: { id: sfi.id }, data: { status: 'voided' } });

    // 3. Bill at the current version under a fresh, version-specific reference.
    const { doc: newDoc, sfi: newSfi } = await this.billing.rebillInTx(tx, {
      studentProfileId: sfi.studentProfileId,
      scheduleId: schedule.id,
      termId: sfi.termId,
      reference: `TERM-${sfi.termId}-V${versionId}`,
    });

    // 4. Re-apply the freed receipts, oldest first.
    let remaining = dec(newDoc.amountResidual ?? newDoc.totalAmount);
    const reapplied: Array<{ paymentId: string; amount: string }> = [];
    let unapplied = ZERO as Prisma.Decimal;
    for (const f of freed) {
      const take = Prisma.Decimal.min(f.amount, remaining);
      if (take.greaterThan(ZERO)) {
        await this.payments.allocateExisting({ paymentId: f.paymentId, allocations: [{ documentId: newDoc.id, amount: Number(take.toString()) }] }, tx);
        reapplied.push({ paymentId: f.paymentId, amount: take.toString() });
        remaining = remaining.minus(take);
      }
      unapplied = unapplied.plus(f.amount.minus(take));
    }

    const summary = {
      supersededInvoiceId: sfi.id,
      supersededDocumentId: doc.id,
      supersededTotal: total.toString(),
      creditJournalEntryId: reversal?.id ?? null,
      newInvoiceId: newSfi.id,
      newDocumentId: newDoc.id,
      newTotal: dec(newDoc.totalAmount).toString(),
      fromVersionId: sfi.feeStructureVersionId,
      toVersionId: versionId,
      reapplied,
      unappliedOverpayment: unapplied.toString(),
      reason,
    };
    await this.audit.recordInTx(tx, { entity: 'SchoolFeeInvoice', entityId: sfi.id, action: 'adjust', newValues: { rebill: true, ...summary } });
    return summary;
  }

  /** The invoice's document, its schedule, and the version it would move to. */
  private async target(db: any, sfi: any) {
    if (sfi.status === 'voided' || sfi.status === 'cancelled') {
      throw new BadRequestException(`Invoice ${sfi.invoiceNumber} was already ${sfi.status}.`);
    }
    const doc = await db.document.findFirst({ where: { id: sfi.documentId } });
    if (!doc || !['posted', 'paid'].includes(doc.status)) {
      throw new BadRequestException(`Invoice ${sfi.invoiceNumber} is not a live posted invoice.`);
    }
    if (doc.sourceType !== 'school_fee' || !doc.sourceId) {
      throw new BadRequestException('Only a term fee invoice can be revised to a new fee version.');
    }
    const schedule = await db.feeSchedule.findFirst({ where: { id: doc.sourceId }, include: { feeStructure: true } });
    if (!schedule) throw new BadRequestException('The fee schedule this invoice was billed from no longer exists.');
    const versionId: string | null = schedule.feeStructure?.currentVersionId ?? null;
    if (!versionId) throw new BadRequestException('The fee structure has no published version to revise to.');
    if (versionId === sfi.feeStructureVersionId) {
      throw new BadRequestException(`Invoice ${sfi.invoiceNumber} is already on the current published fee version.`);
    }
    return { doc, schedule, versionId };
  }
}
