# Release 2026-08-r1 — production upgrade

Upgrades a café running the `v1.5.0`-era schema (198 models) to the current
`schema.prisma` (263 models), including the chart-of-accounts restructure.

**This release cannot be deployed with `scripts/update-pos.ps1`.** That script
handles ordinary releases; this one changes migration history and drops columns
holding live accounting data. Use `upgrade.ps1` here.

---

## Why this exists

Three things make a plain `git pull && prisma migrate deploy` unsafe:

1. **Migration history was renamed.** The 2026-07-27 squash replaced every
   migration folder. Production's `_prisma_migrations` holds five names that no
   longer exist in the repo, and the repo holds five it has never seen — zero
   overlap. `migrate deploy` therefore treats the 4198-line `squashed_baseline`
   as pending and dies on `relation "Account" already exists`.

2. **The updater used to swallow that failure.** Step 5 warned and continued,
   rebuilding the API against a schema the database did not have. Fixed in
   `scripts/update-pos.ps1`, which now throws and adds a drift gate.

3. **The chart of accounts is dropped with no backfill.**
   `Account.accountType` and `isGroup` are replaced by `categoryId` (FK to the
   new global `AccountCategory`), `normalBalance` and `isPostable` — and the
   migration that does it contains no data operations at all. Applied as-is to a
   live COA it leaves every account uncategorized: the posting engine cannot
   resolve accounts, so **sales cannot be settled**, and the snapshot rebuild
   would rewrite financial history from an uncategorized COA — silently, and
   days later.

`phaseB-backfill.ts` is the missing data step.

---

## Files

| File | Purpose |
|---|---|
| `phaseA-additive.sql` | **generated during rehearsal** — all additive DDL |
| `phaseB-backfill.ts` | maps `accountType` → `categoryId`; writes `MigrationReport.{json,md}` |
| `phaseC-contract.sql` | **generated during rehearsal** — the destructive drops |
| `verify.ts` | financial baseline capture / compare |
| `upgrade.ps1` | idempotent, resumable driver |
| `rollback.ps1` | picks code-revert vs restore based on `state.json` |
| `state.json` | written by `upgrade.ps1`; the resume journal |

Phase D has no file of its own — it applies the two RLS migrations already in
`apps/api/prisma/migrations/`, both of which are idempotent `DO $$` blocks.

---

## Generating phase A and phase C

`prisma migrate diff` is the drafting tool; its output is reviewed and committed,
never run straight at production. Do this against a **staging clone**, not prod:

```bash
pnpm --filter @erp/api exec prisma migrate diff \
  --from-url "$STAGING_DATABASE_URL" \
  --to-schema-datamodel ./prisma/schema.prisma \
  --script > deployment/2026-08-r1/draft.sql
```

Then:

1. **Read `draft.sql` line by line.** The only destructive statements should be:
   ```sql
   ALTER TABLE "Account" DROP COLUMN "accountType", DROP COLUMN "isGroup";
   DROP TYPE "AccountType";
   ```
   Anything else that drops a column or table means an unplanned data loss —
   stop and handle that column explicitly.
2. Move those statements into `phaseC-contract.sql`.
3. Everything else becomes `phaseA-additive.sql`, unchanged from the generator.
4. Commit both. They are the permanent record of what this release did.

Diffing `--from-url` (the live database) rather than `--from-migrations` is
deliberate: several features in this period shipped via `prisma db push` with no
migration, so the archived migration chain is not guaranteed to reproduce
`schema.prisma`. Starting from the database starts from reality.

---

## Running it

Connect as the database **owner**, not the RLS-restricted `app` role — the
backfill has to see every organization's accounts.

```powershell
# staging rehearsal, no writes
.\upgrade.ps1 -DryRun

# real run (staging first, then production)
.\upgrade.ps1
```

Resumable: each step is journalled in `state.json`, and re-running skips what
already finished. If it dies at phase C, run it again — it will not redo the
backup or re-apply phase A.

Step order, and why:

```
preflight → backup → baselineBefore → phaseA → phaseB(dry) → phaseB → GATE
  → phaseC → phaseD → history → drift → build → restart+health → verifyAfter
```

`phaseA` is additive on purpose: until `phaseC` runs, the old build still works
against the new schema, which is what makes an early rollback a code-only revert.

---

