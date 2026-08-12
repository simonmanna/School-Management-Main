import type { LifecycleDefinition } from '../../kernel/lifecycle/lifecycle.types';

/**
 * Rental custody lifecycle definitions.
 *
 * Registered in RentalModule.onModuleInit — the kernel registry rejects any
 * `defKey` that is not registered, so these MUST stay in sync with the
 * `this.lifecycle.transition(...)` calls in the rental services.
 *
 * Agreement spine:  draft → confirmed → checked_out → returned/partial
 *                   → closed (settle). cancel is legal from any state except
 *                   closed/cancelled. Terminal: closed, cancelled.
 * Unit spine:       acquire → available → checked_out → (inspect → available |
 *                   dispose → damaged | swap → cleaning) ... retire anywhere.
 */

export const RENTAL_AGREEMENT_LIFECYCLE: LifecycleDefinition = {
  key: 'custody.rental_agreement',
  entityType: 'rental_agreement',
  states: [
    'draft',
    'pending_approval',
    'confirmed',
    'checked_out',
    'partially_returned',
    'returned',
    'closed',
    'cancelled',
  ],
  transitions: [
    { from: 'draft', to: 'confirmed', action: 'confirm' },
    { from: null, to: 'cancelled', action: 'cancel' },
    { from: 'confirmed', to: 'checked_out', action: 'checkout' },
    { from: null, to: 'partially_returned', action: 'partial_return' },
    { from: null, to: 'returned', action: 'return' },
    { from: null, to: 'closed', action: 'settle' },
  ],
  terminalStates: ['closed', 'cancelled'],
};

export const RENTAL_UNIT_LIFECYCLE: LifecycleDefinition = {
  key: 'custody.rental_unit',
  entityType: 'rental_unit',
  states: [
    'available',
    'reserved',
    'checked_out',
    'returned',
    'cleaning',
    'repair',
    'damaged',
    'lost',
    'retired',
  ],
  transitions: [
    { from: null, to: 'available', action: 'acquire' },
    { from: 'available', to: 'checked_out', action: 'checkout' },
    { from: 'checked_out', to: 'checked_out', action: 'extend' },
    { from: 'checked_out', to: 'cleaning', action: 'swap' },
    { from: 'available', to: 'checked_out', action: 'swap' },
    { from: 'checked_out', to: 'available', action: 'inspect' },
    { from: 'checked_out', to: 'damaged', action: 'dispose' },
    { from: null, to: 'retired', action: 'retire' },
  ],
  terminalStates: ['retired'],
};
