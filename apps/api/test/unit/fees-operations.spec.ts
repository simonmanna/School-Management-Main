/**
 * Phases B–E: the bursar's day, the Uganda essentials, and the reports.
 *
 *   B1  overpayment becomes a fee credit funded by the receipt
 *   B4  a batch posts row-by-row so one bad row cannot undo the others
 *   C1  fee clearance, including that waivers count as cleared
 *   D2  instalment progress read against what was actually collected
 */
import { SchoolPaymentService } from '../../src/modules/school/fees/billing.service';
import { SchoolFinanceQueryService } from '../../src/modules/school/fees/school-finance-query.service';
import { makePlacementLookupStub } from './_placement-stub';

/* ───────────────────── B1 · overpayment ───────────────────── */

function makeCollect(opts: { residual: number } = { residual: 700_000 }) {
  const createCredit = jest.fn().mockResolvedValue({ id: 'cr_1', code: 'CR-000001' });
  const createReceipt = jest.fn().mockResolvedValue({ id: 'pay_1' });
  const tx = {
    $queryRawUnsafe: jest.fn(async () => []), // F7 per-payer row lock
    studentProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'stu_1', partnerId: 'p_1' }) },
    // ADR-032 P3: no profile row = cashbook mode (no drawer session required).
    schoolProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    document: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'doc_1', amountResidual: opts.residual, issueDate: new Date('2026-02-01') },
      ]),
    },
    payment: { findFirst: jest.fn().mockResolvedValue({ id: 'pay_1', allocations: [] }), update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = { client: { $transaction: jest.fn(async (cb: any) => cb(tx)) } };
  const service = new SchoolPaymentService(
    prisma as any,
    { organizationId: 'org_test' } as any,
    { publish: jest.fn(), publishInTx: jest.fn(async () => undefined) } as any,
    { createReceipt } as any,
    {
      refundableAmount: jest.fn().mockResolvedValue(0),
      refundableBreakdown: jest.fn().mockResolvedValue({ fromPayments: 0, fromCredits: 0, total: 0, credits: [] }),
    } as any,
    { post: jest.fn() } as any,
    { receivableAccount: jest.fn() } as any,
    { ensureByCode: jest.fn() } as any,
    { assertDocumentsPeriodOpen: jest.fn().mockResolvedValue(undefined) } as any,
    { reverseAllocation: jest.fn() } as any,
    { createCredit } as any,
  );
  return { service, createCredit, createReceipt, tx };
}

describe('B1 · a parent may pay more than is owed', () => {
  it('holds the remainder as a fee credit funded by the receipt', async () => {
    // The blocker: the wizard refused any tender that did not allocate to
    // exactly zero, so a parent paying 1,000,000 against a 700,000 balance had
    // to be turned away or the figure fudged.
    const { service, createCredit } = makeCollect({ residual: 700_000 });

    const res: any = await service.collect({
      studentProfileId: 'stu_1',
      amount: 1_000_000,
      paymentMethod: 'cash',
      convertOverpaymentToCredit: true,
    } as any);

    expect(res.unallocated).toBe(0); // converted to a credit, not free cash
    expect(createCredit).toHaveBeenCalledWith(
      expect.objectContaining({
        studentProfileId: 'stu_1',
        amount: 300_000,
        // The origin is what keeps the entitlement counted once: a refund
        // subtracts overpayment already converted, so the same money can never
        // be both refundable cash and a spendable credit. Converting it also
        // decrements Payment.unallocatedAmount so the audit gate does not
        // double-count it (Payment.unallocatedAmount + FeeCredit).
        source: 'overpayment',
        sourcePaymentId: 'pay_1',
      }),
      expect.anything(),
    );
    expect(res.overpaymentCredit).toMatchObject({ code: 'CR-000001' });
  });

  it('creates the credit inside the receipt transaction, not after it', async () => {
    // A receipt without its credit loses the family's money; a credit without
    // its receipt mints a liability from nothing. They commit together.
    const { service, createCredit, tx } = makeCollect({ residual: 0 });
    await service.collect({
      studentProfileId: 'stu_1',
      amount: 50_000,
      paymentMethod: 'cash',
      convertOverpaymentToCredit: true,
    } as any);
    expect(createCredit.mock.calls[0][1]).toBe(tx);
  });

  it('leaves the remainder unallocated when conversion was not asked for', async () => {
    // Still refundable, just not spendable against a future invoice.
    const { service, createCredit } = makeCollect({ residual: 0 });
    const res: any = await service.collect({
      studentProfileId: 'stu_1',
      amount: 50_000,
      paymentMethod: 'cash',
    } as any);
    expect(res.unallocated).toBe(50_000);
    expect(createCredit).not.toHaveBeenCalled();
  });
});

