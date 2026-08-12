/* eslint-disable @typescript-eslint/no-explicit-any */
import { PosOrdersService } from './pos-orders.service';

/**
 * Regression coverage for C1 — menu-item lines must reach the kitchen.
 *
 * The bug: `fireKitchen` skipped every line with no `productId`, but menu items
 * carry `menuItemId` only. A menu-driven order therefore fired ZERO tickets
 * while still charging + depleting stock. These tests assert a menuItemId-only
 * line now produces a KDS ticket routed to the recipe-derived station.
 */
describe('PosOrdersService — fireKitchen (menu-item routing)', () => {
  const orgId = 'test-org';
  let prisma: any;
  let tenant: any;
  let audit: any;
  let events: any;
  let kds: any;
  let svc: PosOrdersService;

  const receipts = { printKotPaper: jest.fn().mockResolvedValue({ ok: true, backend: 'console', kotNumber: 1 }) };
  // ADR-007 state machine. Status transitions are covered by pos.workflows.spec.ts;
  // here it only needs to not blow up so the KOT routing assertions can run.
  const workflows = { transition: jest.fn().mockResolvedValue({ fromState: 'confirmed', toState: 'in_progress' }) };

  const milestones = { forEntity: jest.fn().mockResolvedValue([]) };

  const build = () =>
    new PosOrdersService(
      prisma as any, tenant as any, audit as any, events as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, kds as any,
      receipts as any, workflows as any, milestones as any,
    );

  beforeEach(() => {
    tenant = { organizationId: orgId, userId: 'u1' };
    audit = { record: jest.fn(), recordInTx: jest.fn() };
    events = { publish: jest.fn() };
    kds = { createTicketsForSale: jest.fn().mockResolvedValue(['t1']) };
    prisma = {
      client: {
        order: {
          findFirst: jest.fn().mockResolvedValue({ id: 'o1', organizationId: orgId, orderNumber: 'ORD-1', status: 'open' }),
          update: jest.fn().mockResolvedValue({}),
        },
        orderItem: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'i1', productId: null, menuItemId: 'm1', description: 'Latte', quantity: 2, kitchenPrintedQty: 0, note: null, modifiers: [], accompanimentNames: [] },
          ]),
          update: jest.fn().mockResolvedValue({}),
        },
        // Recipe: Latte = Espresso (kitchen) — station derives from the products.
        menuProduct: {
          findMany: jest.fn().mockResolvedValue([{ productId: 'p1', product: { station: 'kitchen' } }]),
        },
        product: { findFirst: jest.fn() },
        // No explicit station override + no prep-time hint on the menu item.
        menuItem: { findFirst: jest.fn().mockResolvedValue({ stationCode: null, preparationTime: null }) },
        // Default station fallback (only hit when a line has no derivable station).
        kitchenStation: { findFirst: jest.fn().mockResolvedValue({ code: 'cafe' }) },
        // Tenant transaction wrapper — run the callback with the client itself.
        $transaction: (fn: any) => fn(prisma.client),
      },
    };
    svc = build();
  });

  it('fires a KDS ticket for a menuItemId-only line, routed by recipe station', async () => {
    const res = await svc.fireKitchen('o1');

    expect(kds.createTicketsForSale).toHaveBeenCalledTimes(1);
    const arg = kds.createTicketsForSale.mock.calls[0][0];
    expect(arg.items).toHaveLength(1);
    expect(arg.items[0]).toMatchObject({
      productId: 'm1',        // falls back to menuItemId when no stock product
      productName: 'Latte',
      quantity: 2,
      station: 'kitchen',     // derived from MenuProduct → Product.station
    });
    expect(res.count).toBe(1);

    // The line is marked printed so a re-fire only sends genuinely new qty.
    expect(prisma.client.orderItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'i1' },
        data: expect.objectContaining({ kitchenPrintedQty: 2, kitchenStatus: 'sent' }),
      }),
    );
  });

  it('skips lines that map to neither a product nor a menu item', async () => {
    prisma.client.orderItem.findMany.mockResolvedValueOnce([
      { id: 'i2', productId: null, menuItemId: null, description: 'Free text', quantity: 1, kitchenPrintedQty: 0, modifiers: [] },
    ]);
    const res = await svc.fireKitchen('o1');
    expect(kds.createTicketsForSale).not.toHaveBeenCalled();
    expect(res.count).toBe(0);
  });

  it('fires only the requested course when a course filter is given (fire/hold)', async () => {
    prisma.client.orderItem.findMany.mockResolvedValueOnce([
      { id: 'i1', productId: 'p1', menuItemId: null, description: 'Soup', quantity: 1, kitchenPrintedQty: 0, note: null, modifiers: [], accompanimentNames: [], course: 1 },
      { id: 'i2', productId: 'p2', menuItemId: null, description: 'Steak', quantity: 1, kitchenPrintedQty: 0, note: null, modifiers: [], accompanimentNames: [], course: 2 },
    ]);
    const res = await svc.fireKitchen('o1', { course: 2 });
    expect(kds.createTicketsForSale).toHaveBeenCalledTimes(1);
    const arg = kds.createTicketsForSale.mock.calls[0][0];
    expect(arg.items).toHaveLength(1);
    expect(arg.items[0].productName).toBe('Steak');
    expect(res.count).toBe(1);
  });

  describe('pickPrimaryStation', () => {
    it('returns the majority station', () => {
      expect((svc as any).pickPrimaryStation(['bar', 'bar', 'kitchen'])).toBe('bar');
    });
    it('breaks ties by first-seen (stations are now org-configurable codes)', () => {
      // The old kitchen>bar>cafe preference no longer applies — station codes are
      // arbitrary per org, so a tie resolves to the first code encountered.
      expect((svc as any).pickPrimaryStation(['bar', 'kitchen'])).toBe('bar');
      expect((svc as any).pickPrimaryStation(['grill', 'pizza'])).toBe('grill');
    });
    it('defaults to cafe when the recipe has no products', () => {
      expect((svc as any).pickPrimaryStation([])).toBe('cafe');
    });
  });
});
