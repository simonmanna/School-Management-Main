#!/usr/bin/env node
/**
 * Phase B — chart-of-accounts backfill.
 *
 * Context: `Account.accountType` (a NOT NULL `AccountType` enum) was replaced by
 * `Account.categoryId` -> the global `AccountCategory` table, plus
 * `normalBalance`, and `isGroup` was replaced by `isPostable` with INVERTED
 * meaning. The schema migration that made that change drops the old columns and
 * carries no data operations, so on a database with a real chart of accounts it
 * would leave every account uncategorized: the posting engine could not resolve
 * accounts, and the snapshot rebuild would silently rewrite financial history
 * from an uncategorized COA.
 *
 * This script is the missing data step. It runs BETWEEN phase A (additive DDL —
 * new columns exist, old ones still present) and phase C (drops the old
 * columns). Both old and new columns must be present when it runs.
 *
 * It is idempotent: accounts that already carry a categoryId are left alone
 * unless --force is passed.
 *
 * Dry-run by default, matching apps/api/src/scripts/backfill-inventory-gl.ts.
 *
 * Usage:
 *   DATABASE_URL='postgresql://...' pnpm tsx deployment/2026-08-r1/phaseB-backfill.ts
 *   DATABASE_URL='postgresql://...' pnpm tsx deployment/2026-08-r1/phaseB-backfill.ts --apply
 *
 * Connect as the database OWNER, not the RLS-restricted `app` role — this has to
 * see and update every organization's accounts.
 */
import { Client } from 'pg';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedAccountCategories } from '../../apps/api/src/modules/accounting/coa/account-category-seeder';
import { COA_TEMPLATE } from '../../apps/api/src/modules/accounting/coa/coa-template';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { config } = require('dotenv');
  config();
  config({ path: 'apps/api/.env' });
} catch {
  /* dotenv optional — ambient env works too */
}

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const OUT_DIR = __dirname;
const DB_URL = process.env.DATABASE_URL ?? '';
if (!DB_URL) {
  console.error('DATABASE_URL not set (checked env + apps/api/.env).');
  process.exit(2);
}

/**
 * Old `AccountType` enum value -> new AccountCategory key.
 *
 * `confident: false` marks the three old values that were coarser than the new
 * catalog. `asset` cannot distinguish current from non-current, `liability` the
 * same, and `expense` could be operating or other. The chosen fallback is the
 * common case, but every such account is listed in the report for a human to
 * confirm before phase C makes the old value unrecoverable.
 */
const TYPE_TO_CATEGORY: Record<string, { key: string; confident: boolean }> = {
  cash: { key: 'cash', confident: true },
  bank: { key: 'bank', confident: true },
  mobile_money: { key: 'mobile_money', confident: true },
  petty_cash: { key: 'petty_cash', confident: true },
  receivable: { key: 'receivable', confident: true },
  payable: { key: 'payable', confident: true },
  tax: { key: 'tax', confident: true },
  equity: { key: 'equity', confident: true },
  revenue: { key: 'revenue', confident: true },
  cost_of_goods_sold: { key: 'cost_of_goods_sold', confident: true },
  contra_asset: { key: 'contra_asset', confident: true },
  contra_liability: { key: 'contra_liability', confident: true },
  // Coarser than the new catalog — see note above.
  asset: { key: 'current_asset', confident: false },
  liability: { key: 'current_liability', confident: false },
  expense: { key: 'operating_expense', confident: false },
};

/**
 * Codes whose category is known exactly from the shipped template. Preferred
 * over TYPE_TO_CATEGORY, because the template is the same source `coa-seeder`
 * uses for a fresh organization — matching it keeps upgraded and new databases
 * identical.
 */
const TEMPLATE_BY_CODE = new Map(
  COA_TEMPLATE.filter((a) => a.categoryKey).map((a) => [
    a.code,
    { key: a.categoryKey as string, name: a.name },
  ]),
);

interface AccountRow {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  accountType: string;
  isGroup: boolean;
  categoryId: string | null;
}

