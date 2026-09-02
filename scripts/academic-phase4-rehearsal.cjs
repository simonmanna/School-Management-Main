/* Rehearse Phase 4 on a disposable local DB copy. Never migrates the source DB. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../apps/api/.env'), quiet: true });
const root = path.resolve(__dirname, '..');
const source = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '::1'].includes(source.hostname)) throw new Error('Rehearsal only supports a local source database');
const reportPath = path.join(root, 'var/academics-phase4-rehearsal.json');
const env = { ...process.env, PGHOST: source.hostname, PGPORT: source.port || '5432', PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password) };
const binary = (name) => process.platform === 'win32' ? `C:/Program Files/PostgreSQL/18/bin/${name}.exe` : name;
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, ...extra });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${path.basename(command)} exited ${result.status}`);
}
async function main() {
  if (process.argv[2] === '--verify') {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (!/^school_phase4_rehearsal_\d+$/.test(report.database)) throw new Error('Invalid rehearsal database name');
    const target = new URL(source); target.pathname = `/${report.database}`;
    const original = new Client({ connectionString: source.toString() });
    const copy = new Client({ connectionString: target.toString() });
    await original.connect(); await copy.connect();
    try {
      const sql = 'SELECT id, "effectiveScore"::text AS score, "maxScore"::text AS maximum, percentage::text AS percentage, "approvalStatus"::text AS approval FROM "StudentAssessment" WHERE "effectiveScore" IS NOT NULL';
      const baseline = (await original.query(sql)).rows;
      const migrated = new Map((await copy.query(sql)).rows.map((r) => [r.id, r]));
      const changed = baseline.filter((r) => JSON.stringify(r) !== JSON.stringify(migrated.get(r.id))).length;
      if (changed) throw new Error(`${changed} existing scored records differ from the source; investigate before rollout`);
      Object.assign(report, { originalScoredRecords: baseline.length, preservedScoredRecords: baseline.length, scoredParityVerifiedAt: new Date().toISOString() });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ originalScoredRecords: baseline.length, preservedScoredRecords: baseline.length, mismatches: changed }, null, 2));
    } finally { await original.end(); await copy.end(); }
    return;
  }
  if (process.argv[2] === '--test') {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (!/^school_phase4_rehearsal_\d+$/.test(report.database)) throw new Error('Invalid rehearsal database name');
    const target = new URL(source); target.pathname = `/${report.database}`;
    run(process.execPath, [path.join(root, 'apps/api/node_modules/jest/bin/jest.js'), ...process.argv.slice(3), '--runInBand', '--detectOpenHandles'], {
      cwd: path.join(root, 'apps/api'), env: { ...env, DATABASE_URL: target.toString(), NODE_OPTIONS: '--max-old-space-size=12288', OUTBOX_BATCH: '0' }, stdio: 'inherit',
    });
    return;
  }
  const database = `school_phase4_rehearsal_${Date.now()}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-phase4-'));
  const archive = path.join(temp, 'source.dump');
  const sourceDb = decodeURIComponent(source.pathname.slice(1));
  console.log(`Backing up local database ${sourceDb}; source will not be modified.`);
  run(binary('pg_dump'), ['--format=custom', '--no-owner', '--no-privileges', '--file', archive, '--dbname', sourceDb]);
  const admin = new Client({ connectionString: source.toString() }); await admin.connect();
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.end(); }
  run(binary('pg_restore'), ['--no-owner', '--no-privileges', '--dbname', database, archive]);
  const target = new URL(source); target.pathname = `/${database}`;
  const db = new Client({ connectionString: target.toString() }); await db.connect();
  try {
    const baseline = await db.query('SELECT count(*)::int AS count FROM "StudentAssessment"');
    const sql = fs.readFileSync(path.join(root, 'apps/api/prisma/migrations/20260906000000_phase4_unified_assessment/migration.sql'), 'utf8');
    await db.query('BEGIN');
    try { await db.query(sql); await db.query('COMMIT'); } catch (error) { await db.query('ROLLBACK'); throw error; }
    const reconciliation = await db.query(`SELECT
      (SELECT count(*)::int FROM "HomeworkAssignment") AS legacy_assignments,
      (SELECT count(*)::int FROM "Assignment" WHERE "legacyHomeworkId" IS NOT NULL) AS mapped_assignments,
      (SELECT count(*)::int FROM "HomeworkSubmission") AS legacy_submissions,
      (SELECT count(*)::int FROM "AssignmentSubmission" WHERE "legacyHomeworkSubmissionId" IS NOT NULL) AS mapped_submissions,
      (SELECT count(*)::int FROM "AcademicMigrationException" WHERE "migrationRunId" = '20260906000000_phase4_unified_assessment' AND "resolvedAt" IS NULL) AS exceptions,
      (SELECT count(*)::int FROM "StudentAssessment") AS learner_records`);
    const report = { database, archive, rehearsedAt: new Date().toISOString(), sourceLearnerRecords: baseline.rows[0].count, ...reconciliation.rows[0] };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await db.end(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
