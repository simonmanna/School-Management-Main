-- HR leave accrual + payroll inputs (audit: clean-replay drift).
--
-- These objects were applied to the development database from prisma/sql/*.sql
-- (it had no migration history at the time), so a database built from
-- migrations alone lacked them and HR leave accrual / payroll inputs would fail
-- on a fresh production install. This migration carries both files verbatim;
-- every statement is idempotent, so databases that already have them are unchanged.

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

-- HR payroll hardening — ad-hoc inputs, pro-rata columns, payslip cancellation.
--
-- Applied with `prisma db execute` rather than `prisma migrate` because
-- schooldb-planet has no `_prisma_migrations` history (see the migration
-- baseline note). Every statement is idempotent, so re-running is safe.

-- ── Enums ───────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HrPayrollInputType') THEN
    CREATE TYPE "HrPayrollInputType" AS ENUM ('BONUS', 'COMMISSION', 'ALLOWANCE', 'DEDUCTION', 'REIMBURSEMENT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HrPayrollInputStatus') THEN
    CREATE TYPE "HrPayrollInputStatus" AS ENUM ('PENDING', 'APPROVED', 'APPLIED', 'CANCELLED');
  END IF;
END $$;

-- A reversed payroll run voids its payslips; the number has to keep resolving
-- to a cancelled slip because employees may already hold a printed copy.
ALTER TYPE "HrPayslipStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- ── Ad-hoc payroll inputs ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "HrPayrollInput" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId"     TEXT NOT NULL,
  "periodId"       TEXT NOT NULL,
  "inputType"      "HrPayrollInputType" NOT NULL,
  "name"           TEXT NOT NULL,
  "amount"         DECIMAL(20,6) NOT NULL,
  "isTaxable"      BOOLEAN NOT NULL DEFAULT true,
  "status"         "HrPayrollInputStatus" NOT NULL DEFAULT 'PENDING',
  "appliedRunId"   TEXT,
  "approvedById"   TEXT,
  "approvedAt"     TIMESTAMP(3),
  "reference"      TEXT,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "createdBy"      TEXT,
  "updatedBy"      TEXT,
  "deletedAt"      TIMESTAMP(3),
  CONSTRAINT "HrPayrollInput_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HrPayrollInput_organizationId_periodId_status_deletedAt_idx"
  ON "HrPayrollInput" ("organizationId", "periodId", "status", "deletedAt");
CREATE INDEX IF NOT EXISTS "HrPayrollInput_organizationId_employeeId_deletedAt_idx"
  ON "HrPayrollInput" ("organizationId", "employeeId", "deletedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HrPayrollInput_employeeId_fkey'
  ) THEN
    ALTER TABLE "HrPayrollInput"
      ADD CONSTRAINT "HrPayrollInput_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "HrEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HrPayrollInput_periodId_fkey'
  ) THEN
    ALTER TABLE "HrPayrollInput"
      ADD CONSTRAINT "HrPayrollInput_periodId_fkey"
      FOREIGN KEY ("periodId") REFERENCES "HrPayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Pro-rata provenance on the payroll item ─────────────────────────────────
--
-- Stored, not recomputed: a payslip has to stay explainable years later, when
-- the period, the leave records and the employee's hire date may all have moved.

ALTER TABLE "HrPayrollItem"
  ADD COLUMN IF NOT EXISTS "periodDays"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paidDays"        DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "proRataFactor"   DECIMAL(10,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "unpaidLeaveDays" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- The hand-written file named the ledger's unique index differently from the
-- name Prisma derives, which `migrate diff` reports as drift. Align it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'HrLeaveAccrual_org_emp_type_period_key')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'HrLeaveAccrual_organizationId_employeeId_leaveTypeId_period_key') THEN
    ALTER INDEX "HrLeaveAccrual_org_emp_type_period_key"
      RENAME TO "HrLeaveAccrual_organizationId_employeeId_leaveTypeId_period_key";
  END IF;
END $$;
