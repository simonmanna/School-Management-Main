-- Reconcile schema drift accumulated by `prisma db push`.
--
-- The development database was built with `db push` and had no
-- `_prisma_migrations` table, so the 120 existing migrations were baselined
-- with `migrate resolve --applied` and this migration carries the difference
-- that had accumulated between schema.prisma and the live database.
--
-- Nothing here is destructive: no table, column, type or index is dropped. It is
-- foreign-key constraints re-created with identical definitions, DB-side
-- defaults removed where Prisma generates the value client-side (`@updatedAt`,
-- `@default(uuid())`), and indexes renamed to the names Prisma derives.
--
-- Three StudentAssessment performance indexes that `migrate diff` previously
-- wanted to DROP are NOT dropped: they shipped as raw CREATE INDEX in
-- 20260908000000_phase6_statutory_portal and are now declared in schema.prisma
-- instead, so schema and database agree.
--
-- Every statement is guarded, so re-running this migration is a no-op.

-- DropForeignKey
ALTER TABLE "CourseOffering" DROP CONSTRAINT IF EXISTS "CourseOffering_activityDefinitionId_fkey";

-- DropForeignKey
ALTER TABLE "CourseOffering" DROP CONSTRAINT IF EXISTS "CourseOffering_classCohortId_fkey";

-- DropForeignKey
ALTER TABLE "CourseOffering" DROP CONSTRAINT IF EXISTS "CourseOffering_competencyId_fkey";

-- DropForeignKey
ALTER TABLE "CourseOffering" DROP CONSTRAINT IF EXISTS "CourseOffering_curriculumId_fkey";

-- DropForeignKey
ALTER TABLE "CourseOffering" DROP CONSTRAINT IF EXISTS "CourseOffering_programmeId_fkey";

-- DropForeignKey
ALTER TABLE "CourseOffering" DROP CONSTRAINT IF EXISTS "CourseOffering_subjectId_fkey";

-- DropForeignKey
ALTER TABLE "LessonPlan" DROP CONSTRAINT IF EXISTS "LessonPlan_courseOfferingId_fkey";

-- AlterTable
ALTER TABLE "CourseOffering" ALTER COLUMN "code" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExamAttendance" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ExamIncident" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ModerationSample" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ModerationSampleItem" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PromotionDecision" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ReportDocument" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ScriptAllocation" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SpecialConsideration" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StatutoryExportTemplate" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "StudentExamReference" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LessonPlan" ADD CONSTRAINT "LessonPlan_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "AcademicProgramme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_classCohortId_fkey" FOREIGN KEY ("classCohortId") REFERENCES "ClassCohort"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_curriculumId_fkey" FOREIGN KEY ("curriculumId") REFERENCES "Curriculum"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_activityDefinitionId_fkey" FOREIGN KEY ("activityDefinitionId") REFERENCES "LearningActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'AcademicReminderLog_org_kind_sentAt_idx')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'AcademicReminderLog_organizationId_kind_sentAt_idx') THEN
    ALTER INDEX "AcademicReminderLog_org_kind_sentAt_idx" RENAME TO "AcademicReminderLog_organizationId_kind_sentAt_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'AcademicReminderLog_org_kind_subject_milestone_user_key')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'AcademicReminderLog_organizationId_kind_subjectId_milestone_key') THEN
    ALTER INDEX "AcademicReminderLog_org_kind_subject_milestone_user_key" RENAME TO "AcademicReminderLog_organizationId_kind_subjectId_milestone_key";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'HrLeaveAccrual_org_emp_type_period_key')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'HrLeaveAccrual_organizationId_employeeId_leaveTypeId_period_key') THEN
    ALTER INDEX "HrLeaveAccrual_org_emp_type_period_key" RENAME TO "HrLeaveAccrual_organizationId_employeeId_leaveTypeId_period_key";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ReportDocument_identity_key')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'ReportDocument_studentProfileId_termId_documentType_resultS_key') THEN
    ALTER INDEX "ReportDocument_identity_key" RENAME TO "ReportDocument_studentProfileId_termId_documentType_resultS_key";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StatutoryExportRun_org_scope_generatedAt_idx')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StatutoryExportRun_organizationId_scope_generatedAt_idx') THEN
    ALTER INDEX "StatutoryExportRun_org_scope_generatedAt_idx" RENAME TO "StatutoryExportRun_organizationId_scope_generatedAt_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StatutoryExportTemplate_org_code_version_key')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StatutoryExportTemplate_organizationId_code_version_key') THEN
    ALTER INDEX "StatutoryExportTemplate_org_code_version_key" RENAME TO "StatutoryExportTemplate_organizationId_code_version_key";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StatutoryExportTemplate_org_scope_active_idx')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StatutoryExportTemplate_organizationId_scope_isActive_idx') THEN
    ALTER INDEX "StatutoryExportTemplate_org_scope_active_idx" RENAME TO "StatutoryExportTemplate_organizationId_scope_isActive_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StudentExamReference_org_board_level_year_index_key')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StudentExamReference_organizationId_board_level_registratio_key') THEN
    ALTER INDEX "StudentExamReference_org_board_level_year_index_key" RENAME TO "StudentExamReference_organizationId_board_level_registratio_key";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StudentExamReference_org_level_year_idx')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StudentExamReference_organizationId_level_registrationYear_idx') THEN
    ALTER INDEX "StudentExamReference_org_level_year_idx" RENAME TO "StudentExamReference_organizationId_level_registrationYear_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StudentExamReference_org_student_board_level_year_key')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StudentExamReference_organizationId_studentProfileId_board__key') THEN
    ALTER INDEX "StudentExamReference_org_student_board_level_year_key" RENAME TO "StudentExamReference_organizationId_studentProfileId_board__key";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StudentExamReference_org_student_idx')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'StudentExamReference_organizationId_studentProfileId_idx') THEN
    ALTER INDEX "StudentExamReference_org_student_idx" RENAME TO "StudentExamReference_organizationId_studentProfileId_idx";
  END IF;
END $$;
