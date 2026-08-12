/**
 * Unit: seed data validity — guard vocabulary (G4), lifecycle state targets,
 * duplicate transitions, type→lifecycle references. Pure — no DB.
 */
import { DMS_LIFECYCLES, DMS_TYPE_POLICIES, DMS_RELATION_TYPES, buildPermissionRows } from './dms.seed-data';
import { validateGuardJson, GUARD_VOCABULARY } from './dms.types';
import { validateLifecycleSeeds, validateTypePolicies } from './dms.seed-registry';
import type { LifecycleSeed } from './dms.types';

describe('DMS seed data (Phase 1)', () => {
  it('has lifecycle seeds that pass validation', () => {
    const count = validateLifecycleSeeds(DMS_LIFECYCLES);
    expect(count).toBeGreaterThan(0);
  });

  it('has exactly 6 lifecycles and 17 types', () => {
    expect(DMS_LIFECYCLES).toHaveLength(6);
    expect(DMS_TYPE_POLICIES).toHaveLength(17);
    expect(DMS_RELATION_TYPES).toHaveLength(9);
  });

  it('every type references a known lifecycle', () => {
    expect(() => validateTypePolicies(DMS_TYPE_POLICIES, DMS_LIFECYCLES.map((l) => l.code))).not.toThrow();
  });

  it('contains the five legacy system codes (migrated enum mirror)', () => {
    const codes = DMS_TYPE_POLICIES.map((t) => t.code);
    for (const legacy of ['sales_invoice', 'credit_note', 'vendor_bill', 'debit_note', 'proforma_invoice']) {
      expect(codes).toContain(legacy);
    }
  });

  it('rejects unknown guard keys (G4 whitelist)', () => {
    expect(() =>
      validateGuardJson({ requiresReason: true, requiresApproval: false }, 'ok-guard'),
    ).not.toThrow();
    expect(() => validateGuardJson({ onTimeout: 'kill' }, 'bad-guard')).toThrow(/unknown keys \[onTimeout\]/);
    expect(() => validateGuardJson({ requiresReason: 'yes' }, 'bad-type')).toThrow(/must be boolean/);
  });

  it('rejects transitions targeting states outside the lifecycle (pure)', () => {
    const bad: LifecycleSeed = {
      code: 'broken_doc',
      name: 'Broken',
      states: ['draft', 'posted'],
      initialState: 'draft',
      transitions: [
        { from: 'draft', to: 'nonsense', action: 'post' },
      ],
    };
    expect(() => validateLifecycleSeeds([bad])).toThrow(/toState 'nonsense'/);
  });

  it('rejects duplicate (from, action) transitions (pure)', () => {
    const bad: LifecycleSeed = {
      code: 'dup_doc',
      name: 'Dup',
      states: ['draft', 'posted', 'cancelled'],
      initialState: 'draft',
      transitions: [
        { from: 'draft', to: 'posted', action: 'post' },
        { from: 'draft', to: 'cancelled', action: 'post' },
      ],
    };
    expect(() => validateLifecycleSeeds([bad])).toThrow(/duplicate transition draft.post/);
  });

  it('permission catalog is large enough and well-formed', () => {
    const rows = buildPermissionRows();
    expect(rows.length).toBe(7 + DMS_TYPE_POLICIES.length * 17);
    const keys = new Set(rows.map((r) => r.key));
    expect(keys.size).toBe(rows.length); // no duplicated keys
    for (const r of rows) expect(r.key).toMatch(/^document:/);
    // every type has post + cancel + reverse keys (rev 4 semantics)
    for (const t of DMS_TYPE_POLICIES) {
      expect(keys.has(`document:${t.code}:post`)).toBe(true);
      expect(keys.has(`document:${t.code}:cancel`)).toBe(true);
      expect(keys.has(`document:${t.code}:reverse`)).toBe(true);
    }
  });

  it('guard vocabulary is the fixed whitelist', () => {
    expect(GUARD_VOCABULARY).toEqual([
      'permission',
      'requiresApproval',
      'requiresReason',
      'requiresPaid',
      'requiresSnapshot',
      'allowsAnyState',
    ]);
  });
});