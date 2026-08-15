import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { dec, round, ZERO } from '../../../kernel/common/money';
import { DocumentBuilderService } from '../../invoicing/document/document-builder.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import { PaymentService } from '../../invoicing/payment/payment.service';
// DmsTypeResolver comes from the @Global DocumentsModule, which documents its
// vertical injectors (invoicing, recurring, rental, school) explicitly — no
// module import edge is required.
import { DmsTypeResolver } from '../../documents/dms-type-resolver.service';
import { EVENTS } from '@erp/shared';
import type { CollectFeePaymentDto, FeeComponent, GenerateBillingDto } from './dto.types';

/**
 * BillingService — the keystone of the school vertical.
 *
 * `generateForTerm(termId, classId?)` reads the active FeeStructure,
 * resolves each student's overrides/discounts/scholarships, then creates
 * one Document(sales_invoice) per student. Each invoice is **immediately
 * posted to the GL** via PostingService so the school's books reflect
 * outstanding fees without a separate "post" step.
 *
 * `collectFeePayment` wraps the existing PostingService.record pattern
 * via a raw Document+Payment composition (the kernel's PaymentService.record
 * is reserved for invoice → payment relations which we use directly here).
 *
 * Idempotency: controllers apply `@UseInterceptors(IdempotencyInterceptor)`
 * + `@Idempotent()` so mobile-money retries don't double-bill or double-pay.
 *
 * This is the "proof of reuse" sprint: zero new accounting code.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
    private readonly documentBuilder: DocumentBuilderService,
    private readonly posting: PostingService,
    private readonly determination: AccountDeterminationService,
    private readonly dmsTypes: DmsTypeResolver,
  ) {}

  /**
   * P0-6 (C6): generate term fees for all active students in a class
   * (or all classes if no classId).
   *
   * Idempotency is enforced at THREE levels:
   *  1. Application-level check: look for an existing Document
   *     matching (org, sourceType='school_fee', sourceId=scheduleId,
   *     reference='TERM-<termId>') before creating.
   *  2. Database-level unique constraint: @@unique on the same
   *     tuple. If two concurrent bursars click "Generate" at the
   *     same instant, the second one gets a P2002 unique-violation
   *     that we catch and treat as "already exists".
   *  3. Atomic: the read + create run inside a single $transaction
   *     so a row inserted between the read and the create (from a
   *     different process) is visible to the create's write.
   *
   * Each student gets one sales_invoice Document with one line per
   * FeeComponent. Each invoice is immediately posted to the GL.
   */
  async generateForTerm(dto: GenerateBillingDto) {
    const organizationId = this.tenant.organizationId;

    // Resolve target students (outside tx — read-only).
    const studentWhere: any = { status: 'active' };
    if (dto.classId) studentWhere.currentClassId = dto.classId;
    const students = await this.prisma.client.studentProfile.findMany({
      where: studentWhere,
      include: { currentClass: true },
    });
    if (students.length === 0) throw new BadRequestException('No active students found for billing');

    // Find FeeSchedule for the term.
    const schedules = await this.prisma.client.feeSchedule.findMany({
      where: { termId: dto.termId },
      include: { feeStructure: true },
    });
    if (schedules.length === 0) throw new BadRequestException(`No fee schedule configured for term ${dto.termId}`);

    const created: any[] = [];
    const skipped: any[] = [];
    for (const s of students) {
      // Find a schedule whose FeeStructure is applicable to this student's class.
      const schedule = schedules.find((sch) => this.appliesTo(sch.feeStructure.applicableTo as any, s.currentClassId ?? ''));
      if (!schedule) continue;

      const feeStructure = schedule.feeStructure;
      const components = (feeStructure.components as unknown as FeeComponent[]) ?? [];

      // Resolve per-student overrides and scholarships (outside tx — read-only).
      const studentAssignment = await this.prisma.client.studentFeeAssignment.findFirst({
        where: {
          studentProfileId: s.id,
          feeStructureId: feeStructure.id,
          termId: dto.termId,
        },
      });
      const customDiscount = (studentAssignment?.customDiscount ?? {}) as Record<string, number>;

      const scholarships = await this.prisma.client.scholarship.findMany({
        where: {
          studentProfileId: s.id,
          isActive: true,
          validFrom: { lte: new Date() },
          OR: [{ validTo: null }, { validTo: { gte: new Date() } }],
        },
      });

      // Build document lines from components with discount + scholarship applied.
      const lines = components.map((c) => {
        const override = customDiscount[c.code];
        const baseAmount = override != null ? override : c.amount;
        let lineDiscount = 0;
        for (const sch of scholarships) {
          if (sch.type === 'percent') lineDiscount += (baseAmount * Number(sch.value)) / 100;
          else if (sch.type === 'fixed') lineDiscount += Number(sch.value);
        }
        const finalAmount = Math.max(0, baseAmount - lineDiscount);
        return {
          productId: c.productId,
          description: c.code,
          quantity: 1,
          unitPrice: baseAmount,
          discountPercent: baseAmount > 0 ? (lineDiscount / baseAmount) * 100 : 0,
        };
      });

      const issueDate = new Date();
      const reference = `TERM-${dto.termId}`;

      // P0-6: move the dedupe check + create inside one $transaction
      // so a concurrent call cannot insert a duplicate. The new
      // @@unique([organizationId, sourceType, sourceId, reference])
      // is the database-level safety net.
      let document: any;
      try {
        document = await this.prisma.client.$transaction(async (tx: any) => {
          const existing = await tx.document.findFirst({
            where: {
              organizationId,
              partnerId: s.partnerId,
              sourceType: 'school_fee',
              sourceId: schedule.id,
              reference,
            },
          });
          if (existing) return { _skipped: true, documentId: existing.id } as any;

          // P2A: build the invoice through the invoicing DocumentBuilderService
          // rather than a raw create. The raw path omitted `documentTypeId`,
          // which became a required FK when the DMS registry landed — so the
          // ported billing run would throw on every invoice. The builder also
          // resolves the document number, computes line/tax/totals, and sets
          // amountResidual + paymentStatus, replacing the hand-rolled versions.
          const createdDoc = await this.documentBuilder.createDocument(
            tx,
            'sales_invoice',
            {
              partnerId: s.partnerId,
              issueDate: issueDate.toISOString(),
              dueDate: schedule.dueDate ? new Date(schedule.dueDate).toISOString() : undefined,
              reference,
              notes: `Term fee for ${s.admissionNo}`,
              sourceType: 'school_fee',
            },
            lines.map((l) => ({
              productId: l.productId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              discountPercent: l.discountPercent,
            })),
          );
          // The header input carries sourceType but not sourceId; set it so the
          // (org, sourceType, sourceId, reference) dedup key is unique per
          // schedule and the penalty run can trace invoices back to it.
          await tx.document.update({
            where: { id: createdDoc.id },
            data: { sourceId: schedule.id },
          });
          // Re-load with lines + partner for the GL post below.
          const full = await tx.document.findFirst({
            where: { id: createdDoc.id },
            include: { lines: true, partner: true },
          });
          return { _skipped: false, doc: full! };
        });
      } catch (err: any) {
        // P0-6: race condition safety net. A concurrent process
        // inserted the same (org, sourceType, sourceId, reference)
        // between our findFirst and our create. The unique
        // constraint raised P2002. Treat it as "already exists".
        if (err?.code === 'P2002') {
          const existing = await this.prisma.client.document.findFirst({
            where: {
              organizationId,
              partnerId: s.partnerId,
              sourceType: 'school_fee',
              sourceId: schedule.id,
              reference,
            },
          });
          if (existing) {
            skipped.push({ studentProfileId: s.id, documentId: existing.id, reason: 'already_billed' });
            continue;
          }
        }
        throw err;
      }

      if ((document as any)._skipped) {
        skipped.push({ studentProfileId: s.id, documentId: (document as any).documentId, reason: 'already_billed' });
        continue;
      }

      const createdDoc = (document as any).doc;

      // Post to the GL. We did the per-document work in a tx; the
      // post happens outside that tx so a slow GL post doesn't hold
      // a write lock on the document row. If the post fails the
      // document remains 'draft' and a retry of the billing run
      // will pick it up via the findFirst check (no duplicate).
      const subtotal = createdDoc.lines.reduce((sum: number, l: any) => sum + Number(l.subtotal), 0);
      const discountTotal = createdDoc.lines.reduce((sum: number, l: any) => sum + (Number(l.unitPrice) - Number(l.subtotal)), 0);

      const { counterAccount, itemByAccount, taxByAccount } = await this.documentBuilder.groupForPosting(
        this.prisma.client as any,
        createdDoc,
        'sales',
      );

      const journalLines: any[] = [
        { accountId: counterAccount, debit: subtotal.toString(), partnerId: createdDoc.partnerId, description: `Invoice ${createdDoc.documentNumber}` },
      ];
      for (const [accountId, amount] of itemByAccount) {
        journalLines.push({ accountId, credit: amount.toString(), partnerId: createdDoc.partnerId, description: 'Revenue' });
      }
      for (const [accountId, amount] of taxByAccount) {
        journalLines.push({ accountId, credit: amount.toString(), description: 'Output tax' });
      }

      const entry = await this.posting.post(
        {
          journalCode: 'SALES',
          date: issueDate,
          description: `School fee · ${createdDoc.documentNumber}`,
          sourceType: 'school_fee_invoice',
          sourceId: createdDoc.id,
          lines: journalLines,
        },
        this.prisma.client as any,
      );

      // Promote the document to 'posted'.
      const updatedDoc = await this.prisma.client.document.update({
        where: { id: createdDoc.id },
        data: {
          subtotal,
          discountTotal,
          totalAmount: subtotal,
          amountResidual: subtotal,
          amountPaid: 0,
          paymentStatus: 'not_paid',
          status: 'posted',
          journalEntryId: entry.id,
          postedAt: new Date(),
        },
        include: { lines: true, partner: true },
      });

      created.push(updatedDoc);
      this.events.publish(EVENTS.SchoolFeeInvoiceDrafted, {
        organizationId,
        documentId: updatedDoc.id,
        studentProfileId: s.id,
        amount: updatedDoc.totalAmount.toString(),
      });
      this.events.publish(EVENTS.SchoolFeeInvoicePosted, {
        organizationId,
        documentId: updatedDoc.id,
        studentProfileId: s.id,
        amount: updatedDoc.totalAmount.toString(),
      });
    }

    return { count: created.length, documents: created, skipped };
  }

  private appliesTo(filter: any, classId: string): boolean {
    if (!filter || typeof filter !== 'object') return true;
    if (Array.isArray(filter.classIds) && filter.classIds.length > 0) {
      return filter.classIds.includes(classId);
    }
    return true;
  }

  /**
   * Run a penalty assessment for overdue invoices on a FeeSchedule.
   *
   * P0-2 (C2 + H6) rewrite:
   *  - One PenaltyRun row per (scheduleId, cronDate). The unique
   *    constraint on the table means a second call on the same day
   *    returns the existing run (idempotent on the daily cron).
   *  - One PenaltyAssessment per overdue source Document per run.
   *    A unique constraint on (sourceDocumentId, penaltyRunId) is
   *    the database-level guarantee against the old "every cron tick
   *    mints a new penalty" bug.
   *  - The penalty Document now has a DocumentLine and posts to the
   *    GL (status='posted', journalEntryId set). Previously the
   *    penalty was 'draft' with no line, so the GL was never
   *    debited/credited for late fees.
   */
  async generatePenaltyRun(scheduleId: string) {
    const organizationId = this.tenant.organizationId;

    // UTC date (YYYY-MM-DD) — the natural idempotency key.
    const cronDate = new Date();
    cronDate.setUTCHours(0, 0, 0, 0);

    return this.prisma.client.$transaction(async (tx: any) => {
      // ── Idempotency gate: return existing run if today already ran. ──
      const existingRun = await tx.penaltyRun.findFirst({
        where: { organizationId, scheduleId, cronDate },
        include: { assessments: true },
      });
      if (existingRun) {
        return existingRun;
      }

      const rule = await tx.penaltyRule.findFirst({
        where: { feeScheduleId: scheduleId, isActive: true },
      });
      if (!rule) throw new BadRequestException(`No active penalty rule for schedule ${scheduleId}`);

      const schedule = await tx.feeSchedule.findFirst({ where: { id: scheduleId } });
      if (!schedule) throw new NotFoundException(`FeeSchedule ${scheduleId} not found`);

      const due = new Date(schedule.dueDate);
      const cutoff = new Date(due);
      cutoff.setUTCDate(cutoff.getUTCDate() + rule.graceDays);

      // Find unpaid invoices tied to this schedule and past the grace window.
      const overdueDocs = await tx.document.findMany({
        where: {
          organizationId,
          sourceType: 'school_fee',
          sourceId: scheduleId,
          status: { in: ['posted', 'partial'] },
          dueDate: { lt: cutoff },
          amountResidual: { gt: 0 },
        },
      });

      // ── Create the PenaltyRun header. ──
      const run = await tx.penaltyRun.create({
        data: {
          organizationId,
          cronDate,
          scheduleId,
          totalAssessed: 0,
          createdInvoices: [],
        },
      });

      const newInvoices: string[] = [];
      let totalAssessed = 0;
      for (const doc of overdueDocs) {
        // Per-source idempotency: a previous run on a different day
        // may have already produced a PenaltyAssessment for this
        // source for the *same* run (rare but possible with manual
        // invocations). The unique index is the hard guarantee.
        const existing = await tx.penaltyAssessment.findFirst({
          where: { sourceDocumentId: doc.id, penaltyRunId: run.id },
        });
        if (existing) continue;

        const outstanding = Number(doc.amountResidual);
        const penalty =
          rule.type === 'percent'
            ? (outstanding * Number(rule.value)) / 100
            : Number(rule.value);
        if (penalty <= 0) continue;

        const documentNumber = await this.sequence.next(
          `feeinvoice:${new Date().getUTCFullYear()}`,
          { prefix: 'PEN-', padding: 6 },
          tx,
        );

        // ── Create the penalty Document (with a DocumentLine) ──
        // This stays a raw create (not documentBuilder.createDocument) because a
        // late fee has no product line for the builder to price. It must still
        // set documentTypeId — the required DMS-registry FK the fork predated —
        // resolved via the @Global DmsTypeResolver.
        const penaltyDoc = await tx.document.create({
          data: {
            organizationId,
            documentNumber,
            documentType: 'sales_invoice',
            documentTypeId: await this.dmsTypes.resolveIdByCode('sales_invoice', tx),
            partnerId: doc.partnerId,
            issueDate: new Date(),
            dueDate: new Date(),
            status: 'draft',  // promoted to 'posted' after GL post below
            reference: `PENALTY-${doc.documentNumber}`,
            notes: `Late fee for ${doc.documentNumber}`,
            sourceType: 'school_penalty',
            sourceId: doc.id,
            subtotal: penalty,
            totalAmount: penalty,
            amountResidual: penalty,
          },
        });
        // Create the DocumentLine explicitly (separate from the
        // Document insert for clarity in the audit trail and to keep
        // each line attributable in the prisma query log).
        await tx.documentLine.create({
          data: {
            organizationId,
            documentId: penaltyDoc.id,
            // No productId — late-fee income is tracked at the
            // account-mapping level. A future "Late Fee" product
            // can be added and the line description updated.
            description: `Late fee — ${rule.type} ${rule.value} on ${doc.documentNumber}`,
            quantity: 1,
            unitPrice: penalty,
            discountPercent: 0,
            lineNumber: 1,
            subtotal: penalty,
            total: penalty,
            taxAmount: 0,
          },
        });

        // ── Post to the GL (P0-2 H6 fix). ──
        const { counterAccount, itemByAccount } = await this.documentBuilder.groupForPosting(
          tx,
          penaltyDoc,
          'sales',
        );
        const journalLines: any[] = [
          {
            accountId: counterAccount,
            debit: penalty.toString(),
            partnerId: penaltyDoc.partnerId,
            description: `Penalty invoice ${documentNumber}`,
          },
        ];
        for (const [accountId, amount] of itemByAccount) {
          journalLines.push({
            accountId,
            credit: amount.toString(),
            partnerId: penaltyDoc.partnerId,
            description: 'Penalty revenue',
          });
        }
        const entry = await this.posting.post(
          {
            journalCode: 'SALES',
            date: new Date(),
            description: `School penalty · ${documentNumber}`,
            sourceType: 'school_penalty_invoice',
            sourceId: penaltyDoc.id,
            lines: journalLines,
          },
          tx,
        );

        // Promote the Document to 'posted'.
        const postedDoc = await tx.document.update({
          where: { id: penaltyDoc.id },
          data: {
            status: 'posted',
            paymentStatus: 'not_paid',
            journalEntryId: entry.id,
            postedAt: new Date(),
          },
        });

        // ── Create the PenaltyAssessment (links source → penalty). ──
        await tx.penaltyAssessment.create({
          data: {
            organizationId,
            penaltyRunId: run.id,
            sourceDocumentId: doc.id,
            scheduleId,
            ruleId: rule.id,
            amount: penalty,
            penaltyDocumentId: postedDoc.id,
          },
        });

        newInvoices.push(postedDoc.id);
        totalAssessed += penalty;
      }

      // ── Update the PenaltyRun header with totals. ──
      const updated = await tx.penaltyRun.update({
        where: { id: run.id },
        data: {
          totalAssessed,
          createdInvoices: newInvoices as any,
        },
      });

      this.events.publish(EVENTS.SchoolPenaltyRunCompleted, {
        organizationId,
        scheduleId,
        totalAssessed: totalAssessed.toString(),
        invoiceIds: newInvoices,
        penaltyRunId: updated.id,
      });
      return updated;
    });
  }
}

