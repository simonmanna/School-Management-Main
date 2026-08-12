import { PrismaClient } from '@prisma/client';

/**
 * D2-1 acceptance: direct psql-style test that proves RLS is enforced.
 *
 * Pre-req: `pnpm tsx scripts/setup-rls-role.ts` has been run so that an `app`
 * role exists with NOBYPASSRLS. Also: the Prisma extension on the application
 * client must be disabled (or unset) for this test so we can simulate a
 * malicious / forgotten call from the app role.
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

    orgA = (await prismaSuper.organization.create({ data: { code: `RLS-A-${Date.now()}`, name: 'A' } })).id;
    orgB = (await prismaSuper.organization.create({ data: { code: `RLS-B-${Date.now()}`, name: 'B' } })).id;

    // Create a partner in each org as superuser.
    await prismaSuper.partner.create({ data: { organizationId: orgA, code: 'PA', name: 'Partner A' } });
    await prismaSuper.partner.create({ data: { organizationId: orgB, code: 'PB', name: 'Partner B' } });
  });

  afterAll(async () => {
    if (orgA) {
      await prismaSuper.partner.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } }).catch(() => undefined);
      await prismaSuper.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }).catch(() => undefined);
    }
    await prismaSuper.$disconnect().catch(() => undefined);
    await prismaApp?.$disconnect().catch(() => undefined);
  });

  it('blocks cross-tenant reads when app role sets app.org_id = orgA', async () => {
    if (!prismaApp) return;
    // Set the GUC for the connection and read all Partners. Should only
    // see orgA's partner (RLS policy filters by organizationId).
    await prismaApp.$executeRawUnsafe(`SET app.org_id = '${orgA}'`);
    const visible = await prismaApp.partner.findMany();
    const codes = visible.map((p: any) => p.code);
    expect(codes).toContain('PA');
    expect(codes).not.toContain('PB');
  });

  it('blocks cross-tenant reads when app role sets app.org_id = orgB', async () => {
    if (!prismaApp) return;
    await prismaApp.$executeRawUnsafe(`SET app.org_id = '${orgB}'`);
    const visible = await prismaApp.partner.findMany();
    const codes = visible.map((p: any) => p.code);
    expect(codes).toContain('PB');
    expect(codes).not.toContain('PA');
  });

  it('returns zero rows when app.org_id is unset (default-deny)', async () => {
    if (!prismaApp) return;
    await prismaApp.$executeRawUnsafe(`SET app.org_id = ''`);
    const visible = await prismaApp.partner.findMany();
    expect(visible).toHaveLength(0);
  });
});