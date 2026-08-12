#!/usr/bin/env node
/**
 * scripts/setup-rls-role.ts
 *
 * One-off bootstrap that promotes the RLS migration from "no-op at runtime"
 * to "actively filters rows by organization".
 *
 * What it does:
 *   1. Connects with the existing DATABASE_URL (must be a superuser —
 *      typically `postgres` in dev).
 *   2. Creates the `app` role with LOGIN and a generated password (or the
 *      APP_DB_PASSWORD env var if you want a fixed one).
 *   3. Grants the `app` role CONNECT + CRUD on every table in the public
 *      schema, USAGE on the schema, and (critically) NOBYPASSRLS so RLS
 *      applies to it.
 *   4. Prints the connection string to put in your .env so the app server
 *      connects as `app`, not `postgres`.
 *
 * Run once after `prisma migrate deploy`:
 *   pnpm tsx scripts/setup-rls-role.ts
 *   # or:  node --import tsx scripts/setup-rls-role.ts
 *
 * Requires: tsx (or ts-node). This script does NOT touch application code.
 */
import 'dotenv/config';
import { Client } from 'pg';

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL is not set. Run after prisma migrate deploy.');
    process.exit(1);
  }
  const password = process.env.APP_DB_PASSWORD ?? `app_${Math.random().toString(36).slice(2, 14)}`;

  const admin = new Client({ connectionString: dbUrl });
  await admin.connect();

  // Drop + recreate the app role idempotently.
  await admin.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
      ALTER ROLE "app" WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}' NOSUPERUSER NOBYPASSRLS;
    ELSE
      CREATE ROLE "app" WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}' NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);

  await admin.query(`GRANT CONNECT ON DATABASE current_database() TO "app"`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO "app"`);

  // Grant CRUD on every existing table (and the default privileges for any
  // future ones — Prisma migrations create new tables over time).
  await admin.query(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO "app"', r.tablename);
      END LOOP;
    END $$;
  `);
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app"`);

  await admin.end();

  // Build the connection string for the app role.
  const u = new URL(dbUrl);
  u.username = 'app';
  u.password = password;
  console.log('\n✓ App role `app` is ready.');
  console.log('Add this to your .env so the API connects as a non-superuser:');
  console.log(`\n  DATABASE_URL="${u.toString()}"\n`);
  console.log('Then run `pnpm db:migrate` once more — Prisma migrations will execute as the superuser migration role if you set `DIRECT_URL` to the superuser URL.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});