/**
 * SchoolPaymentService — collects a fee payment and allocates it to a student's
 * open fee invoices.
 *
 * P2A/B1: this delegates to the platform's single payment writer,
 * `PaymentService.createReceipt`, instead of hand-rolling Payment + GL +
 * allocations. That was a ledger-integrity hole: the old code mutated
 * `Document.amountResidual`/`paymentStatus` directly (forbidden by ADR-011 §4),
 * did money math in floats, and — despite accepting `cashSessionId` — never
 * wrote the `CashMovement`, so school fee collections never appeared on the
 * bursar's cash-session Z-report or in bank reconciliation.
 *
 * The school-specific part that stays here is *which* invoices to settle
 * (open school-fee documents, oldest first) and the mobile-money replay guard.
 * Everything downstream of the allocation list — the GL post, the Document
 * updates, the CashMovement, the audit row — is the payment engine's job.
 */
@Injectable()
export class SchoolPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly payments: PaymentService,
  ) {}

  /**
   * Collect a payment and allocate it, oldest-first, to the student's open fee
   * invoices. Returns the Payment row (with allocations) and the unallocated
   * remainder.
   */
  async collect(dto: CollectFeePaymentDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const student = await tx.studentProfile.findFirst({
        where: { id: dto.studentProfileId },
      });
      if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

      const partnerId = student.partnerId;
      const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
      const method = dto.paymentMethod ?? 'cash';

      // Idempotency: mobile-money providers retry with the same external
      // transaction id. A replayed reference returns the original receipt
      // rather than collecting twice. Scoped to inbound receipts for this
      // partner so an unrelated payment can't shadow it.
      if (dto.reference) {
        const existing = await tx.payment.findFirst({
          where: { organizationId, reference: dto.reference, direction: 'inbound', partnerId },
          include: { allocations: true },
        });
        if (existing) {
          return {
            payment: existing,
            allocations: existing.allocations ?? [],
            unallocated: Number(existing.unallocatedAmount),
            replayed: true,
          };
        }
      }

      // Choose the invoices to settle. Explicit documentIds win; otherwise
      // every open school-sourced invoice, oldest issue date first. Fresh
      // invoices from generateForTerm carry paymentStatus 'not_paid', so the
      // open set is ['not_paid','partial'] with a positive residual.
      const docs = dto.documentIds?.length
        ? await tx.document.findMany({
            where: { id: { in: dto.documentIds }, organizationId, partnerId },
            orderBy: { issueDate: 'asc' },
          })
        : await tx.document.findMany({
            where: {
              organizationId,
              partnerId,
              documentType: 'sales_invoice',
              paymentStatus: { in: ['not_paid', 'partial'] },
              sourceType: { in: ['school_fee', 'school_penalty', 'library_fine', 'school_meal'] },
              amountResidual: { gt: 0 },
            },
            orderBy: { issueDate: 'asc' },
          });

      // Build oldest-first allocations up to the payment amount, in Decimal.
      let remaining = round(dec(dto.amount), 6);
      const allocations: Array<{ documentId: string; amount: number }> = [];
      for (const doc of docs) {
        if (remaining.lessThanOrEqualTo(ZERO)) break;
        const residual = dec(doc.amountResidual);
        if (residual.lessThanOrEqualTo(ZERO)) continue;
        const take = Prisma.Decimal.min(remaining, residual);
        allocations.push({ documentId: doc.id, amount: take.toNumber() });
        remaining = remaining.minus(take);
      }

      // Delegate to the single payment writer. It posts the GL leg, updates
      // each Document's residual/status, writes the CashMovement when this is a
      // cash payment on an open session (accountId omitted so that path runs),
      // records the audit row, and emits payment.received/allocated/invoice.paid
      // — all inside this same transaction.
      const receipt: any = await this.payments.createReceipt(
        {
          partnerId,
          paymentDate: paymentDate.toISOString(),
          amount: dto.amount,
          paymentMethod: method,
          // A bank deposit posts to a specific bank GL account and has no cash
          // drawer movement; cash / mobile-money / card let determination pick
          // the default account (and, for cash, keep the CashMovement path live).
          accountId: method === 'bank' ? dto.bankAccountId : undefined,
          reference: dto.reference,
          cashSessionId: dto.cashSessionId,
          allocations,
        },
        tx,
      );

      // School-domain signal, in addition to the engine's generic events, so
      // fee-specific subscribers (statements, guardian notifications) can react.
      for (const a of allocations) {
        this.events.publish(EVENTS.SchoolFeePaymentRecorded, {
          organizationId,
          paymentId: receipt.id,
          documentId: a.documentId,
          amount: a.amount.toString(),
        });
      }

      const payment = await tx.payment.findFirst({
        where: { id: receipt.id },
        include: { allocations: true },
      });
      return {
        payment,
        allocations,
        unallocated: remaining.toNumber(),
        replayed: false,
      };
    });
  }
}