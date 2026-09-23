import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/kernel/prisma/prisma.service';
import { TenantContextService } from '../../src/kernel/tenancy/tenant-context.service';

/**
 * F-01 / F-02 — the application actually works under the production database
 * roles, and RLS actually isolates tenants there.
 *
 * Runs the REAL PrismaService against:
 *   DATABASE_URL        → RLS_APP_DATABASE_URL    (`app`, NOBYPASSRLS)
 *   SYSTEM_DATABASE_URL → RLS_SYSTEM_DATABASE_URL (`app_system`, BYPASSRLS)
 * exactly as docker-compose.prod.yml configures it. Before the fix, every read
 * outside an interactive transaction returned zero rows under `app` (login
 * could not find the organization, cron found no tenants), and batch
 * transactions ran without the tenant setting.
 *
 * CI provisions both roles with scripts/setup-rls-role.ts. Locally: run that
 * script, export the two URLs, then run this spec.
 */
const APP_URL = process.env.RLS_APP_DATABASE_URL;
const SYSTEM_URL = process.env.RLS_SYSTEM_DATABASE_URL;
if (!APP_URL || !SYSTEM_URL) {
  console.warn('[SKIPPED] rls-app-role.spec.ts needs RLS_APP_DATABASE_URL and RLS_SYSTEM_DATABASE_URL (see scripts/setup-rls-role.ts).');
}
const describeRoles = APP_URL && SYSTEM_URL ? describe : describe.skip;

describeRoles('RLS under the production roles (app + app_system)', () => {
  const owner = new PrismaClient();
  const tenant = new TenantContextService();
  let prisma: PrismaService;
  const stamp = Date.now();
  const orgA = `org_rls_a_${stamp}`;
  const orgB = `org_rls_b_${stamp}`;
  let partnerB = '';

  beforeAll(async () => {
    await owner.$connect();
    await owner.currency.upsert({ where: { code: 'UGX' }, update: {}, create: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', decimalPlaces: 0 } });
    for (const id of [orgA, orgB]) {
      await owner.organization.create({ data: { id, code: id, name: id, currencyCode: 'UGX' } });
    }
    await owner.partner.create({ data: { organizationId: orgA, code: `PA-${stamp}`, name: 'Alpha Parent' } });
    partnerB = (await owner.partner.create({ data: { organizationId: orgB, code: `PB-${stamp}`, name: 'Beta Parent' } })).id;

    const saved = { db: process.env.DATABASE_URL, sys: process.env.SYSTEM_DATABASE_URL };
    process.env.DATABASE_URL = APP_URL;
    process.env.SYSTEM_DATABASE_URL = SYSTEM_URL;
    prisma = new PrismaService(tenant);
    process.env.DATABASE_URL = saved.db;
    if (saved.sys === undefined) delete process.env.SYSTEM_DATABASE_URL;
    else process.env.SYSTEM_DATABASE_URL = saved.sys;
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await owner.$disconnect();
  });

  // `async` + `await` inside the run: PrismaPromises are lazy, and a query must
  // EXECUTE inside the tenant context, exactly as a service's awaited call does.
  const asA = <T>(fn: () => Promise<T>) => tenant.run({ organizationId: orgA }, async () => await fn());

  it('pre-tenant lookups work through the system role (login by organization code)', async () => {
    const org = await prisma.raw.organization.findUnique({ where: { code: orgA } });
    expect(org?.id).toBe(orgA);
  });

  it('non-transactional tenant reads see the tenant rows (the GUC is injected)', async () => {
    const rows = await asA(() => prisma.client.partner.findMany({ where: { code: { startsWith: 'P' } } }));
    expect(rows.map((r) => r.name)).toContain('Alpha Parent');
    expect(await asA(() => prisma.client.organization.count())).toBe(1);
  });

  it('writes work outside and inside transactions, batch form included', async () => {
    await asA(() => prisma.client.partner.create({ data: { code: `PA2-${stamp}`, name: 'Alpha Two' } as any }));
    const [a, b] = await asA(() =>
      prisma.client.$transaction([
        prisma.client.partner.count(),
        prisma.client.partner.findFirst({ where: { code: `PA2-${stamp}` } }),
      ]),
    );
    expect(a).toBeGreaterThanOrEqual(2);
    expect(b?.name).toBe('Alpha Two');
  });

  it('RLS hides another tenant even from raw SQL on the tenant client', async () => {
    const rows = await asA(() =>
      prisma.client.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Partner" WHERE "id" = ${partnerB}`,
    );
    expect(rows).toHaveLength(0);
  });

  it('RLS refuses a write stamped with another tenant (WITH CHECK)', async () => {
    await expect(
      asA(() => prisma.client.$executeRaw`INSERT INTO "Partner" ("id","organizationId","code","name","updatedAt") VALUES (${`x-${stamp}`}, ${orgB}, ${`PX-${stamp}`}, 'Intruder', now())`),
    ).rejects.toThrow();
  });

  it('with no tenant context the app role sees nothing (default deny)', async () => {
    const rows = await prisma.client.organization.findMany();
    expect(rows).toHaveLength(0);
  });
});
