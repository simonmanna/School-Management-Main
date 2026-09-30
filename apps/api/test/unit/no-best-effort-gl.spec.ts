import * as fs from 'fs';
import * as path from 'path';

/**
 * Wave 18 invariant: money never moves without a journal.
 *
 * The finance review found cash leaving the school with no ledger entry because
 * posting was "best-effort" — an unresolved account silently skipped the
 * journal and the payment was still saved as posted. Every money writer now
 * fails closed. This spec keeps the old escape hatches from creeping back into
 * the modules that write cash, bank, income or expense records.
 */
const SRC = path.resolve(__dirname, '../../src/modules');

const MONEY_WRITERS = [
  'expenses/expenses.service.ts',
  'income/income.service.ts',
  'accounting/treasury/cash-session.service.ts',
  'accounting/treasury/bank-reconciliation.service.ts',
  'accounting/posting/posting.service.ts',
  'invoicing/payment/payment.service.ts',
  'procurement/purchase-orders.service.ts',
  'school/fees/billing.service.ts',
  'school/fees/mobile-money.service.ts',
];

const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /best[- ]effort GL/i, why: 'GL posting is mandatory' },
  { pattern: /recordGlSkip\s*\(/, why: 'a skipped journal must fail the operation' },
  { pattern: /glPostingSkipped/, why: 'a skipped journal must fail the operation' },
  {
    pattern: /if\s*\(\s*!\w*[Aa]ccount\w*\s*\|\|\s*!\w*[Aa]ccount\w*\s*\)\s*return\b/,
    why: 'an unresolved account must throw, not return',
  },
  {
    pattern: /if\s*\(\s*\w*[Aa]ccount\w*\s*&&\s*\w*[Aa]ccount\w*\s*\)\s*\{\s*(const|let)?\s*\w*\s*=?\s*await this\.posting\.post/,
    why: 'posting must not be conditional on account resolution',
  },
];

describe('no best-effort GL in money writers (wave 18)', () => {
  it.each(MONEY_WRITERS)('%s posts or fails', (rel) => {
    const file = path.join(SRC, rel);
    expect(fs.existsSync(file)).toBe(true);
    const text = fs.readFileSync(file, 'utf-8');
    const hits = FORBIDDEN.filter((f) => f.pattern.test(text)).map((f) => `${f.pattern} — ${f.why}`);
    expect(hits).toEqual([]);
  });
});
