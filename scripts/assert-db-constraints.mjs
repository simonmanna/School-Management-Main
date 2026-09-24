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
  // Wave 4 (E2E audit) — business invariants the database now owns.
  { name: 'AcademicYear_one_current_per_org', why: 'at most one current academic year per school' },
  { name: 'Term_one_current_per_org', why: 'at most one current term per school' },
  { name: 'StudentEnrollment_one_active_per_student', why: 'a pupil holds at most one ACTIVE enrollment' },
  { name: 'CourseOffering_one_per_cohort_subject_section', why: 'no duplicate course offering for a cohort' },
  { name: 'AdmissionApplication_applicant_dedupe', why: 'the same child is not entered twice for a year' },
  { name: 'Notification_org_channel_dedupeKey_key', why: 'a guardian is not messaged twice for one event' },
];

// Wave 4 — constraints and triggers created by migrations 20260924150000-155000.
REQUIRED_CONSTRAINTS.push(
  { table: 'AcademicYear', name: 'AcademicYear_dates_ordered', why: 'start before end' },
  { table: 'Term', name: 'Term_dates_ordered', why: 'start before end' },
  { table: 'AdmissionCapacity', name: 'AdmissionCapacity_counters_nonneg', why: 'seat counters never negative' },
  { table: 'AdmissionApplication', name: 'AdmissionApplication_parentContactId_fkey', why: 'parent contact is a real contact' },
  { table: 'TimetableOverride', name: 'TimetableOverride_teacherPartnerId_fkey', why: 'cover teacher is a real partner' },
  { table: 'Waiver', name: 'Waiver_appliedAmount_range', why: 'a waiver never forgives more than its amount' },
);
const REQUIRED_TRIGGERS = [
  { table: 'Term', name: 'term_within_year', why: 'a term lies inside its academic year' },
  { table: 'AcademicYear', name: 'year_contains_terms', why: 'a year keeps containing its terms' },
  { table: 'TimetableSlot', name: 'timetable_no_clash', why: 'no double-booked teacher/room/class' },
  { table: '_UserRoles', name: 'user_roles_same_org', why: 'no cross-tenant role assignment (A5)' },
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

for (const t of REQUIRED_TRIGGERS) {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_trigger tg JOIN pg_class rel ON rel.oid = tg.tgrelid
      WHERE tg.tgname = $1 AND rel.relname = $2 AND NOT tg.tgisinternal`,
    [t.name, t.table],
  );
  if (rows.length === 0) failures.push(`missing TRIGGER ${t.name} on "${t.table}" — ${t.why}`);
  else console.log(`✓ trigger ${t.name}`);
}

for (const i of REQUIRED_INDEXES) {
  const { rows } = await client.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [i.name]);
  if (rows.length === 0) failures.push(`missing INDEX ${i.name} — ${i.why}`);
  else console.log(`✓ index ${i.name}`);
}

// F-02 — every org-scoped table must have RLS ENABLED and FORCED with a
// tenant_isolation policy. A table that ships without it has no database-level
// isolation at all; a policy without ENABLE is decorative.
{
  const { rows } = await client.query(`
    SELECT c.relname,
           c.relrowsecurity      AS enabled,
           c.relforcerowsecurity AS forced,
           EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS has_policy
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      JOIN pg_attribute a  ON a.attrelid = c.oid
     WHERE ns.nspname = 'public' AND c.relkind = 'r'
       AND a.attname = 'organizationId' AND a.attnum > 0 AND NOT a.attisdropped`);
  const bad = rows.filter((r) => !r.enabled || !r.forced || !r.has_policy);
  if (bad.length > 0) {
    failures.push(
      `${bad.length} org-scoped table(s) without enabled+forced tenant_isolation RLS: ` +
        bad.map((r) => r.relname).slice(0, 20).join(', ') + (bad.length > 20 ? ', …' : ''),
    );
  } else {
    console.log(`✓ RLS enabled, forced and policed on all ${rows.length} org-scoped tables`);
  }
}

// F-05 — every single-column FK between two org-scoped tables must carry the
// same-tenant trigger (migration 20260923110000_tenant_fk_guard).
{
  const { rows } = await client.query(`
    SELECT con.conname, child.relname AS child_tbl
      FROM pg_constraint con
      JOIN pg_class child  ON child.oid  = con.conrelid
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = child.relnamespace
      JOIN pg_attribute ca ON ca.attrelid = con.conrelid  AND ca.attnum = con.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
     WHERE con.contype = 'f' AND ns.nspname = 'public'
       AND array_length(con.conkey, 1) = 1 AND pa.attname = 'id' AND ca.attname <> 'organizationId'
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = child.oid  AND x.attname = 'organizationId' AND NOT x.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = parent.oid AND x.attname = 'organizationId' AND NOT x.attisdropped)
       AND NOT EXISTS (
         SELECT 1 FROM pg_trigger tg
          WHERE tg.tgrelid = con.conrelid AND tg.tgname = 'tenant_fk_' || left(md5(con.conname), 24)
       )`);
  if (rows.length > 0) {
    failures.push(
      `${rows.length} tenant-to-tenant FK(s) without the same-organization trigger: ` +
        rows.map((r) => `${r.child_tbl}.${r.conname}`).slice(0, 20).join(', ') +
        ' — re-run the catalog block from 20260923110000_tenant_fk_guard in a new migration',
    );
  } else {
    console.log('✓ same-organization trigger on every tenant-to-tenant foreign key');
  }
}

await client.end();

if (failures.length) {
  console.error('\nSchema preflight failed:\n' + failures.map((f) => `  ✗ ${f}`).join('\n'));
  console.error('\nThe migration may have reported success while skipping these. Investigate before deploying.');
  process.exit(1);
}
console.log('\n✓ schema preflight passed');
