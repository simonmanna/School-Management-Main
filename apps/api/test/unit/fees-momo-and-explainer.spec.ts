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
import { makePlacementLookupStub } from './_placement-stub';

/* ───────────────────── Mobile money ───────────────────── */

const SECRET = 'test-secret';

function makeMomo(
  overrides: { request?: any; gateway?: any; collectResult?: any; claimCount?: number } = {},
) {
  const request =
    overrides.request === undefined
      ? {
          id: 'req_1',
          organizationId: 'org_a',
          studentProfileId: 'stu_1',
          amount: 300_000,
          providerRef: 'REF-1',
          provider: 'mtn',
          status: 'pending',
          currency: 'UGX',
          gatewayAccountId: 'gw_1',
        }
      : overrides.request;
  const gateway =
    overrides.gateway === undefined
      ? { id: 'gw_1', organizationId: 'org_a', provider: 'mtn', currency: 'UGX', clearingAccountId: 'acc_clr', callbackSecretCipher: 'c', callbackSecretIv: 'i', callbackSecretTag: 't' }
      : overrides.gateway;

  const updateMany = jest.fn().mockResolvedValue({ count: overrides.claimCount ?? 1 });
  const update = jest.fn().mockResolvedValue({});
  const mmCreate = jest.fn().mockResolvedValue({ id: 'req_1' });
  const collect = jest.fn().mockResolvedValue(
    overrides.collectResult ?? { payment: { id: 'pay_1', paymentNumber: 'PAY-1', amount: 300_000 }, replayed: false },
  );
  const tx = { mobileMoneyRequest: { findFirst: jest.fn().mockResolvedValue(request), updateMany, update } };
  const prisma = {
    raw: {
      mobileMoneyRequest: { findFirst: jest.fn().mockResolvedValue(request) },
      paymentGatewayAccount: { findFirst: jest.fn().mockResolvedValue(gateway) },
    },
    client: {
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      studentProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: 'stu_1', admissionNo: 'ADM-1', partner: { name: 'Nakato' } }),
      },
      mobileMoneyRequest: { create: mmCreate, update, findMany: jest.fn().mockResolvedValue([]) },
    },
  };
  const tenantRun = jest.fn((_store: any, fn: any) => fn());
  const encryption = {
    encrypt: jest.fn((v: string) => ({ ciphertext: v, iv: 'i', tag: 't' })),
    decrypt: jest.fn((payload: any) => (payload?.ciphertext === 'c' ? SECRET : payload?.ciphertext ?? null)),
  };
  const service = new MobileMoneyService(
    prisma as any,
    { organizationId: 'org_a', userId: 'u1', run: tenantRun } as any,
    { publish: jest.fn(), publishInTx: jest.fn(async () => undefined) } as any,
    { collect } as any,
    { studentBalance: jest.fn().mockResolvedValue({ balance: 300_000, billed: 900_000, collected: 600_000 }) } as any,
    encryption as any,
    { post: jest.fn() } as any,
    { settlementAccount: jest.fn().mockResolvedValue('acc_default_clr') } as any,
    { ensureByCode: jest.fn() } as any,
  );
  return { service, collect, updateMany, update, tenantRun, prisma };
}

const sign = (raw: string) => createHmac('sha256', SECRET).update(raw).digest('hex');

