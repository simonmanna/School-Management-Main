-- Phase 2: promote the LMS-era CourseOffering into the canonical teaching context.
CREATE TYPE "CourseOfferingType" AS ENUM ('SUBJECT', 'LEARNING_AREA', 'COMPETENCY', 'SCHOOL_WIDE', 'CO_CURRICULAR', 'REMEDIAL', 'CLUB_OR_HOUSE');
CREATE TYPE "CourseOfferingAudienceScope" AS ENUM ('COHORT', 'SECTION', 'STREAM', 'CUSTOM', 'SCHOOL');
CREATE TYPE "CourseOfferingStatus" AS ENUM ('DRAFT', 'STAFFED', 'ROSTER_READY', 'PUBLISHED', 'ACTIVE', 'CLOSED', 'ARCHIVED');
CREATE TYPE "CourseOfferingTeacherRole" AS ENUM ('LEAD', 'CO_TEACHER', 'ASSISTANT', 'SUBSTITUTE');
CREATE TYPE "CourseEnrollmentSource" AS ENUM ('COMPULSORY', 'ELECTIVE', 'REMEDIAL', 'MANUAL', 'OPT_OUT');
CREATE TYPE "CourseEnrollmentStatus" AS ENUM ('ENROLLED', 'OPTED_OUT', 'WITHDRAWN');

ALTER TABLE "CourseOffering"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "name" TEXT,
  ADD COLUMN "programmeId" TEXT,
  ADD COLUMN "classCohortId" TEXT,
  ADD COLUMN "offeringType" "CourseOfferingType" NOT NULL DEFAULT 'SUBJECT',
  ADD COLUMN "audienceScope" "CourseOfferingAudienceScope" NOT NULL DEFAULT 'COHORT',
  ADD COLUMN "streamId" TEXT,
  ADD COLUMN "competencyId" TEXT,
  ADD COLUMN "activityDefinitionId" TEXT,
  ADD COLUMN "effectiveFrom" TIMESTAMP(3),
  ADD COLUMN "effectiveTo" TIMESTAMP(3);

UPDATE "CourseOffering" co
SET
  "code" = 'LEGACY-' || upper(substr(replace(co."id", '-', ''), 1, 12)),
  "name" = concat_ws(' - ', s."name", c."name"),
  "effectiveFrom" = co."startDate"
FROM "Subject" s, "SchoolClass" c
WHERE s."id" = co."subjectId" AND c."id" = co."classId";

UPDATE "CourseOffering"
SET "name" = COALESCE("name", "code", 'Legacy offering'),
    "code" = COALESCE("code", 'LEGACY-' || upper(substr(replace("id", '-', ''), 1, 12))),
    "effectiveFrom" = COALESCE("effectiveFrom", "createdAt");

ALTER TABLE "CourseOffering"
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "code" SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "name" SET DEFAULT 'Course offering',
  ALTER COLUMN "effectiveFrom" SET NOT NULL,
  ALTER COLUMN "effectiveFrom" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "subjectId" DROP NOT NULL,
  ALTER COLUMN "classId" DROP NOT NULL,
  ALTER COLUMN "curriculumId" DROP NOT NULL;

ALTER TABLE "CourseOffering" ALTER COLUMN "status" DROP DEFAULT;
UPDATE "CourseOffering" SET "status" = CASE lower("status") WHEN 'active' THEN 'ACTIVE' WHEN 'archived' THEN 'ARCHIVED' ELSE 'DRAFT' END;
ALTER TABLE "CourseOffering" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "CourseOfferingTeacher" ALTER COLUMN "role" DROP DEFAULT;
UPDATE "CourseOfferingTeacher" SET "role" = CASE lower(COALESCE("role", 'lead')) WHEN 'assistant' THEN 'ASSISTANT' ELSE 'LEAD' END;
ALTER TABLE "CourseOfferingTeacher" ALTER COLUMN "role" SET NOT NULL;
ALTER TABLE "CourseOfferingTeacher" ALTER COLUMN "role" SET DEFAULT 'LEAD';
ALTER TABLE "CourseOfferingTeacher"
  ADD COLUMN "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "effectiveTo" TIMESTAMP(3),
  ADD COLUMN "isResponsible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "replacedTeacherId" TEXT;
UPDATE "CourseOfferingTeacher" SET "isResponsible" = true WHERE "role" = 'LEAD';

DROP INDEX IF EXISTS "CourseOffering_org_ay_term_subj_class_section_key";
DROP INDEX IF EXISTS "CourseOffering_organizationId_academicYearId_termId_subject_key";
CREATE UNIQUE INDEX "CourseOffering_organizationId_code_key" ON "CourseOffering"("organizationId", "code");
CREATE INDEX "CourseOffering_organizationId_status_idx" ON "CourseOffering"("organizationId", "status");
CREATE INDEX "CourseOffering_academicYearId_idx" ON "CourseOffering"("academicYearId");
CREATE INDEX "CourseOffering_programmeId_idx" ON "CourseOffering"("programmeId");
CREATE INDEX "CourseOffering_classCohortId_idx" ON "CourseOffering"("classCohortId");

ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "AcademicProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_classCohortId_fkey" FOREIGN KEY ("classCohortId") REFERENCES "ClassCohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_curriculumId_fkey" FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_activityDefinitionId_fkey" FOREIGN KEY ("activityDefinitionId") REFERENCES "LearningActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CourseEnrollment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "courseOfferingId" TEXT NOT NULL,
  "studentEnrollmentId" TEXT NOT NULL,
  "source" "CourseEnrollmentSource" NOT NULL,
  "status" "CourseEnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "withdrawalReason" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CourseEnrollment_courseOfferingId_studentEnrollmentId_key" ON "CourseEnrollment"("courseOfferingId", "studentEnrollmentId");
CREATE INDEX "CourseEnrollment_organizationId_idx" ON "CourseEnrollment"("organizationId");
CREATE INDEX "CourseEnrollment_organizationId_status_idx" ON "CourseEnrollment"("organizationId", "status");
CREATE INDEX "CourseEnrollment_studentEnrollmentId_idx" ON "CourseEnrollment"("studentEnrollmentId");
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_studentEnrollmentId_fkey" FOREIGN KEY ("studentEnrollmentId") REFERENCES "StudentEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CourseEnrollment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CourseEnrollment"
  USING ("organizationId" = current_setting('app.org_id', true));
