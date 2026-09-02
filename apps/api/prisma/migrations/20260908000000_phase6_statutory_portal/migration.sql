-- Phase 6 — statutory workflows, candidate references and academic reminders.
-- Additive only. Nothing existing changes meaning: the new permission grants are
-- backfilled onto roles that already hold the closest equivalent authority, so
-- no administrator loses a screen the morning after deploy.

-- ── enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "ExamReferenceStatus" AS ENUM ('provisional','registered','confirmed','withdrawn'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── candidate reference registry ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StudentExamReference" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "board" TEXT NOT NULL DEFAULT 'UNEB',
  "level" TEXT NOT NULL,
  "registrationYear" INTEGER NOT NULL,
  "centreNumber" TEXT,
  "candidateNumber" TEXT,
  "indexNumber" TEXT,
  "status" "ExamReferenceStatus" NOT NULL DEFAULT 'provisional',
  "verifiedAt" TIMESTAMP(3),
  "verifiedById" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "StudentExamReference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StudentExamReference_org_student_board_level_year_key"
  ON "StudentExamReference"("organizationId","studentProfileId","board","level","registrationYear");
CREATE UNIQUE INDEX IF NOT EXISTS "StudentExamReference_org_board_level_year_index_key"
  ON "StudentExamReference"("organizationId","board","level","registrationYear","indexNumber");
CREATE INDEX IF NOT EXISTS "StudentExamReference_organizationId_idx" ON "StudentExamReference"("organizationId");
CREATE INDEX IF NOT EXISTS "StudentExamReference_org_level_year_idx" ON "StudentExamReference"("organizationId","level","registrationYear");
CREATE INDEX IF NOT EXISTS "StudentExamReference_org_student_idx" ON "StudentExamReference"("organizationId","studentProfileId");

-- ── configurable statutory exports ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StatutoryExportTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "board" TEXT NOT NULL DEFAULT 'UNEB',
  "level" TEXT,
  "scope" TEXT NOT NULL DEFAULT 'uneb_ca',
  "programmeId" TEXT,
  "delimiter" TEXT NOT NULL DEFAULT ',',
  "includeHeader" BOOLEAN NOT NULL DEFAULT true,
  "columns" JSONB NOT NULL DEFAULT '[]',
  "version" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "StatutoryExportTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StatutoryExportTemplate_org_code_version_key"
  ON "StatutoryExportTemplate"("organizationId","code","version");
CREATE INDEX IF NOT EXISTS "StatutoryExportTemplate_organizationId_idx" ON "StatutoryExportTemplate"("organizationId");
CREATE INDEX IF NOT EXISTS "StatutoryExportTemplate_org_scope_active_idx" ON "StatutoryExportTemplate"("organizationId","scope","isActive");

CREATE TABLE IF NOT EXISTS "StatutoryExportRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL,
  "scope" TEXT NOT NULL,
  "academicYearId" TEXT,
  "termId" TEXT,
  "examId" TEXT,
  "programmeId" TEXT,
  "classIds" JSONB NOT NULL DEFAULT '[]',
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "checksum" TEXT NOT NULL,
  "warnings" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'generated',
  "submittedAt" TIMESTAMP(3),
  "submittedById" TEXT,
  "submissionReference" TEXT,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generatedById" TEXT,
  CONSTRAINT "StatutoryExportRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StatutoryExportRun_organizationId_idx" ON "StatutoryExportRun"("organizationId");
CREATE INDEX IF NOT EXISTS "StatutoryExportRun_org_scope_generatedAt_idx" ON "StatutoryExportRun"("organizationId","scope","generatedAt");
CREATE INDEX IF NOT EXISTS "StatutoryExportRun_templateId_idx" ON "StatutoryExportRun"("templateId");
DO $$ BEGIN
  ALTER TABLE "StatutoryExportRun"
    ADD CONSTRAINT "StatutoryExportRun_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "StatutoryExportTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── reminder ledger ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AcademicReminderLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "milestone" TEXT NOT NULL,
  "userId" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AcademicReminderLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AcademicReminderLog_org_kind_subject_milestone_user_key"
  ON "AcademicReminderLog"("organizationId","kind","subjectId","milestone","userId");
CREATE INDEX IF NOT EXISTS "AcademicReminderLog_org_kind_sentAt_idx" ON "AcademicReminderLog"("organizationId","kind","sentAt");

-- ── Phase 7: markbook and portal read paths ──────────────────────────────────
-- The markbook opens on (assessment, deleted, student) and the portal opens on
-- (student, approval, release). Both were index scans over the whole table on a
-- school with several terms of history.
--
-- These are plain CREATE INDEX, not CONCURRENTLY: Prisma runs a migration inside
-- a transaction and CONCURRENTLY cannot run in one. Each takes a brief ACCESS
-- EXCLUSIVE lock on StudentAssessment — seconds at school scale, but it is why
-- the pilot runbook puts the deploy window outside teaching hours. On a very
-- large tenant, build them by hand with CONCURRENTLY first; the IF NOT EXISTS
-- then makes this migration a no-op for them.
CREATE INDEX IF NOT EXISTS "StudentAssessment_assessment_student_idx"
  ON "StudentAssessment"("assessmentId","deletedAt","studentProfileId");
CREATE INDEX IF NOT EXISTS "StudentAssessment_student_approval_updated_idx"
  ON "StudentAssessment"("studentProfileId","approvalStatus","updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "StudentAssessment_org_term_approval_idx"
  ON "StudentAssessment"("organizationId","termId","approvalStatus");

-- ── permission backfill ──────────────────────────────────────────────────────
-- New grants are useless until a role carries them, and PermissionsGuard ANDs
-- its requirements: shipping them ungranted 403s every exam officer. Each new
-- grant is given to the roles that already hold the authority it splits out of.
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:statutory:read')
  WHERE NOT ('school:statutory:read' = ANY("permissions"))
    AND ('school:exams:operate' = ANY("permissions") OR 'school:exams:write' = ANY("permissions") OR 'school:results:publish' = ANY("permissions"));

UPDATE "Role" SET "permissions" = array_append("permissions", 'school:statutory:write')
  WHERE NOT ('school:statutory:write' = ANY("permissions"))
    AND ('school:exams:operate' = ANY("permissions") OR 'school:exams:write' = ANY("permissions"));

UPDATE "Role" SET "permissions" = array_append("permissions", 'school:statutory:export')
  WHERE NOT ('school:statutory:export' = ANY("permissions"))
    AND ('school:exams:operate' = ANY("permissions") OR 'school:results:publish' = ANY("permissions"));

UPDATE "Role" SET "permissions" = array_append("permissions", 'school:candidates:write')
  WHERE NOT ('school:candidates:write' = ANY("permissions"))
    AND ('school:exams:operate' = ANY("permissions") OR 'school:exams:write' = ANY("permissions"));

-- ── Phase 7: closing the open income routes ─────────────────────────────────
-- Every handler on /income and /income-heads was undecorated, and
-- PermissionsGuard fails OPEN on an undecorated handler, so any authenticated
-- account could create, edit, cancel or delete other-revenue records. They are
-- now gated on the `income:*` grants the catalogue already defined — which
-- means roles that were using those screens through the gap must be given the
-- grants, or the fix reads to them as an outage.
UPDATE "Role" SET "permissions" = array_append("permissions", 'income:read')
  WHERE NOT ('income:read' = ANY("permissions"))
    AND ('journal:read' = ANY("permissions") OR 'school:fees:write' = ANY("permissions") OR 'expense:read' = ANY("permissions"));

UPDATE "Role" SET "permissions" = array_append("permissions", 'income:create')
  WHERE NOT ('income:create' = ANY("permissions"))
    AND ('journal:create' = ANY("permissions") OR 'school:fees:write' = ANY("permissions") OR 'expense:create' = ANY("permissions"));

UPDATE "Role" SET "permissions" = array_append("permissions", 'income:update')
  WHERE NOT ('income:update' = ANY("permissions"))
    AND ('journal:update' = ANY("permissions") OR 'school:fees:write' = ANY("permissions") OR 'expense:update' = ANY("permissions"));

UPDATE "Role" SET "permissions" = array_append("permissions", 'income:post')
  WHERE NOT ('income:post' = ANY("permissions"))
    AND ('journal:create' = ANY("permissions") OR 'expense:post' = ANY("permissions"));

-- Cancelling reverses a posted receipt, so it follows the destructive grants
-- rather than the ordinary write ones.
UPDATE "Role" SET "permissions" = array_append("permissions", 'income:cancel')
  WHERE NOT ('income:cancel' = ANY("permissions"))
    AND ('journal:delete' = ANY("permissions") OR 'expense:cancel' = ANY("permissions"));
