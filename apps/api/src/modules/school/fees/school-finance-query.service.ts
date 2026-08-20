import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../kernel/prisma/prisma.service';
import { TenantContextService } from '../../../kernel/tenancy/tenant-context.service';
import { AccountDeterminationService } from '../../accounting/posting/account-determination.service';
import { dec } from '../../../kernel/common/money';
import {
  ACTIVE_FEE_STATUSES,
  OPEN_FEE_WHERE,
  POSTED_FEE_WHERE,
  SCHOOL_FEE_SOURCE_TYPES,
} from './fee-document.constants';

/**
 * SchoolFinanceQueryService — the canonical query/calculation layer for school
 * finance (A1). It READS truth and never invents it.
 *
 * Truth lives in Documents, PaymentAllocations, Waivers, FeeCreditAllocations,
 * FeeAdjustments and the GL. Cached document columns (amountPaid, amountResidual,
 * amountWaived) are performance projections. This service is the ONE place a
 * student fee balance, statement, ledger or reconciliation is computed, so the
 * portal, the bursar statement and the dashboard can never disagree — the exact
 * failure this whole hardening effort exists to close (P0-1, P0-4).
 *
 * FINANCIAL_INVARIANTS §Outstanding AR:
 *   balance = billed − collected − waived − credited − writtenOff ± adjustments
 * where `collected` is SUM(PaymentAllocation), NOT Document.amountPaid.
 */
export interface StudentBalance {
  studentProfileId: string;
  billed: number;
  collected: number;
  waived: number;
  credited: number;
  adjusted: number;
  balance: number;
  invoiceCount: number;
}

