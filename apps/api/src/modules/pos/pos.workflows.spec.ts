/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WorkflowDefinition, WorkflowTransition } from '@erp/shared';
import { PosWorkflowsInitializer } from './pos.workflows';

/**
 * The POS `Order` state machine (ADR-007, P2).
 *
 * These assert the DEFINITION — which transitions exist, what they require and
 * what they reject. Execution (permission check, guard, audit, event, tx) is
 * covered by workflow.service.spec.ts.
 */
describe('PosWorkflowsInitializer — order workflow', () => {
  let def: WorkflowDefinition;

  beforeEach(() => {
    const registry = { register: jest.fn() };
    new PosWorkflowsInitializer(registry as any).onModuleInit();
    expect(registry.register).toHaveBeenCalledTimes(1);
    def = registry.register.mock.calls[0][0];
  });

  const find = (from: string, action: string): WorkflowTransition | undefined =>
    def.transitions.find((t) => t.from === from && t.action === action);

  it('registers the order document type starting at draft', () => {
    expect(def.documentType).toBe('order');
    expect(def.initial).toBe('draft');
  });

  it('walks the happy path draft → confirmed → in_progress → completed → closed', () => {
    expect(find('draft', 'confirm')?.to).toBe('confirmed');
    expect(find('confirmed', 'start_fulfillment')?.to).toBe('in_progress');
    expect(find('in_progress', 'complete')?.to).toBe('completed');
    expect(find('completed', 'close')?.to).toBe('closed');
  });

  it('allows completing straight from confirmed (counter sale, never fired)', () => {
    expect(find('confirmed', 'complete')?.to).toBe('completed');
  });

  it('allows closing an unbilled-path order (credit / write-off settlement)', () => {
    expect(find('confirmed', 'close')?.to).toBe('closed');
    expect(find('in_progress', 'close')?.to).toBe('closed');
  });

  describe('permissions mirror the existing route guards', () => {
    it('requires pos:checkout to cancel (matches POST /orders/:id/cancel)', () => {
      expect(find('confirmed', 'cancel')?.permission).toBe('pos:checkout');
    });

    it('requires pos:override to reopen (matches POST /orders/:id/reopen)', () => {
      expect(find('cancelled', 'reopen')?.permission).toBe('pos:override');
    });

    it('leaves settlement-driven close unpermissioned so internal callers cannot 403', () => {
      expect(find('completed', 'close')?.permission).toBeUndefined();
    });

    it('leaves complete unpermissioned — rental/repair bill under their own perms', () => {
      expect(find('confirmed', 'complete')?.permission).toBeUndefined();
      expect(find('in_progress', 'complete')?.permission).toBeUndefined();
    });

    it('leaves supersede unpermissioned — merge/split routes gate on tables:*', () => {
      expect(find('confirmed', 'supersede')?.permission).toBeUndefined();
      expect(find('confirmed', 'supersede')?.to).toBe('cancelled');
    });
  });

  describe('guards', () => {
    it('refuses to cancel an order that is already billed', () => {
      const guard = find('confirmed', 'cancel')!.guard!;
      expect(guard({ entity: { invoiceId: 'inv-1' } } as any)).toBe(false);
      expect(guard({ entity: { invoiceId: null } } as any)).toBe(true);
    });

    it('refuses to reopen an order that is already billed', () => {
      const guard = find('cancelled', 'reopen')!.guard!;
      expect(guard({ entity: { invoiceId: 'inv-1' } } as any)).toBe(false);
      expect(guard({ entity: { invoiceId: null } } as any)).toBe(true);
    });
  });

  describe('illegal transitions are absent', () => {
    it('cannot cancel a closed order', () => {
      expect(find('closed', 'cancel')).toBeUndefined();
    });

    it('cannot reopen a closed order', () => {
      expect(find('closed', 'reopen')).toBeUndefined();
    });

    it('cannot complete a cancelled order', () => {
      expect(find('cancelled', 'complete')).toBeUndefined();
    });

    it('cannot fire the kitchen on a completed order', () => {
      expect(find('completed', 'start_fulfillment')).toBeUndefined();
    });

    it('has no transitions out of closed at all (terminal)', () => {
      expect(def.transitions.filter((t) => t.from === 'closed')).toHaveLength(0);
    });
  });

  describe('legacy wire-compat aliases', () => {
    // An order written by an old Android APK can still sit on a legacy status;
    // without these the till would throw "no transition from 'open'".
    it.each([
      ['open', 'cancel', 'cancelled'],
      ['open', 'start_fulfillment', 'in_progress'],
      ['open', 'complete', 'completed'],
      ['preparing', 'complete', 'completed'],
      ['preparing', 'cancel', 'cancelled'],
      ['served', 'close', 'closed'],
    ])('maps legacy %s + %s → %s', (from, action, to) => {
      expect(find(from, action)?.to).toBe(to);
    });

    it('keeps the legacy alias identical to its canonical transition', () => {
      expect(find('open', 'cancel')?.permission).toBe(find('confirmed', 'cancel')?.permission);
    });
  });
});
