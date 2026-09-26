-- ADR-031: school-configurable result / access policies (Wave 13).
CREATE TYPE "ResultAbsencePolicy" AS ENUM ('ABSENT_AS_ZERO', 'ABSENT_BLOCKS', 'ALL_BLOCK');
CREATE TYPE "ClassTeacherScope" AS ENUM ('STREAM', 'CLASS');
CREATE TYPE "BandRounding" AS ENUM ('none', 'half_up_integer');
CREATE TYPE "AssessmentContribution" AS ENUM ('formative', 'summative');

ALTER TABLE "SchoolProfile"
  ADD COLUMN "resultAbsencePolicy" "ResultAbsencePolicy" NOT NULL DEFAULT 'ABSENT_AS_ZERO',
  ADD COLUMN "classTeacherScope" "ClassTeacherScope" NOT NULL DEFAULT 'STREAM';

ALTER TABLE "GradingScale"
  ADD COLUMN "system" TEXT,
  ADD COLUMN "bandRounding" "BandRounding" NOT NULL DEFAULT 'none';

-- A scale's system was only ever implied by its name.
UPDATE "GradingScale" SET "system" = CASE
  WHEN "name" ILIKE '%ECD%' OR "name" ILIKE '%nursery%' THEN 'ECD'
  WHEN "name" ILIKE '%UACE%' THEN 'UACE'
  WHEN "name" ILIKE '%UCE%' THEN 'UCE'
  WHEN "name" ILIKE '%PLE%' THEN 'PLE'
  WHEN "name" ILIKE '%CBC%' THEN 'CBC'
  ELSE NULL END;

ALTER TABLE "AssessmentPolicy" ADD COLUMN "programmeId" TEXT;
CREATE INDEX "AssessmentPolicy_organizationId_programmeId_idx" ON "AssessmentPolicy"("organizationId", "programmeId");

ALTER TABLE "Assessment" ADD COLUMN "contribution" "AssessmentContribution" NOT NULL DEFAULT 'summative';
-- The wizard described a component-less teacher assessment as formative; it now is.
UPDATE "Assessment" SET "contribution" = 'formative'
 WHERE "componentId" IS NULL AND "sourceType" <> 'exam_session';
