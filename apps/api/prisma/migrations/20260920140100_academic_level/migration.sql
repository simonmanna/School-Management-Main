-- AcademicLevel: the band above a grade (ADR-028, brief para 4).
--
-- Additive. `GradeLevel.academicLevelId` is nullable here and stays nullable
-- until every tenant's grades have a band and the exception queue is drained;
-- only then does it become NOT NULL (Phase 8).
--
-- The backfill in 20260920140200 creates one level per AcademicProgramme that
-- actually bands grade levels, so no school loses a distinction it already made.

CREATE TABLE IF NOT EXISTS "AcademicLevel" (
    "id"                 TEXT NOT NULL,
    "organizationId"     TEXT NOT NULL,
    "name"               TEXT NOT NULL,
    "code"               TEXT NOT NULL,
    "description"        TEXT,
    "displayOrder"       INTEGER NOT NULL DEFAULT 0,
    "isActive"           BOOLEAN NOT NULL DEFAULT true,
    "stage"              "ProgrammeStage" NOT NULL DEFAULT 'OTHER',
    "defaultProgrammeId" TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    "createdBy"          TEXT,
    "updatedBy"          TEXT,
    "deletedAt"          TIMESTAMP(3),

    CONSTRAINT "AcademicLevel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AcademicLevel_organizationId_code_key"
    ON "AcademicLevel"("organizationId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "AcademicLevel_organizationId_name_key"
    ON "AcademicLevel"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "AcademicLevel_organizationId_idx"
    ON "AcademicLevel"("organizationId");
CREATE INDEX IF NOT EXISTS "AcademicLevel_organizationId_isActive_displayOrder_idx"
    ON "AcademicLevel"("organizationId", "isActive", "displayOrder");
CREATE INDEX IF NOT EXISTS "AcademicLevel_defaultProgrammeId_idx"
    ON "AcademicLevel"("defaultProgrammeId");

DO $$ BEGIN
  ALTER TABLE "AcademicLevel"
    ADD CONSTRAINT "AcademicLevel_defaultProgrammeId_fkey"
    FOREIGN KEY ("defaultProgrammeId") REFERENCES "AcademicProgramme"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- GradeLevel joins its band.
--
-- ON DELETE RESTRICT, not SET NULL: silently unbanding every grade because
-- somebody removed a level is how a structure screen ends up with an
-- "Unassigned" bucket nobody can explain. The level's own delete guard refuses
-- the removal instead.
ALTER TABLE "GradeLevel"
  ADD COLUMN IF NOT EXISTS "academicLevelId" TEXT;

CREATE INDEX IF NOT EXISTS "GradeLevel_academicLevelId_idx"
    ON "GradeLevel"("academicLevelId");

DO $$ BEGIN
  ALTER TABLE "GradeLevel"
    ADD CONSTRAINT "GradeLevel_academicLevelId_fkey"
    FOREIGN KEY ("academicLevelId") REFERENCES "AcademicLevel"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
