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
