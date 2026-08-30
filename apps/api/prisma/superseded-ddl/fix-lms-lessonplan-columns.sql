-- ============================================================================
-- LMS · LessonPlan soft-delete / tenant-column reconciliation
-- ----------------------------------------------------------------------------
-- Context: the LMS module's Prisma schema declares `organizationId` and
-- `deletedAt` on the LessonPlan join tables, but the live `schooldb-planet`
-- tables were created from an older schema and were missing these columns.
-- Prisma's `lessonPlan.findMany({ include: ... })` SELECTs them, so every
-- GET /school/lp/lesson-plans returned HTTP 500 at runtime even though the
-- code compiled (schema-vs-DB drift — invisible to `tsc`).
--
-- This script makes the live DB match the schema. It is IDEMPOTENT — safe to
-- re-run (e.g. after `prisma generate`) and safe against rows already present.
--
-- Apply with:  npx prisma db execute --schema prisma/schema.prisma --file prisma/fix-lms-lessonplan-columns.sql
-- ============================================================================

-- ── LessonPlanObjective: missing BOTH organizationId and deletedAt ────────────
ALTER TABLE "LessonPlanObjective" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
-- Backfill tenant id from the parent LessonPlan (only where null).
UPDATE "LessonPlanObjective" o
   SET "organizationId" = lp."organizationId"
  FROM "LessonPlan" lp
 WHERE o."lessonPlanId" = lp.id
   AND o."organizationId" IS NULL;
CREATE INDEX IF NOT EXISTS "LessonPlanObjective_organizationId_idx"
  ON "LessonPlanObjective" ("organizationId");
ALTER TABLE "LessonPlanObjective" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;

-- ── Remaining 6 LessonPlan join tables: missing deletedAt ─────────────────────
ALTER TABLE "LessonPlanActivity"        ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;
ALTER TABLE "LessonPlanResource"        ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;
ALTER TABLE "LessonPlanAssessment"      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;
ALTER TABLE "LessonPlanDifferentiation" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;
ALTER TABLE "LessonPlanReflection"      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;
ALTER TABLE "LessonPlanReview"          ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP;

-- ============================================================================
-- NOTE — other column drift found by the same audit (NOT LMS, pre-existing):
--   HrPosition.gradeId?
--   WaiverCategory.createdBy?, WaiverCategory.updatedBy?
--   MealMenuItem.posMenuItemId?
-- These belong to other modules and are out of scope for this LMS fix. Fix them
-- with their own idempotent ALTER scripts / migrations.
-- ============================================================================
