-- A0 assessment hardening for GradeEntry.
--
-- 1. Optimistic-concurrency `version` column (see kernel/common/optimistic-update.ts)
--    so two markers editing the same class sheet cannot silently overwrite each other.
-- 2. `rejectionReason` so `submitted → rejected` carries context back to the enterer.
-- 3. A CHECK constraint enforcing 0 <= marksObtained <= maxMarks at the database.
--    The service validates this too, but the DB is the last line of defence against
--    a bad path storing an impossible mark that would compute a nonsense grade.

-- AlterTable
ALTER TABLE "GradeEntry" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GradeEntry" ADD COLUMN     "rejectionReason" TEXT;

-- CHECK: marks in [0, maxMarks]. marksObtained is nullable (a not-yet-entered
-- row), so the lower/upper bounds only bind when a mark is present. maxMarks is
-- non-null and must be strictly positive.
ALTER TABLE "GradeEntry"
  ADD CONSTRAINT "GradeEntry_marks_range_check"
  CHECK (
    "maxMarks" > 0
    AND ("marksObtained" IS NULL OR ("marksObtained" >= 0 AND "marksObtained" <= "maxMarks"))
  );
