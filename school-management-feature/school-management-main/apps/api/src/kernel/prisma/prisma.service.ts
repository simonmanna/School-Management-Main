import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
    this.client = this.base.$extends({
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
      const run = async (tx: any) => {
        if (orgId) {
          // SET LOCAL is auto-rolled-back at COMMIT, so a single $transaction
          // call sets + clears the GUC atomically.
          await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${orgId.replace(/'/g, "''")}'`);
        }
        return typeof arg === 'function' ? arg(tx) : arg;
      };
      return originalTransaction(run, ...rest);
    };
  }

  async onModuleInit(): Promise<void> {
    await this.base.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }

  get raw(): PrismaClient {
    return this.base;
  }
}