/* ───────────────────── B4 · reporting day ───────────────────── */

describe('B4 · a batch posts row by row', () => {
  function makeBatchService(behaviour: (dto: any) => Promise<any>) {
    const service = new SchoolPaymentService(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    jest.spyOn(service, 'collect').mockImplementation(behaviour as any);
    return service;
  }

  it('keeps the good rows when one row fails', async () => {
    // The whole point of per-row transactions: a closed term or a duplicated
    // MoMo reference on one pupil must not roll back the twenty receipts the
    // bursar already keyed in beside it.
    const service = makeBatchService(async (dto: any) => {
      if (dto.studentProfileId === 'bad') throw new Error('Term is financially closed');
      return { payment: { id: 'p', paymentNumber: 'PAY-1' }, allocations: [{ amount: dto.amount }], unallocated: 0, replayed: false };
    });

    const res = await service.collectBatch({
      rows: [
        { studentProfileId: 'a', amount: 100_000 },
        { studentProfileId: 'bad', amount: 100_000 },
        { studentProfileId: 'c', amount: 50_000 },
      ],
    });

    expect(res.posted).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.totalCollected).toBe(150_000);
    expect(res.results.find((r) => r.studentProfileId === 'bad')?.error).toMatch(/closed/);
  });

  it('reports a replayed row separately from a posted one', async () => {
    // A bursar re-submitting a corrected batch must see which rows were already
    // taken rather than being told they collected twice.
    const service = makeBatchService(async () => ({
      payment: { id: 'p', paymentNumber: 'PAY-1' },
      allocations: [],
      unallocated: 0,
      replayed: true,
    }));
    const res = await service.collectBatch({ rows: [{ studentProfileId: 'a', amount: 10_000 }] });
    expect(res.replayed).toBe(1);
    expect(res.posted).toBe(0);
  });

  it('rejects a row with no amount without calling collect', async () => {
    const service = makeBatchService(async () => ({ payment: null, allocations: [], unallocated: 0, replayed: false }));
    const res = await service.collectBatch({ rows: [{ studentProfileId: 'a', amount: 0 }] });
    expect(res.failed).toBe(1);
    expect(service.collect).not.toHaveBeenCalled();
  });
});

/* ───────────────────── C1 · fee clearance ───────────────────── */

