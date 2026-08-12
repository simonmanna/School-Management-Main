import { matchesCondition } from './condition';

describe('matchesCondition', () => {
  it('empty condition always matches', () => {
    expect(matchesCondition({}, { anything: 1 })).toBe(true);
  });

  it('bare literal is equality', () => {
    expect(matchesCondition({ status: 'paid' }, { status: 'paid' })).toBe(true);
    expect(matchesCondition({ status: 'paid' }, { status: 'draft' })).toBe(false);
  });

  it('numeric operators', () => {
    expect(matchesCondition({ total: { $gte: 100 } }, { total: 100 })).toBe(true);
    expect(matchesCondition({ total: { $gt: 100 } }, { total: 100 })).toBe(false);
    expect(matchesCondition({ total: { $lt: 100 } }, { total: 99 })).toBe(true);
  });

  it('$field compares two payload fields', () => {
    expect(matchesCondition({ quantity: { $lt: { $field: 'minimum' } } }, { quantity: 3, minimum: 5 })).toBe(true);
    expect(matchesCondition({ quantity: { $lt: { $field: 'minimum' } } }, { quantity: 7, minimum: 5 })).toBe(false);
  });

  it('dotted paths resolve into nested payloads', () => {
    expect(matchesCondition({ 'product.qty': { $lte: 2 } }, { product: { qty: 2 } })).toBe(true);
  });

  it('multiple keys are AND-ed', () => {
    const cond = { status: 'paid', total: { $gte: 50 } };
    expect(matchesCondition(cond, { status: 'paid', total: 60 })).toBe(true);
    expect(matchesCondition(cond, { status: 'paid', total: 40 })).toBe(false);
  });

  it('unknown operator fails closed (no spam)', () => {
    expect(matchesCondition({ total: { $wat: 1 } }, { total: 1 })).toBe(false);
  });

  it('$in membership', () => {
    expect(matchesCondition({ kind: { $in: ['a', 'b'] } }, { kind: 'b' })).toBe(true);
    expect(matchesCondition({ kind: { $in: ['a', 'b'] } }, { kind: 'c' })).toBe(false);
  });
});
