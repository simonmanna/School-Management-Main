import { scopeArgs, isOrgScoped } from './tenancy.extension';

describe('scopeArgs (tenancy enforcement)', () => {
  it('injects organizationId and a soft-delete filter on findMany for org-scoped models', () => {
    const out = scopeArgs('Partner', 'findMany', { where: { name: 'x' } }, 'org-1');
    expect((out.where as Record<string, unknown>).organizationId).toBe('org-1');
    expect((out.where as Record<string, unknown>).deletedAt).toBeNull();
    expect((out.where as Record<string, unknown>).name).toBe('x');
  });

  it('injects organizationId into create data', () => {
    const out = scopeArgs('Partner', 'create', { data: { name: 'x' } }, 'org-1');
    expect((out.data as Record<string, unknown>).organizationId).toBe('org-1');
  });

  it('scopes updateMany by organizationId', () => {
    const out = scopeArgs('Partner', 'updateMany', { where: { id: '1' }, data: { name: 'y' } }, 'org-1');
    expect((out.where as Record<string, unknown>).organizationId).toBe('org-1');
  });

  it('does NOT scope global models (Currency)', () => {
    const out = scopeArgs('Currency', 'findMany', { where: {} }, 'org-1');
    expect((out.where as Record<string, unknown>).organizationId).toBeUndefined();
  });

  it('maps organizationId across a createMany batch', () => {
    const out = scopeArgs('Product', 'createMany', { data: [{ name: 'a' }, { name: 'b' }] }, 'org-9');
    const rows = out.data as Array<Record<string, unknown>>;
    expect(rows.every((r) => r.organizationId === 'org-9')).toBe(true);
  });

  it('knows which models are tenant-scoped', () => {
    expect(isOrgScoped('Partner')).toBe(true);
    expect(isOrgScoped('Currency')).toBe(false);
  });
});

/**
 * SEC-02 regression.
 *
 * Four ways a caller could name someone else's organization and win:
 *   1. `create` guarded on `data.organizationId === undefined`, so a supplied
 *      value was kept.
 *   2. `createMany` spread `{ organizationId, ...d }` — the caller's row came
 *      last and overrode the injection.
 *   3. `upsert` scoped only `where`; the `create:` payload was never stamped.
 *   4. `update`/`updateMany` data was never inspected, so organizationId was
 *      mutable — a row could be moved to another tenant through the scoped
 *      client.
 *
 * Every one of these is now a refusal, not a silent rewrite: a write that names
 * a foreign organization is a bug or an attack, and quietly correcting it hides
 * both.
 */
describe('scopeArgs — SEC-02 cross-tenant write refusal', () => {
  const OURS = 'org-ours';
  const THEIRS = 'org-theirs';

  it('refuses a create that names another organization', () => {
    expect(() =>
      scopeArgs('Partner', 'create', { data: { name: 'x', organizationId: THEIRS } }, OURS),
    ).toThrow(/Cross-tenant write rejected/);
  });

  it('overwrites rather than defers when the caller supplies our own id', () => {
    const out = scopeArgs('Partner', 'create', { data: { name: 'x', organizationId: OURS } }, OURS);
    expect((out.data as Record<string, unknown>).organizationId).toBe(OURS);
  });

  it('refuses a createMany row that names another organization', () => {
    expect(() =>
      scopeArgs('Product', 'createMany', { data: [{ name: 'a' }, { name: 'b', organizationId: THEIRS }] }, OURS),
    ).toThrow(/Cross-tenant write rejected/);
  });

  it('wins the spread on createMany even when the caller supplies a value', () => {
    const out = scopeArgs('Product', 'createMany', { data: [{ name: 'a', organizationId: OURS }] }, OURS);
    expect((out.data as Array<Record<string, unknown>>)[0].organizationId).toBe(OURS);
  });

  it('stamps the upsert create payload, which was previously untouched', () => {
    const out = scopeArgs(
      'MedicalRecord',
      'upsert',
      { where: { studentProfileId: 's1' }, create: { studentProfileId: 's1' }, update: {} },
      OURS,
    );
    expect((out.create as Record<string, unknown>).organizationId).toBe(OURS);
    expect((out.where as Record<string, unknown>).organizationId).toBe(OURS);
  });

  it('refuses an upsert whose create payload names another organization', () => {
    expect(() =>
      scopeArgs(
        'MedicalRecord',
        'upsert',
        { where: { studentProfileId: 's1' }, create: { organizationId: THEIRS }, update: {} },
        OURS,
      ),
    ).toThrow(/Cross-tenant write rejected/);
  });

  it('refuses an update that reassigns organizationId', () => {
    expect(() =>
      scopeArgs('Partner', 'update', { where: { id: '1' }, data: { organizationId: THEIRS } }, OURS),
    ).toThrow(/Cross-tenant write rejected/);
  });

  it('refuses the Prisma { set: ... } update form too', () => {
    expect(() =>
      scopeArgs('Partner', 'updateMany', { where: { id: '1' }, data: { organizationId: { set: THEIRS } } }, OURS),
    ).toThrow(/Cross-tenant write rejected/);
  });

  it('refuses a foreign organizationId nested in a relation write', () => {
    expect(() =>
      scopeArgs(
        'Partner',
        'create',
        { data: { name: 'x', contacts: { create: [{ name: 'c', organizationId: THEIRS }] } } },
        OURS,
      ),
    ).toThrow(/Cross-tenant write rejected/);
  });

  it('allows a nested write that omits organizationId entirely', () => {
    const out = scopeArgs(
      'Partner',
      'create',
      { data: { name: 'x', contacts: { create: [{ name: 'c' }] } } },
      OURS,
    );
    expect((out.data as Record<string, unknown>).organizationId).toBe(OURS);
  });

  it('leaves unscoped models alone even when they carry an organizationId-like field', () => {
    const out = scopeArgs('Currency', 'create', { data: { code: 'UGX', organizationId: THEIRS } }, OURS);
    expect((out.data as Record<string, unknown>).organizationId).toBe(THEIRS);
  });

  it('names the offending path so the caller can find it', () => {
    expect(() =>
      scopeArgs('Partner', 'create', { data: { organizationId: THEIRS } }, OURS),
    ).toThrow(/Partner\.data\.organizationId/);
  });
});
