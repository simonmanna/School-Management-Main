import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TenderDto, ReceivePaymentDto } from '../../src/modules/pos/order/dto/order.dto';

/**
 * D2 — a tender leg must be a positive, finite amount, enforced at the HTTP
 * validation boundary. This guards the split-tender attack where a negative
 * leg (e.g. [150 cash, -50 card]) sums to the residual, passes the total
 * check, and would otherwise write a reversing Payment that corrupts the
 * drawer / GL. D1 — ReceivePaymentDto must accept an optional allowPartial.
 */
function tenderErrors(amount: unknown): string[] {
  const dto = plainToInstance(TenderDto, { method: 'cash', amount });
  return validateSync(dto).flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('TenderDto amount validation (D2)', () => {
  it('accepts a positive finite amount', () => {
    expect(tenderErrors(150)).toHaveLength(0);
  });

  it.each([0, -1, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-positive / non-finite amount %p',
    (amount) => {
      expect(tenderErrors(amount).length).toBeGreaterThan(0);
    },
  );

  it('rejects a missing amount', () => {
    const dto = plainToInstance(TenderDto, { method: 'cash' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});

describe('ReceivePaymentDto.allowPartial (D1)', () => {
  it('accepts allowPartial=true', () => {
    const dto = plainToInstance(ReceivePaymentDto, { allowPartial: true, tenders: [{ method: 'cash', amount: 10 }] });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('accepts an omitted allowPartial (defaults to strict full settlement)', () => {
    const dto = plainToInstance(ReceivePaymentDto, { paymentMethod: 'cash' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a non-boolean allowPartial', () => {
    const dto = plainToInstance(ReceivePaymentDto, { allowPartial: 'yes' as unknown as boolean });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });

  it('rejects a nested tender with a negative amount', () => {
    const dto = plainToInstance(ReceivePaymentDto, { tenders: [{ method: 'card', amount: -5 }] });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});
