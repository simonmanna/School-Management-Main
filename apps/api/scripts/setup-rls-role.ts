/**
 * Create (or refresh) the two runtime database roles Row-Level Security needs.
 *
 *   app         NOSUPERUSER NOBYPASSRLS — DATABASE_URL. Every tenant-scoped
 *               statement runs with `app.org_id` set (PrismaService), so the
 *               FORCEd `tenant_isolation` policy on every org-scoped table
 *               genuinely filters what this role can read and write.
 *   app_system  NOSUPERUSER BYPASSRLS   — SYSTEM_DATABASE_URL. Backs
 *               `PrismaService.raw`: pre-tenant lookups (login by organization
 *               code, refresh-token lookup, signed downloads) and cron fan-out
 *               across organizations. Never used for request-scoped data access.
 *
 * Neither role can run DDL; migrations keep their own owner (DIRECT_URL).
 *
 * Usage:
 *   pnpm rls:setup-role     # passwords from RLS_APP_PASSWORD / RLS_SYSTEM_PASSWORD, else generated
 *   RLS_APP_ROLE=pos_app RLS_SYSTEM_ROLE=pos_system pnpm rls:setup-role
 *
 * Idempotent. Re-run after migrations that add tables only if you did not rely
 * on the default privileges it installs.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const ROLE = process.env.RLS_APP_ROLE ?? 'app';
const SYSTEM_ROLE = process.env.RLS_SYSTEM_ROLE ?? 'app_system';

/** Reject anything that is not a plain identifier — the role name is interpolated. */
function assertSafeIdentifier(name: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(
      `Unsafe role name "${name}". Use lowercase letters, digits and underscores only.`,
    );
  }
}

/** Single-quoted SQL literal with quotes doubled. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Double-quoted SQL identifier with quotes doubled. */
function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  assertSafeIdentifier(ROLE);
  assertSafeIdentifier(SYSTEM_ROLE);

  const prisma = new PrismaClient();
  await prisma.$connect();

  try {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;

    const current = await prisma.$queryRaw<{ rolsuper: boolean }[]>`
      SELECT rolsuper FROM pg_roles WHERE rolname = current_user
    `;
    if (!current[0]?.rolsuper) {
      throw new Error(
        'This script must run as a superuser (it creates roles and grants privileges). ' +
          'Point DATABASE_URL at the admin connection for this one command.',
      );
    }

    const generated: Array<{ role: string; password: string }> = [];
    const ensureRole = async (role: string, bypassRls: boolean, suppliedPassword: string | undefined) => {
      if (suppliedPassword && /[\\\r\n\0]/.test(suppliedPassword)) {
        throw new Error(`Password for ${role} must not contain backslashes, newlines or null bytes.`);
      }
      // base64url is quote-free, so it survives literal interpolation unchanged.
      const password = suppliedPassword ?? randomBytes(24).toString('base64url');
      const flags = `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE ${bypassRls ? 'BYPASSRLS' : 'NOBYPASSRLS'}`;
      const existing = await prisma.$queryRaw<{ rolname: string }[]>`
        SELECT rolname FROM pg_roles WHERE rolname = ${role}
      `;
      if (existing.length === 0) {
        await prisma.$executeRawUnsafe(`CREATE ROLE ${role} ${flags} PASSWORD ${quoteLiteral(password)}`);
        console.log(`created role "${role}" (${bypassRls ? 'BYPASSRLS' : 'NOBYPASSRLS'})`);
        if (!suppliedPassword) generated.push({ role, password });
      } else {
        await prisma.$executeRawUnsafe(`ALTER ROLE ${role} ${flags}`);
        if (suppliedPassword) {
          await prisma.$executeRawUnsafe(`ALTER ROLE ${role} PASSWORD ${quoteLiteral(password)}`);
          console.log(`role "${role}" already existed — password reset, flags reasserted`);
        } else {
          console.log(`role "${role}" already existed — flags reasserted, password left unchanged`);
        }
      }
      // Enough privilege to run the app, never enough to alter the schema.
      const grants = [
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(db)} TO ${role}`,
        `GRANT USAGE ON SCHEMA public TO ${role}`,
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
        `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`,
        // Tables created by future migrations inherit the same grants.
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
      ];
      for (const sql of grants) await prisma.$executeRawUnsafe(sql);
    };

    await ensureRole(ROLE, false, process.env.RLS_APP_PASSWORD);
    await ensureRole(SYSTEM_ROLE, true, process.env.RLS_SYSTEM_PASSWORD);

    const [{ n: policies }] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_policies
      WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
    `;
    const unprotected = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
        JOIN pg_attribute a  ON a.attrelid = c.oid
       WHERE ns.nspname = 'public'
         AND c.relkind = 'r'
         AND a.attname = 'organizationId'
         AND a.attnum > 0
         AND NOT a.attisdropped
         AND NOT c.relrowsecurity
       ORDER BY c.relname
    `;

    console.log(`grants applied on database "${db}"`);
    console.log(`tenant_isolation policies present on ${policies} table(s)`);
    if (unprotected.length > 0) {
      console.warn(
        `WARNING: ${unprotected.length} org-scoped table(s) have NO row-level security: ` +
          unprotected.map((r) => r.relname).join(', ') +
          '\nRun the latest migrations, then re-run this script.',
      );
    }

    for (const g of generated) {
      console.log(`\nGenerated password for "${g.role}" (shown once — store it in your secret manager):`);
      console.log(`  ${g.password}`);
    }
    console.log('\nConnection strings:');
    console.log(`  DATABASE_URL        = postgresql://${ROLE}:<password>@<host>:<port>/${db}?schema=public`);
    console.log(`  SYSTEM_DATABASE_URL = postgresql://${SYSTEM_ROLE}:<password>@<host>:<port>/${db}?schema=public`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
