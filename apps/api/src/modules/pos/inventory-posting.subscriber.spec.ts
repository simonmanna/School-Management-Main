import { InventoryPostingSubscriber } from './inventory-posting.subscriber';

/**
 * Phase C — the policy router. Verifies each handler enqueues only under its own
 * policy, that fulfillment completion is gated on all tickets being terminal
 * (derived, no link table), and that the tenant scope is set from the payload
 * (the outbox worker dispatches without one).
 */
describe('InventoryPostingSubscriber', () => {
  const orgId = 'org-1';
  let events: any;
  let prisma: any;
  let tenant: any;
  let billing: any;
  let fulfillment: any;
  let kitchenComplete: boolean;
  let sub: InventoryPostingSubscriber;

  beforeEach(() => {
    events = { subscribe: jest.fn() };
    prisma = { client: {} };
    // tenant.run just invokes the callback, and records the scope it was given.
    tenant = { lastStore: null as any };
    tenant.run = jest.fn((store: any, fn: any) => { tenant.lastStore = store; return fn(); });
    billing = {
      stockPostingTiming: jest.fn(),
      enqueueStockPosting: jest.fn().mockResolvedValue(undefined),
    };
    // The kitchen strategy's completeness is toggled per test.
    kitchenComplete = true;
    fulfillment = {
      get: jest.fn((code: string) =>
        code === 'kitchen' ? { code, label: 'Kitchen', isComplete: async () => kitchenComplete } : undefined,
      ),
    };
    sub = new InventoryPostingSubscriber(events as any, prisma as any, tenant as any, billing as any, fulfillment as any);
  });

  const fulfillmentEvt = { organizationId: orgId, orderId: 'o1', strategy: 'kitchen', documentType: 'kitchen_ticket', documentId: 't1' };
  const lifecycle = { organizationId: orgId, orderId: 'o1', fromState: 'x', toState: 'y', action: 'z' };

  it('at_fulfillment_complete: enqueues when the strategy reports complete', async () => {
    billing.stockPostingTiming.mockResolvedValue('at_fulfillment_complete');
    kitchenComplete = true;
    await (sub as any).onFulfillmentCompleted(fulfillmentEvt);
    expect(billing.enqueueStockPosting).toHaveBeenCalledWith({ orderId: 'o1', trigger: 'at_fulfillment_complete' });
    expect(tenant.lastStore).toEqual({ organizationId: orgId });
  });

  it('at_fulfillment_complete: does NOT enqueue while the strategy is incomplete', async () => {
    billing.stockPostingTiming.mockResolvedValue('at_fulfillment_complete');
    kitchenComplete = false; // another station still cooking
    await (sub as any).onFulfillmentCompleted(fulfillmentEvt);
    expect(billing.enqueueStockPosting).not.toHaveBeenCalled();
  });

  it('fulfillment.completed under a different policy is ignored', async () => {
    billing.stockPostingTiming.mockResolvedValue('at_invoice');
    await (sub as any).onFulfillmentCompleted(fulfillmentEvt);
    expect(fulfillment.get).not.toHaveBeenCalled();
    expect(billing.enqueueStockPosting).not.toHaveBeenCalled();
  });

  it('at_fulfillment_complete: an unregistered strategy is treated as complete', async () => {
    billing.stockPostingTiming.mockResolvedValue('at_fulfillment_complete');
    fulfillment.get.mockReturnValue(undefined); // no strategy registered for this code
    await (sub as any).onFulfillmentCompleted({ ...fulfillmentEvt, strategy: 'unknown' });
    expect(billing.enqueueStockPosting).toHaveBeenCalledWith({ orderId: 'o1', trigger: 'at_fulfillment_complete' });
  });

  it('at_payment: enqueues on order close', async () => {
    billing.stockPostingTiming.mockResolvedValue('at_payment');
    await (sub as any).onOrderClosed(lifecycle);
    expect(billing.enqueueStockPosting).toHaveBeenCalledWith({ orderId: 'o1', trigger: 'at_payment' });
  });

  it('at_confirmation: enqueues on order confirm', async () => {
    billing.stockPostingTiming.mockResolvedValue('at_confirmation');
    await (sub as any).onOrderConfirmed(lifecycle);
    expect(billing.enqueueStockPosting).toHaveBeenCalledWith({ orderId: 'o1', trigger: 'at_confirmation' });
  });

  it('order.closed under at_invoice does not double-enqueue (invoice path owns it)', async () => {
    billing.stockPostingTiming.mockResolvedValue('at_invoice');
    await (sub as any).onOrderClosed(lifecycle);
    expect(billing.enqueueStockPosting).not.toHaveBeenCalled();
  });
});
