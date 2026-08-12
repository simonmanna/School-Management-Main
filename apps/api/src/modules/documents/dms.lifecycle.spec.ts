/**
 * DMS — Phase 2 pure lifecycle decision rules (dms.lifecycle.ts).
 * No database: the engine's guards/eligibility are pure functions.
 */
import {
  cancelEligibility,
  composeSequenceKey,
  composeSequencePrefix,
  evaluateGuards,
  findTransition,
  isReversal,
  reversalEligibility,
} from './dms.lifecycle';
import { DMS_REVERSAL_COUNTERPARTS } from './dms.types';

describe('dms.lifecycle (Phase 2 engine rules)', () => {
  const transitions = [
    { fromState: 'draft', toState: 'submitted', action: 'submit', guardJson: {} },
    { fromState: 'submitted', toState: 'approved', action: 'approve', guardJson: {} },
    { fromState: 'submitted', toState: 'draft', action: 'reject', guardJson: { requiresReason: true } },
    { fromState: 'approved', toState: 'posted', action: 'post', guardJson: { requiresApproval: true } },
    { fromState: 'posted', toState: 'paid', action: 'pay', guardJson: {} },
    { fromState: 'posted', toState: 'closed', action: 'close', guardJson: { requiresPaid: true } },
    { fromState: 'draft', toState: 'cancelled', action: 'cancel', guardJson: { requiresReason: true } },
    { fromState: 'posted', toState: 'posted', action: 'reverse', guardJson: { requiresReason: true } },
  ];

  describe('findTransition', () => {
    it('resolves an allowed (fromState, action) pair', () => {
      const t = findTransition(transitions, 'draft', 'submit');
      expect(t?.toState).toBe('submitted');
    });
    it('returns null for a disallowed pair', () => {
      expect(findTransition(transitions, 'draft', 'post')).toBeNull();
      expect(findTransition(transitions, 'paid', 'cancel')).toBeNull();
    });
  });

  describe('evaluateGuards (declarative vocabulary)', () => {
    it('passes when no guards block', () => {
      expect(evaluateGuards({}, { isPaid: false, hasApprovedRequest: false, hasSnapshot: false })).toEqual([]);
    });
    it('blocks requiresReason without a reason', () => {
      const blocked = evaluateGuards({ requiresReason: true }, { isPaid: false, hasApprovedRequest: false, hasSnapshot: false });
      expect(blocked).toHaveLength(1);
      expect(blocked[0]).toMatch(/reason/i);
    });
    it('passes requiresReason when a reason is supplied', () => {
      expect(evaluateGuards({ requiresReason: true }, { reason: 'customer request', isPaid: false, hasApprovedRequest: false, hasSnapshot: false })).toEqual([]);
    });
    it('blocks requiresApproval without an approved request', () => {
      const blocked = evaluateGuards({ requiresApproval: true }, { isPaid: false, hasApprovedRequest: false, hasSnapshot: false });
      expect(blocked).toHaveLength(1);
      expect(blocked[0]).toMatch(/approval/i);
    });
    it('passes requiresApproval with an approved request', () => {
      expect(evaluateGuards({ requiresApproval: true }, { isPaid: false, hasApprovedRequest: true, hasSnapshot: false })).toEqual([]);
    });
    it('blocks requiresPaid on an unpaid document', () => {
      const blocked = evaluateGuards({ requiresPaid: true }, { isPaid: false, hasApprovedRequest: false, hasSnapshot: false });
      expect(blocked).toHaveLength(1);
    });
    it('passes requiresPaid on a paid document', () => {
      expect(evaluateGuards({ requiresPaid: true }, { isPaid: true, hasApprovedRequest: false, hasSnapshot: false })).toEqual([]);
    });
    it('accumulates multiple blocking reasons', () => {
      const blocked = evaluateGuards(
        { requiresReason: true, requiresPaid: true },
        { isPaid: false, hasApprovedRequest: false, hasSnapshot: false },
      );
      expect(blocked).toHaveLength(2);
    });
    it('respects allowsAnyState (admin override — nothing to evaluate)', () => {
      expect(evaluateGuards({ allowsAnyState: true }, { isPaid: false, hasApprovedRequest: false, hasSnapshot: false })).toEqual([]);
    });
  });

  describe('isReversal', () => {
    it('detects same-state reverse transitions', () => {
      expect(isReversal(transitions[7])).toBe(true);
      expect(isReversal(transitions[0])).toBe(false);
    });
  });

  describe('cancel vs reverse (§3.6)', () => {
    it('cancel allowed while the document has no posted effects', () => {
      expect(cancelEligibility(false)).toEqual({ allowed: true });
    });
    it('cancel blocked once posted effects exist', () => {
      const r = cancelEligibility(true);
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/reverse/i);
    });
    it('reverse blocked without posted effects', () => {
      const r = reversalEligibility(false, 'credit_note');
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/cancel/i);
    });
    it('reverse blocked when the type has no counterpart', () => {
      const r = reversalEligibility(true, null);
      expect(r.allowed).toBe(false);
      expect(r.reason).toMatch(/not reversable/i);
    });
    it('reverse allowed with effects + registered counterpart', () => {
      expect(reversalEligibility(true, 'credit_note')).toEqual({ allowed: true });
    });
  });

  describe('counterpart registry', () => {
    it('maps financial types to their reversal counterparts', () => {
      expect(DMS_REVERSAL_COUNTERPARTS.sales_invoice).toBe('credit_note');
      expect(DMS_REVERSAL_COUNTERPARTS.pos_receipt).toBe('credit_note');
      expect(DMS_REVERSAL_COUNTERPARTS.vendor_bill).toBe('debit_note');
    });
  });

  describe('numbering composition (legacy convention)', () => {
    it('invoice → invoice:2026 with INV-2026- prefix', () => {
      expect(composeSequenceKey('invoice', 2026)).toBe('invoice:2026');
      expect(composeSequencePrefix('INV-', 2026)).toBe('INV-2026-');
    });
    it('handles a missing prefix', () => {
      expect(composeSequencePrefix(undefined, 2026)).toBe('2026-');
    });
  });
});