import { Reflector } from '@nestjs/core';

/**
 * SEC-06 regression.
 *
 * The defect: `PermissionsGuard.canActivate` returned `true` for any handler
 * with no `@RequirePermissions` metadata — and it did so BEFORE the
 * `request.auth` check. So a controller method that simply forgot the decorator
 * was reachable by an anonymous caller. 80 handlers were in that state,
 * including `ApprovalsController#decide`.
 *
 * These tests pin the corrected behaviour:
 *   - undecorated + no session      -> 403 (was: 200)
 *   - undecorated + session         -> allowed, warned once
 *   - undecorated + strict mode     -> 403 regardless of session
 *   - @Public                       -> still anonymous
 *   - @NoPermissionRequired         -> session-only, no permission needed
 *   - @RequirePermissions           -> unchanged
 *
 * The guard reads its strict-mode flag into a static at class-evaluation time,
 * so the module is re-imported per scenario with the env var set beforehand.
 */

type GuardCtor = new (reflector: Reflector, resolver: { lookupPermissions: (id: string) => Promise<string[]> }) => {
  canActivate: (ctx: unknown) => Promise<boolean>;
};

function loadGuard(strict: boolean): GuardCtor {
  jest.resetModules();
  const previous = process.env.PERMISSIONS_FAIL_CLOSED;
  process.env.PERMISSIONS_FAIL_CLOSED = strict ? 'true' : 'false';
  // Permission lookups must not hit a database in a unit test.
  process.env.PERMISSIONS_DB_LOOKUP = 'false';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../../src/kernel/auth/guards/permissions.guard');
  if (previous === undefined) delete process.env.PERMISSIONS_FAIL_CLOSED;
  else process.env.PERMISSIONS_FAIL_CLOSED = previous;
  return mod.PermissionsGuard as GuardCtor;
}

/** Minimal ExecutionContext double: only what the guard actually touches. */
function ctxFor(auth: { sub: string; permissions?: string[] } | undefined) {
  const request: Record<string, unknown> = {};
  if (auth) request.auth = auth;
  return {
    getHandler: () => function handlerUnderTest() { /* marker */ },
    getClass: () => class ControllerUnderTest {},
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

/**
 * Reflector double. `metadata` maps the metadata key to its value; anything
 * absent behaves as an undecorated handler.
 */
function reflectorWith(metadata: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => metadata[key],
  } as unknown as Reflector;
}

/**
 * `jest.resetModules()` gives each guard load its own module registry, so the
 * ForbiddenException thrown inside the guard is a DIFFERENT class object from
 * one imported here — `toBeInstanceOf` fails with the baffling "Expected
 * ForbiddenException, received ForbiddenException". Assert on shape instead.
 */
async function expectForbidden(promise: Promise<unknown>): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeDefined();
  expect((thrown as { constructor: { name: string } }).constructor.name).toBe('ForbiddenException');
  expect((thrown as { getStatus?: () => number }).getStatus?.()).toBe(403);
}

// Import the real metadata keys rather than restating them. Hardcoding them
// here first silently broke this spec: PERMISSIONS_KEY is 'required_permissions',
// not 'permissions', so the reflector double returned undefined and the guard
// saw an UNDECORATED route. Two assertions passed for entirely the wrong reason.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PERMISSIONS_KEY } = require('../../src/kernel/auth/decorators/require-permissions.decorator');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { IS_PUBLIC_KEY } = require('../../src/kernel/auth/decorators/public.decorator');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NO_PERMISSION_REQUIRED_KEY } = require('../../src/kernel/auth/decorators/no-permission-required.decorator');

const resolver = { lookupPermissions: async () => [] };

