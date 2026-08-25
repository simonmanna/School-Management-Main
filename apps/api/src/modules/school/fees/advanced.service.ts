import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { EventBus } from '../../../kernel/events/event-bus';
import { SequenceService } from '../../../kernel/sequence/sequence.service';
import { PostingService } from '../../accounting/posting/posting.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import { AccountResolverService } from '../../accounting/posting/account-resolver.service';
import { EVENTS } from '@erp/shared';
import { dec, round, ZERO } from '../../../kernel/common/money';
import { ACTIVE_FEE_STATUSES, OPEN_FEE_WHERE, SCHOOL_FEE_SOURCE_TYPES } from './fee-document.constants';
import { SchoolFinanceQueryService } from './school-finance-query.service';
import { FinanceControlsService } from './finance-controls.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Advanced school finance (P1):
 *  - Sponsorship  — a Partner that pays fees on behalf of a student. No GL of
 *    its own; the collection still lands on the student's AR (partnerId), but
 *    we record `sponsorId` so sponsor statements can group by payer.
 *  - Waiver       — forgives an amount the school will not collect. Applied as
 *    Dr Waiver Expense / Cr Accounts Receivable, reducing the invoice residual.
 *    Semantically distinct from a Discount (which reduces the *billed* amount).
 *  - FeeCredit    — a student-held stored-value liability (overpayment, refund,
 *    advance, adjustment). Applied to open fee invoices oldest-first; the
 *    drawdown posts Dr Fee-Credit Liability / Cr Accounts Receivable.
 *
 * All three reuse the platform's PostingService + AccountResolverService — no
 * new accounting primitives. Account codes are auto-seeded on first use.
 */
