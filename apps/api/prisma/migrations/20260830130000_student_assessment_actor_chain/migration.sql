-- StudentAssessment: record WHO SUBMITTED marks for approval, separately from
-- who entered them.
--
-- `markingApproval({action:'submit'})` used to write the submitter's id into
-- `enteredById`, overwriting the marker. Two distinct actors collapsed into one
-- column, with two consequences:
--
--   1. A teacher who entered marks that a colleague then submitted could
--      approve those marks themselves -- their authorship had been erased.
--   2. runPublishGate's SOD_VIOLATION check compares enteredById against
--      approvedById, so the publish gate inherited the same blind spot and
--      could not catch it either.
--
-- Entered / submitted / approved are three facts and now have three columns.
-- Both are nullable: rows submitted before this migration have no recorded
-- submitter, and the segregation-of-duty check treats a null as "unknown", so
-- it falls back to the enteredById comparison for historic rows.

-- AlterTable
ALTER TABLE "StudentAssessment" ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT;

