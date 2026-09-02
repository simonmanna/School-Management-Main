-- CreateEnum
CREATE TYPE "ProgrammeStage" AS ENUM ('PRIMARY_LOWER', 'PRIMARY_UPPER', 'LOWER_SECONDARY', 'ADVANCED_SECONDARY', 'OTHER');

-- CreateEnum
CREATE TYPE "GroupingMode" AS ENUM ('NONE', 'SECTION_ONLY', 'STREAM_ONLY', 'SECTION_AND_STREAM');

-- CreateEnum
CREATE TYPE "StudentEnrollmentStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'WITHDRAWN', 'TRANSFERRED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EnrollmentType" AS ENUM ('NEW', 'CONTINUING', 'REPEAT', 'TRANSFER_IN', 'RE_ENTRY');

-- CreateEnum
CREATE TYPE "PlacementMovementReason" AS ENUM ('INITIAL_PLACEMENT', 'TERM_ROLLOVER', 'CLASS_CHANGE', 'SECTION_CHANGE', 'STREAM_CHANGE', 'PROMOTION', 'REPEAT', 'LATE_ADMISSION', 'TRANSFER_IN', 'TRANSFER_OUT', 'WITHDRAWAL', 'RE_ENTRY', 'SUSPENSION', 'COMPLETION', 'CORRECTION', 'BACKFILL');

