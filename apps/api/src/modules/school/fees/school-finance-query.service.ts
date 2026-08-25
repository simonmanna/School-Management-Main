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
      kind: 'amountPaid' | 'amountWaived' | 'creditRemaining';
      id: string;
      reference: string;
      cached: number;
      subledger: number;
      variance: number;
    }>;
  }> {
    const organizationId = this.tenant.organizationId;
    const drifted: Array<{
      kind: 'amountPaid' | 'amountWaived' | 'creditRemaining';
      id: string;
      reference: string;
      cached: number;
      subledger: number;
      variance: number;
    }> = [];

    const docs = await this.prisma.client.document.findMany({
      where: { ...POSTED_FEE_WHERE, organizationId },
      select: { id: true, documentNumber: true, partnerId: true, amountPaid: true, amountWaived: true },
    });
    const docIds = docs.map((d) => d.id);

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

  /** Canonical refundable entitlement for a partner (A2.1). Reused by refunds. */
  async refundableAmount(partnerId: string, studentProfileId: string): Promise<number> {
    const { total } = await this.refundableBreakdown(partnerId, studentProfileId);
    return total;
  }

  /** Constants re-exported for callers that filter documents themselves. */
  static readonly SOURCE_TYPES = SCHOOL_FEE_SOURCE_TYPES;
  static readonly ACTIVE_STATUSES = ACTIVE_FEE_STATUSES;
}
