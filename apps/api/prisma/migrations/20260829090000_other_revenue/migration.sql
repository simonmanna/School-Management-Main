-- Other Revenue / Income module: IncomeHead (revenue categories) + Income
-- (money-in receipts: fine, donation, grant, interest, canteen, etc.).
-- Idempotent: safe to re-run (CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS).

CREATE TABLE IF NOT EXISTS "IncomeHead" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"  TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "icon"            TEXT,
  "description"     TEXT,
  "ledgerAccountId" TEXT,
  "isActive"        BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy"       TEXT,
  "deletedAt"       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS "IncomeHead_organizationId_name_key" ON "IncomeHead" ("organizationId", "name");
CREATE INDEX IF NOT EXISTS "IncomeHead_organizationId_idx" ON "IncomeHead" ("organizationId");

CREATE TABLE IF NOT EXISTS "Income" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"  TEXT NOT NULL,
  "incomeCode"      TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "description"     TEXT,
  "invoiceNumber"   TEXT,
  "amount"          DECIMAL(20, 6) NOT NULL,
  "incomeDate"      TIMESTAMPTZ NOT NULL,
  "incomeHeadId"    TEXT,
  "incomeHeadName"  TEXT,
  "paymentMethod"   TEXT NOT NULL DEFAULT 'CASH',
  "accountId"       TEXT,
  "attachmentId"    TEXT,
  "journalEntryId"  TEXT,
  "status"          TEXT NOT NULL DEFAULT 'RECEIVED',
  "receivedById"    TEXT,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deletedAt"       TIMESTAMPTZ,
  CONSTRAINT "Income_incomeHeadId_fkey" FOREIGN KEY ("incomeHeadId") REFERENCES "IncomeHead" ("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Income_organizationId_incomeCode_key" ON "Income" ("organizationId", "incomeCode");
CREATE INDEX IF NOT EXISTS "Income_organizationId_idx" ON "Income" ("organizationId");
CREATE INDEX IF NOT EXISTS "Income_organizationId_incomeDate_idx" ON "Income" ("organizationId", "incomeDate");
CREATE INDEX IF NOT EXISTS "Income_incomeHeadId_idx" ON "Income" ("incomeHeadId");

-- RLS: every org-scoped table gets the tenant_isolation policy (USING-only,
-- matching the established pattern). Force so SUPERUSER-free connections are
-- scoped; write scoping remains the Prisma tenancy extension's job.
ALTER TABLE "IncomeHead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IncomeHead" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "IncomeHead";
CREATE POLICY tenant_isolation ON "IncomeHead"
  USING ("organizationId" = current_setting('app.org_id', true));

ALTER TABLE "Income" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Income" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Income";
CREATE POLICY tenant_isolation ON "Income"
  USING ("organizationId" = current_setting('app.org_id', true));