describe('PermissionsGuard — SEC-06 fail-closed', () => {
  describe('default mode (undecorated requires a session)', () => {
    const Guard = loadGuard(false);

    it('refuses an anonymous caller on an undecorated handler', async () => {
      const guard = new Guard(reflectorWith({}), resolver);
      await expectForbidden(guard.canActivate(ctxFor(undefined)));
    });

    it('allows an authenticated caller on an undecorated handler', async () => {
      const guard = new Guard(reflectorWith({}), resolver);
      await expect(guard.canActivate(ctxFor({ sub: 'u1' }))).resolves.toBe(true);
    });

    it('still allows an anonymous caller on a @Public handler', async () => {
      const guard = new Guard(reflectorWith({ [IS_PUBLIC_KEY]: true }), resolver);
      await expect(guard.canActivate(ctxFor(undefined))).resolves.toBe(true);
    });

    it('allows a session-only handler without any permission', async () => {
      const guard = new Guard(
        reflectorWith({ [NO_PERMISSION_REQUIRED_KEY]: 'reads only the identity of the calling user' }),
        resolver,
      );
      await expect(guard.canActivate(ctxFor({ sub: 'u1' }))).resolves.toBe(true);
    });

    it('refuses a permissioned handler when the grant is absent', async () => {
      const guard = new Guard(reflectorWith({ [PERMISSIONS_KEY]: ['approvals:decide'] }), resolver);
      await expectForbidden(guard.canActivate(ctxFor({ sub: 'u1', permissions: ['approvals:read'] })));
    });

    it('allows a permissioned handler when the grant is present', async () => {
      const guard = new Guard(reflectorWith({ [PERMISSIONS_KEY]: ['approvals:decide'] }), resolver);
      await expect(
        guard.canActivate(ctxFor({ sub: 'u1', permissions: ['approvals:decide'] })),
      ).resolves.toBe(true);
    });
  });

  describe('strict mode (PERMISSIONS_FAIL_CLOSED=true)', () => {
    const Guard = loadGuard(true);

    it('refuses an undecorated handler even for an authenticated caller', async () => {
      const guard = new Guard(reflectorWith({}), resolver);
      await expectForbidden(guard.canActivate(ctxFor({ sub: 'u1' })));
    });

    it('does not affect explicitly declared routes', async () => {
      const guard = new Guard(reflectorWith({ [IS_PUBLIC_KEY]: true }), resolver);
      await expect(guard.canActivate(ctxFor(undefined))).resolves.toBe(true);
    });
  });
});

/**
 * F-06 / F-07 — production defaults and account state.
 *
 *  - In production an undecorated route is refused unless PERMISSIONS_FAIL_CLOSED=false.
 *  - In DB mode a deactivated account loses its session on the NEXT request
 *    (401), not when its access token expires, and the request's tenant store
 *    is refreshed with the database's grants so in-service checks
 *    (`tenant.permissions`) never act on a stale token copy.
 */
function loadGuardWith(env: Record<string, string | undefined>): any {
  jest.resetModules();
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../../src/kernel/auth/guards/permissions.guard');
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const Guard = mod.PermissionsGuard;
  // The guard reads PERMISSIONS_DB_LOOKUP when an INSTANCE is built, so the
  // environment must also hold during construction.
  return class extends Guard {
    constructor(...args: any[]) {
      const saved2: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(env)) {
        saved2[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      super(...args);
      for (const [k, v] of Object.entries(saved2)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

describe('PermissionsGuard — production defaults and live account state', () => {
  it('is fail-closed by default in production', async () => {
    const Guard = loadGuardWith({ NODE_ENV: 'production', PERMISSIONS_FAIL_CLOSED: undefined, PERMISSIONS_DB_LOOKUP: 'false' });
    const guard = new Guard(reflectorWith({}), resolver, { store: undefined });
    await expectForbidden(guard.canActivate(ctxFor({ sub: 'u1' })));
  });

  it('ends the session of a deactivated account on its next request', async () => {
    const Guard = loadGuardWith({ NODE_ENV: 'test', PERMISSIONS_FAIL_CLOSED: 'false', PERMISSIONS_DB_LOOKUP: 'true' });
    const dbResolver = { sessionState: async () => null, lookupPermissions: async () => [] };
    const guard = new Guard(reflectorWith({ [PERMISSIONS_KEY]: ['school:read'] }), dbResolver, { store: {} });
    let thrown: any;
    try {
      await guard.canActivate(ctxFor({ sub: 'u1', permissions: ['school:read'] }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown?.getStatus?.()).toBe(401);
  });

  it('decides on — and publishes — the database grants, not the token copy', async () => {
    const Guard = loadGuardWith({ NODE_ENV: 'test', PERMISSIONS_FAIL_CLOSED: 'false', PERMISSIONS_DB_LOOKUP: 'true' });
    const store: { permissions?: string[] } = { permissions: ['school:read', 'user:update'] };
    const dbResolver = { sessionState: async () => ({ permissions: ['school:read'] }), lookupPermissions: async () => [] };
    const guard = new Guard(reflectorWith({ [PERMISSIONS_KEY]: ['user:update'] }), dbResolver, { store });
    await expectForbidden(guard.canActivate(ctxFor({ sub: 'u1', permissions: ['school:read', 'user:update'] })));
    expect(store.permissions).toEqual(['school:read']);
  });
});
