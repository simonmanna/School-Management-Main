-- Retire the legacy academic model (ADR-027, ADR-029, ADR-030).
--
-- Pre-launch: the system has not been deployed, so legacy rows are DROPPED, not
-- backfilled. What goes:
--   * Stream (a subdivision is a Section; terminology labels it "Stream")
--   * Enrollment / EnrollmentHistory (StudentEnrollment + EnrollmentPlacement)
--   * StudentProfile.currentClassId/currentSectionId/currentStreamId projections
--   * ProgrammeGradeLevel (AcademicLevel.defaultProgrammeId resolves programmes)
--   * GroupingMode (SchoolClass.allowsStreams + ClassCohort.allowsSubdivision)
--   * the Stream -> Section convergence ledger and provenance columns
-- What changes:
--   * capacity NULL = unlimited, and the default. The untouched legacy default
--     of 40 was never a decision anybody made, so it becomes NULL.
--   * SchoolProfile.capacityPolicy makes enforcement a per-school setting.
--   * StudentEnrollment.admissionApplicationId links an admission to the
--     enrollment it produced (was the legacy Enrollment.applicationId).

-- ── Data preparation, before any constraint changes ─────────────────────────

-- STREAM audiences become SECTION (or COHORT when no section was named).
UPDATE "CourseOffering" SET "audienceScope" = 'SECTION'
 WHERE "audienceScope"::text = 'STREAM' AND "sectionId" IS NOT NULL;
UPDATE "CourseOffering" SET "audienceScope" = 'COHORT'
 WHERE "audienceScope"::text = 'STREAM';

-- Rows that differed only by streamId would collide once it is gone.
DELETE FROM "TeacherAssignment" t USING "TeacherAssignment" k
 WHERE t."organizationId" = k."organizationId"
   AND t."teacherPartnerId" = k."teacherPartnerId"
   AND t."subjectId" = k."subjectId"
   AND t."classId" = k."classId"
   AND t."sectionId" IS NOT DISTINCT FROM k."sectionId"
   AND t."termId" IS NOT DISTINCT FROM k."termId"
   AND (t."streamId" IS NOT NULL AND (k."streamId" IS NULL OR t.id > k.id));
DELETE FROM "AdmissionCapacity" t USING "AdmissionCapacity" k
 WHERE t."organizationId" = k."organizationId"
   AND t."admissionCycleId" = k."admissionCycleId"
   AND t."classId" = k."classId"
   AND t."sectionId" IS NOT DISTINCT FROM k."sectionId"
   AND (t."streamId" IS NOT NULL AND (k."streamId" IS NULL OR t.id > k.id));

-- Untouched default capacity 40 -> unlimited.
UPDATE "SchoolClass" SET "capacity" = NULL WHERE "capacity" = 40;
UPDATE "Section"     SET "capacity" = NULL WHERE "capacity" = 40;
UPDATE "ClassCohort" SET "capacity" = NULL WHERE "capacity" = 40;

-- ── Schema ──────────────────────────────────────────────────────────────────

-- The placement grouping trigger read streamId; re-create it on sectionId alone
-- before the column goes. The Stream trigger goes with its table.
CREATE OR REPLACE FUNCTION school_placement_grouping_check() RETURNS trigger AS $$
DECLARE
  cohort_class  TEXT;
  section_class TEXT;
BEGIN
  SELECT "classId" INTO cohort_class FROM "ClassCohort" WHERE "id" = NEW."classCohortId";
  IF cohort_class IS NULL THEN
    RAISE EXCEPTION 'EnrollmentPlacement %: class cohort % does not exist', NEW."id", NEW."classCohortId";
  END IF;

  IF NEW."sectionId" IS NOT NULL THEN
    SELECT "classId" INTO section_class FROM "Section" WHERE "id" = NEW."sectionId";
    IF section_class IS DISTINCT FROM cohort_class THEN
      RAISE EXCEPTION 'EnrollmentPlacement %: section % is not in the cohort class %', NEW."id", NEW."sectionId", cohort_class;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS school_placement_grouping_trg ON "EnrollmentPlacement";
CREATE TRIGGER school_placement_grouping_trg
  BEFORE INSERT OR UPDATE OF "classCohortId", "sectionId" ON "EnrollmentPlacement"
  FOR EACH ROW EXECUTE FUNCTION school_placement_grouping_check();

DROP TRIGGER IF EXISTS school_stream_section_class_trg ON "Stream";
DROP FUNCTION IF EXISTS school_stream_section_class_check();

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CapacityPolicy" AS ENUM ('ENFORCE', 'WARN', 'OFF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
DROP TYPE IF EXISTS "CourseOfferingAudienceScope_new";
CREATE TYPE "CourseOfferingAudienceScope_new" AS ENUM ('COHORT', 'SECTION', 'CUSTOM', 'SCHOOL');
ALTER TABLE "public"."CourseOffering" ALTER COLUMN "audienceScope" DROP DEFAULT;
ALTER TABLE "CourseOffering" ALTER COLUMN "audienceScope" TYPE "CourseOfferingAudienceScope_new" USING ("audienceScope"::text::"CourseOfferingAudienceScope_new");
ALTER TYPE "CourseOfferingAudienceScope" RENAME TO "CourseOfferingAudienceScope_old";
ALTER TYPE "CourseOfferingAudienceScope_new" RENAME TO "CourseOfferingAudienceScope";
DROP TYPE "public"."CourseOfferingAudienceScope_old";
ALTER TABLE "CourseOffering" ALTER COLUMN "audienceScope" SET DEFAULT 'COHORT';

-- DropForeignKey
ALTER TABLE "CourseOffering" DROP CONSTRAINT "CourseOffering_streamId_fkey";

