/**
 * Phase 5 — relation semantics validation (PURE, no DB; §3.3).
 */
import { validateRelationCreation } from './document-relations.service';

const baseType = {
  id: 'rt-1',
  relationType: 'CANCELS',
  direction: 'both' as const,
  inverseImplicit: true,
  duplicatesAllowed: false,
  cardinality: 'many',
  allowedSourceCategories: ['sales', 'retail'],
  allowedTargetCategories: ['sales', 'retail'],
};

describe('validateRelationCreation (§3.3)', () => {
  it('allows a matching category pair with cardinality many', () => {
    const v = validateRelationCreation({
      relType: baseType,
      sourceCategory: 'sales',
      targetCategory: 'retail',
      currentSourceCount: 0,
    });
    expect(v).toEqual({ allowed: true });
  });

  it('allows empty category lists (any category)', () => {
    const v = validateRelationCreation({
      relType: { ...baseType, allowedSourceCategories: [], allowedTargetCategories: [] },
      sourceCategory: 'school',
      targetCategory: 'procurement',
      currentSourceCount: 0,
    });
    expect(v).toEqual({ allowed: true });
  });

  it('blocks a source category outside the whitelist', () => {
    const v = validateRelationCreation({
      relType: baseType,
      sourceCategory: 'school',
      targetCategory: 'sales',
      currentSourceCount: 0,
    });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toContain('school');
  });

  it('blocks a target category outside the whitelist', () => {
    const v = validateRelationCreation({
      relType: baseType,
      sourceCategory: 'sales',
      targetCategory: 'procurement',
      currentSourceCount: 0,
    });
    expect(v.allowed).toBe(false);
  });

  it('enforces cardinality ONE per source document', () => {
    const v = validateRelationCreation({
      relType: { ...baseType, cardinality: 'one' },
      sourceCategory: 'sales',
      targetCategory: 'sales',
      currentSourceCount: 1,
    });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toContain('ONE');
  });

  it('rejects an unknown relation type', () => {
    const v = validateRelationCreation({
      relType: null as never,
      sourceCategory: 'sales',
      targetCategory: 'sales',
      currentSourceCount: 0,
    });
    expect(v.allowed).toBe(false);
  });
});