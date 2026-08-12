-- D2-2: FiscalPeriod.closedAt, closedBy, lockedAt columns for PeriodCloseService.

-- AlterTable
ALTER TABLE "FiscalPeriod"
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "closedBy" TEXT,
  ADD COLUMN "lockedAt" TIMESTAMP(3);