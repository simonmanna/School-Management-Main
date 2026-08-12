import { Prisma } from '@prisma/client';
import { TaxCalculationService } from './tax-calculation.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

describe('TaxCalculationService', () => {
  const svc = new TaxCalculationService();

  it('adds an exclusive tax on top of the net', () => {
    const r = svc.computeLine(D(100), [{ id: 't', rate: 18, isInclusive: false, isCompound: false }]);
    expect(r.net.toString()).toBe('100');
    expect(r.taxTotal.toString()).toBe('18');
    expect(r.gross.toString()).toBe('118');
  });

  it('extracts the net from an inclusive price', () => {
    const r = svc.computeLine(D(118), [{ id: 't', rate: 18, isInclusive: true, isCompound: false }]);
    expect(r.net.toString()).toBe('100');
    expect(r.taxTotal.toString()).toBe('18');
    expect(r.gross.toString()).toBe('118');
  });

  it('returns zero tax when there are no taxes', () => {
    const r = svc.computeLine(D(100), []);
    expect(r.taxTotal.toString()).toBe('0');
    expect(r.gross.toString()).toBe('100');
  });

  it('stacks a compound tax on top of a prior tax', () => {
    const r = svc.computeLine(D(100), [
      { id: 'a', rate: 10, isInclusive: false, isCompound: false },
      { id: 'b', rate: 10, isInclusive: false, isCompound: true },
    ]);
    // 10% of 100 = 10, then compound 10% of (100 + 10) = 11 -> 21
    expect(r.taxTotal.toString()).toBe('21');
  });
});
