import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { dec, round, ZERO } from '../../../kernel/common/money';
import { OPEN_FEE_WHERE, POSTED_FEE_WHERE } from './fee-document.constants';
import { DocumentBuilderService } from '../../invoicing/document/document-builder.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import { PaymentService } from '../../invoicing/payment/payment.service';
// DmsTypeResolver comes from the @Global DocumentsModule, which documents its
// vertical injectors (invoicing, recurring, rental, school) explicitly — no
// module import edge is required.
import { DmsTypeResolver } from '../../documents/dms-type-resolver.service';
import { EVENTS } from '@erp/shared';
import { SchoolFinanceQueryService } from './school-finance-query.service';
import { FinanceControlsService } from './finance-controls.service';
import type { CollectFeePaymentDto, FeeComponent, GenerateBillingDto, RefundFeeDto } from './dto.types';

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
    private readonly controls: FinanceControlsService,
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

    // A4.1: no fee posting into a financially-closed term.
    await this.controls.assertTermOpen(dto.termId);

    const studentWhere: any = { status: 'active' };
    if (dto.classId) studentWhere.currentClassId = dto.classId;
    const students = await this.prisma.client.studentProfile.findMany({
      where: studentWhere,
      include: { currentClass: { include: { gradeLevel: true } } },
    });
    if (students.length === 0) throw new BadRequestException('No active students found for billing');

    const schedules = await this.prisma.client.feeSchedule.findMany({
      where: { termId: dto.termId },
      include: { feeStructure: true },
    });
    if (schedules.length === 0) throw new BadRequestException(`No fee schedule configured for term ${dto.termId}`);

    // A3 perf: batch the per-student lookups that the old loop issued one query
    // at a time. One assignment query, one scholarship query, one discount
    // query for the whole run instead of O(students × 3) round-trips (P1-9).
    const studentIds = students.map((s) => s.id);
    const now = new Date();
    const [assignments, scholarships, discounts, optionalFees] = await Promise.all([
      this.prisma.client.studentFeeAssignment.findMany({
        where: { organizationId, termId: dto.termId, studentProfileId: { in: studentIds } },
      }),
      this.prisma.client.scholarship.findMany({
        where: {
          organizationId,
          studentProfileId: { in: studentIds },
          isActive: true,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
      }),
      this.prisma.client.discount.findMany({ where: { organizationId, isActive: true } }),
      // P3: the per-student opt-ins that make an OPTIONAL component billable.
      this.prisma.client.studentOptionalFee.findMany({
        where: { organizationId, termId: dto.termId, isActive: true, studentProfileId: { in: studentIds } },
        include: { feeCategory: true },
      }),
    ]);
    const assignByStudent = new Map<string, any>(assignments.map((a) => [a.studentProfileId, a]));
    const optInsByStudent = this.groupOptIns(optionalFees);
    const scholarshipsByStudent = new Map<string, any[]>();
    for (const sc of scholarships) {
      const arr = scholarshipsByStudent.get(sc.studentProfileId) ?? [];
      arr.push(sc);
      scholarshipsByStudent.set(sc.studentProfileId, arr);
    }

    const created: any[] = [];
    const skipped: any[] = [];
    const failed: any[] = [];

    for (const s of students) {
      const schedule = schedules.find((sch) =>
        this.appliesTo(sch.feeStructure.applicableTo as any, s.currentClassId ?? ''),
      );
      if (!schedule) continue;

      const feeStructure = schedule.feeStructure;
      const components = (feeStructure.components as unknown as FeeComponent[]) ?? [];
      const customDiscount = (assignByStudent.get(s.id)?.customDiscount ?? {}) as Record<string, number>;
      const studentScholarships = scholarshipsByStudent.get(s.id) ?? [];

      const lines = this.computeLines(
        components,
        customDiscount,
        discounts,
        studentScholarships,
        s,
        optInsByStudent.get(s.id) ?? new Map(),
      );
      if (lines.length === 0) continue;

      const issueDate = new Date();
      const reference = `TERM-${dto.termId}`;

      try {
        const result = await this.billStudentTransaction(s, schedule, feeStructure, dto, lines, issueDate, reference);

        if ((result as any)._skipped) {
          skipped.push({ studentProfileId: s.id, documentId: (result as any).documentId, reason: 'already_billed' });
          continue;
        }

        const doc = (result as any).doc;
        created.push(doc);
        this.events.publish(EVENTS.SchoolFeeInvoicePosted, {
          organizationId,
          documentId: doc.id,
          schoolFeeInvoiceId: (result as any).sfi.id,
          studentProfileId: s.id,
          amount: doc.totalAmount.toString(),
        });
      } catch (err: any) {
        // P0-6 / A3: a concurrent insert of the same (org, sourceType, sourceId,
        // reference) or the SchoolFeeInvoice business key raises P2002 — treat
        // as already-billed. Any other error is recorded per-student rather than
        // aborting the whole run.
        if (err?.code === 'P2002') {
          const existing = await this.prisma.client.document.findFirst({
            where: { organizationId, partnerId: s.partnerId, sourceType: 'school_fee', sourceId: schedule.id, reference },
          });
          if (existing) {
            skipped.push({ studentProfileId: s.id, documentId: existing.id, reason: 'already_billed' });
            continue;
          }
        }
        failed.push({ studentProfileId: s.id, error: err?.message ?? String(err) });
      }
    }

    return { count: created.length, documents: created, skipped, failed };
  }

  /**
   * A3.1 canonical line calculation. Deterministic precedence:
   *   base (component amount, or per-student override)
   *     → percentage discounts + percentage scholarships (per line)
   *     → fixed discounts (per matching line)
   *     → fixed scholarships (distributed PRO-RATA across lines by base)
   *
   * The pro-rata distribution is the P1-5 fix: the old loop added the FULL fixed
   * scholarship value to every line, so a 100k scholarship against a 5-component
   * structure discounted 500k. A fixed award is now split once across the lines.
   */
  private computeLines(
    components: FeeComponent[],
    customDiscount: Record<string, number>,
    discounts: any[],
    scholarships: any[],
    student: any,
    optIns: Map<string, number | null> = new Map(),
  ): Array<{ productId?: string; description: string; quantity: number; unitPrice: number; discountPercent: number }> {
    const classId = student.currentClassId ?? '';
    const gradeLevelId = student.currentClass?.gradeLevelId ?? '';

    // P3 — the optional-fee gate. A MANDATORY component bills every student in
    // the structure's scope; an OPTIONAL one only bills a student who has a
    // StudentOptionalFee opt-in for this term. Before this, `isOptional` was
    // stored on the component and then ignored, so a Swimming fee configured as
    // optional was invoiced to the entire school.
    const billable = components.filter((c) => !c.isOptional || this.hasOptIn(optIns, c));
    if (billable.length === 0) return [];

    const bases = billable.map((c) => {
      // Precedence for the unit price: per-student opt-in amount (only an
      // optional fee has one) → per-student assignment override → the
      // structure's component amount.
      const optIn = c.isOptional ? this.optInAmount(optIns, c) : null;
      if (optIn != null) return Number(optIn);
      const override = customDiscount[c.code];
      return override != null ? Number(override) : Number(c.amount);
    });
    const baseTotal = bases.reduce((s, b) => s + b, 0);

    // Fixed scholarship pool, distributed pro-rata by base.
    const fixedScholarshipPool = scholarships
      .filter((sc) => sc.type === 'fixed')
      .reduce((s, sc) => s + Number(sc.value), 0);
    const percentScholarship = scholarships
      .filter((sc) => sc.type === 'percent')
      .reduce((s, sc) => s + Number(sc.value), 0);

    return billable.map((c, i) => {
      const base = bases[i];
      // The invoice line reads as the fee's name ("Swimming"), not its code.
      const description = c.name?.trim() || c.code;
      if (base <= 0) {
        return { productId: c.productId, description, quantity: 1, unitPrice: base, discountPercent: 0 };
      }

      // Matching discounts for this component.
      let percentDiscount = 0;
      let fixedDiscount = 0;
      for (const d of discounts) {
        if (!this.discountApplies(d.appliesTo, classId, gradeLevelId, c.code)) continue;
        if (d.type === 'percentage') percentDiscount += Number(d.value);
        else fixedDiscount += Number(d.value); // fixed_amount
      }

      const proRataFixedScholarship = baseTotal > 0 ? (fixedScholarshipPool * base) / baseTotal : 0;
      const lineDiscountAmount =
        (base * (percentDiscount + percentScholarship)) / 100 + fixedDiscount + proRataFixedScholarship;
      const cappedDiscount = Math.min(lineDiscountAmount, base);
      const discountPercent = (cappedDiscount / base) * 100;

      return { productId: c.productId, description, quantity: 1, unitPrice: base, discountPercent };
    });
  }

  /**
   * Index opt-in rows by BOTH the category id and the (upper-cased) category
   * code. Structures written before P3 carry only a `code`, and structures
   * written after carry a `feeCategoryId`; matching on either means an existing
   * structure keeps working without a data migration.
   */
  private groupOptIns(rows: any[]): Map<string, Map<string, number | null>> {
    const byStudent = new Map<string, Map<string, number | null>>();
    for (const r of rows) {
      let m = byStudent.get(r.studentProfileId);
      if (!m) {
        m = new Map<string, number | null>();
        byStudent.set(r.studentProfileId, m);
      }
      const amount = r.amount == null ? null : Number(r.amount);
      m.set(r.feeCategoryId, amount);
      if (r.feeCategory?.code) m.set(r.feeCategory.code.toUpperCase(), amount);
    }
    return byStudent;
  }

  private hasOptIn(optIns: Map<string, number | null>, c: FeeComponent): boolean {
    if (c.feeCategoryId && optIns.has(c.feeCategoryId)) return true;
    return !!c.code && optIns.has(c.code.toUpperCase());
  }

  /** The student's overriding amount for an optional component, or null. */
  private optInAmount(optIns: Map<string, number | null>, c: FeeComponent): number | null {
    const byId = c.feeCategoryId ? optIns.get(c.feeCategoryId) : undefined;
    if (byId != null) return byId;
    const byCode = c.code ? optIns.get(c.code.toUpperCase()) : undefined;
    return byCode ?? null;
  }


  /**
   * Bill ONE student for a term (Phase 1.5 worker entry point). Resolves the
   * applicable schedule + this student's discounts/scholarships, then runs the
   * same atomic transaction the bulk path uses. Returns a per-item outcome the
   * BillingRun worker records; never throws for the "already billed" case.
   */
  async billSingleStudent(
    studentProfileId: string,
    termId: string,
  ): Promise<{ status: 'posted' | 'skipped'; documentId?: string; schoolFeeInvoiceId?: string; amount?: string }> {
    const organizationId = this.tenant.organizationId;
    const s = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId, status: 'active' },
      include: { currentClass: { include: { gradeLevel: true } } },
    });
    if (!s) return { status: 'skipped' };

    const schedules = await this.prisma.client.feeSchedule.findMany({
      where: { termId },
      include: { feeStructure: true },
    });
    const schedule = schedules.find((sch) =>
      this.appliesTo(sch.feeStructure.applicableTo as any, s.currentClassId ?? ''),
    );
    if (!schedule) return { status: 'skipped' };

    const feeStructure = schedule.feeStructure;
    const components = (feeStructure.components as unknown as FeeComponent[]) ?? [];
    const [assignment, studentScholarships, discounts, optionalFees] = await Promise.all([
      this.prisma.client.studentFeeAssignment.findFirst({ where: { organizationId, termId, studentProfileId } }),
      this.prisma.client.scholarship.findMany({
        where: {
          organizationId, studentProfileId, isActive: true,
          validFrom: { lte: new Date() },
          OR: [{ validTo: null }, { validTo: { gte: new Date() } }],
        },
      }),
      this.prisma.client.discount.findMany({ where: { organizationId, isActive: true } }),
      this.prisma.client.studentOptionalFee.findMany({
        where: { organizationId, termId, studentProfileId, isActive: true },
        include: { feeCategory: true },
      }),
    ]);
    const customDiscount = (assignment?.customDiscount ?? {}) as Record<string, number>;
    const optIns = this.groupOptIns(optionalFees).get(studentProfileId) ?? new Map<string, number | null>();
    const lines = this.computeLines(components, customDiscount, discounts, studentScholarships, s, optIns);
    if (lines.length === 0) return { status: 'skipped' };

    const issueDate = new Date();
    const reference = `TERM-${termId}`;
    try {
      const result = await this.billStudentTransaction(s, schedule, feeStructure, { termId } as GenerateBillingDto, lines, issueDate, reference);
      if ((result as any)._skipped) return { status: 'skipped', documentId: (result as any).documentId };
      const doc = (result as any).doc;
      this.events.publish(EVENTS.SchoolFeeInvoicePosted, {
        organizationId, documentId: doc.id, schoolFeeInvoiceId: (result as any).sfi.id,
        studentProfileId, amount: doc.totalAmount.toString(),
      });
      return { status: 'posted', documentId: doc.id, schoolFeeInvoiceId: (result as any).sfi.id, amount: doc.totalAmount.toString() };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const existing = await this.prisma.client.document.findFirst({
          where: { organizationId, partnerId: s.partnerId, sourceType: 'school_fee', sourceId: schedule.id, reference },
        });
        if (existing) return { status: 'skipped', documentId: existing.id };
      }
      throw err;
    }
  }

  /**
   * A3: one student's billing as a single atomic transaction. Extracted so the
   * synchronous bulk run (generateForTerm) and the resumable per-item worker
   * (BillingRunService) share the exact same commit unit.
   */
  private billStudentTransaction(
    s: any,
    schedule: any,
    feeStructure: any,
    dto: GenerateBillingDto,
    lines: Array<{ productId?: string; description: string; quantity: number; unitPrice: number; discountPercent: number }>,
    issueDate: Date,
    reference: string,
  ): Promise<any> {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
          const existing = await tx.document.findFirst({
            where: { organizationId, partnerId: s.partnerId, sourceType: 'school_fee', sourceId: schedule.id, reference },
          });
          if (existing) return { _skipped: true, documentId: existing.id };

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
            lines,
          );
          await tx.document.update({ where: { id: createdDoc.id }, data: { sourceId: schedule.id } });

          const full = await tx.document.findFirst({
            where: { id: createdDoc.id },
            include: { lines: true, partner: true },
          });

          // A3 / P0-5: post the builder's OWN totals. The old code overwrote
          // totalAmount with subtotal (dropping tax) while crediting revenue AND
          // tax — an unbalanced entry that PostingService rejected, killing the
          // run mid-way on any taxable fee. We now debit AR by totalAmount and
          // let the tax legs balance it.
          const { counterAccount, itemByAccount, taxByAccount } = await this.documentBuilder.groupForPosting(
            tx,
            full,
            'sales',
          );
          const totalAmount = dec(full.totalAmount);
          const journalLines: any[] = [
            { accountId: counterAccount, debit: totalAmount.toString(), partnerId: full.partnerId, description: `Invoice ${full.documentNumber}` },
          ];
          for (const [accountId, amount] of itemByAccount) {
            journalLines.push({ accountId, credit: amount.toString(), partnerId: full.partnerId, description: 'Revenue' });
          }
          for (const [accountId, amount] of taxByAccount) {
            journalLines.push({ accountId, credit: amount.toString(), description: 'Output tax' });
          }

          const entry = await this.posting.post(
            {
              journalCode: 'SALES',
              date: issueDate,
              description: `School fee · ${full.documentNumber}`,
              sourceType: 'school_fee_invoice',
              sourceId: full.id,
              lines: journalLines,
            },
            tx,
          );

          const postedDoc = await tx.document.update({
            where: { id: full.id },
            data: { status: 'posted', paymentStatus: 'not_paid', journalEntryId: entry.id, postedAt: new Date() },
            include: { lines: true, partner: true },
          });

          // A1.1: the first-class school invoice, 1:1 with the Document. The
          // business-key unique index makes concurrent billing produce exactly
          // one per (student, term) — the database, not an app check, is the
          // guarantee (A3).
          const invoiceNumber = await this.sequence.next(
            `schoolfeeinvoice:${issueDate.getUTCFullYear()}`,
            { prefix: 'SFI-', padding: 6 },
            tx,
          );
          const sfi = await tx.schoolFeeInvoice.create({
            data: {
              organizationId,
              invoiceNumber,
              documentId: postedDoc.id,
              studentProfileId: s.id,
              academicYearId: feeStructure.academicYearId,
              termId: dto.termId,
              classId: s.currentClassId ?? null,
              sectionId: s.currentSectionId ?? null,
              status: 'issued',
              issueDate,
              dueDate: schedule.dueDate ? new Date(schedule.dueDate) : null,
            },
          });

          return { _skipped: false, doc: postedDoc, sfi };
    });
  }

  /** True when a Discount.appliesTo JSON filter matches this student + fee code. */
  private discountApplies(appliesTo: any, classId: string, gradeLevelId: string, feeCode: string): boolean {
    if (!appliesTo || typeof appliesTo !== 'object') return true;
    const classIds: string[] = Array.isArray(appliesTo.classIds) ? appliesTo.classIds : [];
    const gradeLevelIds: string[] = Array.isArray(appliesTo.gradeLevelIds) ? appliesTo.gradeLevelIds : [];
    const feeCodes: string[] = Array.isArray(appliesTo.feeCodes) ? appliesTo.feeCodes : [];
    if (classIds.length && !classIds.includes(classId)) return false;
    if (gradeLevelIds.length && !gradeLevelIds.includes(gradeLevelId)) return false;
    if (feeCodes.length && !feeCodes.includes(feeCode)) return false;
    return true;
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
    private readonly finance: SchoolFinanceQueryService,
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

      // Choose the invoices + amounts to settle.
      //  1. Explicit `allocations` (wizard Allocation step): use exactly these
      //     {documentId, amount} entries. Each amount is capped at that
      //     invoice's residual and validated; we touch ONLY these invoices.
      //  2. Explicit `documentIds` (convenience full-pay): settle each in full.
      //  3. Neither: open school-sourced invoices, oldest issue date first,
      //     auto-filled up to the tender (the legacy behaviour).
      let allocations: Array<{ documentId: string; amount: number }> = [];

      if (dto.allocations?.length) {
        const ids = dto.allocations.map((a) => a.documentId);
        // P0-7: constrain to financially-active documents. Passing the id of a
        // draft or cancelled invoice used to settle it — real money allocated
        // against a receivable that does not exist.
        const docsById = await tx.document.findMany({
          where: { ...POSTED_FEE_WHERE, id: { in: ids }, organizationId, partnerId },
        });
        const docMap = new Map<string, any>(docsById.map((d: any) => [d.id, d]));
        for (const a of dto.allocations) {
          const doc = docMap.get(a.documentId);
          if (!doc) continue;
          const residual = dec(doc.amountResidual);
          if (residual.lessThanOrEqualTo(ZERO)) continue;
          const want = round(dec(a.amount), 6);
          if (want.lessThanOrEqualTo(ZERO)) continue;
          const take = Prisma.Decimal.min(want, residual);
          allocations.push({ documentId: doc.id, amount: take.toNumber() });
        }
      } else {
        const docs = dto.documentIds?.length
          ? await tx.document.findMany({
              where: { ...POSTED_FEE_WHERE, id: { in: dto.documentIds }, organizationId, partnerId },
              orderBy: { issueDate: 'asc' },
            })
          : await tx.document.findMany({
              // P0-7: OPEN_FEE_WHERE adds the `status` predicate this query
              // never had. Without it the oldest-first auto-fill would happily
              // spend a parent's tender on a cancelled invoice.
              where: { ...OPEN_FEE_WHERE, organizationId, partnerId },
              orderBy: { issueDate: 'asc' },
            });

        // Build oldest-first allocations up to the payment amount, in Decimal.
        let remaining = round(dec(dto.amount), 6);
        for (const doc of docs) {
          if (remaining.lessThanOrEqualTo(ZERO)) break;
          const residual = dec(doc.amountResidual);
          if (residual.lessThanOrEqualTo(ZERO)) continue;
          const take = Prisma.Decimal.min(remaining, residual);
          allocations.push({ documentId: doc.id, amount: take.toNumber() });
          remaining = remaining.minus(take);
        }
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
      const allocatedTotal = allocations.reduce((s, a) => s + Number(a.amount), 0);
      const unallocatedAmt = Math.max(0, Number(dto.amount) - allocatedTotal);
      return {
        payment,
        allocations,
        unallocated: unallocatedAmt,
        replayed: false,
      };
    });
  }

  /**
   * Refund a fee payment back to a student's guardian.
   *
   * Reuses the platform's single payment writer via `createCustomerRefund`
   * (outbound with counterAccount='receivable'), so the GL leg is Dr Accounts
   * Receivable / Cr Cash|Bank — the exact mirror of a collection, never a
   * phantom payable.
   *
   * P0-6. The docstring here previously claimed "the engine's own validation
   * rejects a refund that would overdraw the partner's AR". That was false.
   * `PaymentService.createCustomerRefund` runs its overpayment guard only when
   * `counterType === 'payable'` (a vendor bill); a customer refund is outbound
   * against a *receivable*, so the guard was skipped by construction. Combined
   * with this method computing `overpaymentCredit` and then deliberately not
   * enforcing it, any student with zero entitlement could be refunded any
   * amount — real cash out of the drawer against nothing.
   *
   * Phase 0 applies a deliberately CONSERVATIVE cap: the GREATER of unallocated
   * inbound receipts and outstanding fee credits — never their SUM. Those two
   * can describe the same money: `createCredit` does not draw down
   * `Payment.unallocatedAmount`, so an overpayment converted into a credit is
   * represented on both sides at once (P1-3). Summing them would authorise
   * double the real entitlement.
   *
   * MAX rather than MIN because the two are not both populated in the ordinary
   * case. A plain overpayment leaves unallocated funds with no FeeCredit row at
   * all, and an adjustment-funded credit exists with nothing unallocated; MIN
   * would return zero for both and reject every legitimate refund. MAX equals
   * the true entitlement when the pots overlap, and understates it when they
   * are genuinely distinct — wrong in the safe direction.
   *
   * This is a floor, not the final rule. A2.1 replaces it with the canonical
   * `refundableAmount` (eligible payments − allocated − refunded − converted,
   * plus refundable credits) enforced inside the payment engine itself, where
   * every caller gets it rather than just this one.
   *
   * Idempotency: a replayed `reference` returns the original refund rather
   * than paying out twice (mobile-money reversal retries).
   */
  async refundFee(dto: RefundFeeDto) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.$transaction(async (tx: any) => {
      const student = await tx.studentProfile.findFirst({
        where: { id: dto.studentProfileId },
      });
      if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

      // Replay guard: a prior refund with the same reference returns as-is.
      if (dto.reference) {
        const existing = await tx.payment.findFirst({
          where: { organizationId, reference: dto.reference, direction: 'outbound', partnerId: student.partnerId },
          include: { allocations: true },
        });
        if (existing) {
          return { payment: existing, replayed: true };
        }
      }

      // A2.1: the canonical refundable entitlement, computed once in the query
      // service so every caller shares the same definition. It subtracts the
      // portion of an overpayment already converted into a FeeCredit
      // (entitlement uniqueness, P1-3) and adds refundable outstanding credits.
      const refundableNum = await this.finance.refundableAmount(student.partnerId, student.id);
      const refundable = round(dec(refundableNum), 6);
      const overpaymentCredit = refundableNum;

      const wanted = round(dec(dto.amount), 6);
      if (wanted.greaterThan(refundable)) {
        throw new BadRequestException(
          `Refund of ${wanted.toString()} exceeds this student's refundable entitlement of ` +
            `${refundable.toString()}. Record the overpayment or credit that funds this refund first.`,
        );
      }

      const refund: any = await this.payments.createCustomerRefund(
        {
          partnerId: student.partnerId,
          paymentDate: new Date().toISOString(),
          amount: dto.amount,
          paymentMethod: dto.paymentMethod,
          accountId: dto.paymentMethod === 'bank' ? dto.bankAccountId : undefined,
          reference: dto.reference,
          cashSessionId: dto.cashSessionId,
        },
        tx,
      );

      this.events.publish(EVENTS.SchoolFeeRefundRecorded, {
        organizationId,
        paymentId: refund.id,
        studentProfileId: student.id,
        amount: dto.amount.toString(),
        overpaymentCredit: overpaymentCredit.toString(),
      });

      return { payment: refund, replayed: false, overpaymentCredit };
    });
  }
}