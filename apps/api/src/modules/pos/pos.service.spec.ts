/* eslint-disable @typescript-eslint/no-explicit-any */
import { PosService } from './pos.service';

describe('PosService', () => {
  const orgId = 'test-org';
  let prisma: any;
  let tenant: any;
  let svc: PosService;

  beforeEach(() => {
    prisma = { client: { $transaction: jest.fn((cb: any) => cb({})), order: { create: jest.fn(), update: jest.fn() }, partner: { findFirst: jest.fn(), upsert: jest.fn() }, product: { findFirst: jest.fn(), findMany: jest.fn() } } } as any;
    tenant = { organizationId: orgId, userId: 'test-user' };
    svc = new PosService(
      prisma as any,
      tenant as any,
      {} as any, // audit
      {} as any, // events
      {} as any, // stock
      {} as any, // overrides
      {} as any, // notifications
      {} as any, // modifiers
      {} as any, // variants
      {} as any, // accompaniments
      {} as any, // kds
      {} as any, // loyalty
      {} as any, // printLifecycle
      {} as any, // receipts
      {} as any, // tables
      {} as any, // orders
      {} as any, // billing
      {} as any, // approvals
    );
  });

  describe('resolvePaymentMode', () => {
    it('returns "cash" for a single cash tender', () => {
      const mode = (svc as any).resolvePaymentMode([{ method: 'cash', amount: 100 }]);
      expect(mode).toBe('cash');
    });

    it('returns "card" for a single card tender', () => {
      const mode = (svc as any).resolvePaymentMode([{ method: 'card', amount: 100 }]);
      expect(mode).toBe('card');
    });

    it('returns "mobile_money" for a single mobile_money tender', () => {
      const mode = (svc as any).resolvePaymentMode([{ method: 'mobile_money', amount: 100 }]);
      expect(mode).toBe('mobile_money');
    });

    it('returns "cash" for a single bank tender (bank -> cash)', () => {
      const mode = (svc as any).resolvePaymentMode([{ method: 'bank', amount: 100 }]);
      expect(mode).toBe('cash');
    });

    it('returns "credit" for a single store_credit tender', () => {
      const mode = (svc as any).resolvePaymentMode([{ method: 'store_credit', amount: 100 }]);
      expect(mode).toBe('credit');
    });

    it('returns "mixed" for multiple tender methods', () => {
      const mode = (svc as any).resolvePaymentMode([
        { method: 'cash', amount: 60 },
        { method: 'card', amount: 40 },
      ]);
      expect(mode).toBe('mixed');
    });
  });

  describe('requireCashSession', () => {
    beforeEach(() => {
      prisma.client.cashSession = { findFirst: jest.fn() };
    });

    it('uses a supplied open drawer even when it belongs to a different cashier', async () => {
      // Regression: a waiter settling against the cashier's open drawer on a
      // shared terminal must not be blocked with "belongs to a different cashier".
      prisma.client.cashSession.findFirst.mockResolvedValueOnce({ id: 'drawer-1', status: 'open', userId: 'other-cashier' });
      const id = await (svc as any).requireCashSession({ cashSessionId: 'drawer-1', paymentMethod: 'cash' });
      expect(id).toBe('drawer-1');
    });

    it('falls through to a live drawer when the supplied session id is stale/closed', async () => {
      prisma.client.cashSession.findFirst
        .mockResolvedValueOnce({ id: 'drawer-1', status: 'closed', userId: 'other' }) // supplied — closed
        .mockResolvedValueOnce(null) // caller's own open drawer — none
        .mockResolvedValueOnce({ id: 'drawer-2', status: 'open', userId: 'other' }); // any open drawer
      const id = await (svc as any).requireCashSession({ cashSessionId: 'drawer-1', paymentMethod: 'cash' });
      expect(id).toBe('drawer-2');
    });

    it('lets a waiter with no own drawer settle a cash sale against any open drawer', async () => {
      prisma.client.cashSession.findFirst
        .mockResolvedValueOnce(null) // own — waiter cannot open a drawer
        .mockResolvedValueOnce({ id: 'drawer-2', status: 'open', userId: 'cashier' }); // cashier's open drawer
      const id = await (svc as any).requireCashSession({ paymentMethod: 'cash' });
      expect(id).toBe('drawer-2');
    });

    it('blocks a cash sale only when no drawer is open anywhere', async () => {
      prisma.client.cashSession.findFirst
        .mockResolvedValueOnce(null) // own
        .mockResolvedValueOnce(null); // any
      await expect((svc as any).requireCashSession({ paymentMethod: 'cash' })).rejects.toThrow('No open cash session');
    });

    it('allows a card-only sale with no drawer', async () => {
      prisma.client.cashSession.findFirst.mockResolvedValueOnce(null); // own
      const id = await (svc as any).requireCashSession({ tenders: [{ method: 'card', amount: 100 }] });
      expect(id).toBeUndefined();
    });
  });
});
