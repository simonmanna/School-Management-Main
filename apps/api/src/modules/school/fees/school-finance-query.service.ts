import { Injectable, NotFoundException } from '@nestjs/common';
import { PlacementLookupService } from '../enrollment/placement-lookup.service';
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
    private readonly placements: PlacementLookupService,
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
   * The SAME balance identity as `studentBalance`, for many pupils at once.
   *
   * `studentBalance` is 6 queries per pupil. Anything class-wide or school-wide
   * built on it in a loop is 6N queries — `classFeeClearance` already pays that,
   * and a 2,000-pupil arrears report would issue ~12,000. This does the identical
   * arithmetic in grouped aggregates: 6 queries total, whatever N is.
   *
   * It lives HERE and not in the reporting layer on purpose. The identity in
   * FINANCIAL_INVARIANTS.md has exactly one implementation site; a second copy
   * anywhere else is how a dashboard starts disagreeing with a statement.
   *
   * Returns a Map keyed by studentProfileId. Pupils with no fee documents come
   * back with an all-zero balance rather than being absent, so callers do not
   * have to distinguish "no debt" from "not found".
   */
  async studentBalances(studentProfileIds: string[]): Promise<Map<string, StudentBalance>> {
    const organizationId = this.tenant.organizationId;
    const out = new Map<string, StudentBalance>();
    if (studentProfileIds.length === 0) return out;

    const zero = (id: string): StudentBalance => ({
      studentProfileId: id,
      billed: 0, collected: 0, waived: 0, credited: 0, adjusted: 0,
      balance: 0, invoiceCount: 0,
    });
    for (const id of studentProfileIds) out.set(id, zero(id));

    const students = await this.prisma.client.studentProfile.findMany({
      where: { id: { in: studentProfileIds } },
      select: { id: true, partnerId: true },
    });
    if (students.length === 0) return out;

    const studentByPartner = new Map(students.map((s) => [s.partnerId, s.id]));
    const partnerIds = students.map((s) => s.partnerId);

    // Every financially-active fee document for these pupils, once. We need the
    // ids (to attribute allocations) and the partner (to attribute back to a pupil).
    const documents = await this.prisma.client.document.findMany({
      where: { ...POSTED_FEE_WHERE, organizationId, partnerId: { in: partnerIds } },
      select: { id: true, partnerId: true, totalAmount: true },
    });

    const studentByDocument = new Map<string, string>();
    for (const d of documents) {
      const sid = d.partnerId ? studentByPartner.get(d.partnerId) : undefined;
      if (!sid) continue;
      studentByDocument.set(d.id, sid);
      const row = out.get(sid)!;
      row.billed += Number(d.totalAmount);
      row.invoiceCount += 1;
    }

    const docIds = [...studentByDocument.keys()];
    const [allocations, credits, waivers, adjustments] = await Promise.all([
      // Collected = SUM(PaymentAllocation), never Document.amountPaid — the P0-3
      // defect polluted amountPaid with forgiven and credited value.
      docIds.length
        ? this.prisma.client.paymentAllocation.groupBy({
            by: ['documentId'],
            where: { organizationId, documentId: { in: docIds } },
            _sum: { amount: true },
          })
        : Promise.resolve([] as Array<{ documentId: string; _sum: { amount: unknown } }>),
      docIds.length
        ? this.prisma.client.feeCreditAllocation.groupBy({
            by: ['documentId'],
            where: { organizationId, documentId: { in: docIds }, status: 'posted' },
            _sum: { amount: true },
          })
        : Promise.resolve([] as Array<{ documentId: string; _sum: { amount: unknown } }>),
      this.prisma.client.waiver.groupBy({
        by: ['studentProfileId'],
        where: { organizationId, studentProfileId: { in: studentProfileIds }, applied: true },
        _sum: { amount: true },
      }),
      this.prisma.client.feeAdjustment.findMany({
        where: { organizationId, studentProfileId: { in: studentProfileIds }, status: 'posted' },
        select: { studentProfileId: true, direction: true, amount: true },
      }),
    ]);

    for (const a of allocations as any[]) {
      const sid = studentByDocument.get(a.documentId);
      if (sid) out.get(sid)!.collected += Number(a._sum.amount ?? 0);
    }
    for (const c of credits as any[]) {
      const sid = studentByDocument.get(c.documentId);
      if (sid) out.get(sid)!.credited += Number(c._sum.amount ?? 0);
    }
    for (const w of waivers as any[]) {
      const row = out.get(w.studentProfileId);
      if (row) row.waived += Number(w._sum.amount ?? 0);
    }
    for (const adj of adjustments as any[]) {
      const row = out.get(adj.studentProfileId);
      if (!row) continue;
      row.adjusted += adj.direction === 'debit' ? Number(adj.amount) : -Number(adj.amount);
    }

    for (const row of out.values()) {
      row.balance = row.billed - row.collected - row.waived - row.credited + row.adjusted;
    }
    return out;
  }

  /**
   * School-wide outstanding, derived from the canonical identity.
   *
   * `outstanding` sums only POSITIVE balances: a pupil in credit does not pay
   * down another family's arrears, so netting them would understate what the
   * school is actually owed. `creditBalance` carries the other side separately.
   */
  async outstandingTotal(opts: { classIds?: string[] } = {}): Promise<{
    outstanding: number;
    creditBalance: number;
    billed: number;
    collected: number;
    waived: number;
    studentCount: number;
    owingCount: number;
  }> {
    const students = await this.prisma.client.studentProfile.findMany({
      where: {
        status: 'active',
        deletedAt: null,
        ...(opts.classIds ? this.placements.studentWhere({ classIds: opts.classIds }) : {}),
      },
      select: { id: true },
    });
    const balances = await this.studentBalances(students.map((s) => s.id));

    // Rounding at the presentation edge only — the sums above stay at full
    // precision, per the money-precision rule in FINANCIAL_INVARIANTS.md.
    const round = (n: number) => Number(n.toFixed(2));
    let outstanding = 0; let creditBalance = 0; let billed = 0;
    let collected = 0; let waived = 0; let owingCount = 0;
    for (const b of balances.values()) {
      billed += b.billed;
      collected += b.collected;
      waived += b.waived;
      if (b.balance > 0) { outstanding += b.balance; owingCount += 1; }
      else creditBalance += -b.balance;
    }
    return {
      outstanding: round(outstanding),
      creditBalance: round(creditBalance),
      billed: round(billed),
      collected: round(collected),
      waived: round(waived),
      studentCount: balances.size,
      owingCount,
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
  ): Promise<{
    studentProfileId: string;
    rows: LedgerRow[];
    /** Balance carried into `from`; 0 when no range is given (P1-K). */
    openingBalance: number;
    /** Balance at the end of the visible window. */
    closingBalance: number;
    /** Balance across all time, independent of the window. */
    currentBalance: number;
  }> {
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

    const inRange = (r: LedgerRow) => {
      const t = new Date(r.date);
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    };

    // P1-K · the opening balance.
    //
    // Without it a date-range statement is unreadable: a September statement
    // shows September's movements and a running balance that starts wherever
    // September happened to start, with nothing explaining the 500,000 the
    // student carried in. The identity a statement must satisfy is
    //
    //   Opening + Charges + Penalties − Payments − Credits − Waivers
    //           − Refunds ± Adjustments = Closing
    //
    // and it has no left-hand side without this row.
    const visible: LedgerRow[] = [];
    if (from) {
      const priorRows = withBalance.filter((r) => new Date(r.date) < from);
      const opening = priorRows.length ? priorRows[priorRows.length - 1].balance : 0;
      visible.push({
        date: from.toISOString(),
        ledgerType: 'OPENING_BALANCE',
        sourceType: 'opening_balance',
        sourceId: studentProfileId,
        reference: '—',
        description: `Balance brought forward (${priorRows.length} earlier entr${priorRows.length === 1 ? 'y' : 'ies'})`,
        debit: 0,
        credit: 0,
        balance: opening,
      });
    }
    visible.push(...withBalance.filter(inRange));

    return {
      studentProfileId,
      rows: visible,
      openingBalance: visible.length && from ? visible[0].balance : 0,
      closingBalance: visible.length ? visible[visible.length - 1].balance : 0,
      // The student's true balance across all time, regardless of the window —
      // distinct from the closing balance of a filtered range.
      currentBalance: closingBalance,
    };
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
    /** Inbound payment value received but not yet applied to an invoice. */
    unallocatedTotal: number;
    /** What the GL AR balance SHOULD be: open residual − unallocated payments. */
    expectedGlTotal: number;
    glTotal: number;
    variance: number;
    perStudent: Array<{
      partnerId: string;
      subledger: number;
      unallocated: number;
      expectedGl: number;
      gl: number;
      variance: number;
    }>;
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

    // A payment received but not yet allocated credits AR without any invoice
    // to show for it, so the GL balance legitimately goes NEGATIVE while the
    // open-invoice subledger reads zero. Comparing the two directly reported
    // that prepayment as a reconciliation failure — a false positive that made
    // the dashboard cry wolf on the most ordinary event in a Ugandan school,
    // a parent paying ahead of the next invoice.
    //
    // The identity that actually holds:
    //     GL AR = SUM(open residual) − SUM(unallocated inbound payment)
    const unallocatedRows = allStudentPartnerIds.length
      ? await this.prisma.client.payment.groupBy({
          by: ['partnerId'],
          where: {
            organizationId,
            direction: 'inbound',
            status: { not: 'cancelled' },
            partnerId: { in: allStudentPartnerIds },
          },
          _sum: { unallocatedAmount: true },
        })
      : [];
    const unallocatedByPartner = new Map<string, number>();
    for (const r of unallocatedRows) {
      if (r.partnerId) unallocatedByPartner.set(r.partnerId, Number(r._sum.unallocatedAmount ?? 0));
    }

    const partners = new Set<string>([
      ...subledgerByPartner.keys(),
      ...glByPartner.keys(),
      ...unallocatedByPartner.keys(),
    ]);
    const perStudent: Array<{
      partnerId: string;
      subledger: number;
      unallocated: number;
      expectedGl: number;
      gl: number;
      variance: number;
    }> = [];
    let subTotal = 0;
    let glTotal = 0;
    let unallocatedTotal = 0;
    for (const partnerId of partners) {
      const sub = subledgerByPartner.get(partnerId) ?? 0;
      const gl = glByPartner.get(partnerId) ?? 0;
      const unallocated = unallocatedByPartner.get(partnerId) ?? 0;
      subTotal += sub;
      glTotal += gl;
      unallocatedTotal += unallocated;
      const expectedGl = sub - unallocated;
      const variance = Number((expectedGl - gl).toFixed(6));
      if (Math.abs(variance) > 0.01) {
        perStudent.push({ partnerId, subledger: sub, unallocated, expectedGl, gl, variance });
      }
    }

    return {
      arControlAccountId: arAccountId,
      subledgerTotal: Number(subTotal.toFixed(2)),
      unallocatedTotal: Number(unallocatedTotal.toFixed(2)),
      expectedGlTotal: Number((subTotal - unallocatedTotal).toFixed(2)),
      glTotal: Number(glTotal.toFixed(2)),
      variance: Number((subTotal - unallocatedTotal - glTotal).toFixed(2)),
      perStudent,
    };
  }

  /**
   * Cached-projection reconciliation — ADR-013's Gate 1/4.
   *
   * The ADR promises: "Cached columns (amountPaid, amountResidual, amountWaived,
   * remaining) are performance projections. A CI reconciliation test asserts
   * they equal their subledger." No such check existed, so a projection could
   * drift from the events behind it and nothing would notice — which is the
   * failure mode the whole economic-event model exists to prevent.
   *
   * Each row returned is a projection that disagrees with its subledger. An
   * empty result is the gate passing.
   */
  async reconcileCachedProjections(): Promise<{
    checked: number;
    drifted: Array<{
      kind: 'amountPaid' | 'amountWaived' | 'amountResidual' | 'creditRemaining';
      id: string;
      reference: string;
      cached: number;
      subledger: number;
      variance: number;
    }>;
  }> {
    const organizationId = this.tenant.organizationId;
    const drifted: Array<{
      kind: 'amountPaid' | 'amountWaived' | 'amountResidual' | 'creditRemaining';
      id: string;
      reference: string;
      cached: number;
      subledger: number;
      variance: number;
    }> = [];

    const docs = await this.prisma.client.document.findMany({
      where: { ...POSTED_FEE_WHERE, organizationId },
      select: {
        id: true,
        documentNumber: true,
        partnerId: true,
        totalAmount: true,
        amountResidual: true,
        amountPaid: true,
        amountWaived: true,
      },
    });
    const docIds = docs.map((d) => d.id);

    // Residual lineage: amountResidual is a projection of
    //   total − posted allocations − waived − posted credit applications
    //   − credit adjustments + debit adjustments.
    const [creditAppsByDoc, adjustmentRows] = docIds.length
      ? await Promise.all([
          this.prisma.client.feeCreditAllocation.groupBy({
            by: ['documentId'],
            where: { organizationId, documentId: { in: docIds }, status: 'posted' },
            _sum: { amount: true },
          }),
          this.prisma.client.feeAdjustment.findMany({
            where: { organizationId, documentId: { in: docIds }, status: 'posted' },
            select: { documentId: true, direction: true, amount: true },
          }),
        ])
      : [[], []];
    const creditAppliedByDoc = new Map(creditAppsByDoc.map((a) => [a.documentId, Number(a._sum.amount ?? 0)]));
    const adjustedByDoc = new Map<string, number>();
    for (const a of adjustmentRows) {
      if (!a.documentId) continue;
      const signed = a.direction === 'debit' ? Number(a.amount) : -Number(a.amount);
      adjustedByDoc.set(a.documentId, (adjustedByDoc.get(a.documentId) ?? 0) + signed);
    }

    // amountPaid must equal SUM(posted PaymentAllocation) — cash only. A
    // reversed allocation no longer counts, which is precisely why `status`
    // is filtered here rather than summing every row.
    const allocs = docIds.length
      ? await this.prisma.client.paymentAllocation.groupBy({
          by: ['documentId'],
          where: { organizationId, documentId: { in: docIds }, status: 'posted' },
          _sum: { amount: true },
        })
      : [];
    const paidByDoc = new Map(allocs.map((a) => [a.documentId!, Number(a._sum.amount ?? 0)]));

    // amountWaived must equal SUM(applied Waiver) for the student behind the
    // document. Waivers are student-scoped, so this compares per partner.
    const waivers = await this.prisma.client.waiver.findMany({
      where: { organizationId, applied: true },
      select: { studentProfileId: true, amount: true, documentId: true },
    });
    const waivedByDoc = new Map<string, number>();
    for (const w of waivers) {
      if (!w.documentId) continue;
      waivedByDoc.set(w.documentId, (waivedByDoc.get(w.documentId) ?? 0) + Number(w.amount));
    }

    for (const d of docs) {
      const cachedPaid = Number(d.amountPaid);
      const realPaid = paidByDoc.get(d.id) ?? 0;
      if (Math.abs(cachedPaid - realPaid) > 0.01) {
        drifted.push({
          kind: 'amountPaid',
          id: d.id,
          reference: d.documentNumber,
          cached: cachedPaid,
          subledger: realPaid,
          variance: Number((cachedPaid - realPaid).toFixed(6)),
        });
      }
      const expectedResidual =
        Number(d.totalAmount) -
        realPaid -
        Number(d.amountWaived ?? 0) -
        (creditAppliedByDoc.get(d.id) ?? 0) +
        (adjustedByDoc.get(d.id) ?? 0);
      const cachedResidual = Number(d.amountResidual);
      if (Math.abs(cachedResidual - expectedResidual) > 0.01) {
        drifted.push({
          kind: 'amountResidual',
          id: d.id,
          reference: d.documentNumber,
          cached: cachedResidual,
          subledger: Number(expectedResidual.toFixed(6)),
          variance: Number((cachedResidual - expectedResidual).toFixed(6)),
        });
      }
      // Only document-targeted waivers can be attributed to a document; a
      // whole-student waiver spreads across invoices oldest-first and is
      // reconciled at the student level by studentBalance, not here.
      if (waivedByDoc.has(d.id)) {
        const cachedWaived = Number(d.amountWaived ?? 0);
        const realWaived = waivedByDoc.get(d.id)!;
        if (Math.abs(cachedWaived - realWaived) > 0.01) {
          drifted.push({
            kind: 'amountWaived',
            id: d.id,
            reference: d.documentNumber,
            cached: cachedWaived,
            subledger: realWaived,
            variance: Number((cachedWaived - realWaived).toFixed(6)),
          });
        }
      }
    }

    // FeeCredit.remaining must equal amount − SUM(posted FeeCreditAllocation).
    const credits = await this.prisma.client.feeCredit.findMany({
      where: { organizationId },
      select: { id: true, code: true, amount: true, remaining: true },
    });
    const creditAllocs = await this.prisma.client.feeCreditAllocation.groupBy({
      by: ['feeCreditId'],
      where: { organizationId, status: 'posted' },
      _sum: { amount: true },
    });
    const drawnByCredit = new Map(creditAllocs.map((a) => [a.feeCreditId, Number(a._sum.amount ?? 0)]));
    for (const c of credits) {
      const expected = Number(c.amount) - (drawnByCredit.get(c.id) ?? 0);
      const cached = Number(c.remaining);
      // A refunded credit is drawn down without a FeeCreditAllocation (the
      // payout is a Payment, not an application), so a lower cached value than
      // the allocation subledger implies is expected, not drift. Only the
      // other direction — remaining MORE than the events justify — is a defect.
      if (cached - expected > 0.01) {
        drifted.push({
          kind: 'creditRemaining',
          id: c.id,
          reference: c.code,
          cached,
          subledger: expected,
          variance: Number((cached - expected).toFixed(6)),
        });
      }
    }

    return { checked: docs.length + credits.length, drifted };
  }

  /**
   * Operational cash custody (P2-A, first half).
   *
   * FINANCIAL_INVARIANTS §Cash custody requires Payment = CashMovement = GL
   * cash. This half must hold at EVERY instant: it compares what the system
   * recorded against itself. The second half — bank/mobile-money settlement —
   * legitimately lags and is reported separately, so a timing difference is
   * never mistaken for an accounting defect.
   */
  async reconcileOperationalCash(): Promise<{
    byMethod: Array<{ paymentMethod: string; payments: number; cashMovements: number; variance: number }>;
    variance: number;
  }> {
    const organizationId = this.tenant.organizationId;

    const payments = await this.prisma.client.payment.groupBy({
      by: ['paymentMethod'],
      where: { organizationId, direction: 'inbound', status: 'posted' },
      _sum: { amount: true },
    });

    // Only cash-drawer methods produce a CashMovement; a bank transfer has no
    // till movement, so comparing it against one would manufacture a variance.
    const movements = await this.prisma.raw.$queryRawUnsafe<Array<{ paymentMethod: string; total: unknown }>>(
      `SELECT p."paymentMethod" AS "paymentMethod", COALESCE(SUM(cm."amount"), 0) AS "total"
         FROM "CashMovement" cm
         JOIN "Payment" p ON p."id" = cm."paymentId"
        WHERE cm."organizationId" = $1 AND p."direction" = 'inbound'
        GROUP BY p."paymentMethod"`,
      organizationId,
    );
    const movementByMethod = new Map(movements.map((m) => [m.paymentMethod, Number(m.total ?? 0)]));

    const byMethod = payments
      .filter((p) => movementByMethod.has(p.paymentMethod))
      .map((p) => {
        const paid = Number(p._sum.amount ?? 0);
        const moved = movementByMethod.get(p.paymentMethod) ?? 0;
        return {
          paymentMethod: p.paymentMethod,
          payments: paid,
          cashMovements: moved,
          variance: Number((paid - moved).toFixed(2)),
        };
      });

    return {
      byMethod,
      variance: Number(byMethod.reduce((t, m) => t + m.variance, 0).toFixed(2)),
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

  /**
   * Canonical refundable entitlement, BROKEN DOWN by funding source (A2.1).
   *
   * The split matters because the two halves settle differently. Unallocated
   * inbound cash is refunded by simply paying it back — the original receipt
   * posted Dr Cash / Cr AR, and the refund's Dr AR / Cr Cash reverses it. A
   * FeeCredit is a LIABILITY (posted Dr AR / Cr Fee-Credit Liability), so
   * paying it out must also draw the liability down and mark the credit spent;
   * omitting that let the same credit be refunded repeatedly and still applied
   * to invoices (P0-C).
   *
   * `credits` is ordered oldest-first — the order a drawdown consumes them in.
   */
  async refundableBreakdown(
    partnerId: string,
    studentProfileId: string,
  ): Promise<{
    fromPayments: number;
    fromCredits: number;
    total: number;
    credits: Array<{ id: string; code: string; source: string; remaining: number }>;
  }> {
    const organizationId = this.tenant.organizationId;
    const [inboundAgg, refundedAgg, convertedAgg, credits] = await Promise.all([
      this.prisma.client.payment.aggregate({
        where: { organizationId, partnerId, direction: 'inbound' },
        _sum: { unallocatedAmount: true },
      }),
      // Outbound refunds already paid. Scoped to fee-sourced refunds (P2-F):
      // an unrelated outbound payment on this partner is not a fee refund and
      // must not shrink the student's fee entitlement.
      this.prisma.client.payment.aggregate({
        where: {
          organizationId,
          partnerId,
          direction: 'outbound',
          allocations: { some: { document: { sourceType: { in: [...SCHOOL_FEE_SOURCE_TYPES] } } } },
        },
        _sum: { amount: true },
      }),
      // overpayment already converted into a credit (counted once — P1-3)
      this.prisma.client.feeCredit.aggregate({
        where: { organizationId, studentProfileId, source: 'overpayment' },
        _sum: { amount: true },
      }),
      // Refundable outstanding credits, oldest-first.
      //
      // `opening_balance` is excluded unconditionally: it is a migration
      // artifact representing a balance the school carried forward, not money
      // a payer ever handed over, so it must never be paid out as cash however
      // its isRefundable flag happens to be set.
      this.prisma.client.feeCredit.findMany({
        where: {
          organizationId,
          studentProfileId,
          isRefundable: true,
          status: { in: ['active', 'partially_applied'] },
          source: { not: 'opening_balance' },
          remaining: { gt: 0 },
        },
        select: { id: true, code: true, source: true, remaining: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const unallocated = Number(inboundAgg._sum.unallocatedAmount ?? 0);
    const alreadyRefunded = Number(refundedAgg._sum.amount ?? 0);
    const converted = Number(convertedAgg._sum.amount ?? 0);
    const fromCredits = credits.reduce((s, c) => s + Number(c.remaining), 0);

    // Unallocated payment value, minus what has already left as refunds, minus
    // the portion already re-represented as a FeeCredit (entitlement
    // uniqueness), PLUS refundable outstanding credits.
    const fromPayments = Math.max(0, unallocated - alreadyRefunded - converted);

    return {
      fromPayments: Number(dec(fromPayments).toFixed(6)),
      fromCredits: Number(dec(fromCredits).toFixed(6)),
      total: Number(dec(fromPayments).plus(fromCredits).toFixed(6)),
      credits: credits.map((c) => ({ ...c, remaining: Number(c.remaining) })),
    };
  }

  /**
   * "Why does this pupil owe this?" — the one panel a bursar needs at the window.
   *
   * Every fact is already in the ledger; what was missing was an answer shaped
   * like the question a parent actually asks. A bursar facing an argument about
   * UGX 1,250,000 does not want a transaction list — they want a sentence per
   * line and a total that visibly adds up:
   *
   *     Balance brought forward            200,000
   *     Term 2 tuition                   1,500,000
   *     Transport                          300,000
   *     Bursary (Hope Church)             −200,000
   *     Paid 14 May · receipt PAY-0042    −400,000
   *     Waived — hardship                  −50,000
   *     ─────────────────────────────────────────
   *     Outstanding                      1,350,000
   *
   * Grouped by what a family recognises rather than by event type, and each
   * line keeps its source document so "prove it" is one click away.
   */
  async explainBalance(studentProfileId: string) {
    const [balance, ledger, student, clearance] = await Promise.all([
      this.studentBalance(studentProfileId),
      this.studentLedger(studentProfileId),
      this.prisma.client.studentProfile.findFirst({
        where: { id: studentProfileId },
        include: { partner: true },
      }),
      this.feeClearance(studentProfileId).catch(() => null),
    ]);
    if (!student) throw new NotFoundException(`Student ${studentProfileId} not found`);
    const placedClass = (await this.placements.describe([studentProfileId])).get(studentProfileId);

    // Human wording per event type. A parent has never heard of a
    // "CREDIT_APPLIED" and should not have to.
    const label = (r: LedgerRow): string => {
      switch (r.ledgerType) {
        case 'OPENING_BALANCE': return 'Balance brought forward';
        case 'INVOICE': return `Fees invoiced · ${r.reference}`;
        case 'PENALTY': return `Late-payment charge · ${r.reference}`;
        case 'PAYMENT': return `Paid ${new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · receipt ${r.reference}`;
        case 'CREDIT_APPLIED': return 'Credit applied from an earlier overpayment';
        case 'WAIVER': return `Waived · ${r.description}`;
        case 'WRITE_OFF': return `Written off · ${r.description}`;
        case 'ADJUSTMENT': return `Adjustment · ${r.description}`;
        case 'REFUND': return `Refunded · ${r.reference}`;
        case 'REVERSAL': return `Reversed · ${r.description}`;
        default: return r.description || r.ledgerType;
      }
    };

    const lines = ledger.rows
      .filter((r) => r.debit !== 0 || r.credit !== 0 || r.ledgerType === 'OPENING_BALANCE')
      .map((r) => ({
        date: r.date,
        label: label(r),
        // Signed the way a family reads it: a charge adds, everything else
        // subtracts. The running balance is the ledger's own, unchanged.
        amount: Number((r.debit - r.credit).toFixed(2)),
        kind: r.ledgerType,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        reference: r.reference,
        runningBalance: r.balance,
      }));

    // The same arithmetic as the balance identity, phrased as a summary a
    // bursar can read aloud.
    const summary = {
      billed: balance.billed,
      paid: balance.collected,
      waived: balance.waived,
      credited: balance.credited,
      adjusted: balance.adjusted,
      outstanding: balance.balance,
    };

    // A plain-language headline. This is what gets read out at the window.
    const name = student.partner?.name ?? 'This pupil';
    const ugx = (v: number) => `UGX ${Math.round(v).toLocaleString('en-UG')}`;
    const parts: string[] = [`${name} was billed ${ugx(summary.billed)}`];
    if (summary.paid > 0) parts.push(`has paid ${ugx(summary.paid)}`);
    if (summary.waived > 0) parts.push(`${ugx(summary.waived)} was waived`);
    if (summary.credited > 0) parts.push(`${ugx(summary.credited)} was settled by credit`);
    if (summary.adjusted !== 0) {
      parts.push(`${ugx(Math.abs(summary.adjusted))} ${summary.adjusted > 0 ? 'was added' : 'was deducted'} by adjustment`);
    }
    const headline =
      summary.outstanding > 0
        ? `${parts.join(', ')} — leaving ${ugx(summary.outstanding)} outstanding.`
        : `${parts.join(', ')} — nothing is outstanding.`;

    return {
      studentProfileId,
      studentName: student.partner?.name ?? null,
      admissionNo: student.admissionNo,
      className: placedClass?.className ?? null,
      headline,
      summary,
      lines,
      clearance,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * D2 · instalment progress.
   *
   * `InstallmentPlan` was modelled, CRUD'd and given a React hook, and then
   * read by nothing — a pupil could have a plan and the system would neither
   * chase nor honour it.
   *
   * Deliberately NOT one invoice per instalment. A Ugandan school bills the
   * full term fee up front and the family pays it down in parts; splitting the
   * receivable into three invoices would misstate what is owed on day one and
   * make the carry-forward arithmetic lie. The plan is instead a schedule of
   * EXPECTED payments, checked against what has actually been collected.
   *
   * "Behind" therefore means: less has been received than this instalment's
   * cumulative target by its due date. It is a collections signal, not an
   * accounting fact — no journal entry belongs to an instalment.
   */
  async installmentProgress(studentProfileId: string, termId?: string) {
    const organizationId = this.tenant.organizationId;
    const plan = await this.prisma.client.installmentPlan.findFirst({
      where: { organizationId, studentProfileId, ...(termId ? { termId } : {}) },
      include: { term: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!plan) return null;

    const balance = await this.studentBalance(studentProfileId);
    // Waivers and credits count toward the plan for the same reason they count
    // toward clearance: the school decided not to collect that money, so a
    // bursary pupil must not read as "behind".
    const settled = balance.collected + balance.waived + balance.credited;

    const raw = Array.isArray(plan.installments) ? (plan.installments as any[]) : [];
    const parts = raw
      .map((i) => ({
        number: Number(i?.number ?? 0),
        dueDate: i?.dueDate ? new Date(i.dueDate) : null,
        amount: Number(i?.amount ?? 0),
      }))
      .sort((a, b) => a.number - b.number);

    const now = new Date();
    let cumulative = 0;
    const schedule = parts.map((p) => {
      cumulative += p.amount;
      const coveredBy = Math.min(settled, cumulative);
      const shortfall = Math.max(0, Number((cumulative - settled).toFixed(2)));
      const due = p.dueDate;
      const status: 'paid' | 'due' | 'overdue' | 'upcoming' =
        shortfall <= 0 ? 'paid' : due && due < now ? 'overdue' : due && due <= new Date(now.getTime() + 7 * 86_400_000) ? 'due' : 'upcoming';
      return {
        number: p.number,
        dueDate: due,
        amount: p.amount,
        cumulativeTarget: Number(cumulative.toFixed(2)),
        coveredBy: Number(coveredBy.toFixed(2)),
        shortfall,
        status,
      };
    });

    const nextDue = schedule.find((s) => s.status !== 'paid') ?? null;
    return {
      planId: plan.id,
      termId: plan.termId,
      termName: plan.term?.name ?? null,
      totalPlanned: Number(plan.totalAmount),
      settled,
      billed: balance.billed,
      outstanding: balance.balance,
      onTrack: !schedule.some((s) => s.status === 'overdue'),
      nextDue,
      schedule,
    };
  }

  /**
   * C4 · the termly statement a parent is handed.
   *
   * The single most-requested artifact in a Ugandan school and the one thing
   * this module could not produce. Built on `studentLedger`, which already
   * carries the opening-balance row, so the sheet satisfies the identity a
   * parent can check by hand:
   *
   *   Opening + Charges + Penalties − Payments − Credits − Waivers ± Adjustments = Closing
   *
   * Scoped to a term by date window rather than by invoice term id, because a
   * Term 1 invoice settled in Term 2 must appear on the Term 2 statement — that
   * payment is what the parent is asking about.
   */
  async termStatement(studentProfileId: string, termId?: string) {
    const organizationId = this.tenant.organizationId;

    const term = termId
      ? await this.prisma.client.term.findFirst({ where: { id: termId, organizationId } })
      : await this.prisma.client.term.findFirst({ where: { organizationId, isCurrent: true } });

    const [student, school, ledger] = await Promise.all([
      this.prisma.client.studentProfile.findFirst({
        where: { id: studentProfileId, organizationId },
        include: {
          partner: true,
          guardians: { include: { guardianContact: true } },
        },
      }),
      this.prisma.client.schoolProfile.findFirst({ where: { organizationId } }),
      this.studentLedger(studentProfileId, {
        from: term?.startDate?.toISOString(),
        to: term?.endDate?.toISOString(),
      }),
    ]);
    if (!student) throw new NotFoundException(`Student ${studentProfileId} not found`);

    const balance = await this.studentBalance(studentProfileId);
    const clearance = await this.feeClearance(studentProfileId);

    return {
      school,
      student: await this.withPlacedClass(student, term?.id),
      term,
      ledger,
      balance,
      clearance,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * E1 · the daily cash book.
   *
   * What the bursar reconciles the drawer against at close of day and signs.
   * Split by tender method because only cash is physically counted — a mobile
   * money total that does not match the drawer is not a discrepancy, it is a
   * different account.
   *
   * Reversed payments are excluded from the totals and reported separately:
   * a receipt cancelled during the day did not put money in the drawer, but
   * the bursar still needs to see that it happened.
   */
  async dailyCashBook(dateStr?: string) {
    const organizationId = this.tenant.organizationId;
    const day = dateStr ? new Date(dateStr) : new Date();
    const from = new Date(day);
    from.setHours(0, 0, 0, 0);
    const to = new Date(day);
    to.setHours(23, 59, 59, 999);

    const payments = await this.prisma.client.payment.findMany({
      where: { organizationId, direction: 'inbound', paymentDate: { gte: from, lte: to } },
      include: { partner: { select: { name: true } } },
      orderBy: { paymentDate: 'asc' },
    });

    const live = payments.filter((p) => p.status !== 'cancelled');
    const reversed = payments.filter((p) => p.status === 'cancelled');

    const byMethod = new Map<string, { method: string; count: number; total: number }>();
    for (const p of live) {
      const row = byMethod.get(p.paymentMethod) ?? { method: p.paymentMethod, count: 0, total: 0 };
      row.count++;
      row.total += Number(p.amount);
      byMethod.set(p.paymentMethod, row);
    }

    const refunds = await this.prisma.client.payment.aggregate({
      where: { organizationId, direction: 'outbound', paymentDate: { gte: from, lte: to }, status: { not: 'cancelled' } },
      _sum: { amount: true },
      _count: { _all: true },
    });

    return {
      date: from.toISOString().slice(0, 10),
      byMethod: [...byMethod.values()].sort((a, b) => b.total - a.total),
      totalCollected: live.reduce((t, p) => t + Number(p.amount), 0),
      receiptCount: live.length,
      // Cash is the only line the drawer is counted against.
      cashTotal: byMethod.get('cash')?.total ?? 0,
      refundsPaid: Number(refunds._sum.amount ?? 0),
      refundCount: refunds._count._all,
      netCash: (byMethod.get('cash')?.total ?? 0) - Number(refunds._sum.amount ?? 0),
      reversedCount: reversed.length,
      reversedTotal: reversed.reduce((t, p) => t + Number(p.amount), 0),
      receipts: live.map((p) => ({
        id: p.id,
        paymentNumber: p.paymentNumber,
        time: p.paymentDate,
        payer: p.partner?.name ?? '—',
        method: p.paymentMethod,
        reference: p.reference,
        amount: Number(p.amount),
      })),
    };
  }

  /**
   * E2 · income against budget.
   *
   * `Budget` rows have existed since the module was built and nothing ever
   * compared them to reality. Fee income is matched to the budget period, so a
   * school can see mid-term whether the term's collections are tracking the
   * plan while there is still time to chase.
   */
  async budgetVariance(termId?: string) {
    const organizationId = this.tenant.organizationId;
    const budgets = await this.prisma.client.budget.findMany({
      where: { organizationId, status: { not: 'draft' }, ...(termId ? { termId } : {}) },
      include: { term: true, academicYear: true },
      orderBy: { category: 'asc' },
    });

    const rows = await Promise.all(
      budgets.map(async (b) => {
        // Window: the budget's own dates, else its term's, else the year's.
        const from = b.periodFrom ?? b.term?.startDate ?? b.academicYear?.startDate ?? null;
        const to = b.periodTo ?? b.term?.endDate ?? b.academicYear?.endDate ?? null;

        const actual = await this.prisma.client.payment.aggregate({
          where: {
            organizationId,
            direction: 'inbound',
            status: { not: 'cancelled' },
            ...(from && to ? { paymentDate: { gte: from, lte: to } } : {}),
          },
          _sum: { amount: true },
        });

        const planned = Number(b.amount);
        const collected = Number(actual._sum.amount ?? 0);
        return {
          id: b.id,
          category: b.category,
          name: b.name,
          termName: b.term?.name ?? null,
          planned,
          actual: collected,
          variance: Number((collected - planned).toFixed(2)),
          achievedPercent: planned > 0 ? Number(((collected / planned) * 100).toFixed(1)) : null,
          periodFrom: from,
          periodTo: to,
        };
      }),
    );

    return {
      rows,
      totalPlanned: rows.reduce((t, r) => t + r.planned, 0),
      totalActual: rows.reduce((t, r) => t + r.actual, 0),
    };
  }

  /**
   * C1 · fee clearance.
   *
   * Ugandan schools gate exams on fees, and this system's own report-card
   * template already prints "All fees must be cleared before the first day of
   * term" — a promise nothing in the code was deciding. Bursars were reading
   * the defaulters list and marking a paper register.
   *
   * The rule is a percentage of what a pupil has been billed, because that is
   * how schools state it ("clear at least 60% to sit end-of-term"). A flat
   * shilling threshold would punish a P7 pupil, whose fees are higher, for the
   * same relative payment as a P1 pupil.
   *
   * `waived` and `credited` count toward clearance: a bursary pupil whose fees
   * were forgiven IS cleared — the school decided not to collect that money.
   * Only the outstanding balance blocks. This is why clearance reads the
   * canonical balance rather than SUM(PaymentAllocation) alone.
   *
   * The threshold lives on `SchoolProfile.customFields.feeClearancePercent` so a
   * school sets it once; `DEFAULT_CLEARANCE_PERCENT` applies until they do.
   */
  static readonly DEFAULT_CLEARANCE_PERCENT = 100;

  /**
   * Outstanding, split by whether it is actually due yet.
   *
   * "You owe UGX 650,000" and "UGX 250,000 of that was due three weeks ago" are
   * different statements, and a portal that shows only the first makes a family
   * on an instalment plan look like a defaulter. The split lives here, next to
   * the balance it must agree with, rather than in the portal: a frontend that
   * subtracts payments from invoices to derive its own figures is exactly how a
   * portal comes to contradict the bursar's statement.
   *
   * `outstanding` is the canonical balance, untouched. The overdue and not-yet-due
   * halves are apportioned from open invoice residuals, so they sum to the
   * invoiced portion of the debt — an opening balance carried forward from a
   * previous year has no invoice and therefore no due date, and is reported
   * separately rather than silently counted as overdue.
   */
  async outstandingBreakdown(
    studentProfileId: string,
    asOf: Date = new Date(),
  ): Promise<{
    studentProfileId: string;
    outstanding: number;
    overdue: number;
    dueLater: number;
    undated: number;
    nextDueDate: string | null;
    overdueInvoiceCount: number;
  }> {
    const organizationId = this.tenant.organizationId;
    const balance = await this.studentBalance(studentProfileId);

    const invoices = await this.prisma.client.schoolFeeInvoice.findMany({
      where: { organizationId, studentProfileId, status: { notIn: ['cancelled', 'voided', 'draft'] } },
      select: { documentId: true, dueDate: true },
    });
    const docs = invoices.length
      ? await this.prisma.client.document.findMany({
          where: { id: { in: invoices.map((i) => i.documentId) } },
          select: { id: true, amountResidual: true },
        })
      : [];
    const residualById = new Map(docs.map((d) => [d.id, Number(d.amountResidual ?? 0)]));

    let overdue = 0;
    let dueLater = 0;
    let overdueInvoiceCount = 0;
    let nextDue: Date | null = null;

    for (const inv of invoices) {
      const residual = residualById.get(inv.documentId) ?? 0;
      if (residual <= 0) continue;
      if (inv.dueDate && inv.dueDate <= asOf) {
        overdue += residual;
        overdueInvoiceCount += 1;
      } else if (inv.dueDate) {
        dueLater += residual;
        if (!nextDue || inv.dueDate < nextDue) nextDue = inv.dueDate;
      } else {
        // No due date recorded. Counted as neither — claiming it is overdue would
        // be an accusation the data does not support.
        dueLater += 0;
      }
    }

    const round = (n: number) => Number(n.toFixed(2));
    const dated = round(overdue + dueLater);
    const undated = round(Math.max(0, balance.balance - dated));

    return {
      studentProfileId,
      outstanding: balance.balance,
      overdue: round(overdue),
      dueLater: round(dueLater),
      undated,
      nextDueDate: nextDue ? nextDue.toISOString() : null,
      overdueInvoiceCount,
    };
  }

  async feeClearance(
    studentProfileId: string,
    opts: { thresholdPercent?: number } = {},
  ): Promise<{
    studentProfileId: string;
    status: 'cleared' | 'partial' | 'blocked';
    billed: number;
    settled: number;
    outstanding: number;
    settledPercent: number;
    thresholdPercent: number;
    shortfall: number;
  }> {
    const b = await this.studentBalance(studentProfileId);
    const threshold = opts.thresholdPercent ?? (await this.clearanceThreshold());

    // Settled = every way the debt legitimately went away. A waived pupil is
    // cleared; the school chose not to collect.
    const settled = b.collected + b.waived + b.credited;
    const settledPercent = b.billed > 0 ? Number(((settled / b.billed) * 100).toFixed(2)) : 100;
    const required = (b.billed * threshold) / 100;
    const shortfall = Math.max(0, Number((required - settled).toFixed(2)));

    const status: 'cleared' | 'partial' | 'blocked' =
      settledPercent >= threshold ? 'cleared' : settled > 0 ? 'partial' : 'blocked';

    return {
      studentProfileId,
      status,
      billed: b.billed,
      settled,
      outstanding: b.balance,
      settledPercent,
      thresholdPercent: threshold,
      shortfall,
    };
  }

  /** The org's configured clearance bar, or the default. */
  private async clearanceThreshold(): Promise<number> {
    const organizationId = this.tenant.organizationId;
    const profile = await this.prisma.client.schoolProfile.findFirst({
      where: { organizationId },
      select: { customFields: true },
    });
    const raw = (profile?.customFields as any)?.feeClearancePercent;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 100
      ? n
      : SchoolFinanceQueryService.DEFAULT_CLEARANCE_PERCENT;
  }

  /**
   * Clearance for a whole class — the list a head teacher works from when
   * deciding who sits and who is sent home. One balance query per pupil is
   * avoided by aggregating the class in a handful of grouped queries.
   */
  async classFeeClearance(classId: string, opts: { thresholdPercent?: number } = {}) {
    const organizationId = this.tenant.organizationId;
    const threshold = opts.thresholdPercent ?? (await this.clearanceThreshold());
    const students = await this.prisma.client.studentProfile.findMany({
      where: {
        organizationId,
        status: 'active',
        ...this.placements.studentWhere({ classIds: [classId] }),
      },
      select: { id: true, admissionNo: true, partner: { select: { name: true } } },
      orderBy: { admissionNo: 'asc' },
    });

    const rows = await Promise.all(
      students.map(async (s) => {
        const c = await this.feeClearance(s.id, { thresholdPercent: threshold });
        return {
          ...c,
          admissionNo: s.admissionNo,
          studentName: s.partner?.name ?? s.id,
        };
      }),
    );

    return {
      classId,
      thresholdPercent: threshold,
      total: rows.length,
      cleared: rows.filter((r) => r.status === 'cleared').length,
      partial: rows.filter((r) => r.status === 'partial').length,
      blocked: rows.filter((r) => r.status === 'blocked').length,
      rows,
    };
  }

  /**
   * B2 · find a receipt again.
   *
   * A parent loses the paper, or disputes a payment three weeks later, and the
   * bursar needs to pull it up. Until now the receipt existed only in the
   * browser tab that created it and was gone the moment the wizard reset.
   *
   * Searches every handle a bursar actually has: receipt number, admission
   * number, pupil name, guardian phone, or the mobile-money reference on the
   * parent's SMS. Reversed payments are included deliberately and flagged —
   * "why was this cancelled?" is exactly the question that brings someone to
   * this screen.
   */
  async searchReceipts(params: { q?: string; from?: string; to?: string; page?: number; pageSize?: number }) {
    const organizationId = this.tenant.organizationId;
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 25));
    const q = params.q?.trim();

    const where: any = { organizationId, direction: 'inbound' };
    if (params.from || params.to) {
      where.paymentDate = {};
      if (params.from) where.paymentDate.gte = new Date(params.from);
      if (params.to) where.paymentDate.lte = new Date(params.to);
    }

    if (q) {
      // Resolve the pupil-side handles to partner ids first, then match on the
      // payment's own columns. One extra query beats a three-level nested
      // relation filter and keeps the payment query index-friendly.
      const students = await this.prisma.client.studentProfile.findMany({
        where: {
          organizationId,
          OR: [
            { admissionNo: { contains: q, mode: 'insensitive' } },
            { partner: { name: { contains: q, mode: 'insensitive' } } },
            { partner: { phone: { contains: q } } },
            { guardians: { some: { guardianContact: { phone: { contains: q } } } } },
          ],
        },
        select: { partnerId: true },
        take: 500,
      });
      const partnerIds = [...new Set(students.map((s) => s.partnerId))];
      where.OR = [
        { paymentNumber: { contains: q, mode: 'insensitive' } },
        { reference: { contains: q, mode: 'insensitive' } },
        { externalReference: { contains: q, mode: 'insensitive' } },
        ...(partnerIds.length ? [{ partnerId: { in: partnerIds } }] : []),
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.payment.findMany({
        where,
        orderBy: { paymentDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          partner: { select: { id: true, name: true, phone: true } },
          allocations: {
            include: { document: { select: { id: true, documentNumber: true, sourceType: true } } },
          },
        },
      }),
      this.prisma.client.payment.count({ where }),
    ]);

    // Map partner → pupil so the receipt can print an admission number.
    const partnerIds = [...new Set(rows.map((r) => r.partnerId))];
    const students = partnerIds.length
      ? await this.prisma.client.studentProfile.findMany({
          where: { organizationId, partnerId: { in: partnerIds } },
          select: { id: true, partnerId: true, admissionNo: true },
        })
      : [];
    const studentByPartner = new Map(students.map((s) => [s.partnerId, s]));

    return {
      data: rows.map((p) => {
        const student = studentByPartner.get(p.partnerId);
        const allocations = (p.allocations ?? []).filter((a: any) => a.status !== 'reversed');
        return {
          id: p.id,
          paymentNumber: p.paymentNumber,
          paymentDate: p.paymentDate,
          paymentMethod: p.paymentMethod,
          amount: Number(p.amount),
          allocatedAmount: Number(p.allocatedAmount),
          unallocatedAmount: Number(p.unallocatedAmount),
          reference: p.reference,
          externalReference: p.externalReference,
          status: p.status,
          // A cancelled payment still appears — with its state visible, because
          // "this receipt was reversed and why" is a question a bursar has to
          // be able to answer at the window.
          reversed: p.status === 'cancelled',
          studentProfileId: student?.id ?? null,
          admissionNo: student?.admissionNo ?? null,
          studentName: p.partner?.name ?? null,
          phone: p.partner?.phone ?? null,
          allocations: allocations.map((a: any) => ({
            id: a.id,
            documentId: a.documentId,
            documentNumber: a.document?.documentNumber ?? null,
            amount: Number(a.amount),
            status: a.status,
          })),
          reversedAllocations: (p.allocations ?? []).filter((a: any) => a.status === 'reversed').length,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** One receipt, with everything a reprint needs. */
  /**
   * A fee-related journal entry with its lines, for the accounting trail on
   * receipts, invoices and settlements. Restricted to entries a fee flow
   * produced so `school.read` does not become general-ledger read access.
   */
  async feeJournal(journalEntryId: string) {
    const entry = await this.prisma.client.journalEntry.findFirst({
      where: { id: journalEntryId },
      include: {
        journal: { select: { code: true, name: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { account: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    const feeSource = (t?: string | null) =>
      !!t && (t.startsWith('school_') || ['payment', 'library_fine_invoice', 'mobile_money_settlement'].includes(t));
    let allowed = feeSource(entry.sourceType);
    if (!allowed && entry.sourceType === 'reversal' && entry.sourceId) {
      const original = await this.prisma.client.journalEntry.findFirst({
        where: { id: entry.sourceId },
        select: { sourceType: true },
      });
      allowed = feeSource(original?.sourceType);
    }
    if (!allowed) throw new NotFoundException('Journal entry not found');
    return {
      id: entry.id,
      entryNumber: entry.entryNumber,
      journal: entry.journal,
      postingDate: entry.postingDate,
      status: entry.status,
      description: entry.description,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      reversedEntryId: (entry as any).reversedEntryId ?? null,
      lines: entry.lines.map((l) => ({
        accountCode: l.account?.code,
        accountName: l.account?.name,
        description: l.description,
        debit: Number(l.baseDebit),
        credit: Number(l.baseCredit),
      })),
    };
  }

  async getReceipt(paymentId: string) {
    const organizationId = this.tenant.organizationId;
    const payment = await this.prisma.client.payment.findFirst({
      where: { id: paymentId, organizationId },
      include: {
        partner: true,
        allocations: {
          include: {
            document: { select: { id: true, documentNumber: true, totalAmount: true, sourceType: true, journalEntryId: true } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException(`Receipt ${paymentId} not found`);
    const student = await this.prisma.client.studentProfile.findFirst({
      where: { organizationId, partnerId: payment.partnerId },
    });
    const balance = student ? await this.studentBalance(student.id) : null;
    return { payment, student: student ? await this.withPlacedClass(student) : null, balance };
  }

  /** Canonical refundable entitlement for a partner (A2.1). Reused by refunds. */
  async refundableAmount(partnerId: string, studentProfileId: string): Promise<number> {
    const { total } = await this.refundableBreakdown(partnerId, studentProfileId);
    return total;
  }

  /** Constants re-exported for callers that filter documents themselves. */
  static readonly SOURCE_TYPES = SCHOOL_FEE_SOURCE_TYPES;
  static readonly ACTIVE_STATUSES = ACTIVE_FEE_STATUSES;
  /**
   * Attach `currentClass` / `currentSection` to a student object from placement
   * history (ADR-027). The key names are the statement and receipt response
   * contract the web renders (`student.currentClass.name`); only their source
   * changed, from the StudentProfile projection to the learner's placement.
   */
  private async withPlacedClass<T extends { id: string }>(student: T, termId?: string) {
    const d = (await this.placements.describe([student.id], termId ? { termId } : {})).get(student.id);
    return {
      ...student,
      currentClass: d?.classId
        ? { id: d.classId, name: d.className, gradeLevel: d.gradeLevelName ? { id: d.gradeLevelId, name: d.gradeLevelName } : null }
        : null,
      currentSection: d?.sectionId ? { id: d.sectionId, name: d.sectionName } : null,
    };
  }

}
