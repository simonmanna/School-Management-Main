import { ForbiddenException } from '@nestjs/common';
import { PupilScopeGuard } from '../../src/kernel/auth/guards/pupil-scope.guard';

/**
 * Audit 2026-09-27 F01/F02 (I-013): every staff request naming a pupil — path,
 * query or body — passes the caller's data scope, whatever the route.
 */
describe('PupilScopeGuard', () => {
  const make = (visible: string[] | 'all', opts: { portal?: boolean; exempt?: boolean } = {}) => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => (key === 'pupilScopeExempt' && opts.exempt ? 'reason' : undefined)),
    } as any;
    const scope = {
      visibleStudentIds: jest.fn(async (ids: string[]) =>
        visible === 'all' ? 'all' : new Set(ids.filter((id) => visible.includes(id))),
      ),
    } as any;
    const tenant = { portal: opts.portal ? { kind: 'guardian' } : undefined, optionalOrganizationId: 'org1' } as any;
    return { guard: new PupilScopeGuard(reflector, scope, tenant), scope };
  };
  const ctx = (req: any) =>
    ({
      getType: () => 'http',
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u1' }, params: {}, query: {}, body: {}, ...req }) }),
    }) as any;

  it('passes a request that names no pupil without a scope lookup', async () => {
    const { guard, scope } = make([]);
    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
    expect(scope.visibleStudentIds).not.toHaveBeenCalled();
  });

  it('refuses a pupil outside scope in the path, the query or the body', async () => {
    const { guard } = make(['mine']);
    for (const req of [
      { params: { studentProfileId: 'other' } },
      { query: { studentProfileId: 'other' } },
      { body: { studentProfileId: 'other' } },
      { params: { studentId: 'other' } },
    ]) {
      await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('refuses a list with one stranger appended', async () => {
    const { guard } = make(['mine']);
    await expect(guard.canActivate(ctx({ query: { studentProfileIds: 'mine,other' } }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx({ body: { studentProfileIds: ['mine', 'other'] } }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('admits own pupils and school-wide readers', async () => {
    await expect(make(['mine']).guard.canActivate(ctx({ params: { studentProfileId: 'mine' } }))).resolves.toBe(true);
    await expect(make('all').guard.canActivate(ctx({ body: { studentProfileId: 'anyone' } }))).resolves.toBe(true);
  });

  it('an empty assignment admits nobody', async () => {
    await expect(make([]).guard.canActivate(ctx({ params: { studentProfileId: 'x' } }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('leaves portal requests and explicit exemptions to their own rules', async () => {
    await expect(make([], { portal: true }).guard.canActivate(ctx({ params: { studentProfileId: 'x' } }))).resolves.toBe(true);
    await expect(make([], { exempt: true }).guard.canActivate(ctx({ params: { studentProfileId: 'x' } }))).resolves.toBe(true);
  });
});
