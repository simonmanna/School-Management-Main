/**
 * Unit test for RequireOwnerOrPermissionGuard (teacher row ownership / IDOR).
 *
 * The guard lets a request through when the caller either holds the required
 * permission OR *is* the teacher who owns the target row.
 *
 * ── What changed, and why this spec was rewritten ───────────────────────────
 * The old guard read the caller's teacher identity from an
 * `x-teacher-partner-id` REQUEST HEADER and permissions from `request.tenant`.
 * Both were fictions: nothing in the app ever set that header (so any client
 * could forge it), and the middleware populates `request.auth`, not
 * `request.tenant` — so the permission branch never fired in production. The
 * old spec hand-built `req.tenant` and passed a header, which is why it stayed
 * green while the real thing was broken.
 *
 * Identity now comes from the verified session via EmployeeIdentityService.
 */
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { RequireOwnerOrPermissionGuard } from '../../src/kernel/auth/guards/require-owner-or-permission.guard';
import { RequireOwnerOrPermission } from '../../src/kernel/auth/guards/require-owner-or-permission.decorator';

const TEACHER_A = 'teacher_profile_a';
const TEACHER_B = 'teacher_profile_b';

// A dummy handler carrying the decorator metadata.
class Dummy {
  @RequireOwnerOrPermission('teacherPartnerId', 'school:lessonplans:own')
  lessonPlanHandler() {
    return true;
  }
}

/** Stub identity service: the signed-in user IS `selfTeacherId`. */
const identityFor = (selfTeacherId: string | null) =>
  ({
    isSelfTeacher: async (id: string) => !!selfTeacherId && id === selfTeacherId,
  }) as any;

function makeContext(overrides: any = {}) {
  const req: any = {
    // `auth` is what the tenant middleware actually sets.
    auth: {
      userId: overrides.userId ?? 'u1',
      permissions: overrides.permissions ?? [],
    },
    // Deliberately still present, to prove the guard IGNORES it now.
    headers: { 'x-teacher-partner-id': overrides.spoofHeader },
    params: overrides.params ?? {},
    body: overrides.body ?? {},
    query: overrides.query ?? {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => Dummy.prototype.lessonPlanHandler,
  } as any;
}

const guardAs = (selfTeacherId: string | null) =>
  new RequireOwnerOrPermissionGuard(new Reflector(), identityFor(selfTeacherId));

describe('RequireOwnerOrPermissionGuard', () => {
  it('allows a caller who holds the required permission (admin/school-admin)', async () => {
    const guard = guardAs(null);
    const ctx = makeContext({ permissions: ['school:lessonplans:own'] });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('reads permissions from request.auth (not the never-populated request.tenant)', async () => {
    const guard = guardAs(null);
    // Same permission, but hung off `tenant` the way the old guard expected.
    const ctx = makeContext({});
    (ctx.switchToHttp().getRequest() as any).tenant = { permissions: ['school:lessonplans:own'] };
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows the owning teacher, resolved from the SESSION (route param)', async () => {
    const guard = guardAs(TEACHER_A);
    const ctx = makeContext({ params: { teacherPartnerId: TEACHER_A } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows the owning teacher, resolved from the SESSION (body field)', async () => {
    const guard = guardAs(TEACHER_A);
    const ctx = makeContext({ body: { id: 'lp1', teacherPartnerId: TEACHER_A } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('BLOCKS a non-owner teacher with only the "own" permission (the IDOR fix)', async () => {
    const guard = guardAs(TEACHER_B);
    const ctx = makeContext({ body: { id: 'lp1', teacherPartnerId: TEACHER_A } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('IGNORES a forged x-teacher-partner-id header — the old bypass', async () => {
    // Caller is teacher B but claims to be A via the header the old guard trusted.
    const guard = guardAs(TEACHER_B);
    const ctx = makeContext({
      spoofHeader: TEACHER_A,
      body: { teacherPartnerId: TEACHER_A },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('BLOCKS a caller who is not staff at all', async () => {
    const guard = guardAs(null);
    const ctx = makeContext({ body: { teacherPartnerId: TEACHER_A } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('BLOCKS when no owner id is present and the caller lacks the permission', async () => {
    const guard = guardAs(TEACHER_A);
    const ctx = makeContext({ body: {} });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows an admin even when no owner id is resolved', async () => {
    const guard = guardAs(null);
    const ctx = makeContext({ permissions: ['school:lessonplans:own'], body: {} });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
