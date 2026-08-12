import { Prisma } from '@prisma/client';
import { StockPostingService } from './stock-posting.service';

/**
 * Focused unit test for the returns COGS-reversal leg. postReturnRestock is the
 * structural inverse of postIssue: it must debit Stock Valuation and credit COGS
 * by the same amount (so the entry balances) and skip the GL entirely when the
 * restocked cost is zero/negative (mirrors postIssue's zero-cost guard).
 */
describe('StockPostingService.postReturnRestock', () => {
  function makeSvc() {
    const posting = { post: jest.fn().mockResolvedValue({ id: 'je1' }) };
    const ruleService = {
      resolve: jest.fn().mockRejectedValue(new Error('No posting rule configured')),
    };
    const determination = {
      mapped: jest.fn(async (key: string) =>
        key === 'cogs' ? 'acc-cogs' : key === 'stock_valuation' ? 'acc-stockval' : `acc-${key}`,
      ),
    };
    const svc = new StockPostingService(
      {} as any, // prisma
      {} as any, // tenant
      {} as any, // events
      posting as any,
      determination as any,
      {} as any, // costResolver
      ruleService as any,
    );
    return { svc, posting };
  }

  const tx = { product: { findFirst: jest.fn().mockResolvedValue({ name: 'Coffee' }) } };

  it('posts a balanced Dr Stock Valuation / Cr COGS at the supplied cost', async () => {
    const { svc, posting } = makeSvc();
    await svc.postReturnRestock({
      productId: 'p1',
      totalValue: new Prisma.Decimal('150'),
      date: new Date('2026-07-23'),
      sourceType: 'pos_refund',
      sourceId: 'inv1',
      tx: tx as any,
    });

    expect(posting.post).toHaveBeenCalledTimes(1);
    const arg = posting.post.mock.calls[0][0];
    expect(arg.journalCode).toBe('INV');
    const debit = arg.lines.find((l: any) => l.debit);
    const credit = arg.lines.find((l: any) => l.credit);
    expect(debit.accountId).toBe('acc-stockval');
    expect(credit.accountId).toBe('acc-cogs');
    // Balanced: the debit and credit legs are equal.
    expect(Number(debit.debit)).toBe(150);
    expect(Number(credit.credit)).toBe(150);
  });

  it('skips the GL when the restocked cost is zero', async () => {
    const { svc, posting } = makeSvc();
    await svc.postReturnRestock({
      productId: 'p1',
      totalValue: new Prisma.Decimal('0'),
      date: new Date(),
      sourceType: 'pos_refund',
      sourceId: 'inv1',
      tx: tx as any,
    });
    expect(posting.post).not.toHaveBeenCalled();
  });

  it('skips the GL for a negative cost (never posts a reversed entry)', async () => {
    const { svc, posting } = makeSvc();
    await svc.postReturnRestock({
      productId: 'p1',
      totalValue: new Prisma.Decimal('-5'),
      date: new Date(),
      sourceType: 'pos_refund',
      sourceId: 'inv1',
      tx: tx as any,
    });
    expect(posting.post).not.toHaveBeenCalled();
  });
});

/**
 * Production legs. Both shipped inert: the `wip` mapping resolved to nothing so
 * both legs collapsed onto stock_valuation and the entry cancelled to zero. With
 * Phase 0's fix `mapped('wip')` resolves, so these must post to DISTINCT accounts
 * in the correct direction. The "not the same account" assertion is the guard
 * against the exact regression.
 */
describe('StockPostingService production legs', () => {
  function makeSvc() {
    const posting = { post: jest.fn().mockResolvedValue({ id: 'je1' }) };
    // No rule configured → the method's own fallback (mapped('wip') / mapped('stock_valuation')).
    const ruleService = { resolve: jest.fn().mockRejectedValue(new Error('No posting rule configured')) };
    const determination = {
      mapped: jest.fn(async (key: string) =>
        key === 'wip' ? 'acc-wip' : key === 'stock_valuation' ? 'acc-stockval' : `acc-${key}`,
      ),
    };
    const svc = new StockPostingService(
      {} as any,
      {} as any,
      {} as any,
      posting as any,
      determination as any,
      {} as any,
      ruleService as any,
    );
    return { svc, posting };
  }
  const tx = { product: { findFirst: jest.fn().mockResolvedValue({ name: 'Cake' }) } };

  it('postProductionConsume posts Dr WIP / Cr Stock Valuation, distinct accounts', async () => {
    const { svc, posting } = makeSvc();
    await svc.postProductionConsume({
      productId: 'p1',
      totalValue: new Prisma.Decimal('200'),
      date: new Date('2026-08-02'),
      sourceType: 'production_order',
      sourceId: 'MO-1',
      tx: tx as any,
    });
    expect(posting.post).toHaveBeenCalledTimes(1);
    const arg = posting.post.mock.calls[0][0];
    const debit = arg.lines.find((l: any) => l.debit);
    const credit = arg.lines.find((l: any) => l.credit);
    expect(debit.accountId).toBe('acc-wip');
    expect(credit.accountId).toBe('acc-stockval');
    expect(debit.accountId).not.toBe(credit.accountId); // the regression guard
    expect(Number(debit.debit)).toBe(200);
    expect(Number(credit.credit)).toBe(200);
  });

  it('postProductionOutput posts Dr Stock Valuation / Cr WIP, distinct accounts', async () => {
    const { svc, posting } = makeSvc();
    await svc.postProductionOutput({
      productId: 'p1',
      totalValue: new Prisma.Decimal('200'),
      date: new Date('2026-08-02'),
      sourceType: 'production_order',
      sourceId: 'MO-1',
      tx: tx as any,
    });
    const arg = posting.post.mock.calls[0][0];
    const debit = arg.lines.find((l: any) => l.debit);
    const credit = arg.lines.find((l: any) => l.credit);
    expect(debit.accountId).toBe('acc-stockval');
    expect(credit.accountId).toBe('acc-wip');
    expect(debit.accountId).not.toBe(credit.accountId); // the regression guard
    expect(Number(debit.debit)).toBe(200);
    expect(Number(credit.credit)).toBe(200);
  });

  it('skips the GL when the production value is zero', async () => {
    const { svc, posting } = makeSvc();
    await svc.postProductionConsume({
      productId: 'p1',
      totalValue: new Prisma.Decimal('0'),
      date: new Date(),
      sourceType: 'production_order',
      sourceId: 'MO-1',
      tx: tx as any,
    });
    expect(posting.post).not.toHaveBeenCalled();
  });
});
