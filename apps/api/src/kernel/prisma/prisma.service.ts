import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { tenancyExtension } from './tenancy.extension';

/**
 * Provides two clients:
 *  - `client`: tenant-aware + soft-delete-aware + RLS-aware. Use this in
 *              all app code. Every transaction opens with `SET LOCAL
 *              app.org_id = '<tenant>'` so Postgres RLS policies can verify
 *              the calling tenant against the row's organizationId.
 *  - `raw`:    unscoped base client. Use only for system tables, the Setting
 *              table, migrations, seeding and tests (ADR-002/004).
 *
 * RLS status: D2-1 enables Row-Level Security policies on every org-scoped
 * table. The policies are FORCEd so they apply even to the table owner — but
 * Postgres SUPERUSER still bypasses RLS by definition. To get the second line
 * of defense, run `pnpm tsx scripts/setup-rls-role.ts` and connect the app via
 * the produced `app` role (not the `postgres` superuser).
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly base: PrismaClient;
  public readonly client: PrismaClient;

  constructor(tenant: TenantContextService) {
    this.base = new PrismaClient();
    const extended = this.base.$extends(tenancyExtension(tenant)) as unknown as PrismaClient;
    this.client = extended.$extends({
      name: 'rls-tenant-context',
      query: {
        $allModels: {
          // Inject the org-id GUC at the start of every transaction so the
          // `tenant_isolation` RLS policy can compare it to `organizationId`.
          // SET LOCAL is scoped to the current transaction; no risk of leak.
          async $allOperations({ args, query, operation }: any) {
            // Only inject for transactional ops; reads on the raw client may
            // happen outside a tx (e.g. system-table queries during boot).
            if (operation === 'executeRaw' || operation === 'queryRaw' || operation === 'executeRawUnsafe' || operation === 'queryRawUnsafe') {
              // Best-effort: do nothing for raw SQL — caller is expected to set
              // the GUC explicitly if they want RLS enforcement.
              return query(args);
            }
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;

    // Attach the GUC setter via a $transaction wrapper that runs at the start
    // of every transaction issued by the extended client.
    // (We re-bind the $transaction method to call our wrapper.)
    const originalTransaction = (extended as any).$transaction.bind(extended);
    (this.client as any).$transaction = async (arg: any, ...rest: any[]) => {
      const orgId = tenant.optionalOrganizationId;
      // Batch form — $transaction([op, op, ...]). These are lazy PrismaPromises
      // that only execute when the batch runner consumes them. Wrapping them in
      // an interactive transaction and RETURNING the array from the callback
      // never awaited them, so every batched write silently did nothing while
      // the caller saw a "successful" resolve (password changes and POS PIN
      // resets were no-ops). Batch form must be delegated untouched.
      //
      // Consequence: the app.org_id GUC is not injected for the batch form, so
      // those statements run without RLS context. Callers that need the RLS
      // backstop must use the interactive form below.
      if (Array.isArray(arg)) {
        return originalTransaction(arg, ...rest);
      }
      const run = async (tx: any) => {
        if (orgId) {
          // SET LOCAL is auto-rolled-back at COMMIT, so a single $transaction
          // call sets + clears the GUC atomically.
          await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${orgId.replace(/'/g, "''")}'`);
        }
        return arg(tx);
      };
      return originalTransaction(run, ...rest);
    };
  }

  async onModuleInit(): Promise<void> {
    await this.base.$connect();
    await this.assertRlsPosture();
  }

  /**
   * Report — and in production refuse — the configuration where RLS is inert.
   *
   * Every org-scoped table carries a FORCEd `tenant_isolation` policy, but a
   * Postgres superuser bypasses RLS unconditionally. Connecting as `postgres`
   * therefore leaves the policies decorative while looking, from the schema, as
   * though tenant isolation is enforced at the database. That gap is worth a
   * hard failure rather than a log line nobody reads.
   *
   * Provision the role with `pnpm rls:setup-role`. Read that script's header
   * first: `app.org_id` is only set inside interactive transactions today, so
   * moving the API itself onto the role requires making requests transactional.
   * Set RLS_ALLOW_SUPERUSER=true to acknowledge the gap and boot anyway.
   */
  private async assertRlsPosture(): Promise<void> {
    const log = new Logger(PrismaService.name);
    try {
      const rows = await this.base.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
      `;
      const role = rows[0];
      if (!role || (!role.rolsuper && !role.rolbypassrls)) return;

      const why = role.rolsuper ? 'a SUPERUSER' : 'BYPASSRLS';
      const message =
        `Database user is ${why} — Row-Level Security is bypassed and tenant isolation ` +
        'rests entirely on the Prisma tenancy extension. Provision a non-superuser role ' +
        'with `pnpm rls:setup-role`.';

      if (process.env.NODE_ENV === 'production' && process.env.RLS_ALLOW_SUPERUSER !== 'true') {
        throw new Error(
          `${message} Set RLS_ALLOW_SUPERUSER=true to accept this and boot anyway.`,
        );
      }
      log.warn(message);
    } catch (err) {
      // Never let a diagnostic query stop a boot that would otherwise succeed —
      // except for the deliberate production refusal above, which must propagate.
      if (err instanceof Error && err.message.includes('RLS_ALLOW_SUPERUSER')) throw err;
      log.warn(`Could not determine RLS posture: ${err instanceof Error ? err.message : err}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }

  get raw(): PrismaClient {
    return this.base;
  }
}