describe('C1 · fee clearance before exams', () => {
  function makeQuery(balance: Partial<Record<string, number>>, thresholdPercent?: number) {
    const prisma = {
      client: {
        schoolProfile: {
          findFirst: jest.fn().mockResolvedValue(
            thresholdPercent == null ? null : { customFields: { feeClearancePercent: thresholdPercent } },
          ),
        },
      },
    };
    const service = new SchoolFinanceQueryService(prisma as any, { organizationId: 'org' } as any, {} as any, makePlacementLookupStub() as any);
    jest.spyOn(service, 'studentBalance').mockResolvedValue({
      studentProfileId: 'stu_1',
      billed: 1_000_000,
      collected: 0,
      waived: 0,
      credited: 0,
      adjusted: 0,
      balance: 1_000_000,
      invoiceCount: 1,
      ...balance,
    } as any);
    return service;
  }

  it('clears a pupil who has paid the full bill', async () => {
    const s = makeQuery({ collected: 1_000_000, balance: 0 });
    await expect(s.feeClearance('stu_1')).resolves.toMatchObject({ status: 'cleared', settledPercent: 100 });
  });

  it('clears a BURSARY pupil whose fees were waived', async () => {
    // The rule that matters in a Ugandan school: the school decided not to
    // collect that money, so the pupil is cleared. Counting only cash would
    // send a sponsored child home from an exam they are entitled to sit.
    const s = makeQuery({ collected: 0, waived: 1_000_000, balance: 0 });
    await expect(s.feeClearance('stu_1')).resolves.toMatchObject({ status: 'cleared' });
  });

  it('marks a part-paid pupil partial and names the shortfall', async () => {
    const s = makeQuery({ collected: 400_000, balance: 600_000 }, 60);
    const c = await s.feeClearance('stu_1');
    expect(c.status).toBe('partial');
    expect(c.settledPercent).toBe(40);
    expect(c.shortfall).toBe(200_000); // 60% of 1,000,000 = 600,000; paid 400,000
  });

  it('clears exactly at the threshold, not one shilling above', async () => {
    const s = makeQuery({ collected: 600_000, balance: 400_000 }, 60);
    await expect(s.feeClearance('stu_1')).resolves.toMatchObject({ status: 'cleared', shortfall: 0 });
  });

  it('blocks a pupil who has paid nothing', async () => {
    const s = makeQuery({});
    await expect(s.feeClearance('stu_1')).resolves.toMatchObject({ status: 'blocked' });
  });

  it('treats a pupil billed nothing as cleared', async () => {
    const s = makeQuery({ billed: 0, balance: 0 });
    await expect(s.feeClearance('stu_1')).resolves.toMatchObject({ status: 'cleared', settledPercent: 100 });
  });

  it('honours an explicit threshold over the school default', async () => {
    const s = makeQuery({ collected: 500_000, balance: 500_000 }, 100);
    await expect(s.feeClearance('stu_1', { thresholdPercent: 50 })).resolves.toMatchObject({ status: 'cleared' });
  });
});

/* ───────────────────── D2 · instalment progress ───────────────────── */

describe('D2 · instalment plans finally read', () => {
  function makeQuery(plan: any, settled: { collected: number; waived?: number }) {
    const prisma = {
      client: {
        installmentPlan: { findFirst: jest.fn().mockResolvedValue(plan) },
      },
    };
    const service = new SchoolFinanceQueryService(prisma as any, { organizationId: 'org' } as any, {} as any, makePlacementLookupStub() as any);
    jest.spyOn(service, 'studentBalance').mockResolvedValue({
      studentProfileId: 'stu_1',
      billed: 900_000,
      collected: settled.collected,
      waived: settled.waived ?? 0,
      credited: 0,
      adjusted: 0,
      balance: 900_000 - settled.collected - (settled.waived ?? 0),
      invoiceCount: 1,
    } as any);
    return service;
  }

  const plan = {
    id: 'plan_1',
    termId: 'term_1',
    term: { name: 'Term 1' },
    totalAmount: 900_000,
    installments: [
      { number: 1, dueDate: '2026-02-10', amount: 300_000 },
      { number: 2, dueDate: '2026-03-10', amount: 300_000 },
      { number: 3, dueDate: '2099-05-10', amount: 300_000 },
    ],
  };

  it('returns null when the pupil has no plan', async () => {
    const s = makeQuery(null, { collected: 0 });
    await expect(s.installmentProgress('stu_1')).resolves.toBeNull();
  });

  it('marks instalments paid against cumulative collections', async () => {
    const s = makeQuery(plan, { collected: 300_000 });
    const p: any = await s.installmentProgress('stu_1');
    expect(p.schedule[0].status).toBe('paid');
    // Past due date and not yet covered.
    expect(p.schedule[1].status).toBe('overdue');
    expect(p.schedule[1].shortfall).toBe(300_000);
    expect(p.onTrack).toBe(false);
    expect(p.nextDue.number).toBe(2);
  });

  it('counts a waiver toward the plan, so a bursary pupil is not "behind"', async () => {
    const s = makeQuery(plan, { collected: 0, waived: 600_000 });
    const p: any = await s.installmentProgress('stu_1');
    expect(p.schedule[0].status).toBe('paid');
    expect(p.schedule[1].status).toBe('paid');
    expect(p.onTrack).toBe(true);
  });

  it('leaves a future instalment upcoming rather than overdue', async () => {
    const s = makeQuery(plan, { collected: 600_000 });
    const p: any = await s.installmentProgress('stu_1');
    expect(p.schedule[2].status).toBe('upcoming');
    expect(p.onTrack).toBe(true);
  });
});

