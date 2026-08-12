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
      {} as any, // events
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