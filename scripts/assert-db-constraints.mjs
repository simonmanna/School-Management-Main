#!/usr/bin/env node
/**
 * DB-02 — post-migrate preflight for constraints that can silently not exist.
 *
 * `EnrollmentPlacement_no_overlap` is created inside a
 * `DO $$ ... EXCEPTION WHEN OTHERS THEN RAISE NOTICE ... END $$` block, so if
 * `CREATE EXTENSION btree_gist` is unavailable the migration still SUCCEEDS and
 * the only overlap protection left is a partial unique index plus service-level
 * validation. Placement history is what "where is this learner now?" projects
 * from, so a deploy that quietly lost the constraint must fail here rather than
 * be discovered by a learner appearing in two classes at once.
 *
 * Usage: DATABASE_URL=... node scripts/assert-db-constraints.mjs
 */
import { Client } from 'pg';

const REQUIRED_CONSTRAINTS = [
  {
    table: 'EnrollmentPlacement',
    name: 'EnrollmentPlacement_no_overlap',
    why: 'prevents two placements covering the same instant; needs the btree_gist extension',
  },
];

const REQUIRED_INDEXES = [
  {
    name: 'EnrollmentPlacement_one_open_per_enrollment',
    why: 'exactly one open placement per enrollment',
  },
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

const client = new Client({ connectionString: url });
await client.connect();

const failures = [];

for (const c of REQUIRED_CONSTRAINTS) {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE con.conname = $1 AND rel.relname = $2`,
    [c.name, c.table],
  );
  if (rows.length === 0) failures.push(`missing CONSTRAINT ${c.name} on "${c.table}" — ${c.why}`);
  else console.log(`✓ constraint ${c.name}`);
}

for (const i of REQUIRED_INDEXES) {
  const { rows } = await client.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [i.name]);
  if (rows.length === 0) failures.push(`missing INDEX ${i.name} — ${i.why}`);
  else console.log(`✓ index ${i.name}`);
}

await client.end();

if (failures.length) {
  console.error('\nSchema preflight failed:\n' + failures.map((f) => `  ✗ ${f}`).join('\n'));
  console.error('\nThe migration may have reported success while skipping these. Investigate before deploying.');
  process.exit(1);
}
console.log('\n✓ schema preflight passed');