## The gates

**Sync drain (preflight).** Blocking, not advisory. Restoring the server
database while a tablet holds unsynced sales produces duplicates or drops them
on reconnect, and no restore recovers them. Checks open `SyncOpDeadLetter` rows,
pending/failed `StockPostingJob` rows, and open cash sessions — all must be zero.
The script cannot see a tablet's on-device outbox: **confirm each one is empty in
the app UI by hand.**

**Account mapping (gate).** `phaseC` is irreversible without a restore, so it is
blocked unless `MigrationReport.json` reports `unmapped: 0`. If any account is
flagged `needsReview` — the old `asset`, `liability` and `expense` types were
coarser than the new catalog — the script stops and makes you confirm.

Two things the report catches that nothing else does:

- **Custom accounts.** The café's own accounts (their bank, mobile money,
  specific expense lines) are not in `COA_TEMPLATE`. They fall back to the
  type map; anything with no mapping at all is listed and blocks the release.
- **Template overwrites.** `seedAccountingCore`'s upsert rewrites `name` for
  template codes, so a locally renamed account would be silently reset. Those
  appear as `renamedByTemplate`.

**Drift.** `migrate diff --exit-code` must come back empty — that is the proof
the upgrade landed exactly on `schema.prisma`.

**Financial.** `verify.ts` compares posted-journal debit/credit totals per
organization, before and after, as exact decimal strings. A cent of drift fails
the release.

---

## Migration history

Legacy rows in `_prisma_migrations` are **preserved** — they are the deployment
audit trail for a financial system. The `history` step only registers the five
current migration names with `prisma migrate resolve --applied`, so ordinary
`migrate deploy` works from here on.

Run `prisma migrate status` afterwards and read what it says about the five
legacy rows that have no local folder. If that turns out to block `deploy`,
archive rather than delete:

```sql
CREATE TABLE "_prisma_migrations_archive_2026_08" AS
  SELECT * FROM "_prisma_migrations";
-- then remove only the five stale rows
```

---

## Feature flags

This release creates all 65 new tables but leaves the unused subsystems dark.
Empty tables cost nothing; a registered Nest module does not — it runs its
`OnModuleInit`, crons and queue consumers whether or not anyone navigates to it
(`BeverageModule` has a boot hook). So the gate is on the module import itself,
in `apps/api/src/app.module.ts`:

```
ENABLE_BEVERAGE=false   VITE_ENABLE_BEVERAGE=false
ENABLE_ASSETS=false     VITE_ENABLE_ASSETS=false
ENABLE_TASKS=false      VITE_ENABLE_TASKS=false
```

Flip one at a time, one restart each, after this release has been stable for a
week. No migration is involved — it is a restart, not a deployment.

---

## Rollback

```powershell
.\rollback.ps1                    # before phaseC — code-only revert
.\rollback.ps1 -ConfirmRestore    # after phaseC — restore, discards post-cutover writes
```

`rollback.ps1` reads `state.json` to decide which applies and refuses to guess.
Rehearse it on staging and **time it** — that number belongs in the cutover plan,
not an estimate.

---

## 24-hour watch

The failure mode that matters most here is delayed and silent, so do not stop
watching at the end of the window. Hourly for 4h, then at 12h and 24h:

| Signal | Where | Alarm if |
|---|---|---|
| HTTP 500 rate | Pino logs / `/metrics` | sustained rise over baseline |
| DB errors | Postgres log | any `column does not exist` / constraint violation |
| Sync failures | `SyncOpDeadLetter WHERE status='open'` | > 0 |
| Queue failures | `StockPostingJob` stuck or failed | > 0 |
| **Snapshot job** | `snapshot-cron.worker` output | **any error, or totals shifting** |
| GL posting | failed posting attempts | > 0 |
| Health | `/health/ready` | non-200 |
| Disk / memory | Windows perf | trending toward limits |

The snapshot row is the one to watch. An uncategorized COA does not announce
itself at cutover — it shows up when the rebuild next runs.

---

## Never on production

- `pnpm --filter @erp/api db:seed` — `prisma/seed.ts` does `deleteMany` on
  `menuProduct`, `menuItem` and `menuCategory`. It **wipes a live menu**.
- `scripts/validate-production.ts` — writes real sales, refunds and GL entries.
  Staging only.
