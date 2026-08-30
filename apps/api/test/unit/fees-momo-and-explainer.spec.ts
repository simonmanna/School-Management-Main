/**
 * Operational reach: live mobile money, and the balance explainer.
 *
 * The credit-drawdown concurrency guard is NOT tested here — it cannot be
 * proven with mocks, because the whole defect lives in what two simultaneous
 * transactions do to one row. It has its own gate that runs against a real
 * Postgres: `prisma/audit-fees-concurrency.ts`.
 */
import { createHmac } from 'node:crypto';
import { MobileMoneyService } from '../../src/modules/school/fees/mobile-money.service';
import { SchoolFinanceQueryService } from '../../src/modules/school/fees/school-finance-query.service';

/* ───────────────────── Mobile money ───────────────────── */

function makeMomo(overrides: { request?: any; collectResult?: any } = {}) {
  const mmUpdate = jest.fn().mockResolvedValue({});
  const mmCreate = jest.fn().mockResolvedValue({ id: 'req_1' });
  const collect = jest.fn().mockResolvedValue(
    overrides.collectResult ?? { payment: { id: 'pay_1', paymentNumber: 'PAY-1' }, replayed: false },
  );
  const prisma = {
    client: {
      studentProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: 'stu_1', admissionNo: 'ADM-1', partner: { name: 'Nakato' } }),
      },
      mobileMoneyRequest: {
        create: mmCreate,
        update: mmUpdate,
        findFirst: jest.fn().mockResolvedValue(
          overrides.request === undefined
            ? { id: 'req_1', organizationId: 'org', studentProfileId: 'stu_1', amount: 300_000, providerRef: 'REF-1' }
            : overrides.request,
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
    },
  };
  const service = new MobileMoneyService(
    prisma as any,
    { organizationId: 'org', userId: 'u1' } as any,
    { publish: jest.fn(), publishInTx: jest.fn(async () => undefined) } as any,
    { collect } as any,
    { studentBalance: jest.fn().mockResolvedValue({ balance: 300_000, billed: 900_000, collected: 600_000 }) } as any,
  );
  return { service, collect, mmUpdate, mmCreate };
}

describe('mobile money · phone numbers', () => {
  const { service } = makeMomo();
  const norm = (p: string) => (service as any).toMsisdn(p);

  it('accepts every shape a Ugandan parent actually types', () => {
    // A provider given the wrong shape reports "payer not found" with no clue why.
    expect(norm('0772123456')).toBe('256772123456');
    expect(norm('+256 772 123 456')).toBe('256772123456');
    expect(norm('256772123456')).toBe('256772123456');
    expect(norm('772123456')).toBe('256772123456');
  });

  it('refuses something that is not a phone number, with a usable message', () => {
    expect(() => norm('hello')).toThrow(/not a recognisable Ugandan mobile number/);
  });
});

describe('mobile money · callback safety', () => {
  const raw = JSON.stringify({ externalId: 'REF-1', status: 'SUCCESSFUL', amount: '300000' });
  const secret = 'test-secret';
  const goodSig = createHmac('sha256', secret).update(raw).digest('hex');

  beforeEach(() => {
    process.env.MTN_MOMO_CALLBACK_SECRET = secret;
  });
  afterEach(() => {
    delete process.env.MTN_MOMO_CALLBACK_SECRET;
  });

  it('rejects a callback with no signature', async () => {
    // This endpoint is public by necessity. An unsigned callback would let
    // anyone credit a pupil's account with money nobody paid.
    const { service, collect } = makeMomo();
    await expect(service.handleCallback('mtn', raw, undefined)).rejects.toThrow(/Invalid callback signature/);
    expect(collect).not.toHaveBeenCalled();
  });

  it('rejects a forged signature', async () => {
    const { service, collect } = makeMomo();
    await expect(service.handleCallback('mtn', raw, 'deadbeef')).rejects.toThrow(/Invalid callback signature/);
    expect(collect).not.toHaveBeenCalled();
  });

  it('refuses to run at all when no secret is configured', async () => {
    delete process.env.MTN_MOMO_CALLBACK_SECRET;
    const { service } = makeMomo();
    await expect(service.handleCallback('mtn', raw, goodSig)).rejects.toThrow(/No callback secret configured/);
  });

  it('posts a verified success through the single payment writer', async () => {
    const { service, collect } = makeMomo();
    const res: any = await service.handleCallback('mtn', raw, goodSig);

    expect(res).toMatchObject({ matched: true, status: 'succeeded', posted: true });
    // The provider's transaction id becomes the idempotency key, so the
    // at-least-once retries every provider performs collapse to one Payment.
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({
        studentProfileId: 'stu_1',
        amount: 300_000,
        paymentMethod: 'mobile_money',
        externalReference: 'REF-1',
        externalReferenceType: 'mobile_money_txn',
        convertOverpaymentToCredit: true,
      }),
    );
  });

  it('does not post money for a failed or pending callback', async () => {
    const failedRaw = JSON.stringify({ externalId: 'REF-1', status: 'FAILED' });
    const sig = createHmac('sha256', secret).update(failedRaw).digest('hex');
    const { service, collect } = makeMomo();
    const res: any = await service.handleCallback('mtn', failedRaw, sig);
    expect(res.posted).toBe(false);
    expect(collect).not.toHaveBeenCalled();
  });

  it('acknowledges an unknown reference instead of erroring', async () => {
    // A provider that receives an error retries forever, and a reference we
    // cannot place will never become placeable by being resent.
    const { service, collect } = makeMomo({ request: null });
    const res: any = await service.handleCallback('mtn', raw, goodSig);
    expect(res).toMatchObject({ matched: false });
    expect(collect).not.toHaveBeenCalled();
  });

  it('reports a replayed callback as such rather than as a new payment', async () => {
    const { service } = makeMomo({
      collectResult: { payment: { id: 'pay_1', paymentNumber: 'PAY-1' }, replayed: true },
    });
    const res: any = await service.handleCallback('mtn', raw, goodSig);
    expect(res.replayed).toBe(true);
  });
});

