-- Assessment stands alone (P1).
--
-- `kind` used to be reachable only through `component.kind`, so an
-- adapter-projected exam mark — which has no component until a policy maps it —
-- was typeless. That is what made a single, kind-filterable "Assessments" list
-- impossible: the row could not say whether it was a CAT, a homework or an exam.
--
-- `kind` is deliberately NULLABLE here. A `DEFAULT 'cat'` would be
-- indistinguishable from a row the backfill genuinely classified as a CAT, and
-- the shadow-compare that runs before readers switch over depends on telling
-- "not yet classified" apart from "classified as cat". It goes NOT NULL in a
-- later migration, once the backfill has run and reported zero NULLs.
--
-- The remaining columns close the gaps that forced HomeworkAssignment and
-- ExamSchedule to keep parallel copies of the same facts. `teacherPartnerId` is
-- a StaffProfile id, deliberately NOT the same thing as
-- StudentAssessment.enteredById, which is a User id.
--
-- Purely additive: nothing reads these columns in the release that adds them.
ALTER TABLE "Assessment" ADD COLUMN IF NOT EXISTS "kind" "AssessmentKind";
ALTER TABLE "Assessment" ADD COLUMN IF NOT EXISTS "sectionId" TEXT;
ALTER TABLE "Assessment" ADD COLUMN IF NOT EXISTS "teacherPartnerId" TEXT;
ALTER TABLE "Assessment" ADD COLUMN IF NOT EXISTS "sequence" INTEGER;
ALTER TABLE "Assessment" ADD COLUMN IF NOT EXISTS "lockedById" TEXT;
ALTER TABLE "Assessment" ADD COLUMN IF NOT EXISTS "isResit" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Assessment_organizationId_termId_kind_idx"
  ON "Assessment"("organizationId", "termId", "kind");
CREATE INDEX IF NOT EXISTS "Assessment_organizationId_teacherPartnerId_idx"
  ON "Assessment"("organizationId", "teacherPartnerId");
