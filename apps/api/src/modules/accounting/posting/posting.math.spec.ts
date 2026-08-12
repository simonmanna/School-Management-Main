import { Prisma } from '@prisma/client';
import { approxEqual } from '../../../kernel/common/money';
import { isBalanced, normalizeLines, totals, validateLines } from './posting.math';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

describe('posting.math (double-entry rules)', () => {
  it('computes functional-currency (base) amounts via the exchange rate', () => {
    const lines = normalizeLines(
      [
        { accountId: 'a', debit: 100 },
        { accountId: 'b', credit: 100 },
      ],
      D(2),
    );
    expect(lines[0].baseDebit.toString()).toBe('200');
    expect(lines[1].baseCredit.toString()).toBe('200');
  });

  it('accepts a balanced entry', () => {
    const lines = normalizeLines(
      [
        { accountId: 'a', debit: 100 },
        { accountId: 'b', credit: 60 },
        { accountId: 'c', credit: 40 },
      ],
      D(1),
    );
    expect(isBalanced(lines)).toBe(true);
    expect(totals(lines).debit.toString()).toBe('100');
  });

  it('rejects an unbalanced entry', () => {
    const lines = normalizeLines(
      [
        { accountId: 'a', debit: 100 },
        { accountId: 'b', credit: 90 },
      ],
      D(1),
    );
    expect(isBalanced(lines)).toBe(false);
  });

  it('flags a line carrying both a debit and a credit', () => {
    const lines = normalizeLines([{ accountId: 'a', debit: 100, credit: 50 }], D(1));
    expect(validateLines(lines).length).toBeGreaterThan(0);
  });

  it('flags an empty line (no debit or credit)', () => {
    const lines = normalizeLines([{ accountId: 'a' }], D(1));
    expect(validateLines(lines).length).toBeGreaterThan(0);
  });
});

describe('posting.math — rounding tolerance (D2-3)', () => {
  it('treats a sub-epsilon imbalance as approximately balanced', () => {
    // isBalanced uses approxEqual with epsilon 0.0001. A 0.00005 imbalance
    // is within tolerance and the trial balance reports balanced.
    const lines = normalizeLines(
      [
        { accountId: 'a', debit: 100 },
        { accountId: 'b', credit: 99.99995 },
      ],
      D(1),
    );
    expect(isBalanced(lines)).toBe(true);
  });

  it('flags a 0.005 imbalance as unbalanced at math level', () => {
    // Above the math epsilon (0.0001) but still inside the PostingService
    // rounding tolerance (0.01). PostingService.doPost accepts this with a
    // rounding-account leg; isBalanced alone still says NO.
    const lines = normalizeLines(
      [
        { accountId: 'a', debit: 100 },
        { accountId: 'b', credit: 99.995 },
      ],
      D(1),
    );
    expect(isBalanced(lines)).toBe(false);
  });

  it('flags a 1.00 imbalance as unbalanced', () => {
    const lines = normalizeLines(
      [
        { accountId: 'a', debit: 100 },
        { accountId: 'b', credit: 99 },
      ],
      D(1),
    );
    expect(isBalanced(lines)).toBe(false);
  });
});