/* ───────────────────── Balance explainer ───────────────────── */

describe('"why does this pupil owe this?"', () => {
  function makeService(balance: any, rows: any[]) {
    const prisma = {
      client: {
        studentProfile: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'stu_1',
            admissionNo: 'ADM-001',
            partner: { name: 'Nakato Sarah' },
            currentClass: { name: 'P5' },
          }),
        },
      },
    };
    const s = new SchoolFinanceQueryService(prisma as any, { organizationId: 'org' } as any, {} as any);
    jest.spyOn(s, 'studentBalance').mockResolvedValue(balance);
    jest.spyOn(s, 'studentLedger').mockResolvedValue({
      studentProfileId: 'stu_1',
      rows,
      openingBalance: 0,
      closingBalance: balance.balance,
      currentBalance: balance.balance,
    } as any);
    jest.spyOn(s, 'feeClearance').mockResolvedValue({ status: 'partial', settledPercent: 46, shortfall: 540_000, thresholdPercent: 100 } as any);
    return s;
  }

  const balance = {
    studentProfileId: 'stu_1',
    billed: 1_000_000,
    collected: 400_000,
    waived: 50_000,
    credited: 0,
    adjusted: 0,
    balance: 550_000,
    invoiceCount: 1,
  };
  const rows = [
    { date: '2026-02-01T00:00:00Z', ledgerType: 'INVOICE', sourceType: 'school_fee', sourceId: 'd1', reference: 'FEE-1', description: 'Fee invoice', debit: 1_000_000, credit: 0, balance: 1_000_000 },
    { date: '2026-03-01T00:00:00Z', ledgerType: 'PAYMENT', sourceType: 'payment', sourceId: 'p1', reference: 'PAY-0042', description: 'Payment (cash)', debit: 0, credit: 400_000, balance: 600_000 },
    { date: '2026-03-15T00:00:00Z', ledgerType: 'WAIVER', sourceType: 'school_waiver', sourceId: 'w1', reference: 'WV-1', description: 'Hardship', debit: 0, credit: 50_000, balance: 550_000 },
  ];

  it('writes a headline a bursar can read aloud', async () => {
    const s = makeService(balance, rows);
    const ex: any = await s.explainBalance('stu_1');
    expect(ex.headline).toContain('Nakato Sarah was billed UGX 1,000,000');
    expect(ex.headline).toContain('has paid UGX 400,000');
    expect(ex.headline).toContain('UGX 50,000 was waived');
    expect(ex.headline).toContain('leaving UGX 550,000 outstanding');
  });

  it('labels each line in words a parent recognises, not event codes', async () => {
    const s = makeService(balance, rows);
    const ex: any = await s.explainBalance('stu_1');
    const labels = ex.lines.map((l: any) => l.label);
    expect(labels[0]).toMatch(/Fees invoiced/);
    expect(labels[1]).toMatch(/Paid .* receipt PAY-0042/);
    expect(labels[2]).toMatch(/Waived · Hardship/);
    // Nobody outside the codebase has heard of CREDIT_APPLIED.
    expect(labels.join(' ')).not.toMatch(/CREDIT_APPLIED|WRITE_OFF/);
  });

  it('signs each amount the way a family reads it', async () => {
    const s = makeService(balance, rows);
    const ex: any = await s.explainBalance('stu_1');
    expect(ex.lines[0].amount).toBe(1_000_000);   // a charge adds
    expect(ex.lines[1].amount).toBe(-400_000);    // a payment subtracts
    expect(ex.lines[2].amount).toBe(-50_000);     // so does a waiver
  });

  it('keeps every line traceable to its source document', async () => {
    const s = makeService(balance, rows);
    const ex: any = await s.explainBalance('stu_1');
    for (const l of ex.lines) {
      expect(l.sourceId).toBeTruthy();
      expect(l.sourceType).toBeTruthy();
    }
  });

  it('adds up: billed − paid − waived − credited = outstanding', async () => {
    const s = makeService(balance, rows);
    const ex: any = await s.explainBalance('stu_1');
    const { billed, paid, waived, credited, outstanding } = ex.summary;
    expect(billed - paid - waived - credited).toBe(outstanding);
  });

  it('says so plainly when nothing is owed', async () => {
    const cleared = { ...balance, collected: 950_000, balance: 0 };
    const s = makeService(cleared, rows);
    const ex: any = await s.explainBalance('stu_1');
    expect(ex.headline).toMatch(/nothing is outstanding/);
  });
});
