/* eslint-disable @typescript-eslint/no-explicit-any */
import { CashSessionService } from './cash-session.service';

/**
 * Guards that fail fast BEFORE any DB work — input validation for the hardened
 * cash-session flows (H4 sign rules, C2 negative-count reject). These need no
 * database: the checks run ahead of the `$transaction` call.
 */
describe('CashSessionService input guards', () => {
  let prisma: any;
  let tenant: any;
  let svc: CashSessionService;

  beforeEach(() => {
    // $transaction should NOT be reached for the cases under test — if it is,
    // the guard failed to fire. Make it throw a recognisable marker.
    prisma = {
      client: {
        $transaction: jest.fn(async () => { throw new Error('REACHED_TRANSACTION'); }),
      },
    };
    tenant = { organizationId: 'org-1', userId: 'cashier-1' };
    svc = new CashSessionService(
      prisma as any,
      tenant as any,
      {} as any, // events
      {} as any, // audit
      {} as any, // password
      {} as any, // posting
      {} as any, // determination
    );
  });

  describe('recordMovement — H4 sign rules', () => {
    it('rejects a zero amount for any movement type', async () => {
      await expect(
        svc.recordMovement(undefined, { movementType: 'pay_in', amount: 0 }),
      ).rejects.toThrow(/cannot be zero/i);
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a negative pay_in', async () => {
      await expect(
        svc.recordMovement(undefined, { movementType: 'pay_in', amount: -50 }),
      ).rejects.toThrow(/must be positive/i);
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a negative pay_out', async () => {
      await expect(
        svc.recordMovement(undefined, { movementType: 'pay_out', amount: -50 }),
      ).rejects.toThrow(/must be positive/i);
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
    });

    it('allows a signed (negative) adjustment through to the transaction', async () => {
      // A negative adjustment is legitimate (a downward correction) — it should
      // pass the sign guard and reach the transaction (which we stub to throw).
      await expect(
        svc.recordMovement(undefined, { movementType: 'adjustment', amount: -50 }),
      ).rejects.toThrow('REACHED_TRANSACTION');
      expect(prisma.client.$transaction).toHaveBeenCalled();
    });
  });

  describe('close — C2 negative count', () => {
    it('rejects a negative counted amount before any DB work', async () => {
      await expect(svc.close({ closingCounted: -1 })).rejects.toThrow(/cannot be negative/i);
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('recordBankDeposit — H5 positive amount is enforced (guard path)', () => {
    it('reaches the transaction for a normal deposit (bound check happens inside)', async () => {
      await expect(
        svc.recordBankDeposit('sess-1', { amount: 100, bankName: 'Stanbic' }),
      ).rejects.toThrow('REACHED_TRANSACTION');
    });
  });
});
