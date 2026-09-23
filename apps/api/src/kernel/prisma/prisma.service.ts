import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { tenancyExtension } from './tenancy.extension';

/**
 * Provides two clients:
 *  - `client`: tenant-aware + soft-delete-aware + RLS-aware. Use this in all
 *              app code. EVERY statement it issues on behalf of a tenant runs
 *              with `app.org_id` set, so the `tenant_isolation` RLS policy is a
 *              real second line of defence rather than a decorative one:
 *                · interactive `$transaction(fn)` — set once at the start;
 *                · batch `$transaction([...])` — a `set_config` statement is
 *                  prepended to the batch (same connection, same transaction);
 *                · any other operation, model or raw — wrapped in a two-statement
 *                  batch transaction `[set_config, op]` (Prisma's documented RLS
 *                  pattern). Operations already inside a transaction are left
 *                  alone: the transaction carries the setting.
 *  - `raw`:    unscoped client for system work that legitimately spans tenants
 *              or runs before a tenant is known (login by organization code,
 *              refresh-token lookup, cron fan-out, signed downloads). When
 *              SYSTEM_DATABASE_URL is set it connects through that (BYPASSRLS)
 *              role; otherwise it shares the application connection. Every raw
 *              read must carry its own explicit organization filter.
 *
 * Production posture (enforced in `assertRlsPosture`): the application role is
 * NOSUPERUSER/NOBYPASSRLS, so RLS applies to `client`; `raw` has its own role.
 * Provision both with `pnpm rls:setup-role`.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly base: PrismaClient;
  private readonly system: PrismaClient;
  public readonly client: PrismaClient;

  constructor(tenant: TenantContextService) {
    // Bound explicitly at construction rather than resolved from the environment
    // at connect time, so the role a service was built for is the role it uses.
    this.base = new PrismaClient(process.env.DATABASE_URL ? { datasourceUrl: process.env.DATABASE_URL } : undefined);
    const systemUrl = process.env.SYSTEM_DATABASE_URL;
    this.system = systemUrl ? new PrismaClient({ datasourceUrl: systemUrl }) : this.base;

    const base = this.base;
    const setGuc = (orgId: string) => base.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;

    const extended = this.base.$extends(tenancyExtension(tenant)) as unknown as PrismaClient;
    this.client = extended.$extends({
      name: 'rls-tenant-context',
      query: {
        // Top-level $allOperations covers model operations AND raw queries.
        async $allOperations({ args, query, __internalParams }: any) {
          const orgId = tenant.optionalOrganizationId;
          // No tenant (system boot, public route) → nothing to assert; RLS denies
          // org-scoped rows under the app role, which is the intended default.
          // Inside a transaction → the transaction already carries the setting.
          if (!orgId || __internalParams?.transaction) return query(args);
          const [, result] = await base.$transaction([setGuc(orgId), query(args)]);
          return result;
        },
      },
    }) as unknown as PrismaClient;

    const originalTransaction = (this.client as any).$transaction.bind(this.client);
    (this.client as any).$transaction = async (arg: any, ...rest: any[]) => {
      const orgId = tenant.optionalOrganizationId;
      // Batch form — $transaction([op, op, ...]). The ops are lazy PrismaPromises
      // executed by the batch runner on one connection, so prepending set_config
      // scopes the whole batch. (Wrapping them in an interactive transaction and
      // returning the array never awaited them — every batched write was a
      // silent no-op. Do not reintroduce that.)
      if (Array.isArray(arg)) {
        if (!orgId) return originalTransaction(arg, ...rest);
        const results = await originalTransaction([setGuc(orgId), ...arg], ...rest);
        return (results as unknown[]).slice(1);
      }
      const run = async (tx: any) => {
        if (orgId) {
          // is_local = true: auto-reset at COMMIT/ROLLBACK, never leaks to the
          // next user of this pooled connection.
          await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, true)`;
        }
        return arg(tx);
      };
      return originalTransaction(run, ...rest);
    };
  }

  async onModuleInit(): Promise<void> {
    await this.base.$connect();
    if (this.system !== this.base) await this.system.$connect();
    await this.assertRlsPosture();
  }

  /**
   * Report — and in production refuse — configurations where tenant isolation
   * at the database is inert or where the app cannot work.
   *
   *  1. The application role must not be SUPERUSER/BYPASSRLS, or every
   *     `tenant_isolation` policy is bypassed.
   *  2. When it is not (RLS live), pre-tenant lookups (login by organization
   *     code, refresh, cron fan-out) need SYSTEM_DATABASE_URL, or they see no
   *     rows and nobody can log in.
   *
   * Set RLS_ALLOW_SUPERUSER=true to acknowledge (1) and boot anyway.
   */
  private async assertRlsPosture(): Promise<void> {
    const log = new Logger(PrismaService.name);
    const prod = process.env.NODE_ENV === 'production';
    let role: { rolsuper: boolean; rolbypassrls: boolean } | undefined;
    try {
      const rows = await this.base.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
      `;
      role = rows[0];
    } catch (err) {
      log.warn(`Could not determine RLS posture: ${err instanceof Error ? err.message : err}`);
      return;
    }
    if (!role) return;

    if (role.rolsuper || role.rolbypassrls) {
      const why = role.rolsuper ? 'a SUPERUSER' : 'BYPASSRLS';
      const message =
        `Database user is ${why} — Row-Level Security is bypassed and tenant isolation ` +
        'rests entirely on the Prisma tenancy extension. Provision a non-superuser role ' +
        'with `pnpm rls:setup-role`.';
      if (prod && process.env.RLS_ALLOW_SUPERUSER !== 'true') {
        throw new Error(`${message} Set RLS_ALLOW_SUPERUSER=true to accept this and boot anyway.`);
      }
      log.warn(message);
      return;
    }

    if (this.system === this.base) {
      const message =
        'RLS is enforced for the application role but SYSTEM_DATABASE_URL is not set, so ' +
        'pre-tenant lookups (login, token refresh, scheduled jobs) cannot see any rows. ' +
        'Point SYSTEM_DATABASE_URL at the system role created by `pnpm rls:setup-role`.';
      if (prod) throw new Error(message);
      log.warn(message);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
    if (this.system !== this.base) await this.system.$disconnect();
  }

  get raw(): PrismaClient {
    return this.system;
  }
}
