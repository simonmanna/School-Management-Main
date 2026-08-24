-- Homework IS an assessment (P3), and the spine owns the approval workflow (P6).
--
-- `HomeworkAssignment.assessmentId` lets the gradebook column be minted when the
-- homework is created rather than when it is first graded, so a teacher sees the
-- column the moment the work is set. It also stops `gradeHomework` minting a
-- second Assessment behind the first.
--
-- The StudentAssessment columns are the last three facts GradeEntry held that
-- the spine did not, and they are what let markingApproval replace
-- GradeEntryService.submit/approve/reject.
ALTER TABLE "HomeworkAssignment" ADD COLUMN IF NOT EXISTS "assessmentId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "HomeworkAssignment_assessmentId_key"
  ON "HomeworkAssignment"("assessmentId");

ALTER TABLE "StudentAssessment" ADD COLUMN IF NOT EXISTS "enteredAt" TIMESTAMP(3);
ALTER TABLE "StudentAssessment" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "StudentAssessment" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
