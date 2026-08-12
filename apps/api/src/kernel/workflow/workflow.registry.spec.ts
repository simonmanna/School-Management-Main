import { WorkflowRegistry } from './workflow.registry';
import type { WorkflowDefinition } from '@erp/shared';

describe('WorkflowRegistry', () => {
  let registry: WorkflowRegistry;

  beforeEach(() => {
    registry = new WorkflowRegistry();
  });

  it('registers and retrieves a workflow definition', () => {
    const def: WorkflowDefinition = {
      documentType: 'invoice',
      initial: 'draft',
      transitions: [{ from: 'draft', to: 'posted', action: 'post' }],
    };
    registry.register(def);
    expect(registry.get('invoice')).toEqual(def);
  });

  it('lists all registered workflows', () => {
    registry.register({ documentType: 'invoice', initial: 'draft', transitions: [] });
    registry.register({ documentType: 'payment', initial: 'posted', transitions: [] });
    expect(registry.list()).toHaveLength(2);
  });

  it('throws on duplicate registration', () => {
    registry.register({ documentType: 'invoice', initial: 'draft', transitions: [] });
    expect(() => registry.register({ documentType: 'invoice', initial: 'draft', transitions: [] })).toThrow(/already registered/);
  });

  it('returns undefined for unknown workflow', () => {
    expect(registry.get('unknown')).toBeUndefined();
  });
});