interface Decision {
  id: string;
  code: string;
  name: string;
  oldType: string;
  categoryKey: string | null;
  normalBalance: string | null;
  isPostable: boolean;
  source: 'template' | 'type-map' | 'already-set' | 'unmapped';
  confident: boolean;
}

async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2 AND table_schema = current_schema()`,
    [table, column],
  );
  return (r.rowCount ?? 0) > 0;
}

async function main(): Promise<void> {
  const started = Date.now();
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  try {
    // --- Preflight -----------------------------------------------------------
    const hasOld = await columnExists(db, 'Account', 'accountType');
    const hasNew = await columnExists(db, 'Account', 'categoryId');

    if (!hasNew) {
      throw new Error(
        'Account.categoryId is missing — phase A (additive DDL) has not been applied. ' +
          'Run phaseA-additive.sql first.',
      );
    }
    if (!hasOld) {
      console.log(
        'Account.accountType is already gone — phase C has run, so there is nothing ' +
          'left to map. Exiting without changes.',
      );
      return;
    }

    // --- 1. Global category catalog -----------------------------------------
    // Reuses the API's own seeder so upgraded databases get byte-identical
    // categories to a freshly seeded one. The adapter is enough: the seeder only
    // ever calls $executeRawUnsafe(sql, ...params), and pg uses the same $1
    // placeholder syntax.
    const adapter = {
      $executeRawUnsafe: (sql: string, ...params: unknown[]) => db.query(sql, params),
    };
    const { count } = await seedAccountCategories(adapter);
    console.log(`Global account categories ensured: ${count}`);

    const catRes = await db.query<{ id: string; key: string; normalBalance: string }>(
      `SELECT "id", "key", "normalBalance" FROM "AccountCategory"`,
    );
    const categories = new Map(catRes.rows.map((c) => [c.key, c]));

    // --- 2. Existing accounts ------------------------------------------------
    const accRes = await db.query<AccountRow>(
      `SELECT "id", "organizationId", "code", "name",
              "accountType"::text AS "accountType", "isGroup", "categoryId"
         FROM "Account"
        ORDER BY "organizationId", "code"`,
    );
    const accounts = accRes.rows;

    // --- 3. Decide ------------------------------------------------------------
    const decisions: Decision[] = [];
    const renamedByTemplate: Array<{ code: string; current: string; template: string }> = [];

    for (const a of accounts) {
      if (a.categoryId && !FORCE) {
        decisions.push({
          id: a.id, code: a.code, name: a.name, oldType: a.accountType,
          categoryKey: null, normalBalance: null, isPostable: !a.isGroup,
          source: 'already-set', confident: true,
        });
        continue;
      }

      const fromTemplate = TEMPLATE_BY_CODE.get(a.code);
      const fromType = TYPE_TO_CATEGORY[a.accountType];
      const chosen = fromTemplate
        ? { key: fromTemplate.key, confident: true, source: 'template' as const }
        : fromType
          ? { key: fromType.key, confident: fromType.confident, source: 'type-map' as const }
          : null;

      // `seedAccountingCore`'s upsert rewrites `name` for template codes, so a
      // locally renamed account would be silently reset the next time it runs.
      // Surface those rather than let the seeder decide.
      if (fromTemplate && fromTemplate.name !== a.name) {
        renamedByTemplate.push({ code: a.code, current: a.name, template: fromTemplate.name });
      }

      const cat = chosen ? categories.get(chosen.key) : undefined;
      decisions.push({
        id: a.id,
        code: a.code,
        name: a.name,
        oldType: a.accountType,
        categoryKey: cat ? chosen!.key : null,
        normalBalance: cat ? cat.normalBalance : null,
        isPostable: !a.isGroup,
        source: cat ? chosen!.source : 'unmapped',
        confident: cat ? chosen!.confident : false,
      });
    }

    const toWrite = decisions.filter((d) => d.source === 'template' || d.source === 'type-map');
    const unmapped = decisions.filter((d) => d.source === 'unmapped');
    const alreadySet = decisions.filter((d) => d.source === 'already-set');
    const needsReview = toWrite.filter((d) => !d.confident);

    // --- 4. Report ------------------------------------------------------------
    const report = {
      generatedAt: new Date().toISOString(),
      mode: APPLY ? 'apply' : 'dry-run',
      accounts: accounts.length,
      mapped: toWrite.length,
      alreadyCategorized: alreadySet.length,
      unmapped: unmapped.length,
      needsReview: needsReview.length,
      unmappedAccounts: unmapped.map((d) => ({ code: d.code, name: d.name, oldType: d.oldType })),
      reviewAccounts: needsReview.map((d) => ({
        code: d.code, name: d.name, oldType: d.oldType, assigned: d.categoryKey,
      })),
      renamedByTemplate,
      warnings: [] as string[],
      durationMs: 0,
    };
    if (renamedByTemplate.length > 0) {
      report.warnings.push(
        `${renamedByTemplate.length} account name(s) differ from COA_TEMPLATE and would be ` +
          'overwritten the next time seedAccountingCore runs for this organization.',
      );
    }
    report.durationMs = Date.now() - started;

    writeFileSync(join(OUT_DIR, 'MigrationReport.json'), JSON.stringify(report, null, 2));

    const md = [
      '# Account mapping report',
      '',
      `Generated ${report.generatedAt} (${report.mode})`,
      '',
      `- accounts: **${report.accounts}**`,
      `- mapped this run: **${report.mapped}**`,
      `- already categorized: ${report.alreadyCategorized}`,
      `- **unmapped: ${report.unmapped}**`,
      `- needs review (coarse old type): ${report.needsReview}`,
      '',
      '| Code | Name | Old type | New category | Normal balance | isPostable | Source |',
      '|---|---|---|---|---|---|---|',
      ...decisions.map(
        (d) =>
          `| ${d.code} | ${d.name} | ${d.oldType} | ${d.categoryKey ?? '—'} | ` +
          `${d.normalBalance ?? '—'} | ${d.isPostable} | ${d.source}${d.confident ? '' : ' ⚠'} |`,
      ),
    ].join('\n');
    writeFileSync(join(OUT_DIR, 'MigrationReport.md'), md);

    console.log(
      `\naccounts=${report.accounts} mapped=${report.mapped} ` +
        `alreadySet=${report.alreadyCategorized} unmapped=${report.unmapped} ` +
        `needsReview=${report.needsReview}`,
    );
    console.log(`Report written to ${OUT_DIR}\\MigrationReport.{json,md}`);

    if (unmapped.length > 0) {
      console.error(
        `\nBLOCKED: ${unmapped.length} account(s) have no category mapping. ` +
          'Add them to TYPE_TO_CATEGORY (or give them a template code) and re-run. ' +
          'Phase C must NOT be applied until this reads 0.',
      );
      for (const d of unmapped) console.error(`  ${d.code}  ${d.name}  (${d.oldType})`);
      process.exitCode = 1;
      return;
    }

    if (needsReview.length > 0) {
      console.warn(
        `\n${needsReview.length} account(s) came from a coarse old type and were assigned a ` +
          'default. Review MigrationReport.md before phase C.',
      );
    }

    // --- 5. Apply -------------------------------------------------------------
    if (!APPLY) {
      console.log('\nDry run — nothing written. Re-run with --apply to commit.');
      return;
    }

    await db.query('BEGIN');
    try {
      for (const d of toWrite) {
        await db.query(
          `UPDATE "Account"
              SET "categoryId"    = (SELECT "id" FROM "AccountCategory" WHERE "key" = $1),
                  "normalBalance" = $2::"NormalBalance",
                  "isPostable"    = $3,
                  "updatedAt"     = NOW()
            WHERE "id" = $4`,
          [d.categoryKey, d.normalBalance, d.isPostable, d.id],
        );
      }

      const leftover = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "Account" WHERE "categoryId" IS NULL`,
      );
      if (Number(leftover.rows[0].count) > 0) {
        throw new Error(
          `${leftover.rows[0].count} account(s) still have a NULL categoryId after the ` +
            'backfill — rolling back.',
        );
      }

      await db.query('COMMIT');
      console.log(`\nApplied. ${toWrite.length} account(s) updated, 0 left uncategorized.`);
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