@Injectable()
export class AdvancedFinanceService {
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
    // P1-B: period control on every document a waiver or credit touches.
    private readonly controls: FinanceControlsService,
  ) {}

  /* ───────────────────────── Sponsorship ───────────────────────── */

  async createSponsorship(dto: {
    sponsorId: string;
    studentProfileId: string;
    code: string;
    name: string;
    capAmount?: number;
    validFrom: string;
    validTo?: string;
    notes?: string;
  }) {
    const organizationId = this.tenant.organizationId;
    // Validate the sponsor Partner exists.
    const sponsor = await this.prisma.client.partner.findFirst({ where: { id: dto.sponsorId } });
    if (!sponsor) throw new NotFoundException(`Sponsor ${dto.sponsorId} not found`);
    const student = await this.prisma.client.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
    if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);

    // P1-I · the cap. `capAmount` was written and read by nothing, so a sponsor
    // capped at 500,000 could have 800,000 attributed to them.
    //
    // Being straight about what is and is not enforced here: a stored zero or
    // negative cap is rejected, and overlapping live sponsorships for the same
    // sponsor+student are rejected — both are integrity rules this layer CAN
    // uphold. Enforcing the cap against actual consumption is not possible
    // yet, because nothing collects money from a sponsor: payments land on the
    // student's AR, so no query can say how much of a student's balance a
    // sponsor settled. That is why sponsorship is gated off at the controller
    // (Phase 5) rather than shipped with a cap that silently does nothing.
    if (dto.capAmount != null && dec(dto.capAmount).lessThanOrEqualTo(ZERO)) {
      throw new BadRequestException(
        'A sponsorship cap must be positive. Omit capAmount for an uncapped sponsorship.',
      );
    }
    const validFrom = new Date(dto.validFrom);
    const validTo = dto.validTo ? new Date(dto.validTo) : null;
    if (validTo && validTo <= validFrom) {
      throw new BadRequestException('validTo must be after validFrom.');
    }
    const overlapping = await this.prisma.client.sponsorship.findFirst({
      where: {
        organizationId,
        sponsorId: dto.sponsorId,
        studentProfileId: dto.studentProfileId,
        isActive: true,
        AND: [
          { OR: [{ validTo: null }, { validTo: { gte: validFrom } }] },
          ...(validTo ? [{ validFrom: { lte: validTo } }] : []),
        ],
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        `${sponsor.name} already sponsors this student over an overlapping period (${overlapping.code}). ` +
          'Two live sponsorships would make each cap unenforceable against the other.',
      );
    }

    const row = await this.prisma.client.sponsorship.create({
      data: {
        organizationId,
        sponsorId: dto.sponsorId,
        studentProfileId: dto.studentProfileId,
        code: dto.code,
        name: dto.name,
        capAmount: dto.capAmount != null ? new Prisma.Decimal(dto.capAmount) : null,
        validFrom: new Date(dto.validFrom),
        validTo: dto.validTo ? new Date(dto.validTo) : null,
        isActive: true,
        notes: dto.notes ?? null,
      },
    });
    await this.audit.record({ entity: 'Sponsorship', entityId: row.id, action: 'create', newValues: row });
    this.events.publish(EVENTS.SchoolSponsorshipCreated, {
      organizationId,
      sponsorshipId: row.id,
      sponsorId: dto.sponsorId,
      studentProfileId: dto.studentProfileId,
    });
    return row;
  }

  listSponsorships(studentProfileId?: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.sponsorship.findMany({
      where: { organizationId, ...(studentProfileId ? { studentProfileId } : {}) },
      include: { sponsor: true, studentProfile: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Sponsor statement — every figure reported as its own event class.
   *
   * P0-D: this used to derive `totalPaid = totalBilled - totalBalance`.
   * `totalBalance` is the sum of `amountResidual`, which waivers, credit
   * applications and credit adjustments all reduce — so every forgiven shilling
   * was reported to a third party as money they had paid. That is the P0-3
   * defect the rest of this module was remediated to remove, surviving in the
   * one method the remediation did not reach (FINANCIAL_INVARIANTS §Terminology:
   * amountPaid EXCLUDES waivers, credits, write-offs and adjustments).
   *
   * There is now no derived "paid" figure anywhere. Each student's numbers come
   * from `SchoolFinanceQueryService.studentBalance`, the one canonical
   * calculation, where `collected` is SUM(PaymentAllocation).
   *
   * `paidBySponsor` vs `paidByOthers`: a sponsorship does not currently create a
   * distinct payer — collections land on the STUDENT's AR — so the split cannot
   * be derived from the subledger and every collection is reported under
   * `paidByOthers`. That is honest rather than convenient, and it is one of the
   * reasons sponsorship is not production-ready (see the audit's Deferred
   * section: a sponsor must become a real payer with its own receivable).
   */
  async sponsorStatement(sponsorId: string) {
    const organizationId = this.tenant.organizationId;
    const sponsor = await this.prisma.client.partner.findFirst({ where: { id: sponsorId } });
    if (!sponsor) throw new NotFoundException(`Sponsor ${sponsorId} not found`);

    const sponsorships = await this.prisma.client.sponsorship.findMany({
      where: { organizationId, sponsorId, isActive: true },
      include: { studentProfile: true },
    });

    const empty = {
      sponsorId,
      sponsorName: sponsor.name,
      students: [] as any[],
      totalBilled: 0,
      paidBySponsor: 0,
      paidByOthers: 0,
      totalWaived: 0,
      totalCredited: 0,
      totalAdjusted: 0,
      totalOutstanding: 0,
    };
    if (sponsorships.length === 0) return empty;

    const rows = await Promise.all(
      sponsorships.map(async (sp) => {
        const b = await this.finance.studentBalance(sp.studentProfileId);
        return {
          studentProfileId: sp.studentProfileId,
          studentName: (sp.studentProfile as any)?.partner?.name ?? sp.studentProfileId,
          sponsorshipCode: sp.code,
          capAmount: sp.capAmount != null ? Number(sp.capAmount) : null,
          billed: b.billed,
          paidBySponsor: 0,
          paidByOthers: b.collected,
          waived: b.waived,
          credited: b.credited,
          adjusted: b.adjusted,
          outstanding: b.balance,
        };
      }),
    );

    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((t, r) => t + Number(r[k] ?? 0), 0);

    return {
      sponsorId,
      sponsorName: sponsor.name,
      students: rows,
      totalBilled: sum('billed'),
      paidBySponsor: sum('paidBySponsor'),
      paidByOthers: sum('paidByOthers'),
      totalWaived: sum('waived'),
      totalCredited: sum('credited'),
      totalAdjusted: sum('adjusted'),
      totalOutstanding: sum('outstanding'),
    };
  }

  /* ───────────────────────── Waiver ───────────────────────── */

  async createWaiver(dto: {
    studentProfileId: string;
    code: string;
    name: string;
    amount: number;
    reason?: string;
    documentId?: string;
  }) {
    const organizationId = this.tenant.organizationId;
    const student = await this.prisma.client.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
    if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);
    const row = await this.prisma.client.waiver.create({
      data: {
        organizationId,
        studentProfileId: dto.studentProfileId,
        code: dto.code,
        name: dto.name,
        amount: new Prisma.Decimal(dto.amount),
        reason: dto.reason ?? null,
        documentId: dto.documentId ?? null,
        applied: false,
        status: 'pending',
        createdBy: this.tenant.userId ?? null,
      },
    });
    await this.audit.record({ entity: 'Waiver', entityId: row.id, action: 'create', newValues: row });
    return row;
  }

  /**
   * A4 maker-checker: approve a pending waiver. The approver must differ from
   * the creator, mirroring the platform's journal-entry rule
   * (posting.service.ts). Only an approved waiver may be applied.
   */
  async approveWaiver(waiverId: string) {
    const organizationId = this.tenant.organizationId;
    const approverId = this.tenant.userId ?? null;
    const waiver = await this.prisma.client.waiver.findFirst({ where: { id: waiverId, organizationId } });
    if (!waiver) throw new NotFoundException(`Waiver ${waiverId} not found`);
    if (waiver.status === 'approved' || waiver.applied) return waiver;
    if (waiver.status !== 'pending') {
      throw new BadRequestException(`Waiver ${waiver.code} is ${waiver.status}, not pending`);
    }
    if (approverId && waiver.createdBy && approverId === waiver.createdBy) {
      throw new BadRequestException(
        'The user who created a waiver cannot approve it (maker-checker).',
      );
    }
    const updated = await this.prisma.client.waiver.update({
      where: { id: waiver.id },
      data: { status: 'approved', approvedById: approverId, approvedAt: new Date() },
    });
    await this.audit.record({ entity: 'Waiver', entityId: waiver.id, action: 'approve', newValues: { approvedById: approverId } });
    this.events.publish('school.fee.waiver.approved', {
      organizationId,
      waiverId: waiver.id,
      studentProfileId: waiver.studentProfileId,
      approvedById: approverId ?? 'system',
    });
    return updated;
  }

  /** A4: reject a pending waiver with a reason. */
  async rejectWaiver(waiverId: string, reason?: string) {
    const organizationId = this.tenant.organizationId;
    const waiver = await this.prisma.client.waiver.findFirst({ where: { id: waiverId, organizationId } });
    if (!waiver) throw new NotFoundException(`Waiver ${waiverId} not found`);
    const updated = await this.prisma.client.waiver.update({
      where: { id: waiver.id },
      data: { status: 'rejected', rejectionReason: reason ?? null },
    });
    await this.audit.record({ entity: 'Waiver', entityId: waiver.id, action: 'reject', newValues: { reason } });
    this.events.publish('school.fee.waiver.rejected', {
      organizationId,
      waiverId: waiver.id,
      studentProfileId: waiver.studentProfileId,
      reason,
    });
    return updated;
  }

  listWaivers(studentProfileId?: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.waiver.findMany({
      where: { organizationId, ...(studentProfileId ? { studentProfileId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Apply a waiver: reduce the student's open fee invoices by the waived amount
   * (oldest-first) and post Dr Waiver Expense / Cr Accounts Receivable so the
   * books reflect the forgiven income. The waived amount is NOT a payment — it
   * moves the invoice to 'not_paid' (residual 0) but the difference is waived,
   * not collected.
   */
  async applyWaiver(waiverId: string) {
    const organizationId = this.tenant.organizationId;
    const waiver = await this.prisma.client.waiver.findFirst({ where: { id: waiverId, organizationId } });
    if (!waiver) throw new NotFoundException(`Waiver ${waiverId} not found`);
    if (waiver.applied) return waiver;
    // A4: a waiver forgives real receivable, so it must clear maker-checker
    // approval before it can touch the ledger. Bad-debt write-offs create their
    // waiver already approved (see writeOffBadDebt).
    if (waiver.status !== 'approved') {
      throw new BadRequestException(
        `Waiver ${waiver.code} must be approved before it can be applied (current status: ${waiver.status}).`,
      );
    }

    const student = await this.prisma.client.studentProfile.findFirst({ where: { id: waiver.studentProfileId } });
    if (!student) throw new NotFoundException(`Student ${waiver.studentProfileId} not found`);

    return this.prisma.client.$transaction(async (tx: any) => {
      const docs = await tx.document.findMany({
        where: {
          ...OPEN_FEE_WHERE,
          organizationId,
          partnerId: student.partnerId,
          ...(waiver.documentId ? { id: waiver.documentId } : {}),
        },
        orderBy: { issueDate: 'asc' },
      });

      // P0-3: money math in Decimal, not JS floats (FINANCIAL_INVARIANTS
      // §Money precision). A percentage-derived waiver produces fractions that
      // float arithmetic silently drifts on.
      let remaining = round(dec(waiver.amount), 6);
      const settled: string[] = [];
      for (const doc of docs) {
        if (remaining.lessThanOrEqualTo(ZERO)) break;
        const residual = dec(doc.amountResidual);
        if (residual.lessThanOrEqualTo(ZERO)) continue;
        const take = Prisma.Decimal.min(remaining, residual);
        const newResidual = residual.minus(take);
        await tx.document.update({
          where: { id: doc.id },
          data: {
            amountResidual: newResidual,
            // P0-3: a waiver is FORGIVEN money, not RECEIVED money. This used
            // to do `amountPaid + take`, which made every collections report
            // count forgiven balances as cash in the drawer. It now accrues to
            // amountWaived and amountPaid is left strictly alone.
            amountWaived: dec(doc.amountWaived ?? 0).plus(take),
            paymentStatus: newResidual.lessThanOrEqualTo(ZERO) ? 'paid' : 'partial',
          },
        });
        remaining = remaining.minus(take);
        settled.push(doc.id);
      }

      // P1-B: a waiver forgives receivable on these documents, so their terms
      // must be open (FINANCIAL_INVARIANTS §Period control).
      await this.controls.assertDocumentsPeriodOpen(settled, tx);

      const appliedAmount = round(dec(waiver.amount), 6).minus(remaining);

      // P0-2: the GL post below MUST happen on every path that mutated a
      // document. The previous code returned from inside this callback when
      // `remaining > 0` — and returning COMMITS. That silently reduced the AR
      // subledger while leaving the general ledger untouched, producing a
      // permanent divergence nothing in the system detected.
      //
      // A waiver that exceeds the student's open invoices is still a partial
      // application: post for what was actually applied, and leave the waiver
      // open so the remainder can attach to future invoices.
      if (appliedAmount.greaterThan(ZERO)) {
        const arAccount = await this.accounts.receivableAccount(null, tx);
        const waiverAccount = await this.resolver.ensureByCode(
          'FEE-WAIVER',
          { name: 'Fee Waiver Expense', categoryKey: 'expense', mappingKey: 'fee_waiver' },
          tx,
        );
        await this.posting.post(
          {
            journalCode: 'GEN',
            date: new Date(),
            description: `Fee waiver · ${waiver.code}`,
            sourceType: 'school_waiver',
            sourceId: waiver.id,
            lines: [
              { accountId: waiverAccount, debit: appliedAmount.toString(), description: 'Fee waiver expense' },
              { accountId: arAccount, credit: appliedAmount.toString(), partnerId: student.partnerId, description: 'AR waived' },
            ],
          },
          tx,
        );
      }

      const fullyApplied = remaining.lessThanOrEqualTo(ZERO);
      const updated = await tx.waiver.update({
        where: { id: waiver.id },
        data: {
          applied: fullyApplied,
          ...(fullyApplied
            ? { status: 'applied' }
            : { reason: `${waiver.reason ?? ''} (partial: ${remaining.toString()} unapplied)` }),
        },
      });
      await this.audit.recordInTx(tx, {
        entity: 'Waiver',
        entityId: waiver.id,
        action: 'update',
        newValues: {
          settledDocumentIds: settled,
          appliedAmount: appliedAmount.toString(),
          unappliedAmount: remaining.toString(),
        },
      });
      this.events.publish(EVENTS.SchoolWaiverApplied, {
        organizationId,
        waiverId: waiver.id,
        studentProfileId: waiver.studentProfileId,
        amount: appliedAmount.toString(),
      });
      return { ...updated, settledDocumentIds: settled, appliedAmount: appliedAmount.toString() };
    });
  }

  /* ───────────────────────── Fee credit ───────────────────────── */

  /**
   * Create a student fee credit (advance payment, refund carry-forward, or
   * manual adjustment). Posts Dr AR / Cr Fee-Credit Liability so the balance
   * sheet carries the obligation. The credit is then drawn down by
   * `applyCredits` against future invoices.
   */
  async createCredit(dto: {
    studentProfileId: string;
    amount: number;
    source?: string;
    sourcePaymentId?: string;
    sourceDocumentId?: string;
    expiresAt?: string;
  },
    /**
     * B1: run inside the caller's transaction. Converting an overpayment to a
     * credit has to commit atomically with the receipt that funds it — a
     * receipt without its credit leaves the family's money unaccounted for,
     * and a credit without its receipt mints a liability from nothing (P1-2).
     */
    externalTx?: any,
  ) {
    const organizationId = this.tenant.organizationId;
    const db = externalTx ?? this.prisma.client;
    const student = await db.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
    if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);
    const amount = dec(dto.amount);
    if (amount.lessThanOrEqualTo(ZERO)) throw new BadRequestException('Credit amount must be positive');

    // P1-2 / ADR-013: a credit mints a balance-sheet liability, so it must name
    // an explicit, legitimate origin. A bare createCredit call can no longer
    // fabricate value from nothing.
    const source = dto.source ?? 'overpayment';
    const ALLOWED = ['overpayment', 'refund_conversion', 'approved_adjustment', 'opening_balance'];
    if (!ALLOWED.includes(source)) {
      throw new BadRequestException(
        `Fee credit origin must be one of ${ALLOWED.join(', ')} — got '${source}'.`,
      );
    }
    if (source === 'overpayment' && !dto.sourcePaymentId) {
      throw new BadRequestException(
        'An overpayment credit must reference the sourcePaymentId that funds it, so the ' +
          'entitlement is counted once (refunds cannot double-count it).',
      );
    }

    const run = async (tx: any) => {
      const code = await this.sequence.next(`feecredit:${new Date().getUTCFullYear()}`, { prefix: 'CR-', padding: 6 }, tx);
      const row = await tx.feeCredit.create({
        data: {
          organizationId,
          studentProfileId: dto.studentProfileId,
          code,
          amount,
          remaining: amount,
          source,
          sourcePaymentId: dto.sourcePaymentId ?? null,
          sourceDocumentId: dto.sourceDocumentId ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          isActive: true,
        },
      });
      // GL: Dr AR / Cr Fee-Credit Liability (the school now owes the student a
      // credit it will apply to future fees).
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
          description: `Fee credit · ${code}`,
          sourceType: 'school_fee_credit',
          sourceId: row.id,
          lines: [
            { accountId: arAccount, debit: amount.toString(), partnerId: student.partnerId, description: 'Fee credit (AR)' },
            { accountId: liabilityAccount, credit: amount.toString(), description: 'Fee credit liability' },
          ],
        },
        tx,
      );
      this.events.publish(EVENTS.SchoolFeeCreditCreated, {
        organizationId,
        feeCreditId: row.id,
        studentProfileId: dto.studentProfileId,
        amount: amount.toString(),
        source,
      });
      return row;
    };

    // Join the caller's transaction when given one, so the credit and whatever
    // funds it commit or roll back together (§Atomicity).
    return externalTx ? run(externalTx) : this.prisma.client.$transaction(run);
  }

  listCredits(studentProfileId?: string) {
    const organizationId = this.tenant.organizationId;
    return this.prisma.client.feeCredit.findMany({
      where: { organizationId, ...(studentProfileId ? { studentProfileId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Apply a student's available fee credits to their open invoices
   * (oldest-first). Returns total applied. Safe to call after a billing run —
   * draws down the stored-value liability and settles AR.
   */
  async applyCredits(studentProfileId: string) {
    const organizationId = this.tenant.organizationId;
    const student = await this.prisma.client.studentProfile.findFirst({ where: { id: studentProfileId } });
    if (!student) throw new NotFoundException(`Student ${studentProfileId} not found`);

    return this.prisma.client.$transaction(async (tx: any) => {
      // P1-E: an EXPIRED credit is not spendable. `expiresAt` existed on the
      // model and was read by nothing, so a lapsed credit kept settling
      // invoices indefinitely.
      const now = new Date();
      const credits = await tx.feeCredit.findMany({
        where: {
          organizationId,
          studentProfileId,
          isActive: true,
          remaining: { gt: 0 },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { createdAt: 'asc' },
      });
      const docs = await tx.document.findMany({
        where: { ...OPEN_FEE_WHERE, organizationId, partnerId: student.partnerId },
        orderBy: { issueDate: 'asc' },
      });

      const liabilityAccount = await this.resolver.ensureByCode(
        'FEE-CR',
        { name: 'Fee Credit Liability', categoryKey: 'current_liability', mappingKey: 'fee_credit' },
        tx,
      );
      const arAccount = await this.accounts.receivableAccount(null, tx);

      // P1-D: running balances in Decimal, not JS floats.
      //
      // This used to carry a comment claiming "credit drawdown is not sub-cent
      // sensitive" and run on `Number` / `Math.min` — a self-granted exemption
      // from FINANCIAL_INVARIANTS §Money precision, twenty lines from
      // `applyWaiver`, which does the same arithmetic in Decimal correctly.
      // Percentage-derived credits produce fractions that float math silently
      // drifts on, and the drift lands in the AR subledger.
      let creditIdx = 0;
      let creditRemaining = credits.length ? dec(credits[0].remaining) : ZERO;
      let totalApplied = ZERO;
      const usedByCredit = new Map<string, Prisma.Decimal>();
      // P1-B: the documents this drawdown settles, checked for period control
      // before anything is persisted.
      const settledDocIds: string[] = [];

      for (const doc of docs) {
        if (creditIdx >= credits.length || creditRemaining.lessThanOrEqualTo(ZERO)) break;
        const residual = dec(doc.amountResidual);
        if (residual.lessThanOrEqualTo(ZERO)) continue;
        const take = Prisma.Decimal.min(creditRemaining, residual);
        const newResidual = residual.minus(take);
        settledDocIds.push(doc.id);
        await tx.document.update({
          where: { id: doc.id },
          data: {
            amountResidual: newResidual,
            // P0-3: drawing down a stored-value credit is not a cash receipt.
            // This used to increment amountPaid, so applying a credit inflated
            // reported collections exactly as a waiver did. The credit
            // subledger (FeeCreditAllocation, A2) becomes the record of what
            // was applied; amountPaid stays reserved for realized payment.
            paymentStatus: newResidual.lessThanOrEqualTo(ZERO) ? 'paid' : 'partial',
          },
        });
        // GL: Dr Fee-Credit Liability / Cr AR (drawdown).
        await this.posting.post(
          {
            journalCode: 'GEN',
            date: new Date(),
            description: `Apply fee credit · ${doc.documentNumber}`,
            sourceType: 'school_fee_credit_apply',
            sourceId: doc.id,
            lines: [
              { accountId: liabilityAccount, debit: take.toString(), description: 'Fee credit drawdown' },
              { accountId: arAccount, credit: take.toString(), partnerId: student.partnerId, description: 'AR settled by credit' },
            ],
          },
          tx,
        );
        // A2: record the drawdown as a typed FeeCreditAllocation — the credit
        // subledger. FeeCredit.remaining becomes the cached projection of
        // amount − SUM(these).
        const cid = credits[creditIdx].id;
        await tx.feeCreditAllocation.create({
          data: {
            organizationId,
            feeCreditId: cid,
            documentId: doc.id,
            amount: take,
            status: 'posted',
          },
        });
        creditRemaining = creditRemaining.minus(take);
        totalApplied = totalApplied.plus(take);
        usedByCredit.set(cid, (usedByCredit.get(cid) ?? ZERO).plus(take));
        if (creditRemaining.lessThanOrEqualTo(ZERO)) {
          creditIdx++;
          if (creditIdx < credits.length) creditRemaining = dec(credits[creditIdx].remaining);
        }
      }

      // P1-B: a credit drawdown settles receivable on these documents.
      await this.controls.assertDocumentsPeriodOpen(settledDocIds, tx);

      // Persist the drawdown ATOMICALLY (A2). `remaining` is a derived cache;
      // `status` reflects how much of the credit is spent.
      //
      // Conditional decrement, not read-compute-write. The credits were read at
      // the top of this transaction; between then and here a concurrent
      // `applyCredits` or `refundFee` may have taken the same value. Writing a
      // computed `newRemaining` would silently overwrite their drawdown and
      // spend one credit twice — against two different invoices, each with its
      // own GL entry, so the Fee-Credit Liability would no longer reconcile.
      //
      // Postgres takes a row lock for the UPDATE and re-evaluates
      // `remaining >= used` against the committed value, so the loser matches
      // zero rows and we abort (FINANCIAL_INVARIANTS §Concurrency).
      for (const [id, used] of usedByCredit) {
        const credit = credits.find((c: any) => c.id === id)!;
        const claimed = await tx.feeCredit.updateMany({
          where: { id, remaining: { gte: used } },
          data: { remaining: { decrement: used } },
        });
        if (claimed.count !== 1) {
          throw new BadRequestException(
            `Fee credit ${credit.code} was drawn down by another transaction while these invoices ` +
              'were being settled. Nothing has been applied — retry.',
          );
        }
        const after = await tx.feeCredit.findFirst({ where: { id }, select: { remaining: true } });
        const nowRemaining = dec(after?.remaining ?? 0);
        await tx.feeCredit.update({
          where: { id },
          data: {
            isActive: nowRemaining.greaterThan(ZERO),
            status: nowRemaining.lessThanOrEqualTo(ZERO) ? 'fully_applied' : 'partially_applied',
          },
        });
      }

      if (totalApplied.greaterThan(ZERO)) {
        this.events.publish(EVENTS.SchoolFeeCreditApplied, {
          organizationId,
          studentProfileId,
          totalApplied: totalApplied.toString(),
          appliedCreditIds: [...usedByCredit.keys()],
        });
      }
      return { studentProfileId, totalApplied: totalApplied.toString(), appliedCreditIds: [...usedByCredit.keys()] };
    });
  }

  /* ───────────────────────── Aging (P2) ───────────────────────── */

  /**
   * School-specific AR aging over fee documents, reusing the platform's aging
   * buckets. Returns bucketed totals + per-student rows.
   */
  async aging(asOfStr?: string) {
    const asOf = asOfStr ? new Date(asOfStr) : new Date();
    const organizationId = this.tenant.organizationId;
    const docs = await this.prisma.client.document.findMany({
      where: { ...OPEN_FEE_WHERE, organizationId },
      include: { partner: true },
      orderBy: { dueDate: 'asc' },
    });

    const buckets: Record<string, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    const rows: Array<{ documentNumber: string; partnerName: string; dueDate: string; daysOverdue: number; residual: number; bucket: string }> = [];

    for (const d of docs) {
      const due = d.dueDate ?? d.issueDate;
      const days = Math.floor((asOf.getTime() - new Date(due).getTime()) / 86_400_000);
      const bucket = days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus';
      const residual = Number(d.amountResidual);
      buckets[bucket] += residual;
      rows.push({
        documentNumber: d.documentNumber,
        partnerName: (d as any).partner?.name ?? 'Unknown',
        dueDate: new Date(due).toISOString().slice(0, 10),
        daysOverdue: Math.max(0, days),
        residual,
        bucket,
      });
    }
    return { asOf: asOf.toISOString(), buckets, rows };
  }

  /* ─────────────────── Waiver Categories (catalog) ─────────────────── */

  private catCols = [
    '"id"', '"organizationId"', '"code"', '"name"', '"description"',
    '"type"', '"value"', '"defaultReason"', '"appliesTo"', '"isActive"',
    '"createdAt"', '"updatedAt"',
  ];

  async createWaiverCategory(dto: {
    code: string; name: string; description?: string;
    type?: string; value?: number; defaultReason?: string;
    appliesTo?: any; isActive?: boolean;
  }) {
    const organizationId = this.tenant.organizationId;
    if (!dto.code || !dto.name) throw new BadRequestException('code and name are required');
    const type = dto.type ?? 'percentage';
    const value = dto.value ?? 0;
    const appliesTo = dto.appliesTo ? JSON.stringify(dto.appliesTo) : '{}';
    let row: Record<string, any>[];
    try {
      row = await this.prisma.raw.$queryRawUnsafe<Record<string, any>[]>(
        `INSERT INTO "WaiverCategory" ("id","organizationId","code","name","description","type","value","defaultReason","appliesTo","isActive","updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now())
         RETURNING ${this.catCols.join(', ')}`,
        organizationId, dto.code, dto.name, dto.description ?? null, type, value,
        dto.defaultReason ?? null, appliesTo, dto.isActive ?? true,
      );
    } catch (e: any) {
      // raw $queryRawUnsafe surfaces Postgres native code 23505 (unique violation)
      if (e?.code === 'P2002' || e?.code === '23505' || /already exists|duplicate/i.test(e?.message ?? '')) {
        throw new ConflictException(`Waiver category code '${dto.code}' already exists`);
      }
      throw e;
    }
    this.audit.record({ entity: 'WaiverCategory', entityId: (row[0] as any).id, action: 'create', newValues: row[0] });
    return this.mapCategory(row[0]);
  }

  async listWaiverCategories(includeInactive = false) {
    const organizationId = this.tenant.organizationId;
    const where = includeInactive ? '' : ` AND "isActive" = true`;
    const rows = await this.prisma.raw.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT ${this.catCols.join(', ')} FROM "WaiverCategory" WHERE "organizationId" = $1${where} ORDER BY "name"`,
      organizationId,
    );
    return rows.map((r) => this.mapCategory(r));
  }

  async updateWaiverCategory(id: string, dto: any) {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.raw.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT ${this.catCols.join(', ')} FROM "WaiverCategory" WHERE "id" = $1 AND "organizationId" = $2`,
      id, organizationId,
    );
    if (!existing.length) throw new NotFoundException(`WaiverCategory ${id} not found`);
    const sets: string[] = [];
    const params: any[] = [id, organizationId];
    let i = 3;
    for (const f of ['code', 'name', 'description', 'type', 'value', 'defaultReason', 'isActive'] as const) {
      if (dto[f] !== undefined) {
        const col = `"${f}"`;
        sets.push(`${col} = $${i++}`);
        params.push(f === 'value' ? Number(dto[f]) : dto[f]);
      }
    }
    if (dto.appliesTo !== undefined) {
      sets.push(`"appliesTo" = $${i++}::jsonb`);
      params.push(JSON.stringify(dto.appliesTo));
    }
    if (!sets.length) return this.mapCategory(existing[0]);
    sets.push(`"updatedAt" = now()`);
    const updated = await this.prisma.raw.$queryRawUnsafe<Record<string, any>[]>(
      `UPDATE "WaiverCategory" SET ${sets.join(', ')} WHERE "id" = $1 AND "organizationId" = $2 RETURNING ${this.catCols.join(', ')}`,
      ...params,
    );
    this.audit.record({ entity: 'WaiverCategory', entityId: id, action: 'update', oldValues: existing[0], newValues: updated[0] });
    return this.mapCategory(updated[0]);
  }

  async deleteWaiverCategory(id: string) {
    const organizationId = this.tenant.organizationId;
    const existing = await this.prisma.raw.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT ${this.catCols.join(', ')} FROM "WaiverCategory" WHERE "id" = $1 AND "organizationId" = $2`,
      id, organizationId,
    );
    if (!existing.length) throw new NotFoundException(`WaiverCategory ${id} not found`);
    await this.prisma.raw.$queryRawUnsafe(
      `DELETE FROM "WaiverCategory" WHERE "id" = $1 AND "organizationId" = $2`,
      id, organizationId,
    );
    this.audit.record({ entity: 'WaiverCategory', entityId: id, action: 'delete', oldValues: existing[0] });
    return { id, deleted: true };
  }

  private mapCategory(r: any) {
    return {
      id: r.id, organizationId: r.organizationId, code: r.code, name: r.name,
      description: r.description, type: r.type, value: Number(r.value),
      defaultReason: r.defaultReason, appliesTo: typeof r.appliesTo === 'string' ? JSON.parse(r.appliesTo) : (r.appliesTo ?? {}),
      isActive: r.isActive, createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }

  /* ─────────────────── Fee Defaulters & Bad Debtors ─────────────────── */

  /**
   * Fee Defaulters: every student with an outstanding fee balance, aggregated
   * from the AR aging of school fee documents. Pure read; never mutates.
   */
  async feeDefaulters(asOfStr?: string, minBalance = 0, classId?: string) {
    const org = this.tenant.organizationId;
    const asOf = asOfStr ? new Date(asOfStr) : new Date();
    const rows = await this.studentArRows(org, asOf, classId);
    const out = rows
      .filter((r) => Number(r.balance) >= minBalance)
      .map((r) => ({
        studentProfileId: r.studentProfileId,
        studentName: r.studentName,
        admissionNo: r.admissionNo,
        className: r.className,
        totalBalance: Number(r.balance),
        oldestDueDate: r.oldestDueDate,
        maxDaysOverdue: r.maxDays,
        invoiceCount: Number(r.invoiceCount),
        waived: Number(r.waived),
      }))
      .sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue);
    return { asOf: asOf.toISOString(), count: out.length, rows: out };
  }

  /**
   * Bad Debtors: defaulters whose oldest overdue fee invoice exceeds
   * thresholdDays (default 90), i.e. chronic unpaid debt. Pure read.
   */
  async badDebtors(asOfStr?: string, thresholdDays = 90, classId?: string) {
    const res = await this.feeDefaulters(asOfStr, 0, classId);
    const rows = res.rows.filter((r) => r.maxDaysOverdue >= thresholdDays);
    return { asOf: res.asOf, thresholdDays, count: rows.length, rows };
  }

  /** Write off a student's overdue fee balance as bad debt (uses waiver engine). */
  async writeOffBadDebt(studentProfileId: string, dto: { reason?: string; documentId?: string }) {
    const org = this.tenant.organizationId;
    const stu = await this.prisma.raw.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT "id","admissionNo","partnerId" FROM "StudentProfile" WHERE "id" = $1 AND "organizationId" = $2`,
      studentProfileId, org,
    );
    if (!stu.length) throw new NotFoundException(`Student ${studentProfileId} not found`);
    const rows = await this.studentArRows(org, new Date(), undefined, studentProfileId);
    const balance = rows.length ? Number(rows[0].balance) : 0;
    if (balance <= 0) throw new BadRequestException('No outstanding balance to write off');
    const code = `BADDEBT-${Date.now().toString(36).toUpperCase()}`;
    const waiver = await this.createWaiver({
      studentProfileId,
      code,
      name: `Bad debt write-off · ${stu[0].admissionNo ?? studentProfileId}`,
      amount: balance,
      reason: dto.reason ?? 'Written off as bad debt',
      documentId: dto.documentId,
    });
    // A write-off IS the authorized action (gated by school:fees:writeoff), so
    // the waiver it produces is approved in the same step — it does not go
    // through the separate approval queue. Mark badDebt + approved, then apply.
    const wid = (waiver as any).id;
    await this.prisma.client.waiver.update({
      where: { id: wid },
      data: { badDebt: true, status: 'approved', approvedById: this.tenant.userId ?? null, approvedAt: new Date() },
    });
    const applied = await this.applyWaiver(wid);
    this.audit.record({ entity: 'Waiver', entityId: wid, action: 'update', newValues: { balance, studentProfileId, badDebtWriteOff: true } });
    return { waiverId: wid, applied };
  }

  /**
   * Shared per-student AR aggregation over school fee documents.
   *
   * Runs on `prisma.raw`, which bypasses the tenancy extension — so the
   * organizationId predicate below is load-bearing, not decorative.
   *
   * Every caller-supplied value is a bound parameter. The previous version
   * interpolated `classId` and `onlyStudentId` straight into the SQL string
   * with hand-rolled quote-doubling as the only defence; that is one missed
   * escape away from injection on a financial query, and quote-doubling is not
   * sufficient under non-standard-conforming-strings settings. `$3`/`$4` are
   * NULL-guarded so a single query text serves both the filtered and unfiltered
   * cases.
   */
  private async studentArRows(org: string, asOf: Date, classId?: string, onlyStudentId?: string) {
    return this.prisma.raw.$queryRawUnsafe<Record<string, any>[]>(
      `SELECT sp."id" AS "studentProfileId",
              COALESCE(p."name", sp."id") AS "studentName",
              sp."admissionNo" AS "admissionNo",
              COALESCE(c."name", '') AS "className",
              SUM(d."amountResidual") AS "balance",
              COUNT(d."id") AS "invoiceCount",
              MIN(d."dueDate") AS "oldestDueDate",
              MAX(CASE WHEN d."dueDate" IS NOT NULL
                  THEN FLOOR(EXTRACT(EPOCH FROM ($1::timestamp - d."dueDate"))/86400) ELSE 0 END) AS "maxDays",
              COALESCE(w."waived", 0) AS "waived"
       FROM "Document" d
       JOIN "StudentProfile" sp ON sp."partnerId" = d."partnerId" AND sp."organizationId" = d."organizationId"
       LEFT JOIN "Partner" p ON p."id" = sp."partnerId"
       LEFT JOIN "SchoolClass" c ON c."id" = sp."currentClassId"
       LEFT JOIN (
         SELECT "studentProfileId", SUM("amount") AS "waived"
         FROM "Waiver" WHERE "organizationId" = $2 AND "applied" = true GROUP BY "studentProfileId"
       ) w ON w."studentProfileId" = sp."id"
       WHERE d."organizationId" = $2
         AND d."documentType" = 'sales_invoice'
         AND d."status" = ANY($3::text[])
         AND d."paymentStatus" IN ('not_paid','partial')
         AND d."amountResidual" > 0
         AND d."sourceType" = ANY($4::text[])
         AND ($1::timestamp >= d."issueDate")
         AND ($5::text IS NULL OR sp."currentClassId" = $5)
         AND ($6::text IS NULL OR sp."id" = $6)
       GROUP BY sp."id", sp."partnerId", p."name", sp."admissionNo", c."name", w."waived"
       HAVING SUM(d."amountResidual") > 0`,
      asOf.toISOString(),
      org,
      [...ACTIVE_FEE_STATUSES],
      [...SCHOOL_FEE_SOURCE_TYPES],
      classId ?? null,
      onlyStudentId ?? null,
    );
  }
}
