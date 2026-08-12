import type { LifecycleDefinition } from '../../kernel/lifecycle/lifecycle.types';

/**
 * Repair order lifecycle definitions.
 *
 * Registered in RepairModule.onModuleInit — the kernel registry rejects any
 * `defKey` that is not registered, so these MUST stay in sync with the
 * `assertTransition(...)` calls in the repair services.
 *
 * Order spine: received → diagnosis → waiting_approval → approved → repairing
 * → testing → ready_pickup → delivered → closed. `cancelled` is legal from any
 * state (customer bailed, item beyond repair, part unavailable). Terminal:
 * closed, cancelled.
 */
export const REPAIR_ORDER_LIFECYCLE: LifecycleDefinition = {
  key: 'repair.order',
  entityType: 'repair_order',
  states: [
    'received',
    'diagnosis',
    'waiting_approval',
    'approved',
    'repairing',
    'testing',
    'ready_pickup',
    'delivered',
    'closed',
    'cancelled',
  ],
  transitions: [
    { from: 'received', to: 'diagnosis', action: 'diagnose' },
    { from: 'diagnosis', to: 'waiting_approval', action: 'quote' },
    { from: 'waiting_approval', to: 'approved', action: 'approve' },
    { from: 'waiting_approval', to: 'waiting_approval', action: 'revision' },
    { from: 'approved', to: 'repairing', action: 'start' },
    { from: 'repairing', to: 'testing', action: 'test' },
    { from: 'testing', to: 'repairing', action: 'rework' },
    { from: 'testing', to: 'ready_pickup', action: 'ready' },
    { from: 'ready_pickup', to: 'delivered', action: 'deliver' },
    { from: 'delivered', to: 'closed', action: 'close' },
    { from: null, to: 'cancelled', action: 'cancel' },
  ],
  terminalStates: ['closed', 'cancelled'],
};