describe('mobile money · phone numbers', () => {
  const { service } = makeMomo();
  const norm = (p: string) => (service as any).toMsisdn(p);

  it('accepts every shape a Ugandan parent actually types', () => {
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
  const raw = JSON.stringify({ externalId: 'REF-1', status: 'SUCCESSFUL', amount: '300000', currency: 'UGX' });

  it('rejects a callback with no signature', async () => {
    const { service, collect } = makeMomo();
    await expect(service.handleCallback('mtn', raw, undefined)).rejects.toThrow(/Invalid callback signature/);
    expect(collect).not.toHaveBeenCalled();
  });

  it('rejects a forged signature', async () => {
    const { service, collect } = makeMomo();
    await expect(service.handleCallback('mtn', raw, 'deadbeef')).rejects.toThrow(/Invalid callback signature/);
    expect(collect).not.toHaveBeenCalled();
  });

  it("refuses when the school's gateway has no callback secret", async () => {
    const { service } = makeMomo({ gateway: { id: 'gw_1', organizationId: 'org_a', provider: 'mtn', currency: 'UGX' } });
    await expect(service.handleCallback('mtn', raw, sign(raw))).rejects.toThrow(/No callback secret configured/);
  });

  it('refuses a callback whose raw bytes are unavailable rather than re-serialising', async () => {
    const { service, collect } = makeMomo();
    await expect(service.handleCallback('mtn', undefined, sign(raw))).rejects.toThrow(/raw body unavailable/);
    expect(collect).not.toHaveBeenCalled();
  });

  it("resolves the tenant from the request, then posts to the gateway's clearing account in one transaction", async () => {
    const { service, collect, tenantRun, prisma } = makeMomo();
    const res: any = await service.handleCallback('mtn', raw, sign(raw));

    expect(res).toMatchObject({ matched: true, status: 'succeeded', posted: true });
    expect(tenantRun).toHaveBeenCalledWith({ organizationId: 'org_a' }, expect.any(Function));
    expect(prisma.client.$transaction).toHaveBeenCalledTimes(1);
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({
        studentProfileId: 'stu_1',
        amount: 300_000,
        paymentMethod: 'mobile_money',
        externalReference: 'REF-1',
        externalReferenceType: 'mobile_money_txn',
      }),
      expect.objectContaining({ settlementAccountId: 'acc_clr', tx: expect.anything() }),
    );
  });

  it('posts what the provider says it collected, not what was requested', async () => {
    const partial = JSON.stringify({ externalId: 'REF-1', status: 'SUCCESSFUL', amount: '250000', currency: 'UGX' });
    const { service, collect } = makeMomo();
    await service.handleCallback('mtn', partial, sign(partial));
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ amount: 250_000 }), expect.anything());
  });

  it('holds money in a foreign currency for review instead of posting it', async () => {
    const usd = JSON.stringify({ externalId: 'REF-1', status: 'SUCCESSFUL', amount: '100', currency: 'USD' });
    const { service, collect, updateMany } = makeMomo();
    const res: any = await service.handleCallback('mtn', usd, sign(usd));
    expect(res.status).toBe('needs_review');
    expect(collect).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'needs_review' }) }),
    );
  });

  it('does not post money for a failed callback', async () => {
    const failedRaw = JSON.stringify({ externalId: 'REF-1', status: 'FAILED' });
    const { service, collect } = makeMomo();
    const res: any = await service.handleCallback('mtn', failedRaw, sign(failedRaw));
    expect(res.posted).toBe(false);
    expect(collect).not.toHaveBeenCalled();
  });

  it('acknowledges an unknown reference without touching tenant data', async () => {
    const { service, collect, tenantRun } = makeMomo({ request: null });
    const res: any = await service.handleCallback('mtn', raw, sign(raw));
    expect(res).toMatchObject({ matched: false });
    expect(collect).not.toHaveBeenCalled();
    expect(tenantRun).not.toHaveBeenCalled();
  });

  it('treats a replay of an already-succeeded request as a no-op', async () => {
    const { service, collect } = makeMomo({
      request: { id: 'req_1', organizationId: 'org_a', studentProfileId: 'stu_1', amount: 300_000, providerRef: 'REF-1', provider: 'mtn', status: 'succeeded', gatewayAccountId: 'gw_1' },
    });
    const res: any = await service.handleCallback('mtn', raw, sign(raw));
    expect(res.replayed).toBe(true);
    expect(collect).not.toHaveBeenCalled();
  });

  it('a late failure never un-posts a succeeded request', async () => {
    const failedRaw = JSON.stringify({ externalId: 'REF-1', status: 'FAILED' });
    const { service, updateMany } = makeMomo({
      request: { id: 'req_1', organizationId: 'org_a', studentProfileId: 'stu_1', amount: 300_000, providerRef: 'REF-1', provider: 'mtn', status: 'succeeded', gatewayAccountId: 'gw_1' },
    });
    await service.handleCallback('mtn', failedRaw, sign(failedRaw));
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('loses the race cleanly when a concurrent callback claimed the request first', async () => {
    const { service, collect } = makeMomo({ claimCount: 0 });
    const res: any = await service.handleCallback('mtn', raw, sign(raw));
    expect(res.replayed).toBe(true);
    expect(collect).not.toHaveBeenCalled();
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
    const s = new SchoolFinanceQueryService(prisma as any, { organizationId: 'org' } as any, {} as any, makePlacementLookupStub() as any);
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