export interface LedgerRow {
  date: string;
  ledgerType: string;
  sourceType: string;
  sourceId: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

@Injectable()
export class SchoolFinanceQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly determination: AccountDeterminationService,
  ) {}

  /**
   * The one canonical balance. `collected` is derived from PaymentAllocation —
   * the authoritative record of money received — not from Document.amountPaid,
   * which the P0-3 defect polluted with forgiven and credited value.
   */
  async studentBalance(studentProfileId: string): Promise<StudentBalance> {
    const organizationId = this.tenant.organizationId;
    const student = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId },
      select: { id: true, partnerId: true },
    });
    if (!student) throw new NotFoundException(`Student ${studentProfileId} not found`);

    const [billedAgg, invoiceIds, waivedAgg, adjustments] = await Promise.all([
      // Billed = total of financially-active fee documents.
      this.prisma.client.document.aggregate({
        where: { ...POSTED_FEE_WHERE, organizationId, partnerId: student.partnerId },
        _sum: { totalAmount: true, amountResidual: true },
        _count: { _all: true },
      }),
      // The document ids we count allocations/credits against.
      this.prisma.client.document.findMany({
        where: { ...POSTED_FEE_WHERE, organizationId, partnerId: student.partnerId },
        select: { id: true },
      }),
      // Waived = applied waivers for this student.
      this.prisma.client.waiver.aggregate({
        where: { organizationId, studentProfileId, applied: true },
        _sum: { amount: true },
      }),
      // Posted adjustments net of direction.
      this.prisma.client.feeAdjustment.findMany({
        where: { organizationId, studentProfileId, status: 'posted' },
        select: { direction: true, amount: true },
      }),
    ]);

    const docIds = invoiceIds.map((d) => d.id);
    const [collectedAgg, creditedAgg] = await Promise.all([
      docIds.length
        ? this.prisma.client.paymentAllocation.aggregate({
            where: { organizationId, documentId: { in: docIds } },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
      docIds.length
        ? this.prisma.client.feeCreditAllocation.aggregate({
            where: { organizationId, documentId: { in: docIds }, status: 'posted' },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
    ]);

    const billed = Number(billedAgg._sum.totalAmount ?? 0);
    const collected = Number(collectedAgg._sum.amount ?? 0);
    const waived = Number(waivedAgg._sum.amount ?? 0);
    const credited = Number(creditedAgg._sum.amount ?? 0);
    const adjusted = adjustments.reduce(
      (s, a) => s + (a.direction === 'debit' ? Number(a.amount) : -Number(a.amount)),
      0,
    );

    // The authoritative balance identity. We also carry the residual sum as a
    // cross-check; a divergence between the two is exactly what reconciliation
    // surfaces (A6).
    const balance = billed - collected - waived - credited + adjusted;

    return {
      studentProfileId,
      billed,
      collected,
      waived,
      credited,
      adjusted,
      balance,
      invoiceCount: billedAgg._count._all,
    };
  }

  /**
   * Chronological student ledger (B1) — a typed union of every economic event,
   * with a running balance. Each row carries sourceType/sourceId/reference so a
   * bursar can trace a line back to the waiver or payment that produced it.
   */
  async studentLedger(
    studentProfileId: string,
    range?: { from?: string; to?: string },
  ): Promise<{ studentProfileId: string; rows: LedgerRow[]; closingBalance: number }> {
    const organizationId = this.tenant.organizationId;
    const student = await this.prisma.client.studentProfile.findFirst({
      where: { id: studentProfileId },
      select: { id: true, partnerId: true },
    });
    if (!student) throw new NotFoundException(`Student ${studentProfileId} not found`);

    const from = range?.from ? new Date(range.from) : undefined;
    const to = range?.to ? new Date(range.to) : undefined;

    const docs = await this.prisma.client.document.findMany({
      where: { ...POSTED_FEE_WHERE, organizationId, partnerId: student.partnerId },
      select: { id: true, documentNumber: true, issueDate: true, totalAmount: true, sourceType: true },
    });
    const docIds = docs.map((d) => d.id);

    const [allocations, credits, waivers, adjustments] = await Promise.all([
      docIds.length
        ? this.prisma.client.paymentAllocation.findMany({
            where: { organizationId, documentId: { in: docIds } },
            include: { payment: { select: { paymentNumber: true, paymentDate: true, paymentMethod: true } } },
          })
        : Promise.resolve([] as any[]),
      docIds.length
        ? this.prisma.client.feeCreditAllocation.findMany({
            where: { organizationId, documentId: { in: docIds }, status: 'posted' },
          })
        : Promise.resolve([] as any[]),
      this.prisma.client.waiver.findMany({
        where: { organizationId, studentProfileId, applied: true },
      }),
      this.prisma.client.feeAdjustment.findMany({
        where: { organizationId, studentProfileId, status: 'posted' },
      }),
    ]);

    const rows: Omit<LedgerRow, 'balance'>[] = [];
    for (const d of docs) {
      const isPenalty = d.sourceType === 'school_penalty';
      rows.push({
        date: new Date(d.issueDate).toISOString(),
        ledgerType: isPenalty ? 'PENALTY' : 'INVOICE',
        sourceType: d.sourceType ?? 'school_fee',
        sourceId: d.id,
        reference: d.documentNumber,
        description: isPenalty ? 'Late-fee penalty' : 'Fee invoice',
        debit: Number(d.totalAmount),
        credit: 0,
      });
    }
    for (const a of allocations) {
      rows.push({
        date: new Date(a.payment?.paymentDate ?? a.createdAt).toISOString(),
        ledgerType: 'PAYMENT',
        sourceType: 'payment',
        sourceId: a.paymentId,
        reference: a.payment?.paymentNumber ?? a.paymentId,
        description: `Payment${a.payment?.paymentMethod ? ` (${a.payment.paymentMethod})` : ''}`,
        debit: 0,
        credit: Number(a.amount),
      });
    }
    for (const c of credits) {
      rows.push({
        date: new Date(c.createdAt).toISOString(),
        ledgerType: 'CREDIT_APPLIED',
        sourceType: 'school_fee_credit',
        sourceId: c.feeCreditId,
        reference: c.id.slice(0, 12),
        description: 'Fee credit applied',
        debit: 0,
        credit: Number(c.amount),
      });
    }
    for (const w of waivers) {
      rows.push({
        date: new Date(w.updatedAt ?? w.createdAt).toISOString(),
        ledgerType: w.badDebt ? 'WRITE_OFF' : 'WAIVER',
        sourceType: 'school_waiver',
        sourceId: w.id,
        reference: w.code,
        description: w.name,
        debit: 0,
        credit: Number(w.amount),
      });
    }
    for (const adj of adjustments) {
      const isDebit = adj.direction === 'debit';
      rows.push({
        date: new Date(adj.createdAt).toISOString(),
        ledgerType: 'ADJUSTMENT',
        sourceType: 'school_fee_adjustment',
        sourceId: adj.id,
        reference: adj.code,
        description: adj.reason,
        debit: isDebit ? Number(adj.amount) : 0,
        credit: isDebit ? 0 : Number(adj.amount),
      });
    }

    // Chronological, then running balance. Range filter is applied for display
    // but the opening balance still reflects everything before `from`.
    rows.sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    const withBalance: LedgerRow[] = rows.map((r) => {
      running += r.debit - r.credit;
      return { ...r, balance: running };
    });
    const closingBalance = running;

    const visible = withBalance.filter((r) => {
      const t = new Date(r.date);
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    });

    return { studentProfileId, rows: visible, closingBalance };
  }

  /**
   * Current-state AR ⇄ GL reconciliation (A6). Compares the fee AR subledger
   * (Document.amountResidual over active fee docs) against the GL AR control
   * account, aggregate AND per-student — the latter possible only because
   * JournalLine.partnerId is populated on every AR leg.
   *
   * FINANCIAL_INVARIANTS forbids mixing this with an as-of GL balance.
   */
  async reconcileCurrentArToGl(): Promise<{
    arControlAccountId: string;
    subledgerTotal: number;
    glTotal: number;
    variance: number;
    perStudent: Array<{ partnerId: string; subledger: number; gl: number; variance: number }>;
  }> {
    const organizationId = this.tenant.organizationId;
    const arAccountId = await this.determination.receivableAccount(null, this.prisma.client);

    // Subledger: residual over active fee documents, grouped by partner.
    const subledgerRows = await this.prisma.client.document.groupBy({
      by: ['partnerId'],
      where: { ...OPEN_FEE_WHERE, organizationId },
      _sum: { amountResidual: true },
    });
    const subledgerByPartner = new Map<string, number>();
    for (const r of subledgerRows) {
      if (r.partnerId) subledgerByPartner.set(r.partnerId, Number(r._sum.amountResidual ?? 0));
    }

    // GL: net debit on the AR control account, grouped by partner. Scoped to the
    // student partners in the subledger — every AR movement for a student
    // partner (invoice, payment, waiver, credit, adjustment) belongs to their
    // fee subledger regardless of the journal sourceType, and filtering by
    // sourceType would drop the payment leg (the P0 reconciliation could never
    // have balanced). Non-student AR on other partners is simply not summed.
    const studentPartnerIds = subledgerRows.map((r) => r.partnerId).filter((x): x is string => Boolean(x));
    const studentProfiles = await this.prisma.client.studentProfile.findMany({
      where: { organizationId },
      select: { partnerId: true },
    });
    const allStudentPartnerIds = [...new Set([...studentPartnerIds, ...studentProfiles.map((s) => s.partnerId)])];
    const glByPartner = new Map<string, number>();
    if (allStudentPartnerIds.length) {
      const glRows = await this.prisma.raw.$queryRawUnsafe<Array<{ partnerId: string | null; net: unknown }>>(
        `SELECT jl."partnerId" AS "partnerId",
                SUM(jl."baseDebit" - jl."baseCredit") AS "net"
           FROM "JournalLine" jl
          WHERE jl."organizationId" = $1
            AND jl."accountId" = $2
            AND jl."partnerId" = ANY($3::text[])
          GROUP BY jl."partnerId"`,
        organizationId,
        arAccountId,
        allStudentPartnerIds,
      );
      for (const r of glRows) {
        if (r.partnerId) glByPartner.set(r.partnerId, Number(r.net ?? 0));
      }
    }

    const partners = new Set<string>([...subledgerByPartner.keys(), ...glByPartner.keys()]);
    const perStudent: Array<{ partnerId: string; subledger: number; gl: number; variance: number }> = [];
    let subTotal = 0;
    let glTotal = 0;
    for (const partnerId of partners) {
      const sub = subledgerByPartner.get(partnerId) ?? 0;
      const gl = glByPartner.get(partnerId) ?? 0;
      subTotal += sub;
      glTotal += gl;
      const variance = Number((sub - gl).toFixed(6));
      if (Math.abs(variance) > 0.01) perStudent.push({ partnerId, subledger: sub, gl, variance });
    }

    return {
      arControlAccountId: arAccountId,
      subledgerTotal: Number(subTotal.toFixed(2)),
      glTotal: Number(glTotal.toFixed(2)),
      variance: Number((subTotal - glTotal).toFixed(2)),
      perStudent,
    };
  }

  /**
   * Credit-liability reconciliation (A6): outstanding FeeCredit vs the GL
   * Fee-Credit Liability account.
   */
  async reconcileCreditLiability(): Promise<{ outstanding: number; glBalance: number; variance: number }> {
    const organizationId = this.tenant.organizationId;
    const outstandingAgg = await this.prisma.client.feeCredit.aggregate({
      where: { organizationId, isActive: true },
      _sum: { remaining: true },
    });
    const outstanding = Number(outstandingAgg._sum.remaining ?? 0);

    const gl = await this.prisma.raw.$queryRawUnsafe<Array<{ net: unknown }>>(
      `SELECT COALESCE(SUM(jl."baseCredit" - jl."baseDebit"), 0) AS "net"
         FROM "JournalLine" jl
         JOIN "Account" acc ON acc."id" = jl."accountId"
        WHERE jl."organizationId" = $1 AND acc."code" = 'FEE-CR'`,
      organizationId,
    );
    const glBalance = Number(gl[0]?.net ?? 0);
    return {
      outstanding: Number(outstanding.toFixed(2)),
      glBalance: Number(glBalance.toFixed(2)),
      variance: Number((outstanding - glBalance).toFixed(2)),
    };
  }

  /**
   * List school fee invoices (the first-class invoice model, A1.1), joined to
   * their accounting Document for the financial figures — which live on the
   * Document, never duplicated onto the invoice.
   */
  async listInvoices(params: { studentProfileId?: string; termId?: string; status?: string; page?: number; pageSize?: number }) {
    const organizationId = this.tenant.organizationId;
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 25));
    const where: any = { organizationId };
    if (params.studentProfileId) where.studentProfileId = params.studentProfileId;
    if (params.termId) where.termId = params.termId;
    if (params.status) where.status = params.status;

    const [rows, total] = await Promise.all([
      this.prisma.client.schoolFeeInvoice.findMany({
        where, orderBy: { issueDate: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.client.schoolFeeInvoice.count({ where }),
    ]);
    const docIds = rows.map((r) => r.documentId);
    const docs = docIds.length
      ? await this.prisma.client.document.findMany({
          where: { id: { in: docIds } },
          select: { id: true, documentNumber: true, totalAmount: true, amountResidual: true, amountPaid: true, amountWaived: true, paymentStatus: true },
        })
      : [];
    const docById = new Map(docs.map((d) => [d.id, d]));
    const data = rows.map((r) => {
      const d = docById.get(r.documentId);
      return {
        ...r,
        documentNumber: d?.documentNumber,
        totalAmount: Number(d?.totalAmount ?? 0),
        amountResidual: Number(d?.amountResidual ?? 0),
        amountPaid: Number(d?.amountPaid ?? 0),
        amountWaived: Number(d?.amountWaived ?? 0),
        paymentStatus: d?.paymentStatus,
      };
    });
    return { data, total, page, pageSize };
  }

  async getInvoice(id: string) {
    const organizationId = this.tenant.organizationId;
    const inv = await this.prisma.client.schoolFeeInvoice.findFirst({ where: { id, organizationId } });
    if (!inv) throw new NotFoundException(`Invoice ${id} not found`);
    const doc = await this.prisma.client.document.findFirst({
      where: { id: inv.documentId },
      include: { lines: true, partner: true },
    });
    return { invoice: inv, document: doc };
  }

  /** Canonical refundable entitlement for a partner (A2.1). Reused by refunds. */
  async refundableAmount(partnerId: string, studentProfileId: string): Promise<number> {
    const organizationId = this.tenant.organizationId;
    const [inboundAgg, refundedAgg, convertedAgg, creditAgg] = await Promise.all([
      this.prisma.client.payment.aggregate({
        where: { organizationId, partnerId, direction: 'inbound' },
        _sum: { unallocatedAmount: true },
      }),
      // outbound refunds already paid
      this.prisma.client.payment.aggregate({
        where: { organizationId, partnerId, direction: 'outbound' },
        _sum: { amount: true },
      }),
      // overpayment already converted into a credit (counted once — P1-3)
      this.prisma.client.feeCredit.aggregate({
        where: { organizationId, studentProfileId, source: 'overpayment' },
        _sum: { amount: true },
      }),
      // refundable outstanding credits
      this.prisma.client.feeCredit.findMany({
        where: {
          organizationId,
          studentProfileId,
          isRefundable: true,
          status: { in: ['active', 'partially_applied'] },
        },
        select: { remaining: true },
      }),
    ]);

    const unallocated = Number(inboundAgg._sum.unallocatedAmount ?? 0);
    const alreadyRefunded = Number(refundedAgg._sum.amount ?? 0);
    const converted = Number(convertedAgg._sum.amount ?? 0);
    const refundableCredits = creditAgg.reduce((s, c) => s + Number(c.remaining), 0);

    // Unallocated payment value, minus what has already left as refunds, minus
    // the portion already re-represented as a FeeCredit (entitlement
    // uniqueness), PLUS refundable outstanding credits.
    const fromPayments = Math.max(0, unallocated - alreadyRefunded - converted);
    return Number(dec(fromPayments).plus(refundableCredits).toFixed(6));
  }

  /** Constants re-exported for callers that filter documents themselves. */
  static readonly SOURCE_TYPES = SCHOOL_FEE_SOURCE_TYPES;
  static readonly ACTIVE_STATUSES = ACTIVE_FEE_STATUSES;
}
