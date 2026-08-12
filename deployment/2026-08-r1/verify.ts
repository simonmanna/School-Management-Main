#!/usr/bin/env node
/**
 * Financial baseline capture + comparison for the 2026-08-r1 upgrade.
 *
 * The point of this script is narrow and important: the upgrade restructures the
 * chart of accounts, so the only trustworthy proof it did no damage is that the
 * money did not move. Capture before, compare after, and require an exact match.
 *
 * Amounts are compared as exact decimal strings, not floats — a cent of drift is
 * a failed upgrade, not a rounding artifact.
 *
 * Usage:
 *   DATABASE_URL='postgresql://...' pnpm tsx deployment/2026-08-r1/verify.ts --capture baseline-before.json
 *   DATABASE_URL='postgresql://...' pnpm tsx deployment/2026-08-r1/verify.ts --compare baseline-before.json
 */
import { Client } from 'pg';
import { writeFileSync, readFileSync } from 'node:fs';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { config } = require('dotenv');
  config();
  config({ path: 'apps/api/.env' });
} catch {
  /* dotenv optional */
}

const args = process.argv.slice(2);
const captureIdx = args.indexOf('--capture');
const compareIdx = args.indexOf('--compare');
const captureTo = captureIdx >= 0 ? args[captureIdx + 1] : null;
const compareTo = compareIdx >= 0 ? args[compareIdx + 1] : null;

if (!captureTo && !compareTo) {
  console.error('Pass --capture <file> or --compare <file>.');
  process.exit(2);
}

const DB_URL = process.env.DATABASE_URL ?? '';
if (!DB_URL) {
  console.error('DATABASE_URL not set (checked env + apps/api/.env).');
  process.exit(2);
}

interface Snapshot {
  capturedAt: string;
  totals: Record<string, string>;
  counts: Record<string, string>;
  skippedTables: string[];
  perOrgTrialBalance: Array<{ organizationId: string; debit: string; credit: string }>;
}

/**
 * Counted both before and after. The "before" snapshot runs against the old
 * schema and the "after" against the new one, so a table missing on one side is
 * expected rather than fatal — it is recorded and skipped, and only tables
 * present in both are compared.
 */
const COUNT_TABLES = [
  'Account',
  'JournalEntry',
  'JournalLine',
  'Invoice',
  'Receipt',
  'InventoryLedger',
  'CashSession',
  'CashMovement',
];

async function capture(db: Client): Promise<Snapshot> {
  // Posted lines only — drafts are not part of the ledger and can legitimately
  // change between the two runs.
  const totals = await db.query<{ debit: string; credit: string }>(
    `SELECT COALESCE(SUM(l."baseDebit"), 0)::text  AS debit,
            COALESCE(SUM(l."baseCredit"), 0)::text AS credit
       FROM "JournalLine" l
       JOIN "JournalEntry" e ON e."id" = l."journalEntryId"
      WHERE e."status" = 'posted'`,
  );

  const perOrg = await db.query<{ organizationId: string; debit: string; credit: string }>(
    `SELECT l."organizationId",
            COALESCE(SUM(l."baseDebit"), 0)::text  AS debit,
            COALESCE(SUM(l."baseCredit"), 0)::text AS credit
       FROM "JournalLine" l
       JOIN "JournalEntry" e ON e."id" = l."journalEntryId"
      WHERE e."status" = 'posted'
      GROUP BY l."organizationId"
      ORDER BY l."organizationId"`,
  );

  const counts: Record<string, string> = {};
  const skippedTables: string[] = [];
  for (const t of COUNT_TABLES) {
    const exists = await db.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_name = $1 AND table_schema = current_schema()`,
      [t],
    );
    if ((exists.rowCount ?? 0) === 0) {
      skippedTables.push(t);
      continue;
    }
    const r = await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM "${t}"`);
    counts[t] = r.rows[0].n;
  }

  return {
    capturedAt: new Date().toISOString(),
    totals: { postedDebit: totals.rows[0].debit, postedCredit: totals.rows[0].credit },
    counts,
    skippedTables,
    perOrgTrialBalance: perOrg.rows,
  };
}

function compare(before: Snapshot, after: Snapshot): string[] {
  const failures: string[] = [];

  for (const key of Object.keys(before.totals)) {
    if (before.totals[key] !== after.totals[key]) {
      failures.push(`totals.${key}: ${before.totals[key]} -> ${after.totals[key]}`);
    }
  }

  // Row counts may legitimately grow if anything ran between the snapshots, but
  // they must never shrink — that is data loss. Tables absent on either side are
  // skipped rather than read as a drop to zero.
  for (const key of Object.keys(before.counts)) {
    const a = after.counts[key];
    if (a === undefined) {
      failures.push(`counts.${key}: table present before the upgrade, missing after`);
      continue;
    }
    if (BigInt(a) < BigInt(before.counts[key])) {
      failures.push(`counts.${key} SHRANK: ${before.counts[key]} -> ${a}`);
    }
  }

  const afterByOrg = new Map(after.perOrgTrialBalance.map((r) => [r.organizationId, r]));
  for (const b of before.perOrgTrialBalance) {
    const a = afterByOrg.get(b.organizationId);
    if (!a) {
      failures.push(`org ${b.organizationId} disappeared from the trial balance`);
      continue;
    }
    if (a.debit !== b.debit || a.credit !== b.credit) {
      failures.push(
        `org ${b.organizationId}: debit ${b.debit} -> ${a.debit}, credit ${b.credit} -> ${a.credit}`,
      );
    }
  }

  return failures;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const snap = await capture(db);

    if (captureTo) {
      writeFileSync(captureTo, JSON.stringify(snap, null, 2));
      console.log(`Baseline written to ${captureTo}`);
      console.log(
        `  posted debit=${snap.totals.postedDebit} credit=${snap.totals.postedCredit}, ` +
          `${snap.perOrgTrialBalance.length} org(s)`,
      );
      return;
    }

    const before: Snapshot = JSON.parse(readFileSync(compareTo as string, 'utf8'));
    const failures = compare(before, snap);

    if (failures.length > 0) {
      console.error(`FINANCIAL VERIFICATION FAILED (${failures.length}):`);
      for (const f of failures) console.error(`  ${f}`);
      console.error('\nDo not reopen. Roll back.');
      process.exit(1);
    }

    console.log('Financial verification PASSED — trial balance unchanged, no row counts lost.');
    console.log(`  posted debit=${snap.totals.postedDebit} credit=${snap.totals.postedCredit}`);
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
