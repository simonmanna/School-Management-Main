-- Stream → Section convergence: schema only (ADR-029).
--
-- Additive. The conversion itself runs as application code
-- (StreamConvergenceService) because ADR-027 requires it to be dry-run by
-- default, run-id tagged and exception-queued, none of which SQL can give
-- cleanly. Nothing here moves a learner.

-- ── Section provenance ───────────────────────────────────────────────────────
ALTER TABLE "Section"
  ADD COLUMN IF NOT EXISTS "legacyStreamId"        TEXT,
  ADD COLUMN IF NOT EXISTS "legacyParentSectionId" TEXT,
  ADD COLUMN IF NOT EXISTS "isSynthesized"         BOOLEAN NOT NULL DEFAULT false;

-- ── ClassCohort: frozen mode and the boolean that replaces GroupingMode ──────
ALTER TABLE "ClassCohort"
  ADD COLUMN IF NOT EXISTS "resolvedGroupingMode" "GroupingMode",
  ADD COLUMN IF NOT EXISTS "allowsSubdivision"    BOOLEAN;

-- ── The permanent convergence ledger ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StreamSectionMigrationMap" (
    "id"              TEXT NOT NULL,
    "organizationId"  TEXT NOT NULL,
    "migrationRunId"  TEXT NOT NULL,
    "streamId"        TEXT NOT NULL,
    "sourceKey"       TEXT NOT NULL,
    "sourceSectionId" TEXT,
    "targetSectionId" TEXT,
    "disposition"     TEXT NOT NULL,
    "streamName"      TEXT NOT NULL,
    "classId"         TEXT NOT NULL,
    "touched"         JSONB NOT NULL DEFAULT '{}',
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamSectionMigrationMap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StreamSectionMigrationMap_organizationId_streamId_sourceKey_key"
    ON "StreamSectionMigrationMap"("organizationId", "streamId", "sourceKey");
CREATE INDEX IF NOT EXISTS "StreamSectionMigrationMap_organizationId_idx"
    ON "StreamSectionMigrationMap"("organizationId");
CREATE INDEX IF NOT EXISTS "StreamSectionMigrationMap_migrationRunId_idx"
    ON "StreamSectionMigrationMap"("migrationRunId");

-- Same shape as every other school table: FORCE, never bare ENABLE. RLS is inert
-- in this deployment and isolation is enforced app-side; the policy waits for
-- `pnpm rls:setup-role`. The table is also registered in ORG_SCOPED.
DO $$ BEGIN
  EXECUTE 'ALTER TABLE "StreamSectionMigrationMap" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "StreamSectionMigrationMap"';
  EXECUTE 'CREATE POLICY tenant_isolation ON "StreamSectionMigrationMap" USING ("organizationId" = current_setting(''app.org_id'', true))';
END $$;

-- ── allowsSubdivision seeded from the mode the cohort already runs ───────────
-- NONE means undivided; every other mode subdivides. Only rows that carry an
-- explicit override get one; NULL keeps "inherit from the class".
UPDATE "ClassCohort"
   SET "allowsSubdivision" = ("groupingMode" <> 'NONE')
 WHERE "groupingMode" IS NOT NULL AND "allowsSubdivision" IS NULL;

-- A class whose cohorts all run NONE is not subdivided. Leave every other class
-- at the default (true): switching a class off while it has sections is refused
-- by the service, and doing it here silently would strand learners.
UPDATE "SchoolClass" c
   SET "allowsStreams" = false
 WHERE c."allowsStreams" = true
   AND EXISTS (SELECT 1 FROM "ClassCohort" cc WHERE cc."classId" = c."id")
   AND NOT EXISTS (
     SELECT 1 FROM "ClassCohort" cc
      LEFT JOIN "AcademicProgramme" p ON p."id" = cc."programmeId"
      WHERE cc."classId" = c."id"
        AND COALESCE(cc."groupingMode", p."groupingMode", 'SECTION_ONLY') <> 'NONE')
   AND NOT EXISTS (SELECT 1 FROM "Section" s WHERE s."classId" = c."id" AND s."deletedAt" IS NULL);
