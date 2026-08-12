/**
 * Create (or refresh) the non-superuser `app` role that Row-Level Security
 * actually needs.
 *
 * Why this exists: every org-scoped table carries a FORCEd `tenant_isolation`
 * policy, but Postgres lets a SUPERUSER walk straight through RLS — FORCE only
 * defeats the *table owner* exemption, not the superuser one. Connecting as
 * `postgres` therefore means the policies are decorative. This provisions a role
 * that RLS genuinely applies to.
 *
 * Usage:
 *   pnpm rls:setup-role                       # password from RLS_APP_PASSWORD, else generated
 *   RLS_APP_ROLE=pos_app pnpm rls:setup-role  # custom role name
 *
 * Re-run after any migration that adds tables. It is idempotent.
 *
 * IMPORTANT — read before switching DATABASE_URL:
 * `app.org_id` is only set inside interactive transactions (see PrismaService),
 * so reads issued outside a transaction match no rows once the app connects
 * through this role. Moving the whole API onto it requires making every request
 * transactional first. Until then the intended use is operator, BI, reporting
 * and read-replica access — which is where ad-hoc cross-tenant reads actually
 * happen — while the Prisma tenancy extension remains the application's primary
 * scoping mechanism.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const ROLE = process.env.RLS_APP_ROLE ?? 'app';

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

  const supplied = process.env.RLS_APP_PASSWORD;
  if (supplied && /[\\\r\n\0]/.test(supplied)) {
    throw new Error('RLS_APP_PASSWORD must not contain backslashes, newlines or null bytes.');
  }
  // base64url is quote-free, so it survives literal interpolation unchanged.
  const password = supplied ?? randomBytes(24).toString('base64url');

  const prisma = new PrismaClient();
  await prisma.$connect();

  try {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;

    const current = await prisma.$queryRaw<{ rolsuper: boolean }[]>`
      SELECT rolsuper FROM pg_roles WHERE rolname = current_user
    `;
    if (!current[0]?.rolsuper) {
      throw new Error(
        'This script must run as a superuser (it creates a role and grants privileges). ' +
          'Point DATABASE_URL at the admin connection for this one command.',
      );
    }

    const existing = await prisma.$queryRaw<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname = ${ROLE}
    `;

    if (existing.length === 0) {
      // NOSUPERUSER + NOBYPASSRLS are the entire point of this role.
      await prisma.$executeRawUnsafe(
        `CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${quoteLiteral(password)}`,
      );
      console.log(`created role "${ROLE}"`);
    } else {
      await prisma.$executeRawUnsafe(`ALTER ROLE ${ROLE} NOSUPERUSER NOBYPASSRLS LOGIN`);
      if (supplied) {
        await prisma.$executeRawUnsafe(`ALTER ROLE ${ROLE} PASSWORD ${quoteLiteral(password)}`);
        console.log(`role "${ROLE}" already existed — password reset, flags reasserted`);
      } else {
        console.log(`role "${ROLE}" already existed — flags reasserted, password left unchanged`);
      }
    }

    // Enough privilege to run the app, never enough to alter the schema. DDL
    // stays with the migration user so a leaked app credential cannot drop a
    // policy and read every tenant.
    const grants = [
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(db)} TO ${ROLE}`,
      `GRANT USAGE ON SCHEMA public TO ${ROLE}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`,
      // Tables created by future migrations inherit the same grants.
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`,
    ];
    for (const sql of grants) await prisma.$executeRawUnsafe(sql);

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

    if (!supplied) {
      console.log('\nGenerated password (shown once — store it in your secret manager):');
      console.log(`  ${password}`);
    }
    console.log('\nConnection string for this role:');
    console.log(`  postgresql://${ROLE}:<password>@<host>:<port>/${db}?schema=public`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