-- DropForeignKey
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_classId_fkey";

-- DropForeignKey
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_sectionId_fkey";

-- DropForeignKey
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_streamId_fkey";

-- DropForeignKey
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_studentProfileId_fkey";

-- DropForeignKey
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_termId_fkey";

-- DropForeignKey
ALTER TABLE "EnrollmentHistory" DROP CONSTRAINT "EnrollmentHistory_enrollmentId_fkey";

-- DropForeignKey
ALTER TABLE "EnrollmentPlacement" DROP CONSTRAINT "EnrollmentPlacement_streamId_fkey";

-- DropForeignKey
ALTER TABLE "ProgrammeGradeLevel" DROP CONSTRAINT "ProgrammeGradeLevel_gradeLevelId_fkey";

-- DropForeignKey
ALTER TABLE "ProgrammeGradeLevel" DROP CONSTRAINT "ProgrammeGradeLevel_programmeId_fkey";

-- DropForeignKey
ALTER TABLE "Stream" DROP CONSTRAINT "Stream_classId_fkey";

-- DropForeignKey
ALTER TABLE "Stream" DROP CONSTRAINT "Stream_sectionId_fkey";

-- DropForeignKey
ALTER TABLE "StudentProfile" DROP CONSTRAINT "StudentProfile_currentClassId_fkey";

-- DropForeignKey
ALTER TABLE "StudentProfile" DROP CONSTRAINT "StudentProfile_currentSectionId_fkey";

-- DropForeignKey
ALTER TABLE "StudentProfile" DROP CONSTRAINT "StudentProfile_currentStreamId_fkey";

-- DropForeignKey
ALTER TABLE "TeacherAssignment" DROP CONSTRAINT "TeacherAssignment_streamId_fkey";

-- DropForeignKey
ALTER TABLE "TimetableSlot" DROP CONSTRAINT "TimetableSlot_streamId_fkey";

-- DropIndex
DROP INDEX "AdmissionCapacity_organizationId_admissionCycleId_classId_s_key";

-- DropIndex
DROP INDEX "EnrollmentPlacement_legacyEnrollmentId_key";

-- DropIndex
DROP INDEX "EnrollmentPlacement_streamId_idx";

-- DropIndex
DROP INDEX "StudentEnrollment_legacyEnrollmentId_key";

-- DropIndex
DROP INDEX "StudentProfile_currentClassId_idx";

-- DropIndex
DROP INDEX "StudentProfile_currentSectionId_idx";

-- DropIndex
DROP INDEX "StudentProfile_currentStreamId_idx";

-- DropIndex
DROP INDEX "TeacherAssignment_organizationId_teacherPartnerId_subjectId_key";

-- DropIndex
DROP INDEX "TeacherAssignment_streamId_idx";

-- DropIndex
DROP INDEX "TimetableSlot_streamId_idx";

-- AlterTable
ALTER TABLE "AcademicProgramme" DROP COLUMN "groupingMode";

-- AlterTable
ALTER TABLE "AdmissionCapacity" DROP COLUMN "streamId";

-- AlterTable
ALTER TABLE "ClassCohort" DROP COLUMN "groupingMode",
DROP COLUMN "resolvedGroupingMode";

-- AlterTable
ALTER TABLE "CourseOffering" DROP COLUMN "streamId";

-- AlterTable
ALTER TABLE "EnrollmentPlacement" DROP COLUMN "legacyEnrollmentId",
DROP COLUMN "streamId";

-- AlterTable
ALTER TABLE "ExamCandidateEntry" DROP COLUMN "streamId";

-- AlterTable
ALTER TABLE "PromotionDecision" DROP COLUMN "toStreamId";

-- AlterTable
ALTER TABLE "SchoolClass" ALTER COLUMN "capacity" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SchoolProfile" ADD COLUMN IF NOT EXISTS "capacityPolicy" "CapacityPolicy" NOT NULL DEFAULT 'ENFORCE';

-- AlterTable
ALTER TABLE "Section" DROP COLUMN "isSynthesized",
DROP COLUMN "legacyParentSectionId",
DROP COLUMN "legacyStreamId",
ALTER COLUMN "capacity" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StudentEnrollment" DROP COLUMN "legacyEnrollmentId",
ADD COLUMN     "admissionApplicationId" TEXT;

-- AlterTable
ALTER TABLE "StudentProfile" DROP COLUMN "currentClassId",
DROP COLUMN "currentSectionId",
DROP COLUMN "currentStreamId";

-- AlterTable
ALTER TABLE "TeacherAssignment" DROP COLUMN "streamId";

-- AlterTable
ALTER TABLE "TimetableSlot" DROP COLUMN "streamId";

-- DropTable
DROP TABLE "Enrollment";

-- DropTable
DROP TABLE "EnrollmentHistory";

-- DropTable
DROP TABLE "ProgrammeGradeLevel";

-- DropTable
DROP TABLE "Stream";

-- DropTable
DROP TABLE "StreamSectionMigrationMap";

-- DropEnum
DROP TYPE "GroupingMode";

-- CreateIndex
CREATE UNIQUE INDEX "AdmissionCapacity_organizationId_admissionCycleId_classId_s_key" ON "AdmissionCapacity"("organizationId", "admissionCycleId", "classId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentEnrollment_admissionApplicationId_key" ON "StudentEnrollment"("admissionApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherAssignment_organizationId_teacherPartnerId_subjectId_key" ON "TeacherAssignment"("organizationId", "teacherPartnerId", "subjectId", "classId", "sectionId", "termId");

-- AddForeignKey
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_admissionApplicationId_fkey" FOREIGN KEY ("admissionApplicationId") REFERENCES "AdmissionApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

