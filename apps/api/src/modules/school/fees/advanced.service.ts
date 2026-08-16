import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
import { dec, ZERO } from '../../../kernel/common/money';

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

  async sponsorStatement(sponsorId: string) {
    const organizationId = this.tenant.organizationId;
    const sponsor = await this.prisma.client.partner.findFirst({ where: { id: sponsorId } });
    if (!sponsor) throw new NotFoundException(`Sponsor ${sponsorId} not found`);

    const sponsorships = await this.prisma.client.sponsorship.findMany({
      where: { organizationId, sponsorId, isActive: true },
      include: { studentProfile: true },
    });
    const studentIds = sponsorships.map((s) => s.studentProfileId);
    if (studentIds.length === 0) {
      return { sponsorId, sponsorName: sponsor.name, students: [], totalBilled: 0, totalPaid: 0, totalBalance: 0, totalWaived: 0 };
    }
    const partnerIds = await this.prisma.client.studentProfile.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, partnerId: true },
    });
    const partnerIdSet = [...new Set(partnerIds.map((p) => p.partnerId))];

    const invoices = await this.prisma.client.document.findMany({
      where: {
        organizationId,
        partnerId: { in: partnerIdSet },
        documentType: 'sales_invoice',
        sourceType: { in: ['school_fee', 'school_penalty', 'library_fine', 'school_meal'] },
      },
      select: { id: true, partnerId: true, totalAmount: true, amountResidual: true },
    });
    const waivers = await this.prisma.client.waiver.findMany({
      where: { organizationId, studentProfileId: { in: studentIds }, applied: true },
      select: { amount: true },
    });

    const totalBilled = invoices.reduce((s, d) => s + Number(d.totalAmount), 0);
    const totalBalance = invoices.reduce((s, d) => s + Number(d.amountResidual), 0);
    const totalWaived = waivers.reduce((s, w) => s + Number(w.amount), 0);

    return {
      sponsorId,
      sponsorName: sponsor.name,
      students: sponsorships.map((sp) => ({
        studentProfileId: sp.studentProfileId,
        studentName: (sp.studentProfile as any)?.partner?.name ?? sp.studentProfileId,
      })),
      totalBilled,
      totalPaid: totalBilled - totalBalance,
      totalBalance,
      totalWaived,
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
      },
    });
    await this.audit.record({ entity: 'Waiver', entityId: row.id, action: 'create', newValues: row });
    return row;
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

    const student = await this.prisma.client.studentProfile.findFirst({ where: { id: waiver.studentProfileId } });
    if (!student) throw new NotFoundException(`Student ${waiver.studentProfileId} not found`);

    return this.prisma.client.$transaction(async (tx: any) => {
      const docs = await tx.document.findMany({
        where: {
          organizationId,
          partnerId: student.partnerId,
          documentType: 'sales_invoice',
          paymentStatus: { in: ['not_paid', 'partial'] },
          sourceType: { in: ['school_fee', 'school_penalty', 'library_fine', 'school_meal'] },
          amountResidual: { gt: 0 },
          ...(waiver.documentId ? { id: waiver.documentId } : {}),
        },
        orderBy: { issueDate: 'asc' },
      });

      let remaining = Number(waiver.amount);
      const settled: string[] = [];
      for (const doc of docs) {
        if (remaining <= 0) break;
        const residual = Number(doc.amountResidual);
        if (residual <= 0) continue;
        const take = Math.min(remaining, residual);
        const newResidual = residual - take;
        await tx.document.update({
          where: { id: doc.id },
          data: {
            amountResidual: newResidual,
            amountPaid: Number(doc.amountPaid) + take,
            paymentStatus: newResidual <= 0 ? 'paid' : 'partial',
          },
        });
        remaining -= take;
        settled.push(doc.id);
      }
      if (remaining > 0) {
        // Waiver exceeds open invoices — leave the remainder unapplied (can be
        // applied later when new invoices are generated).
        await tx.waiver.update({ where: { id: waiver.id }, data: { applied: false, reason: `${waiver.reason ?? ''} (partial: ${remaining} unapplied)` } });
        return { ...waiver, applied: false, settledDocumentIds: settled };
      }

      // GL: Dr Waiver Expense / Cr AR.
      const arAccount = await this.accounts.receivableAccount(null, tx);
      const waiverAccount = await this.resolver.ensureByCode(
        'FEE-WAIVER',
        { name: 'Fee Waiver Expense', categoryKey: 'expense', mappingKey: 'fee_waiver' },
        tx,
      );
      const appliedAmount = Number(waiver.amount) - remaining;
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

      const updated = await tx.waiver.update({ where: { id: waiver.id }, data: { applied: true } });
      await this.audit.recordInTx(tx, { entity: 'Waiver', entityId: waiver.id, action: 'update', newValues: { settledDocumentIds: settled } });
      this.events.publish(EVENTS.SchoolWaiverApplied, {
        organizationId,
        waiverId: waiver.id,
        studentProfileId: waiver.studentProfileId,
        amount: appliedAmount.toString(),
      });
      return { ...updated, settledDocumentIds: settled };
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
  }) {
    const organizationId = this.tenant.organizationId;
    const student = await this.prisma.client.studentProfile.findFirst({ where: { id: dto.studentProfileId } });
    if (!student) throw new NotFoundException(`Student ${dto.studentProfileId} not found`);
    const amount = dec(dto.amount);
    if (amount.lessThanOrEqualTo(ZERO)) throw new BadRequestException('Credit amount must be positive');

    return this.prisma.client.$transaction(async (tx: any) => {
      const code = await this.sequence.next(`feecredit:${new Date().getUTCFullYear()}`, { prefix: 'CR-', padding: 6 }, tx);
      const row = await tx.feeCredit.create({
        data: {
          organizationId,
          studentProfileId: dto.studentProfileId,
          code,
          amount,
          remaining: amount,
          source: dto.source ?? 'advance',
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
        source: dto.source ?? 'advance',
      });
      return row;
    });
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
      const credits = await tx.feeCredit.findMany({
        where: { organizationId, studentProfileId, isActive: true, remaining: { gt: 0 } },
        orderBy: { createdAt: 'asc' },
      });
      const docs = await tx.document.findMany({
        where: {
          organizationId,
          partnerId: student.partnerId,
          documentType: 'sales_invoice',
          paymentStatus: { in: ['not_paid', 'partial'] },
          sourceType: { in: ['school_fee', 'school_penalty', 'library_fine', 'school_meal'] },
          amountResidual: { gt: 0 },
        },
        orderBy: { issueDate: 'asc' },
      });

      const liabilityAccount = await this.resolver.ensureByCode(
        'FEE-CR',
        { name: 'Fee Credit Liability', categoryKey: 'current_liability', mappingKey: 'fee_credit' },
        tx,
      );
      const arAccount = await this.accounts.receivableAccount(null, tx);

      // Running balances as plain numbers (credit drawdown is not sub-cent
      // sensitive). Each credit's new `remaining` is persisted at the end.
      let creditIdx = 0;
      let creditRemaining = credits.length ? Number(credits[0].remaining) : 0;
      let totalApplied = 0;
      const usedByCredit = new Map<string, number>();

      for (const doc of docs) {
        if (creditIdx >= credits.length || creditRemaining <= 0) break;
        const residual = Number(doc.amountResidual);
        if (residual <= 0) continue;
        const take = Math.min(creditRemaining, residual);
        const newResidual = residual - take;
        await tx.document.update({
          where: { id: doc.id },
          data: {
            amountResidual: newResidual,
            amountPaid: Number(doc.amountPaid) + take,
            paymentStatus: newResidual <= 0 ? 'paid' : 'partial',
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
        creditRemaining -= take;
        totalApplied += take;
        const cid = credits[creditIdx].id;
        usedByCredit.set(cid, (usedByCredit.get(cid) ?? 0) + take);
        if (creditRemaining <= 0) {
          creditIdx++;
          if (creditIdx < credits.length) creditRemaining = Number(credits[creditIdx].remaining);
        }
      }

      // Persist drawn-down balances.
      for (const [id, used] of usedByCredit) {
        const credit = credits.find((c: any) => c.id === id)!;
        const newRemaining = Number(credit.remaining) - used;
        await tx.feeCredit.update({
          where: { id },
          data: { remaining: newRemaining, isActive: newRemaining > 0 },
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
      where: {
        organizationId,
        documentType: 'sales_invoice',
        status: { in: ['posted'] },
        paymentStatus: { in: ['not_paid', 'partial'] },
        amountResidual: { gt: 0 },
        sourceType: { in: ['school_fee', 'school_penalty', 'library_fine', 'school_meal'] },
      },
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
}
