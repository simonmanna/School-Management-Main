-- Reusable course templates, and a cover image for a course (ADR-034).
--
-- Additive only: nothing is dropped and no existing row changes. The spec this
-- came from wanted a `Course` entity between `Subject` and `CourseOffering`; we
-- did not add one, because CourseOffering already carries the course identity
-- and Curriculum/CurriculumSubject/Topic/Unit already is the year-independent
-- per-grade layer. What was missing was REUSE — a teacher rebuilding the same
-- fourteen weeks every January — so a template is a named, structure-only
-- course bundle (the JSON `CourseBackupService.export` already produced for
-- rollover), never a second source of course naming.

-- 1. Course tile image. A file in the LMS area rather than a URL, so a picture
--    a teacher uploads obeys the same ACL as the rest of the course content.
ALTER TABLE "CourseOffering" ADD COLUMN IF NOT EXISTS "coverImageFileId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CourseOffering_coverImageFileId_fkey'
  ) THEN
    ALTER TABLE "CourseOffering"
      ADD CONSTRAINT "CourseOffering_coverImageFileId_fkey"
      FOREIGN KEY ("coverImageFileId") REFERENCES "File"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. The template.
CREATE TABLE IF NOT EXISTS "LmsCourseTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subjectId" TEXT,
    "gradeLevelId" TEXT,
    "academicLevelId" TEXT,
    "coverImageFileId" TEXT,
    "bundle" JSONB NOT NULL,
    "sectionCount" INTEGER NOT NULL DEFAULT 0,
    "moduleCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "LmsCourseTemplate_pkey" PRIMARY KEY ("id")
);

-- `code` is the operator-facing identity, so a seed can be re-run without
-- making a second copy of the same template.
CREATE UNIQUE INDEX IF NOT EXISTS "LmsCourseTemplate_organizationId_code_key"
    ON "LmsCourseTemplate"("organizationId", "code");
CREATE INDEX IF NOT EXISTS "LmsCourseTemplate_organizationId_idx"
    ON "LmsCourseTemplate"("organizationId");
CREATE INDEX IF NOT EXISTS "LmsCourseTemplate_organizationId_subjectId_idx"
    ON "LmsCourseTemplate"("organizationId", "subjectId");
CREATE INDEX IF NOT EXISTS "LmsCourseTemplate_organizationId_gradeLevelId_idx"
    ON "LmsCourseTemplate"("organizationId", "gradeLevelId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LmsCourseTemplate_subjectId_fkey') THEN
    ALTER TABLE "LmsCourseTemplate" ADD CONSTRAINT "LmsCourseTemplate_subjectId_fkey"
      FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LmsCourseTemplate_gradeLevelId_fkey') THEN
    ALTER TABLE "LmsCourseTemplate" ADD CONSTRAINT "LmsCourseTemplate_gradeLevelId_fkey"
      FOREIGN KEY ("gradeLevelId") REFERENCES "GradeLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LmsCourseTemplate_academicLevelId_fkey') THEN
    ALTER TABLE "LmsCourseTemplate" ADD CONSTRAINT "LmsCourseTemplate_academicLevelId_fkey"
      FOREIGN KEY ("academicLevelId") REFERENCES "AcademicLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LmsCourseTemplate_coverImageFileId_fkey') THEN
    ALTER TABLE "LmsCourseTemplate" ADD CONSTRAINT "LmsCourseTemplate_coverImageFileId_fkey"
      FOREIGN KEY ("coverImageFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. Tenant isolation.
--
-- Same shape as 20260812120001_school_rls: create the policy and FORCE ROW
-- LEVEL SECURITY, but deliberately do NOT `ENABLE ROW LEVEL SECURITY`. In this
-- deployment RLS is inert and isolation is enforced by the app-side Prisma
-- tenancy extension; the policy lies dormant until an operator turns RLS on
-- org-wide via `pnpm rls:setup-role`.
--
-- The matching app-side registration is in ORG_SCOPED and SOFT_DELETE
-- (apps/api/src/kernel/prisma/tenancy.extension.ts) and is verified against the
-- schema by tenancy-registration.spec.ts.
ALTER TABLE "LmsCourseTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LmsCourseTemplate";
CREATE POLICY tenant_isolation ON "LmsCourseTemplate"
    USING ("organizationId" = current_setting('app.org_id', true));
