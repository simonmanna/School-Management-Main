-- LMS Phase 1: add the HomeworkSubmission -> StudentAssessment grade bridge column.
-- Non-destructive: nullable column + index.
ALTER TABLE "HomeworkSubmission"
  ADD COLUMN "studentAssessmentId" TEXT;

CREATE INDEX "HomeworkSubmission_studentAssessmentId_idx"
  ON "HomeworkSubmission" ("studentAssessmentId");
