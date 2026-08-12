import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/**
 * D2-1 acceptance: direct psql-style test that proves RLS is enforced.
 *
 * Pre-req: `pnpm tsx scripts/setup-rls-role.ts` has been run so that an `app`
 * role exists with NOBYPASSRLS. Also: the Prisma extension on the application
 * client must be disabled (or unset) for this test so we can simulate a
 * malicious / forgotten call from the app role.
 *
 * The `superset` client connects as the DATABASE_URL owner, which is NOT a
 * superuser — and the RLS migrations use FORCE ROW LEVEL SECURITY, so even
 * the table owner must satisfy the policy. Seeding therefore follows the same
 * pattern as PrismaService: `SET LOCAL app.org_id` inside an interactive
 * transaction (the GUC is transaction-scoped and pinned to one connection).
 *
 * Skipped automatically when no DATABASE_URL is configured.
 */
const HAS_DB = !!process.env.DATABASE_URL;
const describeDb = HAS_DB ? describe : describe.skip;

describeDb('Row-Level Security (RLS) — D2-1', () => {
  let prismaSuper: PrismaClient;
  let prismaApp: PrismaClient;
  let orgA: string;
  let orgB: string;

  /** Run fn with app.org_id set for the duration of one interactive transaction. */
  async function asTenant<T>(client: PrismaClient, tenantId: string, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.org_id = '${tenantId.replace(/'/g, "''")}'`);
      return fn(tx as unknown as PrismaClient);
    });
  }

  beforeAll(async () => {
    prismaSuper = new PrismaClient();
    await prismaSuper.$connect();

    // Try to connect as the `app` role. If it doesn't exist, skip the
    // RLS tests with a notice — the user hasn't run setup-rls-role.ts yet.
    const dbUrl = process.env.DATABASE_URL!;
    const appUrl = dbUrl.replace(/(\/\/)[^:]+:[^@]+@/, '$1app:app@');
    try {
      prismaApp = new PrismaClient({ datasourceUrl: appUrl });
      await prismaApp.$connect();
    } catch {
      console.warn('RLS tests skipped: app role not configured. Run scripts/setup-rls-role.ts.');
      return;
    }

    orgA = randomUUID();
    orgB = randomUUID();

    // Seed orgs + partners as the table owner, scoping each write to its own
    // tenant via the app.org_id GUC (same pattern as PrismaService).
    await asTenant(prismaSuper, orgA, async (tx) => {
      await tx.organization.create({ data: { id: orgA, code: `RLS-A-${Date.now()}`, name: 'A' } });
      await tx.partner.create({ data: { organizationId: orgA, code: 'PA', name: 'Partner A' } });
    });
    await asTenant(prismaSuper, orgB, async (tx) => {
      await tx.organization.create({ data: { id: orgB, code: `RLS-B-${Date.now()}`, name: 'B' } });
      await tx.partner.create({ data: { organizationId: orgB, code: 'PB', name: 'Partner B' } });
    });
  });

  afterAll(async () => {
    if (orgA && orgB) {
      await asTenant(prismaSuper, orgA, async (tx) => {
        await tx.partner.deleteMany({ where: { organizationId: orgA } });
        await tx.organization.deleteMany({ where: { id: orgA } });
      }).catch(() => undefined);
      await asTenant(prismaSuper, orgB, async (tx) => {
        await tx.partner.deleteMany({ where: { organizationId: orgB } });
        await tx.organization.deleteMany({ where: { id: orgB } });
      }).catch(() => undefined);
    }
    await prismaSuper.$disconnect().catch(() => undefined);
    await prismaApp?.$disconnect().catch(() => undefined);
  });

  it('blocks cross-tenant reads when app role sets app.org_id = orgA', async () => {
    if (!prismaApp) return;
    // Set the GUC for the connection and read all Partners. Should only
    // see orgA's partner (RLS policy filters by organizationId).
    const codes = await asTenant(prismaApp, orgA, async (tx) => {
      const visible = await tx.partner.findMany();
      return visible.map((p: any) => p.code);
    });
    expect(codes).toContain('PA');
    expect(codes).not.toContain('PB');
  });

  it('blocks cross-tenant reads when app role sets app.org_id = orgB', async () => {
    if (!prismaApp) return;
    const codes = await asTenant(prismaApp, orgB, async (tx) => {
      const visible = await tx.partner.findMany();
      return visible.map((p: any) => p.code);
    });
    expect(codes).toContain('PB');
    expect(codes).not.toContain('PA');
  });

  it('returns zero rows when app.org_id is unset (default-deny)', async () => {
    if (!prismaApp) return;
    // Empty GUC matches no organizationId → default-deny.
    const visible = await asTenant(prismaApp, '', async (tx) => tx.partner.findMany());
    expect(visible).toHaveLength(0);
  });
});