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
import { AccountResolverService } from '../../accounting/posting/account-resolver.service';
import { PaymentService } from '../../invoicing/payment/payment.service';
// DmsTypeResolver comes from the @Global DocumentsModule, which documents its
// vertical injectors (invoicing, recurring, rental, school) explicitly — no
// module import edge is required.
import { DmsTypeResolver } from '../../documents/dms-type-resolver.service';
import { EVENTS } from '@erp/shared';
import { SchoolFinanceQueryService } from './school-finance-query.service';
import { FinanceControlsService } from './finance-controls.service';
import { PaymentAllocationReversalService } from './allocation-reversal.service';
import { AdvancedFinanceService } from './advanced.service';
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
   *  2. Database-level unique constraint on
   *     (organizationId, partnerId, sourceType, sourceId, reference)
   *     — one charge per STUDENT per schedule per term. If two
   *     concurrent bursars click "Generate" at the same instant, the
   *     second gets a P2002 unique-violation that we catch and treat
   *     as "already exists".
   *
   *     This comment previously described this constraint as existing.
   *     It did not: no migration created it, so layer 2 was fiction and
   *     layer 1 (a findFirst under READ COMMITTED) was the only guard —
   *     which two concurrent transactions both pass. Created by
   *     20260824120000_fees_integrity_constraints. `partnerId` is
   *     load-bearing: without it the key would permit only ONE invoice
   *     per schedule for the entire school.
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

    // D4: mid-term proration policy + the term's own dates, read once for the
    // whole run. Default 'none' — an existing school's billing is unchanged
    // until somebody deliberately turns proration on.
    const [prorationPolicy, term] = await Promise.all([
      this.prorationPolicy(),
      this.prisma.client.term.findFirst({
        where: { id: dto.termId, organizationId },
        select: { startDate: true, endDate: true },
      }),
    ]);

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

    // P1-A: load every published version's priced items ONCE, so pricing every
    // student from the immutable version costs one query for the whole run
    // rather than one per student.
    const versionIds = [...new Set(schedules.map((sch) => sch.feeStructure.currentVersionId).filter((v): v is string => !!v))];
    const itemsByVersion = new Map<string, FeeComponent[]>();
    if (versionIds.length) {
      const items = await this.prisma.client.feeItem.findMany({
        where: { feeStructureVersionId: { in: versionIds } },
      });
      for (const i of items) {
        const arr = itemsByVersion.get(i.feeStructureVersionId) ?? [];
        arr.push(this.itemToComponent(i));
        itemsByVersion.set(i.feeStructureVersionId, arr);
      }
    }

    const created: any[] = [];
    const skipped: any[] = [];
    const failed: any[] = [];

    for (const s of students) {
      const schedule = schedules.find((sch) =>
        this.appliesTo(sch.feeStructure.applicableTo as any, this.targetingAxes(s)),
      );
      if (!schedule) continue;

      const feeStructure = schedule.feeStructure;
      const priced = await this.pricedComponents(feeStructure as any, itemsByVersion);
      if (priced.components === null) {
        // P1-G: a structure that cannot be priced from an immutable version is
        // reported, never billed from its mutable JSON instead.
        skipped.push({ studentProfileId: s.id, reason: 'unpriceable_structure', detail: priced.reason });
        continue;
      }
      const components = priced.components;
      const customDiscount = (assignByStudent.get(s.id)?.customDiscount ?? {}) as Record<string, number>;
      const studentScholarships = scholarshipsByStudent.get(s.id) ?? [];

      const lines = this.computeLines(
        components,
        customDiscount,
        discounts,
        studentScholarships,
        s,
        optInsByStudent.get(s.id) ?? new Map(),
        this.prorationFactor(prorationPolicy, s.enrollmentDate, term),
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
   * P1-A · pricing provenance. Load the priced components an invoice must be
   * billed from: the immutable `FeeItem` rows of the structure's published
   * `FeeStructureVersion` — never the mutable `FeeStructure.components` JSON.
   *
   * Billing used to read that JSON directly, which meant editing a published
   * structure silently changed what the next run charged, with no version bump
   * and no provenance. `FeeStructureVersion` and `FeeItem` were written by
   * `catalog.publish()` and read by nothing at all.
   *
   * FINANCIAL_INVARIANTS §Pricing provenance:
   *     FeeStructure → published FeeStructureVersion → FeeItem → billing → DocumentLine
   *
   * Returns null when the structure cannot be priced immutably — an unpublished
   * structure, or a published one with no version. The caller records that as a
   * typed `skipped` reason rather than quietly falling back to mutable pricing
   * (P1-G): billing from a draft is exactly the failure this closes.
   */
  private async pricedComponents(
    feeStructure: { id: string; name: string; status: string; currentVersionId: string | null },
    itemsByVersion?: Map<string, FeeComponent[]>,
  ): Promise<{ components: FeeComponent[]; versionId: string } | { components: null; reason: string }> {
    if (feeStructure.status !== 'published') {
      return { components: null, reason: `fee structure "${feeStructure.name}" is ${feeStructure.status}, not published` };
    }
    if (!feeStructure.currentVersionId) {
      return {
        components: null,
        reason: `fee structure "${feeStructure.name}" has no published version — publish it before billing`,
      };
    }

    const cached = itemsByVersion?.get(feeStructure.currentVersionId);
    const items =
      cached ??
      (await this.prisma.client.feeItem.findMany({
        where: { feeStructureVersionId: feeStructure.currentVersionId },
      })).map((i) => this.itemToComponent(i));

    if (items.length === 0) {
      return { components: null, reason: `published version of "${feeStructure.name}" has no fee items` };
    }
    return { components: items, versionId: feeStructure.currentVersionId };
  }

  /** The org's proration policy. 'none' unless a school opts in. */
  private async prorationPolicy(): Promise<string> {
    // A school with no profile row yet still bills — proration is opt-in, so
    // the absence of configuration means "off", never an error.
    const profile = await this.prisma.client.schoolProfile
      ?.findFirst({
        where: { organizationId: this.tenant.organizationId },
        select: { customFields: true },
      })
      .catch(() => null);
    const raw = (profile?.customFields as any)?.feeProrationPolicy;
    return ['none', 'daily', 'weekly', 'monthly'].includes(raw) ? raw : 'none';
  }

  /**
   * D4 · mid-term joiner proration.
   *
   * A pupil admitted in week six was billed the full term. Schools handle this
   * differently and there is no single right answer, so the policy is
   * configurable on `SchoolProfile.customFields.feeProrationPolicy`:
   *
   *   'none'    bill the full term regardless of join date (the default, and
   *             what every existing school gets — behaviour is unchanged until
   *             somebody deliberately turns proration on)
   *   'monthly' charge whole months remaining ÷ whole months in the term, the
   *             most common Ugandan practice — a pupil joining any time in
   *             month two of a three-month term pays two thirds
   *   'weekly'  charge whole weeks remaining ÷ weeks in the term, for schools
   *             that bill more finely
   *   'daily'   exact days remaining ÷ days in the term
   *
   * Only MANDATORY, recurring components are prorated. A one-off charge —
   * admission fee, uniform, PLE registration — is not cheaper for joining late,
   * and prorating it would under-bill the school for a real cost it has already
   * incurred. Optional components are opt-in and priced by the opt-in itself.
   *
   * Returns 1 (no reduction) whenever proration is off, the pupil joined before
   * the term began, or the term dates are unusable — the safe direction is
   * always to bill in full and let a bursar issue a credit adjustment.
   */
  private prorationFactor(
    policy: string,
    enrollmentDate: Date | null | undefined,
    term: { startDate?: Date | null; endDate?: Date | null } | null | undefined,
  ): number {
    if (!policy || policy === 'none') return 1;
    if (!enrollmentDate || !term?.startDate || !term?.endDate) return 1;

    const start = new Date(term.startDate);
    const end = new Date(term.endDate);
    const joined = new Date(enrollmentDate);
    if (!(end > start)) return 1;
    // Joined before (or on) the first day — a full term, nothing to prorate.
    if (joined <= start) return 1;
    // Joined after the term ended: nothing of this term was attended. Bill
    // nothing rather than a negative, and let the next term's run charge them.
    if (joined >= end) return 0;

    const DAY = 86_400_000;
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY));
    const remainingDays = Math.max(0, Math.round((end.getTime() - joined.getTime()) / DAY));

    let factor: number;
    if (policy === 'daily') {
      factor = remainingDays / totalDays;
    } else if (policy === 'weekly') {
      factor = Math.ceil(remainingDays / 7) / Math.ceil(totalDays / 7);
    } else {
      // monthly — count calendar months so a term that straddles month
      // boundaries divides the way a head teacher would describe it.
      const monthsIn = Math.max(
        1,
        (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1,
      );
      const monthsLeft = Math.max(
        0,
        (end.getFullYear() - joined.getFullYear()) * 12 + (end.getMonth() - joined.getMonth()) + 1,
      );
      factor = Math.min(monthsIn, monthsLeft) / monthsIn;
    }
    // Never above 1, never negative; round to 4dp so the line price stays clean.
    return Number(Math.min(1, Math.max(0, factor)).toFixed(4));
  }

  /** A priced FeeItem, in the shape the line calculator already understands. */
  private itemToComponent(item: {
    code: string;
    name: string;
    productId: string | null;
    amount: unknown;
    isOptional: boolean;
    frequency?: string;
  }): FeeComponent {
    return {
      code: item.code,
      name: item.name,
      productId: item.productId ?? undefined,
      amount: Number(item.amount),
      isOptional: item.isOptional,
      // Load-bearing for proration: a one-off charge is never reduced (D4).
      frequency: item.frequency ?? 'per_term',
    };
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
    /**
     * D4: 1 = full term. Below 1, MANDATORY recurring components are reduced
     * for a pupil who joined mid-term. One-off charges are never prorated —
     * an admission fee is not cheaper for arriving in week six.
     */
    prorationFactor = 1,
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

    const prorate = (c: FeeComponent, amount: number) => {
      // Optional components are priced by the pupil's own opt-in, and one-off
      // charges are the same whenever you arrive.
      if (prorationFactor >= 1 || c.isOptional) return amount;
      const frequency = (c as any).frequency ?? 'per_term';
      if (frequency === 'one_time') return amount;
      return Math.round(amount * prorationFactor);
    };

    const bases = billable.map((c) => {
      // Precedence for the unit price: per-student opt-in amount (only an
      // optional fee has one) → per-student assignment override → the
      // structure's component amount.
      const optIn = c.isOptional ? this.optInAmount(optIns, c) : null;
      if (optIn != null) return Number(optIn);
      const override = customDiscount[c.code];
      // A per-pupil override is a deliberate price for THIS pupil, so it is
      // prorated too — the bursar set what a full term costs them.
      return prorate(c, override != null ? Number(override) : Number(c.amount));
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
  ): Promise<{
    status: 'posted' | 'skipped';
    documentId?: string;
    schoolFeeInvoiceId?: string;
    amount?: string;
    /** Why the student was skipped — e.g. a structure with no published version (P1-G). */
    reason?: string;
  }> {
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
      this.appliesTo(sch.feeStructure.applicableTo as any, this.targetingAxes(s)),
    );
    if (!schedule) return { status: 'skipped' };

    const feeStructure = schedule.feeStructure;
    // P1-A: priced from the immutable published version, same as the bulk run.
    const priced = await this.pricedComponents(feeStructure as any);
    if (priced.components === null) return { status: 'skipped', reason: priced.reason };
    const components = priced.components;
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
    const [prorationPolicy, term] = await Promise.all([
      this.prorationPolicy(),
      this.prisma.client.term.findFirst({ where: { id: termId, organizationId }, select: { startDate: true, endDate: true } }),
    ]);
    const lines = this.computeLines(
      components,
      customDiscount,
      discounts,
      studentScholarships,
      s,
      optIns,
      this.prorationFactor(prorationPolicy, s.enrollmentDate, term),
    );
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
              // P0-A: the pricing version this invoice was billed from. Without
              // it the business-key unique index above is INERT — Postgres
              // treats NULLs as distinct, so every row's key was unique by
              // virtue of being unknown and concurrent runs could both insert.
              feeStructureVersionId: feeStructure.currentVersionId ?? null,
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

  /**
   * D2 · which pupils a fee structure applies to.
   *
   * `FeeStructure.applicableTo` is documented in the schema as
   * `{gradeLevelIds:[...], classIds:[...]}`, and `discountApplies` above has
   * always honoured both. This did not: it checked `classIds` and returned
   * `true` for everything else, so a structure scoped to grade levels P1–P3
   * silently billed the ENTIRE school, P7 included.
   *
   * That matters in a Ugandan primary school specifically, because fees are
   * conventionally set per grade band rather than per class — expressing it by
   * grade level is the natural configuration, and it did the wrong thing.
   *
   * `residenceTypes` is new: boarding and day pupils pay materially different
   * fees, `StudentProfile.residenceType` already records which a pupil is, and
   * there was previously no way to price them apart.
   *
   * Every dimension is AND-ed, and an absent or empty dimension means "no
   * constraint on this axis" — so `{}` still applies to everyone, which is the
   * behaviour existing structures rely on.
   */
  private appliesTo(
    filter: any,
    student: { classId: string; gradeLevelId: string; residenceType: string },
  ): boolean {
    if (!filter || typeof filter !== 'object') return true;

    const classIds: string[] = Array.isArray(filter.classIds) ? filter.classIds : [];
    const gradeLevelIds: string[] = Array.isArray(filter.gradeLevelIds) ? filter.gradeLevelIds : [];
    const residenceTypes: string[] = Array.isArray(filter.residenceTypes) ? filter.residenceTypes : [];

    if (classIds.length && !classIds.includes(student.classId)) return false;
    if (gradeLevelIds.length && !gradeLevelIds.includes(student.gradeLevelId)) return false;
    if (residenceTypes.length && !residenceTypes.includes(student.residenceType)) return false;
    return true;
  }

  /** The axes `appliesTo` filters on, read off a student profile. */
  private targetingAxes(s: any): { classId: string; gradeLevelId: string; residenceType: string } {
    return {
      classId: s.currentClassId ?? '',
      gradeLevelId: s.currentClass?.gradeLevelId ?? '',
      residenceType: s.residenceType ?? 'day',
    };
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

      // P1-B: a penalty is a NEW CHARGE against the schedule's term (ADR-013),
      // so it must not post into a closed one. The gate lives here rather than
      // in the cron worker so a manually triggered run is covered too — and the
      // daily cron would otherwise keep assessing penalties against terms the
      // bursar had already closed and reconciled.
      await this.controls.assertTermOpen(schedule.termId);

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
    // Needed only by the credit-funded half of a refund (P0-C), which must
    // retire the Fee-Credit Liability the credit's creation raised.
    private readonly posting: PostingService,
    private readonly accounts: AccountDeterminationService,
    private readonly resolver: AccountResolverService,
    // P1-B: period control on every document a tender or refund touches.
    private readonly controls: FinanceControlsService,
    // P1-C: refunding an allocated payment composes an allocation reversal.
    private readonly reversals: PaymentAllocationReversalService,
    // B1: converting an overpayment to a fee credit, in the receipt's own tx.
    private readonly advanced: AdvancedFinanceService,
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
      // transaction id. A replayed key returns the original receipt rather than
      // collecting twice.
      //
      // P0-B: this keys on `externalReference`, NOT `reference`. The two were
      // one free-text column, which made the guard both too strict and too
      // loose — a bursar typing "CASH" on a second receipt was treated as a
      // replay, while the check itself was only an application `findFirst`
      // under READ COMMITTED, so two concurrent provider callbacks both passed
      // it. `externalReference` carries a database unique index
      // (organizationId, type, value, direction), so the race now fails at the
      // database and is caught below.
      if (dto.externalReference) {
        const existing = await tx.payment.findFirst({
          where: {
            organizationId,
            externalReference: dto.externalReference,
            externalReferenceType: dto.externalReferenceType ?? undefined,
            direction: 'inbound',
          },
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
      const allocations: Array<{ documentId: string; amount: number }> = [];

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

      // P1-B: every invoice this tender will settle must be in an OPEN term.
      // Checking only a requested termId would let a Term-2 payment settle a
      // Term-1 invoice after Term 1 closed (FINANCIAL_INVARIANTS §Period
      // control). Runs inside this transaction so it cannot race a close.
      await this.controls.assertDocumentsPeriodOpen(allocations.map((a) => a.documentId), tx);

      // Delegate to the single payment writer. It posts the GL leg, updates
      // each Document's residual/status, writes the CashMovement when this is a
      // cash payment on an open session (accountId omitted so that path runs),
      // records the audit row, and emits payment.received/allocated/invoice.paid
      // — all inside this same transaction.
      //
      // P0-B idempotency under CONCURRENCY: the application `findFirst` replay
      // guard above cannot catch two callbacks that race under READ COMMITTED —
      // both observe "no existing payment" and both reach createReceipt. The
      // database unique index on (org, externalReferenceType, externalReference,
      // direction) is the real guarantee: the second insert throws P2002. We
      // catch that and return the row the first transaction already committed,
      // so a retried MoMo callback gets an idempotent 200 (replayed: true)
      // instead of an unhandled 500. The GL/allocation work is re-verified by
      // the caller against the returned payment, so no double-posting occurs.
      let receipt: any;
      try {
        receipt = await this.payments.createReceipt(
          {
            partnerId,
            paymentDate: paymentDate.toISOString(),
            amount: dto.amount,
            paymentMethod: method,
            accountId: method === 'bank' ? dto.bankAccountId : undefined,
            reference: dto.reference,
            externalReference: dto.externalReference,
            externalReferenceType: dto.externalReferenceType,
            cashSessionId: dto.cashSessionId,
            allocations,
          },
          tx,
        );
      } catch (err: any) {
        if (
          err?.code === 'P2002' &&
          dto.externalReference &&
          err?.meta?.target?.includes('externalReference')
        ) {
          // The competing transaction committed first; this one aborted on the
          // unique index. Re-read the committed row on the OUTER client (not
          // `tx`, which is now aborted) so the retried callback still gets an
          // idempotent result instead of a 500.
          const existing = await this.prisma.client.payment.findFirst({
            where: {
              organizationId,
              externalReference: dto.externalReference,
              externalReferenceType: dto.externalReferenceType ?? undefined,
              direction: 'inbound',
            },
            include: { allocations: true },
          });
          if (existing) return { payment: existing, allocations: [], unallocated: 0, replayed: true };
          throw err; // genuine conflict, not the replay we guard
        }
        throw err;
      }

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

      const allocatedTotal = allocations.reduce((s, a) => s + Number(a.amount), 0);
      const unallocatedAmt = Math.max(0, Number(dto.amount) - allocatedTotal);

      // B1 · overpayment.
      //
      // A parent paying more than is owed is routine in a Ugandan school —
      // rounding up to a note they have, or paying next term forward. The
      // remainder is genuine value the school is holding, so it becomes a
      // FeeCredit against the payment that funded it, in THIS transaction.
      //
      // `sourcePaymentId` is what keeps the entitlement counted once: the
      // refund calculation subtracts overpayment already converted to a credit,
      // so the same money can never be both refundable cash and a spendable
      // credit (FINANCIAL_INVARIANTS §Economic-entitlement uniqueness).
      //
      // Left unconverted the money is not lost — it stays on
      // `Payment.unallocatedAmount` and is still refundable — but it cannot be
      // spent against next term's invoice until it is a credit.
      let overpaymentCredit: any = null;
      let converted = 0;
      if (unallocatedAmt > 0 && dto.convertOverpaymentToCredit) {
        overpaymentCredit = await this.advanced.createCredit(
          {
            studentProfileId: dto.studentProfileId,
            amount: unallocatedAmt,
            source: 'overpayment',
            sourcePaymentId: receipt.id,
          },
          tx,
        );
        // Entitlement uniqueness (P1-3 / FINANCIAL_INVARIANTS §Economic-entitlement
        // uniqueness): the converted amount leaves the payment's unallocated pot
        // so the same money is never both refundable cash AND a spendable credit.
        // Without this the audit gate double-counts it (Payment.unallocatedAmount
        // + FeeCredit) and AR⇄GL reconciliation diverges.
        await tx.payment.update({
          where: { id: receipt.id },
          data: { unallocatedAmount: { decrement: unallocatedAmt } },
        });
        converted = unallocatedAmt;
      }

      const payment = await tx.payment.findFirst({
        where: { id: receipt.id },
        include: { allocations: true },
      });
      return {
        payment,
        allocations,
        unallocated: unallocatedAmt - converted,
        overpaymentCredit,
        replayed: false,
      };
    });
  }

  /**
   * B4 · reporting day.
   *
   * Two hundred parents arrive on the first morning of term and the bursar has
   * one wizard, three steps deep, per pupil. This takes a whole class at once:
   * a row per pupil with an amount and a tender method, allocated oldest-first.
   *
   * Each row is its OWN transaction, deliberately. One pupil's bad row — a
   * closed term, a wrong id, a duplicated mobile-money reference — must not
   * roll back the twenty receipts already keyed in beside it. The result
   * reports per row so the bursar can fix the failures and re-submit only
   * those; a re-submitted row carrying the same `externalReference` replays
   * rather than double-collecting.
   */
  async collectBatch(dto: {
    rows: Array<{
      studentProfileId: string;
      amount: number;
      paymentMethod?: 'cash' | 'bank' | 'mobile_money' | 'card';
      reference?: string;
      externalReference?: string;
      externalReferenceType?: any;
      convertOverpaymentToCredit?: boolean;
    }>;
    paymentDate?: string;
    cashSessionId?: string;
    bankAccountId?: string;
  }) {
    const results: Array<{
      studentProfileId: string;
      status: 'posted' | 'replayed' | 'failed';
      paymentId?: string;
      paymentNumber?: string;
      allocated?: number;
      unallocated?: number;
      creditCode?: string;
      error?: string;
    }> = [];

    for (const row of dto.rows) {
      if (!row.studentProfileId || !(Number(row.amount) > 0)) {
        results.push({
          studentProfileId: row.studentProfileId,
          status: 'failed',
          error: 'A pupil and an amount above zero are required.',
        });
        continue;
      }
      try {
        const res: any = await this.collect({
          studentProfileId: row.studentProfileId,
          amount: Number(row.amount),
          paymentMethod: row.paymentMethod ?? 'cash',
          paymentDate: dto.paymentDate,
          cashSessionId: dto.cashSessionId,
          bankAccountId: dto.bankAccountId,
          reference: row.reference,
          externalReference: row.externalReference,
          externalReferenceType: row.externalReferenceType,
          convertOverpaymentToCredit: row.convertOverpaymentToCredit ?? true,
        } as CollectFeePaymentDto);

        results.push({
          studentProfileId: row.studentProfileId,
          status: res.replayed ? 'replayed' : 'posted',
          paymentId: res.payment?.id,
          paymentNumber: res.payment?.paymentNumber,
          allocated: (res.allocations ?? []).reduce((t: number, a: any) => t + Number(a.amount), 0),
          unallocated: Number(res.unallocated ?? 0),
          creditCode: res.overpaymentCredit?.code,
        });
      } catch (err: any) {
        results.push({
          studentProfileId: row.studentProfileId,
          status: 'failed',
          error: err?.message ?? String(err),
        });
      }
    }

    const posted = results.filter((r) => r.status === 'posted');
    return {
      total: results.length,
      posted: posted.length,
      replayed: results.filter((r) => r.status === 'replayed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      totalCollected: posted.reduce((t, r) => t + Number(r.allocated ?? 0) + Number(r.unallocated ?? 0), 0),
      results,
    };
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

      // Replay guard: a prior refund carrying the same machine-issued key
      // returns as-is. Keys on externalReference for the same reason collect
      // does (P0-B) — narration is not an idempotency key.
      if (dto.externalReference) {
        const existing = await tx.payment.findFirst({
          where: {
            organizationId,
            externalReference: dto.externalReference,
            externalReferenceType: dto.externalReferenceType ?? undefined,
            direction: 'outbound',
          },
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
      // P1-C · refunding an ALREADY-ALLOCATED payment.
      //
      // The entitlement covers unallocated cash and refundable credits only, so
      // without this a parent who paid an invoice in full and was then owed
      // money back had no path at all. Reversing the allocation first restores
      // the invoice's receivable and returns the value to the payment's
      // unallocated balance — which is what then funds the payout.
      //
      // This is a composition of two distinct events (REVERSAL then REFUND),
      // not a third kind of refund: after this block the ordinary
      // unallocated-cash path below runs unchanged.
      //
      // FINANCIAL_INVARIANTS §Outstanding AR: "A refund of an *allocated*
      // payment increases outstanding AR."
      const reversedAllocations: string[] = [];
      if (dto.allocatedPaymentId) {
        const priorAllocations = await tx.paymentAllocation.findMany({
          where: { organizationId, paymentId: dto.allocatedPaymentId, status: 'posted' },
          select: { id: true, documentId: true },
        });
        if (priorAllocations.length === 0) {
          throw new BadRequestException(
            `Payment ${dto.allocatedPaymentId} has no posted allocations to reverse. ` +
              'Omit allocatedPaymentId to refund unallocated cash or a credit.',
          );
        }
        // P1-B: restoring AR on these documents posts against their terms.
        await this.controls.assertDocumentsPeriodOpen(
          priorAllocations.map((a: any) => a.documentId).filter(Boolean),
          tx,
        );
        for (const alloc of priorAllocations) {
          await this.reversals.reverseAllocation(
            alloc.id,
            `Refund of allocated payment: ${dto.reference ?? 'no reference'}`,
            tx,
          );
          reversedAllocations.push(alloc.id);
        }
      }

      const breakdown = await this.finance.refundableBreakdown(student.partnerId, student.id);
      const refundable = round(dec(breakdown.total), 6);
      const overpaymentCredit = breakdown.total;

      const wanted = round(dec(dto.amount), 6);
      if (wanted.greaterThan(refundable)) {
        throw new BadRequestException(
          `Refund of ${wanted.toString()} exceeds this student's refundable entitlement of ` +
            `${refundable.toString()}. Record the overpayment or credit that funds this refund first.`,
        );
      }

      // P0-C: draw down the credits this refund actually spends.
      //
      // Unallocated cash is consumed first, because refunding it needs no
      // credit at all. Only the remainder touches FeeCredits, oldest-first.
      //
      // Previously nothing here touched the credit: `remaining` stayed put,
      // `status` stayed 'active', and the Fee-Credit Liability was never
      // debited — so the same entitlement could be paid out again and again and
      // ALSO applied to the next invoice. One credit, unlimited payouts
      // (FINANCIAL_INVARIANTS §Economic-entitlement uniqueness).
      const fromPayments = round(dec(breakdown.fromPayments), 6);
      let creditPortion = wanted.greaterThan(fromPayments) ? wanted.minus(fromPayments) : ZERO;
      const creditsSpent: Array<{ id: string; code: string; amount: string }> = [];

      if (creditPortion.greaterThan(ZERO)) {
        for (const credit of breakdown.credits) {
          if (creditPortion.lessThanOrEqualTo(ZERO)) break;
          const take = Prisma.Decimal.min(creditPortion, dec(credit.remaining));
          if (take.lessThanOrEqualTo(ZERO)) continue;

          // ─── The drawdown must be ATOMIC, not read-compute-write. ───
          //
          // `breakdown.credits` was read through the query service, which uses
          // its own connection — so that read is not even inside this
          // transaction, let alone holding a lock. Two simultaneous refunds of
          // the same credit both saw `remaining = 300,000`, both computed
          // `newRemaining = 0`, and both paid out. One credit, two payouts.
          //
          // A conditional decrement closes it: Postgres takes a row lock for
          // the UPDATE, and the second transaction re-evaluates
          // `remaining >= take` against the value the first one committed. It
          // matches zero rows and we abort instead of paying unfunded cash.
          //
          // FINANCIAL_INVARIANTS §Concurrency — enforced by the database, never
          // by an application read.
          const claimed = await tx.feeCredit.updateMany({
            where: { id: credit.id, remaining: { gte: take } },
            data: { remaining: { decrement: take } },
          });
          if (claimed.count !== 1) {
            // Someone else took it between our read and this write.
            throw new BadRequestException(
              `Fee credit ${credit.code} was drawn down by another transaction while this refund ` +
                'was being prepared. No money has left the drawer — retry.',
            );
          }

          // Re-read the committed value: the row is ours until this transaction
          // ends, so this is the true post-decrement balance.
          const after = await tx.feeCredit.findFirst({
            where: { id: credit.id },
            select: { remaining: true },
          });
          const nowRemaining = dec(after?.remaining ?? 0);
          await tx.feeCredit.update({
            where: { id: credit.id },
            data: {
              // 'refunded' is terminal for a fully-paid-out credit; a partially
              // refunded one stays drawable for what is left.
              status: nowRemaining.lessThanOrEqualTo(ZERO) ? 'refunded' : 'partially_applied',
              isActive: nowRemaining.greaterThan(ZERO),
            },
          });

          creditPortion = creditPortion.minus(take);
          creditsSpent.push({ id: credit.id, code: credit.code, amount: take.toString() });
        }

        if (creditPortion.greaterThan(ZERO)) {
          // The entitlement said this was fundable and the credits say otherwise.
          // Abort rather than pay out unfunded cash. An explicit throw is
          // required: a return here would COMMIT (§Atomicity).
          throw new BadRequestException(
            `Refund of ${wanted.toString()} is short by ${creditPortion.toString()}: the fee credits ` +
              'funding it are no longer available. Retry.',
          );
        }
      }

      const refund: any = await this.payments.createCustomerRefund(
        {
          partnerId: student.partnerId,
          paymentDate: new Date().toISOString(),
          amount: dto.amount,
          paymentMethod: dto.paymentMethod,
          accountId: dto.paymentMethod === 'bank' ? dto.bankAccountId : undefined,
          reference: dto.reference,
          externalReference: dto.externalReference,
          externalReferenceType: dto.externalReferenceType,
          cashSessionId: dto.cashSessionId,
        },
        tx,
      );

      // P0-C, GL half. `createCustomerRefund` posts Dr AR / Cr Cash — correct
      // for unallocated cash, whose receipt credited AR in the first place. A
      // credit-funded refund is different: the credit's creation posted
      // Dr AR / Cr Fee-Credit Liability, so paying it out must retire that
      // liability rather than debit AR a second time. This compensating leg
      // (Dr Fee-Credit Liability / Cr AR) nets the refund's AR debit away,
      // leaving Dr Fee-Credit Liability / Cr Cash overall.
      //
      // The treatment is the same for every refundable origin, because in each
      // of them the liability represents value the payer is entitled to have
      // back. The origin that genuinely differs is `opening_balance` — a
      // carried-forward migration artifact, never money anyone handed over —
      // and it is excluded from the entitlement upstream rather than posted
      // differently here.
      const creditFunded = creditsSpent.reduce((acc, c) => acc.plus(dec(c.amount)), dec(0));
      if (creditFunded.greaterThan(ZERO)) {
        const arAccount = await this.accounts.receivableAccount(null, tx);
        const liabilityAccount = await this.resolver.ensureByCode(
          'FEE-CR',
          { name: 'Fee Credit Liability', categoryKey: 'current_liability', mappingKey: 'fee_credit' },
          tx,
        );
        await this.posting.post(
          {
            journalCode: 'GEN',
            date: new Date(),
            description: `Fee credit refunded · ${creditsSpent.map((c) => c.code).join(', ')}`,
            sourceType: 'school_fee_credit_refund',
            sourceId: refund.id,
            lines: [
              {
                accountId: liabilityAccount,
                debit: creditFunded.toString(),
                description: 'Fee credit liability retired',
              },
              {
                accountId: arAccount,
                credit: creditFunded.toString(),
                partnerId: student.partnerId,
                description: 'AR restored (credit refunded)',
              },
            ],
          },
          tx,
        );
      }

      this.events.publish(EVENTS.SchoolFeeRefundRecorded, {
        organizationId,
        paymentId: refund.id,
        studentProfileId: student.id,
        amount: dto.amount.toString(),
        overpaymentCredit: overpaymentCredit.toString(),
      });

      return { payment: refund, replayed: false, overpaymentCredit, creditsSpent, reversedAllocations };
    });
  }
}