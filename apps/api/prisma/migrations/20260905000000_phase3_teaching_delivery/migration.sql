-- Phase 3: curriculum and teaching delivery.
--
-- Expand-first, like Phase 1 and Phase 2: every legacy row keeps working, new
-- rows must satisfy the canonical rules, and anything that cannot be mapped is
-- written to the visible exception queue instead of being discarded.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Lesson plans belong to a teaching context
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "LessonPlan" ADD COLUMN "schemeOfWorkWeekId" TEXT;

-- Backfill the offering from (term, subject, class). Where a class has several
-- offerings for one subject (section/stream variants), prefer the whole-cohort
-- one: a plan written before offerings existed was not section-specific.
UPDATE "LessonPlan" lp
SET "courseOfferingId" = (
  SELECT co."id"
  FROM "CourseOffering" co
  WHERE co."organizationId" = lp."organizationId"
    AND co."termId" = lp."termId"
    AND co."subjectId" = lp."subjectId"
    AND (lp."classId" IS NULL OR co."classId" = lp."classId")
  ORDER BY (co."sectionId" IS NULL) DESC, (co."streamId" IS NULL) DESC, co."createdAt" ASC
  LIMIT 1
)
WHERE lp."courseOfferingId" IS NULL;

INSERT INTO "AcademicMigrationException" (
  "id", "organizationId", "migrationRunId", "sourceEntity", "sourceId", "reason", "payload", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  lp."organizationId",
  '20260905000000_phase3_teaching_delivery',
  'LessonPlan',
  lp."id",
  'No CourseOffering matched this lesson plan (term/subject/class). The plan is unattached and cannot be edited until an offering is chosen.',
  jsonb_build_object('termId', lp."termId", 'subjectId', lp."subjectId", 'classId', lp."classId", 'title', lp."title"),
  CURRENT_TIMESTAMP
FROM "LessonPlan" lp
WHERE lp."courseOfferingId" IS NULL;

ALTER TABLE "LessonPlan"
  ADD CONSTRAINT "LessonPlan_courseOfferingId_fkey"
  FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NOT VALID rather than NOT NULL: new and updated plans must carry an offering,
-- while the unmapped legacy rows above stay readable until they are resolved.
ALTER TABLE "LessonPlan"
  ADD CONSTRAINT "LessonPlan_offering_required_ck" CHECK ("courseOfferingId" IS NOT NULL) NOT VALID;

CREATE INDEX IF NOT EXISTS "LessonPlan_courseOfferingId_idx" ON "LessonPlan"("courseOfferingId");
CREATE INDEX IF NOT EXISTS "LessonPlan_schemeOfWorkWeekId_idx" ON "LessonPlan"("schemeOfWorkWeekId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. One lesson status
-- ─────────────────────────────────────────────────────────────────────────────
-- `status` and `workflowStatus` were two names for the same fact. Anything the
-- thin column knew that the workflow column does not is carried over first.

UPDATE "LessonPlan"
SET "workflowStatus" = 'approved'
WHERE "workflowStatus" = 'draft' AND lower(COALESCE("status", '')) IN ('published', 'approved');

ALTER TABLE "LessonPlan" DROP COLUMN IF EXISTS "status";

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Schemes of work
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "SchemeOfWork" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "courseOfferingId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "summary" TEXT,
  "createdById" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "SchemeOfWork_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SchemeOfWork_courseOfferingId_key" ON "SchemeOfWork"("courseOfferingId");
CREATE INDEX "SchemeOfWork_organizationId_idx" ON "SchemeOfWork"("organizationId");
ALTER TABLE "SchemeOfWork" ADD CONSTRAINT "SchemeOfWork_courseOfferingId_fkey"
  FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SchemeOfWorkWeek" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "schemeOfWorkId" TEXT NOT NULL,
  "weekNumber" INTEGER NOT NULL,
  "weekStart" TIMESTAMP(3),
  "theme" TEXT,
  "plannedPeriods" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchemeOfWorkWeek_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SchemeOfWorkWeek_schemeOfWorkId_weekNumber_key" ON "SchemeOfWorkWeek"("schemeOfWorkId", "weekNumber");
CREATE INDEX "SchemeOfWorkWeek_organizationId_idx" ON "SchemeOfWorkWeek"("organizationId");
ALTER TABLE "SchemeOfWorkWeek" ADD CONSTRAINT "SchemeOfWorkWeek_schemeOfWorkId_fkey"
  FOREIGN KEY ("schemeOfWorkId") REFERENCES "SchemeOfWork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SchemeOfWorkItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "schemeOfWorkWeekId" TEXT NOT NULL,
  "topicId" TEXT,
  "unitId" TEXT,
  "learningOutcomeId" TEXT,
  "learningObjectiveId" TEXT,
  "title" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "plannedPeriods" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SchemeOfWorkItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SchemeOfWorkItem_organizationId_idx" ON "SchemeOfWorkItem"("organizationId");
CREATE INDEX "SchemeOfWorkItem_schemeOfWorkWeekId_idx" ON "SchemeOfWorkItem"("schemeOfWorkWeekId");
CREATE INDEX "SchemeOfWorkItem_learningOutcomeId_idx" ON "SchemeOfWorkItem"("learningOutcomeId");
ALTER TABLE "SchemeOfWorkItem" ADD CONSTRAINT "SchemeOfWorkItem_schemeOfWorkWeekId_fkey"
  FOREIGN KEY ("schemeOfWorkWeekId") REFERENCES "SchemeOfWorkWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchemeOfWorkItem" ADD CONSTRAINT "SchemeOfWorkItem_learningOutcomeId_fkey"
  FOREIGN KEY ("learningOutcomeId") REFERENCES "LearningOutcome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LessonPlan" ADD CONSTRAINT "LessonPlan_schemeOfWorkWeekId_fkey"
  FOREIGN KEY ("schemeOfWorkWeekId") REFERENCES "SchemeOfWorkWeek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lesson plans reference curriculum outcomes
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "LessonPlanOutcome" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "lessonPlanId" TEXT NOT NULL,
  "learningOutcomeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LessonPlanOutcome_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LessonPlanOutcome_lessonPlanId_learningOutcomeId_key" ON "LessonPlanOutcome"("lessonPlanId", "learningOutcomeId");
CREATE INDEX "LessonPlanOutcome_organizationId_idx" ON "LessonPlanOutcome"("organizationId");
CREATE INDEX "LessonPlanOutcome_learningOutcomeId_idx" ON "LessonPlanOutcome"("learningOutcomeId");
ALTER TABLE "LessonPlanOutcome" ADD CONSTRAINT "LessonPlanOutcome_lessonPlanId_fkey"
  FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonPlanOutcome" ADD CONSTRAINT "LessonPlanOutcome_learningOutcomeId_fkey"
  FOREIGN KEY ("learningOutcomeId") REFERENCES "LearningOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Learning resources attach through the offering
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "CourseOfferingResource" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "courseOfferingId" TEXT NOT NULL,
  "learningResourceId" TEXT NOT NULL,
  "visibleToLearners" BOOLEAN NOT NULL DEFAULT false,
  "order" INTEGER NOT NULL DEFAULT 0,
  "addedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourseOfferingResource_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CourseOfferingResource_courseOfferingId_learningResourceId_key" ON "CourseOfferingResource"("courseOfferingId", "learningResourceId");
CREATE INDEX "CourseOfferingResource_organizationId_idx" ON "CourseOfferingResource"("organizationId");
CREATE INDEX "CourseOfferingResource_learningResourceId_idx" ON "CourseOfferingResource"("learningResourceId");
ALTER TABLE "CourseOfferingResource" ADD CONSTRAINT "CourseOfferingResource_courseOfferingId_fkey"
  FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseOfferingResource" ADD CONSTRAINT "CourseOfferingResource_learningResourceId_fkey"
  FOREIGN KEY ("learningResourceId") REFERENCES "LearningResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over resources that were attached to an offering through the loose
-- `LearningResource.attaches` JSON, so the typed table starts complete.
INSERT INTO "CourseOfferingResource" ("id", "organizationId", "courseOfferingId", "learningResourceId", "createdAt")
SELECT
  gen_random_uuid()::text,
  lr."organizationId",
  co."id",
  lr."id",
  CURRENT_TIMESTAMP
FROM "LearningResource" lr
JOIN "CourseOffering" co
  ON co."id" = (lr."attaches" ->> 'offeringId')
 AND co."organizationId" = lr."organizationId"
WHERE lr."attaches" ? 'offeringId'
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Scheduled versus delivered
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "LessonDelivery"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'in_progress',
  ADD COLUMN "attendanceDate" TIMESTAMP(3),
  ADD COLUMN "attendancePeriodId" TEXT,
  ADD COLUMN "attendanceMarked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "presentCount" INTEGER,
  ADD COLUMN "absentCount" INTEGER,
  ADD COLUMN "coveredContent" TEXT,
  ADD COLUMN "varianceReason" TEXT,
  ADD COLUMN "whatWorked" TEXT,
  ADD COLUMN "whatDidntWork" TEXT,
  ADD COLUMN "studentsNeedingSupport" TEXT,
  ADD COLUMN "followUpNote" TEXT,
  ADD COLUMN "reflectedAt" TIMESTAMP(3);

UPDATE "LessonDelivery" SET "status" = 'delivered' WHERE "completedAt" IS NOT NULL;

-- One delivery per scheduled lesson. Repeated "start" clicks produced empty
-- duplicates; the completed row wins and every discarded row is logged.
INSERT INTO "AcademicMigrationException" (
  "id", "organizationId", "migrationRunId", "sourceEntity", "sourceId", "reason", "payload", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  d."organizationId",
  '20260905000000_phase3_teaching_delivery',
  'LessonDelivery',
  d."id",
  'Duplicate delivery for one scheduled lesson; the completed (or newest) delivery was kept.',
  jsonb_build_object('scheduledLessonId', d."scheduledLessonId", 'startedAt', d."startedAt", 'completedAt', d."completedAt"),
  CURRENT_TIMESTAMP
FROM "LessonDelivery" d
WHERE d."id" NOT IN (
  SELECT DISTINCT ON ("scheduledLessonId") "id"
  FROM "LessonDelivery"
  ORDER BY "scheduledLessonId", ("completedAt" IS NOT NULL) DESC, "createdAt" DESC
);

DELETE FROM "LessonDelivery" d
WHERE d."id" NOT IN (
  SELECT DISTINCT ON ("scheduledLessonId") "id"
  FROM "LessonDelivery"
  ORDER BY "scheduledLessonId", ("completedAt" IS NOT NULL) DESC, "createdAt" DESC
);

-- Deliveries whose scheduled lesson no longer exists cannot carry a foreign key.
INSERT INTO "AcademicMigrationException" (
  "id", "organizationId", "migrationRunId", "sourceEntity", "sourceId", "reason", "payload", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  d."organizationId",
  '20260905000000_phase3_teaching_delivery',
  'LessonDelivery',
  d."id",
  'Delivery referenced a scheduled lesson that no longer exists.',
  jsonb_build_object('scheduledLessonId', d."scheduledLessonId"),
  CURRENT_TIMESTAMP
FROM "LessonDelivery" d
WHERE NOT EXISTS (SELECT 1 FROM "ScheduledLesson" sl WHERE sl."id" = d."scheduledLessonId");

DELETE FROM "LessonDelivery" d
WHERE NOT EXISTS (SELECT 1 FROM "ScheduledLesson" sl WHERE sl."id" = d."scheduledLessonId");

DROP INDEX IF EXISTS "LessonDelivery_scheduledLessonId_idx";
CREATE UNIQUE INDEX "LessonDelivery_scheduledLessonId_key" ON "LessonDelivery"("scheduledLessonId");
ALTER TABLE "LessonDelivery" ADD CONSTRAINT "LessonDelivery_scheduledLessonId_fkey"
  FOREIGN KEY ("scheduledLessonId") REFERENCES "ScheduledLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Lesson evidence and follow-up
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "LessonDeliveryEvidence" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "lessonDeliveryId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "assessmentId" TEXT,
  "learningResourceId" TEXT,
  "learningOutcomeId" TEXT,
  "url" TEXT,
  "note" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LessonDeliveryEvidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LessonDeliveryEvidence_organizationId_idx" ON "LessonDeliveryEvidence"("organizationId");
CREATE INDEX "LessonDeliveryEvidence_lessonDeliveryId_idx" ON "LessonDeliveryEvidence"("lessonDeliveryId");
ALTER TABLE "LessonDeliveryEvidence" ADD CONSTRAINT "LessonDeliveryEvidence_lessonDeliveryId_fkey"
  FOREIGN KEY ("lessonDeliveryId") REFERENCES "LessonDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LessonFollowUp" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "courseOfferingId" TEXT NOT NULL,
  "lessonDeliveryId" TEXT,
  "studentProfileId" TEXT,
  "learningOutcomeId" TEXT,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "dueDate" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolutionNote" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LessonFollowUp_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LessonFollowUp_organizationId_idx" ON "LessonFollowUp"("organizationId");
CREATE INDEX "LessonFollowUp_courseOfferingId_status_idx" ON "LessonFollowUp"("courseOfferingId", "status");
CREATE INDEX "LessonFollowUp_studentProfileId_idx" ON "LessonFollowUp"("studentProfileId");
CREATE INDEX "LessonFollowUp_lessonDeliveryId_idx" ON "LessonFollowUp"("lessonDeliveryId");
ALTER TABLE "LessonFollowUp" ADD CONSTRAINT "LessonFollowUp_courseOfferingId_fkey"
  FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonFollowUp" ADD CONSTRAINT "LessonFollowUp_lessonDeliveryId_fkey"
  FOREIGN KEY ("lessonDeliveryId") REFERENCES "LessonDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Tenant isolation policies
-- ─────────────────────────────────────────────────────────────────────────────
-- Same shape as the Phase 1 policies: create the policy and FORCE ROW LEVEL
-- SECURITY without ENABLE, so it stays dormant until an operator turns RLS on.
-- App-side isolation is the Prisma tenancy extension (ORG_SCOPED).

DO $$
DECLARE
    t text;
    phase3_tables text[] := ARRAY[
        'CourseOfferingResource',
        'LessonDeliveryEvidence',
        'LessonFollowUp',
        'LessonPlanOutcome',
        'SchemeOfWork',
        'SchemeOfWorkItem',
        'SchemeOfWorkWeek'
    ];
BEGIN
    FOREACH t IN ARRAY phase3_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));',
            t
        );
    END LOOP;
END $$;
