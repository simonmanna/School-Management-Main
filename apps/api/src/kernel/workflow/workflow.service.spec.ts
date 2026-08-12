import { WorkflowService } from './workflow.service';
import { WorkflowRegistry } from './workflow.registry';
import type { WorkflowDefinition } from '@erp/shared';

/**
 * Tests WorkflowService's lookup methods (availableActions, canTransition) which
 * don't require a DB. The full transition() flow is exercised in integration
 * tests with a real DB.
 */
describe('WorkflowService (lookup methods)', () => {
  let svc: WorkflowService;
  let registry: WorkflowRegistry;

  beforeEach(() => {
    registry = new WorkflowRegistry();
    // Build a WorkflowService with stub deps for the lookup methods.
    svc = new WorkflowService(
      {} as any, // prisma
      {} as any, // tenant
      {} as any, // audit
      {} as any, // outbox
      registry,
    );

    const invoiceWorkflow: WorkflowDefinition = {
      documentType: 'invoice',
      initial: 'draft',
      transitions: [
        { from: 'draft', to: 'posted', action: 'post', permission: 'invoice:post' },
        { from: 'posted', to: 'cancelled', action: 'cancel', permission: 'invoice:cancel' },
      ],
    };
    registry.register(invoiceWorkflow);
  });

  describe('availableActions', () => {
    it('returns actions allowed by permissions', () => {
      const actions = svc.availableActions('invoice', 'draft', ['invoice:post']);
      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe('post');
    });

    it('returns no actions if permissions do not match', () => {
      const actions = svc.availableActions('invoice', 'draft', []);
      expect(actions).toHaveLength(0);
    });

    it('returns [] for unknown entity type', () => {
      const actions = svc.availableActions('unknown', 'draft', []);
      expect(actions).toEqual([]);
    });

    it('returns multiple actions from the same from-state', () => {
      // Add a second transition from 'draft'.
      registry.register({
        documentType: 'partner',
        initial: 'active',
        transitions: [
          { from: 'active', to: 'archived', action: 'archive', permission: 'partner:delete' },
          { from: 'active', to: 'inactive', action: 'deactivate', permission: 'partner:update' },
        ],
      });
      const actions = svc.availableActions('partner', 'active', ['partner:delete', 'partner:update']);
      expect(actions.map((a) => a.action).sort()).toEqual(['archive', 'deactivate']);
    });
  });

  describe('canTransition', () => {
    it('returns the transition when valid', () => {
      const t = svc.canTransition('invoice', 'draft', 'post', ['invoice:post']);
      expect(t?.to).toBe('posted');
    });

    it('returns undefined when no matching transition', () => {
      const t = svc.canTransition('invoice', 'draft', 'cancel', ['invoice:cancel']);
      expect(t).toBeUndefined();
    });

    it('returns undefined when permission missing', () => {
      const t = svc.canTransition('invoice', 'draft', 'post', []);
      expect(t).toBeUndefined();
    });
  });
});

/**
 * Phase A — the engine emits the business fact for a transition, on the SAME
 * transaction as the status update. A rolled-back transition must never leave
 * an event behind claiming it happened.
 */
describe('WorkflowService.transition — business events', () => {
  const orgId = 'org-1';
  let registry: WorkflowRegistry;
  let prisma: any;
  let audit: any;
  let outbox: any;
  let svc: WorkflowService;

  beforeEach(() => {
    registry = new WorkflowRegistry();
    const client: any = {
      order: {
        findFirst: jest.fn().mockResolvedValue({ id: 'o1', status: 'confirmed' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    // $transaction hands the same client back, so `tx` === `client` in assertions.
    client.$transaction = jest.fn((cb: any) => cb(client));
    prisma = { client };
    audit = { recordInTx: jest.fn() };
    outbox = { publish: jest.fn() };
    svc = new WorkflowService(
      prisma as any,
      { organizationId: orgId, userId: 'u1', permissions: [] } as any,
      audit as any,
      outbox as any,
      registry,
    );

    registry.register({
      documentType: 'order',
      initial: 'draft',
      transitions: [
        // Declared fact.
        { from: 'confirmed', to: 'completed', action: 'complete', event: 'order.completed' },
        // No `event` — notification only, deliberately not a recorded fact.
        { from: 'confirmed', to: 'in_progress', action: 'start_fulfillment' },
      ],
    });
  });

  it('publishes the declared typed event', async () => {
    await svc.transition({ entityType: 'order', entityId: 'o1', action: 'complete' });
    expect(outbox.publish).toHaveBeenCalledWith(
      prisma.client,
      'order.completed',
      expect.objectContaining({ organizationId: orgId, orderId: 'o1', fromState: 'confirmed', toState: 'completed' }),
    );
  });

  it('falls back to an untyped entityType.action name when no event is declared', async () => {
    await svc.transition({ entityType: 'order', entityId: 'o1', action: 'start_fulfillment' });
    expect(outbox.publish).toHaveBeenCalledWith(
      prisma.client,
      'order.start_fulfillment',
      expect.anything(),
    );
  });

  it('publishes on the caller transaction, not a fresh one (durability)', async () => {
    const tx: any = {
      order: {
        findFirst: jest.fn().mockResolvedValue({ id: 'o1', status: 'confirmed' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    await svc.transition({ entityType: 'order', entityId: 'o1', action: 'complete', externalTx: tx });
    expect(prisma.client.$transaction).not.toHaveBeenCalled();
    expect(outbox.publish).toHaveBeenCalledWith(tx, 'order.completed', expect.anything());
  });

  it('merges the transition payload into the fact', async () => {
    await svc.transition({
      entityType: 'order',
      entityId: 'o1',
      action: 'complete',
      payload: { invoiceId: 'inv-9' },
    });
    expect(outbox.publish).toHaveBeenCalledWith(
      prisma.client,
      'order.completed',
      expect.objectContaining({ invoiceId: 'inv-9' }),
    );
  });
});