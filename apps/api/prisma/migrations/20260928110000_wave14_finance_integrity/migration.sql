-- Wave 14 (audit 2026-09-27) Phase 2/3 school policies. ADR-032.
--
-- P1 (F08): what a late mark contributes. NULL = the school has not chosen, and
-- no attendance rate is computed until it does.
ALTER TABLE "SchoolProfile" ADD COLUMN "attendanceLateContribution" DECIMAL(3,2);
ALTER TABLE "SchoolProfile" ADD CONSTRAINT "SchoolProfile_attendanceLateContribution_check"
  CHECK ("attendanceLateContribution" IS NULL OR "attendanceLateContribution" IN (0.5, 1));
ALTER TABLE "SchoolProfile" ADD COLUMN "attendanceExcusedInDenominator" BOOLEAN NOT NULL DEFAULT false;

-- P3 (F09): cash custody mode. Existing schools stay on the cashbook — no drawer
-- sessions were ever required of them — and now see untracked custody reported
-- honestly instead of a zero variance.
ALTER TABLE "SchoolProfile" ADD COLUMN "cashCustodyMode" TEXT NOT NULL DEFAULT 'cashbook';
ALTER TABLE "SchoolProfile" ADD CONSTRAINT "SchoolProfile_cashCustodyMode_check"
  CHECK ("cashCustodyMode" IN ('drawer', 'cashbook'));

-- F03 (I-020): one adjustment, one journal. A second posting of the same
-- adjustment cannot exist even if application code regresses.
CREATE UNIQUE INDEX IF NOT EXISTS "FeeAdjustment_journalEntryId_key"
  ON "FeeAdjustment"("journalEntryId") WHERE "journalEntryId" IS NOT NULL;
