/**
 * Fees ⇄ accounting integrity invariants.
 *
 *  1. PostingService is the only writer of JournalEntry / JournalLine.
 *  2. Every school document source that raises a sales invoice is classified.
 *  3. Invoice postings are balanced from the document's own total (tax included).
 *  4. Payment methods settle to the right account (digital money → clearing).
 *  5. Statement import matching follows the confidence hierarchy.
 *  6. Term scoping resolves every fee document to its term.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Prisma } from '@prisma/client';
import { DocumentBuilderService } from '../../src/modules/invoicing/document/document-builder.service';
import {
  AccountDeterminationService,
  SETTLEMENT_CLEARING_ACCOUNTS,
} from '../../src/modules/accounting/posting/account-determination.service';
import {
  FINANCIAL_DOCUMENT_PROFILES,
  OPEN_FEE_WHERE,
  SCHOOL_FEE_SOURCE_TYPES,
  financialProfile,
} from '../../src/modules/school/fees/fee-document.constants';
import { PaymentReconciliationService } from '../../src/modules/school/fees/payment-reconciliation.service';
import { FinanceControlsService } from '../../src/modules/school/fees/finance-controls.service';

const D = (n: number | string) => new Prisma.Decimal(n);
const SRC = join(__dirname, '..', '..', 'src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('invariant · single GL writer', () => {
  it('no module outside PostingService writes journal entries or lines', () => {
    const writer = /\.(journalEntry|journalLine)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
    const rawInsert = /INSERT\s+INTO\s+"Journal(Entry|Line)"/i;
    const offenders = tsFiles(SRC)
      .filter((f) => !f.endsWith(join('accounting', 'posting', 'posting.service.ts')))
      .filter((f) => {
        const text = readFileSync(f, 'utf8');
        return writer.test(text) || rawInsert.test(text);
      })
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});

describe('invariant · receivable classification', () => {
  it('every school sales invoice source is a classified receivable', () => {
    const unclassified: string[] = [];
    for (const f of tsFiles(join(SRC, 'modules', 'school'))) {
      const text = readFileSync(f, 'utf8');
      const re = /(createDocument\(|document\.create\()/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const window = text.slice(m.index, m.index + 1500);
        if (!window.includes('sales_invoice')) continue;
        const src = /sourceType:\s*'([a-z_]+)'/.exec(window)?.[1];
        if (src && !financialProfile(src)) unclassified.push(`${relative(SRC, f)} → ${src}`);
      }
    }
    expect(unclassified).toEqual([]);
  });

  it('transport and admission fees count toward the student balance; the meal wallet does not', () => {
    expect(SCHOOL_FEE_SOURCE_TYPES).toEqual(
      expect.arrayContaining([
        'school_fee',
        'school_penalty',
        'library_fine',
        'school_meal',
        'school_transport',
        'school_admission_fee',
      ]),
    );
    expect(SCHOOL_FEE_SOURCE_TYPES).not.toContain('meal_wallet');
    expect(financialProfile('meal_wallet')?.balanceClass).toBe('stored_value');
  });

  it('open-balance filter separates lifecycle from settlement', () => {
    expect(OPEN_FEE_WHERE).toMatchObject({
      status: { in: ['posted', 'paid'] },
      paymentStatus: { in: ['not_paid', 'partial'] },
      amountResidual: { gt: 0 },
    });
    for (const p of FINANCIAL_DOCUMENT_PROFILES) expect(p.sourceType).toMatch(/^[a-z_]+$/);
  });
});

describe('invariant · balanced invoice posting', () => {
  function builder(taxAmount: number) {
    const determination = {
      receivableAccount: jest.fn().mockResolvedValue('ar'),
      incomeAccount: jest.fn().mockResolvedValue('rev'),
      taxAccount: jest.fn().mockResolvedValue('vat'),
    };
    const client = {
      partner: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }) },
      product: { findFirst: jest.fn().mockResolvedValue(null) },
      tax: { findFirst: jest.fn().mockResolvedValue({ id: 't1', type: 'vat' }) },
    };
    const svc = new DocumentBuilderService({} as any, {} as any, {} as any, {} as any, determination as any);
    const doc = (total: number) => ({
      id: 'd1',
      documentNumber: 'INV-1',
      partnerId: 'p1',
      totalAmount: D(total),
      lines: [{ lineType: 'product', subtotal: D(100_000), taxId: taxAmount ? 't1' : null, taxAmount: D(taxAmount) }],
    });
    return { svc, client, doc };
  }

  const totals = (lines: any[]) => ({
    dr: lines.reduce((t, l) => t + Number(l.debit ?? 0), 0),
    cr: lines.reduce((t, l) => t + Number(l.credit ?? 0), 0),
  });

  it('debits AR with the document total, so a taxed invoice balances', async () => {
    const { svc, client, doc } = builder(18_000);
    const lines = await svc.salesPostingLines(client, doc(118_000));
    expect(lines[0]).toMatchObject({ accountId: 'ar', debit: '118000' });
    expect(totals(lines)).toEqual({ dr: 118_000, cr: 118_000 });
    expect(lines.find((l) => l.accountId === 'vat')?.credit).toBe('18000');
  });

  it('balances an untaxed invoice', async () => {
    const { svc, client, doc } = builder(0);
    const lines = await svc.salesPostingLines(client, doc(100_000));
    expect(totals(lines)).toEqual({ dr: 100_000, cr: 100_000 });
  });

  it('refuses a document whose header disagrees with its lines (the transport/meal subtotal bug)', async () => {
    const { svc, client, doc } = builder(18_000);
    await expect(svc.salesPostingLines(client, doc(100_000))).rejects.toThrow(/refusing to post an unbalanced invoice/);
  });
});

describe('invariant · settlement accounts', () => {
  function make() {
    const resolver = {
      byMapping: jest.fn(async (k: string) => `map:${k}`),
      ensureByCode: jest.fn(async (code: string) => `code:${code}`),
    };
    return { svc: new AccountDeterminationService({ client: {} } as any, resolver as any), resolver };
  }

  it.each([
    ['cash', 'map:default_cash'],
    ['bank', 'map:default_bank'],
    ['cheque', 'map:default_bank'],
    ['mobile_money', `code:${SETTLEMENT_CLEARING_ACCOUNTS.mobile_money.code}`],
    ['card', `code:${SETTLEMENT_CLEARING_ACCOUNTS.card.code}`],
  ])('%s settles to %s', async (method, expected) => {
    const { svc } = make();
    expect(await svc.settlementAccount(method, {})).toBe(expected);
  });
});

describe('statement import · confidence hierarchy', () => {
  const svc = new PaymentReconciliationService({} as any, {} as any, {} as any, {} as any, {} as any);
  const index = {
    byAdmission: new Map([
      ['S12', 'stu_s12'],
      ['S123', 'stu_s123'],
    ]),
    byPhone: new Map([
      ['772111222', new Set(['stu_phone'])],
      ['772999888', new Set(['stu_a', 'stu_b'])],
    ]),
    byName: new Map([['MUKASA OKELLO', new Set(['stu_name'])]]),
    byRequestRef: new Map([
      ['REQ-OPEN', { studentProfileId: 'stu_req', paymentId: null }],
      ['REQ-PAID', { studentProfileId: 'stu_req', paymentId: 'pay_1' }],
    ]),
    existingRefs: new Set(['BANK-DUP']),
  };
  const match = (r: any) => (svc as any).match({ amount: 1, ...r }, index);

  it('our own MoMo request reference is a HIGH match', () => {
    expect(match({ externalRef: 'REQ-OPEN' })).toMatchObject({ studentId: 'stu_req', confidence: 'high', status: 'matched' });
  });

  it('money already received under that reference is never posted twice', () => {
    expect(match({ externalRef: 'REQ-PAID' }).status).toBe('already_received');
    expect(match({ externalRef: 'BANK-DUP' }).status).toBe('already_received');
  });

  it('admission numbers match whole tokens only', () => {
    expect(match({ externalRef: 'X1', narration: 'fees for S123 term 2' })).toMatchObject({ studentId: 'stu_s123', reason: 'admission_no' });
  });

  it('a unique guardian phone is MEDIUM and needs review', () => {
    expect(match({ externalRef: 'X2', payerPhone: '+256 772 111 222' })).toMatchObject({
      studentId: 'stu_phone',
      confidence: 'medium',
      status: 'review',
    });
  });

  it('an exact name in any order is MEDIUM; a shared phone is LOW with no student', () => {
    expect(match({ externalRef: 'X3', payerName: 'okello mukasa' })).toMatchObject({ studentId: 'stu_name', confidence: 'medium' });
    const shared = match({ externalRef: 'X4', payerPhone: '0772999888' });
    expect(shared.confidence).toBe('low');
    expect(shared.studentId).toBeUndefined();
  });
});

describe('term scoping', () => {
  it('resolves tuition, penalties, meals and transport to their term; admission fees stay unscoped', async () => {
    const db = {
      document: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'fee', sourceType: 'school_fee', sourceId: 'sch', reference: 'TERM-t1' },
          { id: 'pen', sourceType: 'school_penalty', sourceId: 'fee', reference: 'PENALTY-X' },
          { id: 'meal', sourceType: 'school_meal', sourceId: 'a', reference: 'MEALS-t1' },
          { id: 'bus', sourceType: 'school_transport', sourceId: 'c', reference: 'TRANSPORT-t2' },
          { id: 'adm', sourceType: 'school_admission_fee', sourceId: 'app', reference: 'ADMISSION-FEE-1' },
        ]),
      },
      schoolFeeInvoice: { findMany: jest.fn().mockResolvedValue([{ documentId: 'fee', termId: 't1' }]) },
    };
    const svc = new FinanceControlsService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const terms = await svc.termsOfDocuments(['fee', 'pen', 'meal', 'bus', 'adm'], db);
    expect(Object.fromEntries(terms)).toEqual({ fee: 't1', pen: 't1', meal: 't1', bus: 't2' });
  });
});
