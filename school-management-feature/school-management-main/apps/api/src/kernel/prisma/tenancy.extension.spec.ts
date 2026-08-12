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
