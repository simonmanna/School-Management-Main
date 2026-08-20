/**
 * Unit test for the RequireOwnerOrPermissionGuard (P0-1 — teacher row ownership / IDOR).
 *
 * The guard is HTTP-layer: it lets a request through when the caller either
 * holds the required permission OR owns the target row (by header-provided
 * teacher identity). This proves the decision logic without standing up a full
 * HTTP server.
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

function makeContext(overrides: any = {}) {
  const req: any = {
    tenant: {
      userId: overrides.userId ?? 'u1',
      permissions: overrides.permissions ?? [],
    },
    headers: { 'x-teacher-partner-id': overrides.teacherPartnerId },
    params: overrides.params ?? {},
    body: overrides.body ?? {},
    query: overrides.query ?? {},
    ...overrides.extra,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => Dummy.prototype.lessonPlanHandler,
  } as any;
}

const guard = new RequireOwnerOrPermissionGuard(new Reflector());

describe('RequireOwnerOrPermissionGuard (P0-1)', () => {
  it('allows a user who holds the required permission (admin/school-admin)', () => {
    const ctx = makeContext({ permissions: ['school:lessonplans:own'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows the owning teacher identified via x-teacher-partner-id (row param)', () => {
    const ctx = makeContext({
      teacherPartnerId: TEACHER_A,
      params: { id: 'lp1' },
      body: { id: 'lp1', teacherPartnerId: TEACHER_A },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows the owning teacher identified via x-teacher-partner-id (row body)', () => {
    const ctx = makeContext({
      teacherPartnerId: TEACHER_A,
      body: { id: 'lp1', teacherPartnerId: TEACHER_A },
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('BLOCKS a non-owner teacher with only the "own" permission (the IDOR fix)', () => {
    const ctx = makeContext({
      teacherPartnerId: TEACHER_B,
      body: { id: 'lp1', teacherPartnerId: TEACHER_A },
    });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('BLOCKS a user with no permission and no ownership', () => {
    const ctx = makeContext({ teacherPartnerId: TEACHER_B, body: { teacherPartnerId: TEACHER_A } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('falls back to the permission check when no owner field is resolved', () => {
    // Row has no teacher field but admin holds the perm → allowed.
    const ctx = makeContext({ permissions: ['school:lessonplans:own'], body: {} });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