-- CreateEnum
CREATE TYPE "ClassCohortStatus" AS ENUM ('PLANNED', 'ACTIVE', 'CLOSED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Stream" ADD COLUMN     "sectionId" TEXT;

-- CreateTable
CREATE TABLE "AcademicProgramme" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" "ProgrammeStage" NOT NULL DEFAULT 'OTHER',
    "curriculumAuthority" TEXT,
    "groupingMode" "GroupingMode" NOT NULL DEFAULT 'SECTION_ONLY',
    "description" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AcademicProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgrammeGradeLevel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "gradeLevelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgrammeGradeLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassCohort" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "programmeId" TEXT,
    "groupingMode" "GroupingMode",
    "capacity" INTEGER,
    "status" "ClassCohortStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ClassCohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "gradeLevelId" TEXT NOT NULL,
    "admissionDate" TIMESTAMP(3) NOT NULL,
    "completionDate" TIMESTAMP(3),
    "status" "StudentEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrollmentType" "EnrollmentType" NOT NULL DEFAULT 'NEW',
    "legacyEnrollmentId" TEXT,
    "migrationRunId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "StudentEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentPlacement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classCohortId" TEXT NOT NULL,
    "sectionId" TEXT,
    "streamId" TEXT,
    "rollNumber" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "movementReason" "PlacementMovementReason" NOT NULL DEFAULT 'INITIAL_PLACEMENT',
    "endReason" "PlacementMovementReason",
    "notes" TEXT,
    "changedById" TEXT,
    "migrationRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrollmentPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentEnrollmentEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "fromStatus" "StudentEnrollmentStatus",
    "toStatus" "StudentEnrollmentStatus" NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "requestId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentEnrollmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicMigrationException" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "migrationRunId" TEXT NOT NULL,
    "sourceEntity" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicMigrationException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcademicProgramme_organizationId_idx" ON "AcademicProgramme"("organizationId");

-- CreateIndex
CREATE INDEX "AcademicProgramme_organizationId_stage_idx" ON "AcademicProgramme"("organizationId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicProgramme_organizationId_code_key" ON "AcademicProgramme"("organizationId", "code");

-- CreateIndex
CREATE INDEX "ProgrammeGradeLevel_organizationId_idx" ON "ProgrammeGradeLevel"("organizationId");

-- CreateIndex
CREATE INDEX "ProgrammeGradeLevel_programmeId_idx" ON "ProgrammeGradeLevel"("programmeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgrammeGradeLevel_organizationId_programmeId_gradeLevelId_key" ON "ProgrammeGradeLevel"("organizationId", "programmeId", "gradeLevelId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgrammeGradeLevel_organizationId_gradeLevelId_key" ON "ProgrammeGradeLevel"("organizationId", "gradeLevelId");

-- CreateIndex
CREATE INDEX "ClassCohort_organizationId_idx" ON "ClassCohort"("organizationId");

-- CreateIndex
CREATE INDEX "ClassCohort_academicYearId_idx" ON "ClassCohort"("academicYearId");

-- CreateIndex
CREATE INDEX "ClassCohort_classId_idx" ON "ClassCohort"("classId");

-- CreateIndex
CREATE INDEX "ClassCohort_programmeId_idx" ON "ClassCohort"("programmeId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassCohort_organizationId_academicYearId_classId_key" ON "ClassCohort"("organizationId", "academicYearId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentEnrollment_legacyEnrollmentId_key" ON "StudentEnrollment"("legacyEnrollmentId");

-- CreateIndex
CREATE INDEX "StudentEnrollment_organizationId_idx" ON "StudentEnrollment"("organizationId");

-- CreateIndex
CREATE INDEX "StudentEnrollment_organizationId_status_idx" ON "StudentEnrollment"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StudentEnrollment_studentProfileId_idx" ON "StudentEnrollment"("studentProfileId");

-- CreateIndex
CREATE INDEX "StudentEnrollment_academicYearId_idx" ON "StudentEnrollment"("academicYearId");

-- CreateIndex
CREATE INDEX "StudentEnrollment_programmeId_idx" ON "StudentEnrollment"("programmeId");

-- CreateIndex
CREATE INDEX "StudentEnrollment_gradeLevelId_idx" ON "StudentEnrollment"("gradeLevelId");

-- CreateIndex
CREATE INDEX "StudentEnrollment_migrationRunId_idx" ON "StudentEnrollment"("migrationRunId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentEnrollment_organizationId_studentProfileId_academicY_key" ON "StudentEnrollment"("organizationId", "studentProfileId", "academicYearId");

-- CreateIndex
CREATE INDEX "EnrollmentPlacement_organizationId_idx" ON "EnrollmentPlacement"("organizationId");

-- CreateIndex
CREATE INDEX "EnrollmentPlacement_enrollmentId_idx" ON "EnrollmentPlacement"("enrollmentId");

-- CreateIndex
CREATE INDEX "EnrollmentPlacement_termId_idx" ON "EnrollmentPlacement"("termId");

-- CreateIndex
CREATE INDEX "EnrollmentPlacement_classCohortId_idx" ON "EnrollmentPlacement"("classCohortId");

-- CreateIndex
CREATE INDEX "EnrollmentPlacement_sectionId_idx" ON "EnrollmentPlacement"("sectionId");

-- CreateIndex
CREATE INDEX "EnrollmentPlacement_streamId_idx" ON "EnrollmentPlacement"("streamId");

-- CreateIndex
CREATE INDEX "EnrollmentPlacement_organizationId_effectiveFrom_idx" ON "EnrollmentPlacement"("organizationId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "EnrollmentPlacement_migrationRunId_idx" ON "EnrollmentPlacement"("migrationRunId");

-- CreateIndex
CREATE INDEX "StudentEnrollmentEvent_organizationId_idx" ON "StudentEnrollmentEvent"("organizationId");

-- CreateIndex
CREATE INDEX "StudentEnrollmentEvent_enrollmentId_idx" ON "StudentEnrollmentEvent"("enrollmentId");

-- CreateIndex
CREATE INDEX "AcademicMigrationException_organizationId_idx" ON "AcademicMigrationException"("organizationId");

-- CreateIndex
CREATE INDEX "AcademicMigrationException_migrationRunId_idx" ON "AcademicMigrationException"("migrationRunId");

-- CreateIndex
CREATE INDEX "AcademicMigrationException_organizationId_resolvedAt_idx" ON "AcademicMigrationException"("organizationId", "resolvedAt");

-- AddForeignKey
ALTER TABLE "SchoolClass" ADD CONSTRAINT "SchoolClass_homeroomTeacherId_fkey" FOREIGN KEY ("homeroomTeacherId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammeGradeLevel" ADD CONSTRAINT "ProgrammeGradeLevel_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "AcademicProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammeGradeLevel" ADD CONSTRAINT "ProgrammeGradeLevel_gradeLevelId_fkey" FOREIGN KEY ("gradeLevelId") REFERENCES "GradeLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassCohort" ADD CONSTRAINT "ClassCohort_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassCohort" ADD CONSTRAINT "ClassCohort_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassCohort" ADD CONSTRAINT "ClassCohort_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "AcademicProgramme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_studentProfileId_fkey" FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "AcademicProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEnrollment" ADD CONSTRAINT "StudentEnrollment_gradeLevelId_fkey" FOREIGN KEY ("gradeLevelId") REFERENCES "GradeLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentPlacement" ADD CONSTRAINT "EnrollmentPlacement_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "StudentEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentPlacement" ADD CONSTRAINT "EnrollmentPlacement_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentPlacement" ADD CONSTRAINT "EnrollmentPlacement_classCohortId_fkey" FOREIGN KEY ("classCohortId") REFERENCES "ClassCohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentPlacement" ADD CONSTRAINT "EnrollmentPlacement_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentPlacement" ADD CONSTRAINT "EnrollmentPlacement_streamId_fkey" FOREIGN KEY ("streamId") REFERENCES "Stream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentEnrollmentEvent" ADD CONSTRAINT "StudentEnrollmentEvent_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "StudentEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill provenance: the legacy `Enrollment` row a placement came from.
ALTER TABLE "EnrollmentPlacement" ADD COLUMN IF NOT EXISTS "legacyEnrollmentId" TEXT;
DROP INDEX IF EXISTS "EnrollmentPlacement_legacyEnrollmentId_key";
CREATE UNIQUE INDEX "EnrollmentPlacement_legacyEnrollmentId_key" ON "EnrollmentPlacement"("legacyEnrollmentId");

-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 1 integrity guardrails (ADR-018 / ADR-019).
--
-- Prisma cannot express these, so they live as raw DDL. They are deliberately
-- redundant with the service-layer validation: the exit gate is "no duplicate
-- active placement", and a rule that exists only in application code is one
-- bad script away from being false.
-- ═══════════════════════════════════════════════════════════════════════════

-- A placement may not end before it starts.
ALTER TABLE "EnrollmentPlacement"
  DROP CONSTRAINT IF EXISTS "EnrollmentPlacement_period_ck";
ALTER TABLE "EnrollmentPlacement"
  ADD CONSTRAINT "EnrollmentPlacement_period_ck"
  CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

-- An end reason only makes sense on a closed placement.
ALTER TABLE "EnrollmentPlacement"
  DROP CONSTRAINT IF EXISTS "EnrollmentPlacement_end_reason_ck";
ALTER TABLE "EnrollmentPlacement"
  ADD CONSTRAINT "EnrollmentPlacement_end_reason_ck"
  CHECK ("effectiveTo" IS NOT NULL OR "endReason" IS NULL);

-- Exactly one OPEN placement per enrollment. This is the invariant the whole
-- "where is this learner now?" projection rests on.
DROP INDEX IF EXISTS "EnrollmentPlacement_one_open_per_enrollment";
CREATE UNIQUE INDEX "EnrollmentPlacement_one_open_per_enrollment"
  ON "EnrollmentPlacement" ("enrollmentId")
  WHERE "effectiveTo" IS NULL;

-- No two placements for the same enrollment may cover the same instant. Ranges
-- are half-open, so a movement that closes one placement at exactly the moment
-- the next opens is accepted. Requires btree_gist; if the extension cannot be
-- installed the partial unique index above plus service validation still hold
-- the line for the open row, so we warn rather than fail the migration.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE "EnrollmentPlacement"
    DROP CONSTRAINT IF EXISTS "EnrollmentPlacement_no_overlap";
  ALTER TABLE "EnrollmentPlacement"
    ADD CONSTRAINT "EnrollmentPlacement_no_overlap"
    EXCLUDE USING gist (
      "enrollmentId" WITH =,
      tsrange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::timestamp)) WITH &&
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'EnrollmentPlacement_no_overlap not installed (%). Overlap prevention falls back to the partial unique index and service validation.', SQLERRM;
END $$;

-- ── ADR-019: a stream belongs to a section of the SAME class ────────────────
CREATE OR REPLACE FUNCTION school_stream_section_class_check() RETURNS trigger AS $$
DECLARE
  section_class TEXT;
BEGIN
  IF NEW."sectionId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "classId" INTO section_class FROM "Section" WHERE "id" = NEW."sectionId";
  IF section_class IS NULL THEN
    RAISE EXCEPTION 'Stream %: section % does not exist', NEW."id", NEW."sectionId";
  END IF;
  IF section_class <> NEW."classId" THEN
    RAISE EXCEPTION 'Stream %: section % belongs to class %, not class %',
      NEW."id", NEW."sectionId", section_class, NEW."classId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS school_stream_section_class_trg ON "Stream";
CREATE TRIGGER school_stream_section_class_trg
  BEFORE INSERT OR UPDATE OF "sectionId", "classId" ON "Stream"
  FOR EACH ROW EXECUTE FUNCTION school_stream_section_class_check();

-- ── ADR-019: a placement's section/stream must belong to the cohort's class ─
CREATE OR REPLACE FUNCTION school_placement_grouping_check() RETURNS trigger AS $$
DECLARE
  cohort_class  TEXT;
  section_class TEXT;
  stream_class  TEXT;
  stream_sect   TEXT;
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

  IF NEW."streamId" IS NOT NULL THEN
    SELECT "classId", "sectionId" INTO stream_class, stream_sect FROM "Stream" WHERE "id" = NEW."streamId";
    IF stream_class IS DISTINCT FROM cohort_class THEN
      RAISE EXCEPTION 'EnrollmentPlacement %: stream % is not in the cohort class %', NEW."id", NEW."streamId", cohort_class;
    END IF;
    IF stream_sect IS NOT NULL AND stream_sect IS DISTINCT FROM NEW."sectionId" THEN
      RAISE EXCEPTION 'EnrollmentPlacement %: stream % belongs to section %, but the placement selected section %',
        NEW."id", NEW."streamId", stream_sect, COALESCE(NEW."sectionId", 'none');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS school_placement_grouping_trg ON "EnrollmentPlacement";
CREATE TRIGGER school_placement_grouping_trg
  BEFORE INSERT OR UPDATE OF "classCohortId", "sectionId", "streamId" ON "EnrollmentPlacement"
  FOR EACH ROW EXECUTE FUNCTION school_placement_grouping_check();