/* ───────────────────── D4 · mid-term joiner proration ───────────────────── */

describe('D4 · a pupil who joins mid-term', () => {
  const service = new (require('../../src/modules/school/fees/billing.service').BillingService)(
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  const factor = (policy: string, joined: string | null, start: string, end: string) =>
    (service as any).prorationFactor(policy, joined ? new Date(joined) : null, {
      startDate: new Date(start),
      endDate: new Date(end),
    });

  // A Ugandan Term 1: February to April.
  const T = ['2026-02-01', '2026-04-30'] as const;

  it('bills the full term when proration is off — the default', () => {
    // Existing schools must see no change until they deliberately opt in.
    expect(factor('none', '2026-03-15', ...T)).toBe(1);
    expect(factor('', '2026-03-15', ...T)).toBe(1);
  });

  it('bills the full term for a pupil who started on day one', () => {
    expect(factor('monthly', '2026-02-01', ...T)).toBe(1);
    expect(factor('monthly', '2026-01-10', ...T)).toBe(1);
  });

  it('charges two thirds for a pupil joining in the second month of three', () => {
    // The way a head teacher states it: "they came in March, they pay for
    // March and April."
    expect(factor('monthly', '2026-03-10', ...T)).toBeCloseTo(2 / 3, 3);
  });

  it('charges one third for a pupil joining in the final month', () => {
    expect(factor('monthly', '2026-04-20', ...T)).toBeCloseTo(1 / 3, 3);
  });

  it('charges nothing for a pupil who joined after the term ended', () => {
    // Not a negative, and not a full term — the next term's run bills them.
    expect(factor('monthly', '2026-05-15', ...T)).toBe(0);
  });

  it('supports finer weekly and daily policies', () => {
    const weekly = factor('weekly', '2026-04-01', ...T);
    const daily = factor('daily', '2026-04-01', ...T);
    expect(weekly).toBeGreaterThan(0);
    expect(weekly).toBeLessThan(1);
    expect(daily).toBeGreaterThan(0);
    expect(daily).toBeLessThan(1);
  });

  it('bills in full when the data cannot support proration', () => {
    // Missing enrollment date, missing term dates, or a term that ends before
    // it starts. The safe direction is always to bill fully and let a bursar
    // issue a credit adjustment.
    expect(factor('monthly', null, ...T)).toBe(1);
    expect(
      (service as any).prorationFactor('monthly', new Date('2026-03-01'), null),
    ).toBe(1);
    expect(factor('monthly', '2026-03-01', '2026-04-30', '2026-02-01')).toBe(1);
  });

  it('never prorates a one-off charge', () => {
    // An admission fee or PLE registration costs the school the same whenever
    // the pupil arrives.
    const lines = (service as any).computeLines(
      [
        { code: 'TUITION', name: 'Tuition', amount: 900_000, frequency: 'per_term' },
        { code: 'ADMISSION', name: 'Admission fee', amount: 50_000, frequency: 'one_time' },
      ],
      {},
      [],
      [],
      { currentClassId: 'c1', currentClass: { gradeLevelId: 'g1' } },
      new Map(),
      1 / 3,
    );
    expect(lines.find((l: any) => l.description === 'Tuition').unitPrice).toBe(300_000);
    expect(lines.find((l: any) => l.description === 'Admission fee').unitPrice).toBe(50_000);
  });
});
