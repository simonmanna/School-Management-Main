-- HR leave accrual engine — accrual configuration on the leave type, plus the
-- accrual ledger that makes the job idempotent.
--
-- Applied with psql / `prisma db execute` rather than `prisma migrate` because
-- schooldb-planet has no `_prisma_migrations` history. Idempotent throughout.

-- ── Enums ───────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HrLeaveAccrualMethod') THEN
    CREATE TYPE "HrLeaveAccrualMethod" AS ENUM ('ANNUAL_UPFRONT', 'MONTHLY', 'NONE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HrLeaveAccrualReason') THEN
    CREATE TYPE "HrLeaveAccrualReason" AS ENUM (
      'ANNUAL_GRANT', 'MONTHLY_ACCRUAL', 'CARRY_FORWARD', 'CARRY_FORWARD_EXPIRY', 'FORFEITURE'
    );
  END IF;
END $$;

-- ── Accrual configuration on the leave type ─────────────────────────────────
-- ANNUAL_UPFRONT is the default so existing leave types behave exactly as before.

ALTER TABLE "HrLeaveType"
  ADD COLUMN IF NOT EXISTS "accrualMethod" "HrLeaveAccrualMethod" NOT NULL DEFAULT 'ANNUAL_UPFRONT',
  ADD COLUMN IF NOT EXISTS "accrualStartsAfterMonths" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "carryForwardExpiryMonths" INTEGER,
  ADD COLUMN IF NOT EXISTS "maxBalanceDays" INTEGER;

-- ── The accrual ledger ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "HrLeaveAccrual" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId"     TEXT NOT NULL,
  "leaveTypeId"    TEXT NOT NULL,
  "year"           INTEGER NOT NULL,
  "periodKey"      TEXT NOT NULL,
  "days"           DECIMAL(10,2) NOT NULL,
  "reason"         "HrLeaveAccrualReason" NOT NULL,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  CONSTRAINT "HrLeaveAccrual_pkey" PRIMARY KEY ("id")
);

-- The idempotence key: re-running a month's accrual grants nothing twice.
CREATE UNIQUE INDEX IF NOT EXISTS "HrLeaveAccrual_org_emp_type_period_key"
  ON "HrLeaveAccrual" ("organizationId", "employeeId", "leaveTypeId", "periodKey");
CREATE INDEX IF NOT EXISTS "HrLeaveAccrual_organizationId_year_leaveTypeId_idx"
  ON "HrLeaveAccrual" ("organizationId", "year", "leaveTypeId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrLeaveAccrual_employeeId_fkey') THEN
    ALTER TABLE "HrLeaveAccrual"
      ADD CONSTRAINT "HrLeaveAccrual_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrLeaveAccrual_leaveTypeId_fkey') THEN
    ALTER TABLE "HrLeaveAccrual"
      ADD CONSTRAINT "HrLeaveAccrual_leaveTypeId_fkey"
      FOREIGN KEY ("leaveTypeId") REFERENCES "HrLeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
