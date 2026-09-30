-- Wave 18: bank reconciliation matches statement lines to GENERAL LEDGER lines on
-- the bank's ledger account instead of to Payment rows. The old matcher compared
-- Payment.accountId (a ledger account) with BankAccount.id, so real receipts never
-- matched, and it could not see expense payments or mobile-money payouts at all.

-- 1. Statement line status becomes an enum; a dedupe key replaces the per-row
--    findFirst (which raced and re-imported lines without a bank reference).
CREATE TYPE "BankStatementLineStatus" AS ENUM ('unmatched', 'matched', 'excluded');

ALTER TABLE "BankStatementLine"
  ADD COLUMN "contentKey" TEXT,
  ADD COLUMN "excludedReason" TEXT,
  ADD COLUMN "importedById" TEXT;

UPDATE "BankStatementLine"
   SET "contentKey" = CASE WHEN "externalRef" IS NOT NULL THEN 'ref:' || "externalRef" ELSE 'legacy:' || id END;
ALTER TABLE "BankStatementLine" ALTER COLUMN "contentKey" SET NOT NULL;

-- Matches made by the old matcher pointed at Payment rows and are not carried
-- over: every line starts unmatched and is reconciled against the ledger.
ALTER TABLE "BankStatementLine" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "BankStatementLine"
  ALTER COLUMN "status" TYPE "BankStatementLineStatus"
  USING (CASE "status" WHEN 'ignored' THEN 'excluded' ELSE 'unmatched' END)::"BankStatementLineStatus";
ALTER TABLE "BankStatementLine" ALTER COLUMN "status" SET DEFAULT 'unmatched';

ALTER TABLE "BankStatementLine" DROP COLUMN "matchedPaymentId", DROP COLUMN "matchedRunId";

DROP INDEX IF EXISTS "BankStatementLine_status_idx";
CREATE UNIQUE INDEX "BankStatementLine_organizationId_bankAccountId_contentKey_key"
  ON "BankStatementLine" ("organizationId", "bankAccountId", "contentKey");
CREATE INDEX "BankStatementLine_organizationId_bankAccountId_status_idx"
  ON "BankStatementLine" ("organizationId", "bankAccountId", "status");

-- 2. One row per statement-line ↔ journal-line match; unmatching stamps it.
CREATE TABLE "BankReconciliationMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "statementLineId" TEXT NOT NULL,
    "journalLineId" TEXT NOT NULL,
    "runId" TEXT,
    "method" TEXT NOT NULL,
    "matchedById" TEXT,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unmatchedAt" TIMESTAMP(3),
    "unmatchedById" TEXT,
    "unmatchReason" TEXT,

    CONSTRAINT "BankReconciliationMatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankReconciliationMatch_organizationId_statementLineId_idx"
  ON "BankReconciliationMatch" ("organizationId", "statementLineId");
CREATE INDEX "BankReconciliationMatch_organizationId_journalLineId_idx"
  ON "BankReconciliationMatch" ("organizationId", "journalLineId");

-- A statement line and a ledger line can each be in at most ONE live match —
-- across every run, which is what the old per-run Set never guaranteed.
CREATE UNIQUE INDEX "BankReconciliationMatch_live_statement_line_key"
  ON "BankReconciliationMatch" ("statementLineId") WHERE "unmatchedAt" IS NULL;
CREATE UNIQUE INDEX "BankReconciliationMatch_live_journal_line_key"
  ON "BankReconciliationMatch" ("journalLineId") WHERE "unmatchedAt" IS NULL;

ALTER TABLE "BankReconciliationMatch"
  ADD CONSTRAINT "BankReconciliationMatch_statementLineId_fkey"
  FOREIGN KEY ("statementLineId") REFERENCES "BankStatementLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankReconciliationMatch"
  ADD CONSTRAINT "BankReconciliationMatch_journalLineId_fkey"
  FOREIGN KEY ("journalLineId") REFERENCES "JournalLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Row-level security (catalog block, idempotent — re-covers every org table).
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
        JOIN pg_attribute a  ON a.attrelid = c.oid
        WHERE ns.nspname = 'public'
          AND c.relkind = 'r'
          AND a.attname = 'organizationId'
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        IF EXISTS (
            SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
             WHERE c.relname = t AND a.attname = 'organizationId' AND NOT a.attnotnull
        ) THEN
            EXECUTE format(
                'CREATE POLICY tenant_isolation ON %I
                 USING ("organizationId" IS NULL OR "organizationId" = current_setting(''app.org_id'', true))
                 WITH CHECK ("organizationId" = current_setting(''app.org_id'', true))',
                t
            );
        ELSE
            EXECUTE format(
                'CREATE POLICY tenant_isolation ON %I
                 USING ("organizationId" = current_setting(''app.org_id'', true))',
                t
            );
        END IF;
    END LOOP;
END $$;

-- 4. Cross-tenant FK guard (catalog block of 20260923110000, idempotent).
DO $$
DECLARE
  r record;
  trg text;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT con.conname,
           child.relname  AS child_tbl,
           ca.attname     AS fk_col,
           parent.relname AS parent_tbl
      FROM pg_constraint con
      JOIN pg_class child   ON child.oid  = con.conrelid
      JOIN pg_class parent  ON parent.oid = con.confrelid
      JOIN pg_namespace ns  ON ns.oid = child.relnamespace
      JOIN pg_attribute ca  ON ca.attrelid = con.conrelid  AND ca.attnum = con.conkey[1]
      JOIN pg_attribute pa  ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
     WHERE con.contype = 'f'
       AND ns.nspname = 'public'
       AND array_length(con.conkey, 1) = 1
       AND pa.attname = 'id'
       AND ca.attname <> 'organizationId'
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = child.oid  AND x.attname = 'organizationId' AND NOT x.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = parent.oid AND x.attname = 'organizationId' AND NOT x.attisdropped)
  LOOP
    trg := 'tenant_fk_' || left(md5(r.conname), 24);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trg, r.child_tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION enforce_same_org_fk(%L, %L)',
      trg, r.fk_col, r.child_tbl, r.fk_col, r.parent_tbl
    );
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'tenant FK guard installed on % foreign key(s)', n;
END $$;
