-- Chart of Accounts re-architecture.
--
-- Splits the two concerns the flat `AccountType` enum conflated:
--   * `Account.parentAccountId` -> hierarchy (reporting / navigation only)
--   * `Account.categoryId`      -> behavior (how the engine treats the account)
--
-- Key properties of the target design:
--   * `AccountCategory` is GLOBAL — accounting concepts ("cash", "inventory")
--     are not tenant configuration. No `organizationId`, and deliberately NO
--     row-level security, matching `Currency` and `Permission`.
--   * `Account.isPostable` replaces `isGroup` (inverted). The invariant
--     `isPostable = (categoryId IS NOT NULL)` holds: group nodes are structural
--     folders and carry no accounting behavior.
--   * `AccountType` is dropped entirely.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "AccountClassification" AS ENUM ('asset','liability','equity','revenue','expense','off_balance');
CREATE TYPE "NormalBalance"         AS ENUM ('debit','credit');
CREATE TYPE "CashFlowClass"         AS ENUM ('operating','investing','financing','none');
CREATE TYPE "ReportSection"         AS ENUM (
    'current_assets','non_current_assets','current_liabilities','long_term_liabilities','equity',
    'revenue','contra_revenue','cogs','operating_expense','other_income','other_expense','off_balance');
CREATE TYPE "ControlAccountType"    AS ENUM ('ar','ap','inventory','fixed_assets','payroll','tax');

-- ---------------------------------------------------------------------------
-- 2. AccountCategory — global catalog, system-managed, no RLS
-- ---------------------------------------------------------------------------
CREATE TABLE "AccountCategory" (
    "id"                  TEXT NOT NULL,
    "key"                 TEXT NOT NULL,
    "name"                TEXT NOT NULL,
    "description"         TEXT,
    "classification"      "AccountClassification" NOT NULL,
    "normalBalance"       "NormalBalance"         NOT NULL,
    "reportSection"       "ReportSection"         NOT NULL,
    "cashFlowClass"       "CashFlowClass"         NOT NULL DEFAULT 'operating',
    "isContra"            BOOLEAN NOT NULL DEFAULT false,
    "isCashEquivalent"    BOOLEAN NOT NULL DEFAULT false,
    "allowReconciliation" BOOLEAN NOT NULL DEFAULT false,
    "allowManualPosting"  BOOLEAN NOT NULL DEFAULT true,
    "allowBudgeting"      BOOLEAN NOT NULL DEFAULT false,
    "isSystem"            BOOLEAN NOT NULL DEFAULT false,
    "isActive"            BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"           INTEGER NOT NULL DEFAULT 0,
    -- Upgrade gate: the boot seeder only rewrites a row when the shipped
    -- template declares a higher version.
    "systemVersion"       INTEGER NOT NULL DEFAULT 1,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,
    "createdBy"           TEXT,
    "updatedBy"           TEXT,
    "deletedAt"           TIMESTAMP(3),
    CONSTRAINT "AccountCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountCategory_key_key" ON "AccountCategory"("key");
CREATE INDEX "AccountCategory_classification_idx" ON "AccountCategory"("classification");

-- No ENABLE ROW LEVEL SECURITY here, deliberately. 20260704000001_rls_and_triggers
-- uses an opt-in allowlist and this table is not in it, exactly like Currency
-- and Permission. The catalog is global; tenant isolation would make it unreadable.

-- ---------------------------------------------------------------------------
-- 3. Account — behavior + structure columns
-- ---------------------------------------------------------------------------
ALTER TABLE "Account"
    ADD COLUMN "categoryId"          TEXT,
    ADD COLUMN "normalBalance"       "NormalBalance" NOT NULL DEFAULT 'debit',
    ADD COLUMN "isPostable"          BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "allowReconciliation" BOOLEAN,
    ADD COLUMN "allowManualPosting"  BOOLEAN,
    ADD COLUMN "allowBudgeting"      BOOLEAN,
    ADD COLUMN "reportSection"       "ReportSection",
    ADD COLUMN "controlAccountType"  "ControlAccountType",
    ADD COLUMN "sortOrder"           INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "deprecatedAt"        TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 4. Drop the legacy flat type. It conflated normal balance, the BS/P&L split,
--    the balance-sheet section and the cash-flow class into one enum.
-- ---------------------------------------------------------------------------
DROP INDEX "Account_organizationId_accountType_idx";
ALTER TABLE "Account" DROP COLUMN "accountType", DROP COLUMN "isGroup";
DROP TYPE "AccountType";

-- ---------------------------------------------------------------------------
-- 5. Account FK + indexes
-- ---------------------------------------------------------------------------
ALTER TABLE "Account" ADD CONSTRAINT "Account_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "AccountCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Account_organizationId_categoryId_idx"      ON "Account"("organizationId","categoryId");
CREATE INDEX "Account_organizationId_parentAccountId_idx" ON "Account"("organizationId","parentAccountId");

-- ---------------------------------------------------------------------------
-- 6. AccountMapping — the FK the init migration never created
-- ---------------------------------------------------------------------------
ALTER TABLE "AccountMapping" ADD CONSTRAINT "AccountMapping_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AccountMapping_organizationId_accountId_idx"
    ON "AccountMapping"("organizationId","accountId");

-- ---------------------------------------------------------------------------
-- 7. Report snapshots — denormalized category data so readers need no join
-- ---------------------------------------------------------------------------
ALTER TABLE "ReportTrialBalanceSnapshot"
    ADD COLUMN "accountCategoryKey" TEXT,
    ADD COLUMN "classification"     TEXT,
    ADD COLUMN "normalBalance"      TEXT,
    ADD COLUMN "schemaVersion"      INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "ReportBalanceSheetSnapshot"
    ADD COLUMN "accountCategoryKey" TEXT,
    ADD COLUMN "classification"     TEXT,
    ADD COLUMN "normalBalance"      TEXT,
    ADD COLUMN "reportSection"      TEXT,
    ADD COLUMN "schemaVersion"      INTEGER NOT NULL DEFAULT 2;
