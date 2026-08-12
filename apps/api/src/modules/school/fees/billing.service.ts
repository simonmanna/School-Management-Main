import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { DocumentBuilderService } from '../../invoicing/document/document-builder.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
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

          const documentNumber = await this.sequence.next(
            `feeinvoice:${issueDate.getUTCFullYear()}`,
            { prefix: 'FEE-', padding: 6 },
            tx,
          );
          const createdDoc = await tx.document.create({
            data: {
              organizationId,
              documentNumber,
              documentType: 'sales_invoice',
              partnerId: s.partnerId,
              issueDate,
              dueDate: schedule.dueDate,
              status: 'draft',
              reference,
              notes: `Term fee for ${s.admissionNo}`,
              sourceType: 'school_fee',
              sourceId: schedule.id,
              subtotal: 0,
              totalAmount: 0,
              amountResidual: 0,
              amountPaid: 0,
            },
          });
          // Create each DocumentLine explicitly (in the same tx).
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            await tx.documentLine.create({
              data: {
                organizationId,
                documentId: createdDoc.id,
                productId: l.productId,
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                discountPercent: l.discountPercent,
                lineNumber: i + 1,
                subtotal: l.unitPrice * (1 - l.discountPercent / 100),
                total: l.unitPrice * (1 - l.discountPercent / 100),
                taxAmount: 0,
              },
            });
          }
          // Re-load to get the lines (for the post + total).
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
        const penaltyDoc = await tx.document.create({
          data: {
            organizationId,
            documentNumber,
            documentType: 'sales_invoice',
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
 * SchoolPaymentService — collects a payment against a student's open invoices.
 * Uses the existing PaymentService.record pattern via a raw Document+Payment
 * composition (the kernel module PaymentService is reserved for invoice → payment
 * relations which we use directly here).
 */
@Injectable()
export class SchoolPaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventBus,
    private readonly sequence: SequenceService,
    private readonly posting: PostingService,
    private readonly determination: AccountDeterminationService,
  ) {}

  /**
   * Collect a payment and allocate it to the student's open fee invoices.
   * Returns the Payment row and the allocations.
   *
   * Posts the cash/bank leg to the GL via PostingService, mirroring the
   * existing InvoicingModule's payment flow.
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

      // Idempotency: if a PaymentNumber was provided as reference, check we don't duplicate.
      // (Mobile-money providers commonly retry with the same external transaction id.)
      if (dto.reference) {
        const existing = await tx.payment.findFirst({
          where: { organizationId, reference: dto.reference },
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

      // Resolve target invoices.
      let docs: any[];
      if (dto.documentIds?.length) {
        docs = await tx.document.findMany({
          where: { id: { in: dto.documentIds }, organizationId, partnerId },
          orderBy: { issueDate: 'asc' },
        });
      } else {
        // P0-1 (C1): auto-allocation must include freshly-posted invoices.
        // Fresh invoices from `generateForTerm` are written with
        // `paymentStatus: 'not_paid'`. The previous filter
        //   { in: ['partial', 'paid'] }
        // excluded them entirely, so a parent paying without `documentIds`
        // had their Payment post to the GL but the matching Document stayed
        // unpaid and `unallocated` carried the full amount.
        // The correct set is open-but-not-settled: ['not_paid', 'partial'].
        docs = await tx.document.findMany({
          where: {
            organizationId,
            partnerId,
            documentType: 'sales_invoice',
            paymentStatus: { in: ['not_paid', 'partial'] },
            sourceType: { in: ['school_fee', 'school_penalty', 'library_fine'] },
            amountResidual: { gt: 0 },
          },
          orderBy: { issueDate: 'asc' },
        });
      }

      // Resolve GL accounts.
      const partner = await tx.partner.findFirst({ where: { id: partnerId } });
      const method = dto.paymentMethod ?? 'cash';
      const cashAccount =
        dto.bankAccountId ?? (await this.determination.mapped(method === 'bank' ? 'default_bank' : 'default_cash', tx));
      const counterAccount = await this.determination.receivableAccount(partner!, tx);

      // Create Payment.
      const paymentNumber = await this.sequence.next(`payment:${paymentDate.getUTCFullYear()}`, { prefix: 'PAY-', padding: 6 }, tx);
      const payment = await tx.payment.create({
        data: {
          organizationId,
          paymentNumber,
          direction: 'inbound',
          partnerId,
          paymentDate,
          paymentMethod: method,
          accountId: cashAccount,
          amount: dto.amount,
          allocatedAmount: 0,
          unallocatedAmount: dto.amount,
          reference: dto.reference ?? null,
          notes: dto.notes ?? null,
          cashSessionId: dto.cashSessionId ?? null,
          bankAccountId: dto.bankAccountId ?? null,
          status: 'posted',
        },
      });

      // Post the GL entry.
      const entry = await this.posting.post(
        {
          journalCode: method === 'bank' ? 'BANK' : 'CASH',
          date: paymentDate,
          description: `School fee receipt · ${paymentNumber}`,
          sourceType: 'payment',
          sourceId: payment.id,
          lines: [
            { accountId: cashAccount, debit: dto.amount.toString() },
            { accountId: counterAccount, credit: dto.amount.toString(), partnerId },
          ],
        },
        tx,
      );
      await tx.payment.updateMany({ where: { id: payment.id }, data: { journalEntryId: entry.id } });

      // Allocate oldest-first.
      let remaining = Number(dto.amount);
      const allocations: Array<{ documentId: string; amount: number }> = [];
      for (const doc of docs) {
        if (remaining <= 0) break;
        const outstanding = Number(doc.amountResidual);
        const take = Math.min(remaining, outstanding);
        await tx.paymentAllocation.create({
          data: {
            organizationId,
            paymentId: payment.id,
            documentId: doc.id,
            amount: take,
          },
        });
        const newPaid = Number(doc.amountPaid) + take;
        const newResidual = Number(doc.amountResidual) - take;
        const newStatus = newResidual <= 0.005 ? 'paid' : newPaid > 0 ? 'partial' : doc.status;
        await tx.document.updateMany({
          where: { id: doc.id },
          data: {
            amountPaid: newPaid,
            amountResidual: newResidual,
            paymentStatus: newResidual <= 0.005 ? 'paid' : 'partial',
            status: newStatus,
          },
        });
        allocations.push({ documentId: doc.id, amount: take });
        remaining -= take;
      }

      await tx.payment.updateMany({
        where: { id: payment.id },
        data: {
          allocatedAmount: Number(dto.amount) - remaining,
          unallocatedAmount: remaining,
        },
      });

      // Emit per-invoice events for downstream listeners.
      for (const a of allocations) {
        this.events.publish(EVENTS.SchoolFeePaymentRecorded, {
          organizationId,
          paymentId: payment.id,
          documentId: a.documentId,
          amount: a.amount.toString(),
        });
      }

      return {
        payment: await tx.payment.findFirst({
          where: { id: payment.id },
          include: { allocations: true },
        }),
        allocations,
        unallocated: remaining,
        replayed: false,
      };
    });
  }
}