-- LMS Phase 1 migration (focused, additive only).
-- Extends existing tables and creates the new LMS/CourseOffering/Learning-Progress models.
-- Safe to apply: only ADD COLUMN on existing tables + CREATE TABLE for new entities.

-- ───────────── Extend existing tables ─────────────
ALTER TABLE "HomeworkAssignment" ADD COLUMN "courseOfferingId" TEXT;
ALTER TABLE "HomeworkAssignment" ADD COLUMN "learningObjectiveId" TEXT;
ALTER TABLE "HomeworkAssignment" ADD COLUMN "lessonPlanId" TEXT;

ALTER TABLE "LearningResource" ADD COLUMN "attaches" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "LearningResource" ADD COLUMN "curriculumVersionId" TEXT;
ALTER TABLE "LearningResource" ADD COLUMN "previewUrl" TEXT;
ALTER TABLE "LearningResource" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "LessonPlan" ADD COLUMN "courseOfferingId" TEXT;
ALTER TABLE "LessonPlan" ADD COLUMN "curriculumVersionId" TEXT;
ALTER TABLE "LessonPlan" ADD COLUMN "subtopic" TEXT;
ALTER TABLE "LessonPlan" ADD COLUMN "topicId" TEXT;
ALTER TABLE "LessonPlan" ADD COLUMN "unitId" TEXT;
ALTER TABLE "LessonPlan" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "LessonPlan" ADD COLUMN "workflowStatus" TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE "Paper" ADD COLUMN "courseOfferingId" TEXT;
ALTER TABLE "Paper" ADD COLUMN "learningObjectiveId" TEXT;
ALTER TABLE "Paper" ADD COLUMN "lessonPlanId" TEXT;

ALTER TABLE "QuizAttempt" ADD COLUMN "courseOfferingId" TEXT;
ALTER TABLE "QuizAttempt" ADD COLUMN "learningObjectiveId" TEXT;
ALTER TABLE "QuizAttempt" ADD COLUMN "lessonPlanId" TEXT;

-- ───────────── New tables ─────────────
CREATE TABLE "CourseOffering" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "sectionId" TEXT,
    "curriculumId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CourseOffering_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourseOfferingTeacher" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "teacherPartnerId" TEXT NOT NULL,
    "role" TEXT DEFAULT 'lead',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseOfferingTeacher_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "learningObjectiveId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LearningActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonPlanActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonPlanId" TEXT NOT NULL,
    "learningActivityId" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "durationMin" INTEGER,
    "teacherInstructions" TEXT,
    "studentInstructions" TEXT,
    "differentiationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonPlanActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonPlanResource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonPlanId" TEXT NOT NULL,
    "learningResourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonPlanResource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonPlanAssessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonPlanId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonPlanAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonPlanDifferentiation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonPlanId" TEXT NOT NULL,
    "lessonPlanActivityId" TEXT,
    "learningObjectiveId" TEXT,
    "tier" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonPlanDifferentiation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonPlanReflection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonPlanId" TEXT NOT NULL,
    "whatWorked" TEXT,
    "whatDidnt" TEXT,
    "teacherPerceivedAchievement" TEXT,
    "studentsNeedingSupport" TEXT,
    "followUp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonPlanReflection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonPlanTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subjectId" TEXT,
    "body" JSONB NOT NULL DEFAULT '{}',
    "isSchoolWide" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LessonPlanTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonPlanReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonPlanId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "comment" TEXT,
    "requestedChanges" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonPlanReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonPlanRevision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonPlanId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonPlanRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduledLesson" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "timetableSlotId" TEXT,
    "lessonPlanId" TEXT,
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "teacherPartnerId" TEXT,
    "teachingRoomId" TEXT,
    "room" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledLesson_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduledLessonId" TEXT NOT NULL,
    "lessonPlanId" TEXT,
    "attendanceSessionId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deliveredById" TEXT,
    "participationNote" TEXT,
    "reflection" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Discussion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseOfferingId" TEXT,
    "lessonPlanId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Discussion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscussionPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "discussionId" TEXT NOT NULL,
    "authorId" TEXT,
    "parentPostId" TEXT,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscussionPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningObjectiveEvidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "learningObjectiveId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "normalizedScore" DECIMAL(5,2),
    "proficiency" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningObjectiveEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningObjectiveProgress" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "learningObjectiveId" TEXT NOT NULL,
    "masteryPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lastComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningObjectiveProgress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentCourseProgress" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "progressPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lastComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentCourseProgress_pkey" PRIMARY KEY ("id")
);

-- ───────────── Indexes ─────────────
CREATE INDEX "CourseOffering_organizationId_idx" ON "CourseOffering"("organizationId");
CREATE INDEX "CourseOffering_classId_idx" ON "CourseOffering"("classId");
CREATE INDEX "CourseOffering_subjectId_idx" ON "CourseOffering"("subjectId");
CREATE INDEX "CourseOffering_curriculumId_idx" ON "CourseOffering"("curriculumId");
CREATE INDEX "CourseOffering_termId_idx" ON "CourseOffering"("termId");
CREATE UNIQUE INDEX "CourseOffering_org_ay_term_subj_class_section_key" ON "CourseOffering"("organizationId", "academicYearId", "termId", "subjectId", "classId", "sectionId");

CREATE INDEX "CourseOfferingTeacher_organizationId_idx" ON "CourseOfferingTeacher"("organizationId");
CREATE INDEX "CourseOfferingTeacher_teacherPartnerId_idx" ON "CourseOfferingTeacher"("teacherPartnerId");
CREATE INDEX "CourseOfferingTeacher_courseOfferingId_idx" ON "CourseOfferingTeacher"("courseOfferingId");
CREATE UNIQUE INDEX "CourseOfferingTeacher_co_teacher_key" ON "CourseOfferingTeacher"("courseOfferingId", "teacherPartnerId");

CREATE INDEX "LearningActivity_organizationId_idx" ON "LearningActivity"("organizationId");
CREATE INDEX "LearningActivity_learningObjectiveId_idx" ON "LearningActivity"("learningObjectiveId");

CREATE INDEX "LessonPlanActivity_organizationId_idx" ON "LessonPlanActivity"("organizationId");
CREATE INDEX "LessonPlanActivity_lessonPlanId_idx" ON "LessonPlanActivity"("lessonPlanId");
CREATE INDEX "LessonPlanActivity_learningActivityId_idx" ON "LessonPlanActivity"("learningActivityId");

CREATE INDEX "LessonPlanResource_organizationId_idx" ON "LessonPlanResource"("organizationId");
CREATE INDEX "LessonPlanResource_learningResourceId_idx" ON "LessonPlanResource"("learningResourceId");
CREATE UNIQUE INDEX "LessonPlanResource_lp_lr_key" ON "LessonPlanResource"("lessonPlanId", "learningResourceId");

CREATE INDEX "LessonPlanAssessment_organizationId_idx" ON "LessonPlanAssessment"("organizationId");
CREATE INDEX "LessonPlanAssessment_lessonPlanId_idx" ON "LessonPlanAssessment"("lessonPlanId");

CREATE INDEX "LessonPlanDifferentiation_organizationId_idx" ON "LessonPlanDifferentiation"("organizationId");
CREATE INDEX "LessonPlanDifferentiation_lessonPlanId_idx" ON "LessonPlanDifferentiation"("lessonPlanId");
CREATE INDEX "LessonPlanDifferentiation_lessonPlanActivityId_idx" ON "LessonPlanDifferentiation"("lessonPlanActivityId");

CREATE INDEX "LessonPlanReflection_organizationId_idx" ON "LessonPlanReflection"("organizationId");
CREATE INDEX "LessonPlanReflection_lessonPlanId_idx" ON "LessonPlanReflection"("lessonPlanId");

CREATE INDEX "LessonPlanTemplate_organizationId_idx" ON "LessonPlanTemplate"("organizationId");
CREATE INDEX "LessonPlanTemplate_subjectId_idx" ON "LessonPlanTemplate"("subjectId");

CREATE INDEX "LessonPlanReview_organizationId_idx" ON "LessonPlanReview"("organizationId");
CREATE INDEX "LessonPlanReview_lessonPlanId_idx" ON "LessonPlanReview"("lessonPlanId");

CREATE INDEX "LessonPlanRevision_organizationId_idx" ON "LessonPlanRevision"("organizationId");
CREATE INDEX "LessonPlanRevision_lessonPlanId_idx" ON "LessonPlanRevision"("lessonPlanId");

CREATE INDEX "ScheduledLesson_organizationId_idx" ON "ScheduledLesson"("organizationId");
CREATE INDEX "ScheduledLesson_courseOfferingId_idx" ON "ScheduledLesson"("courseOfferingId");
CREATE INDEX "ScheduledLesson_timetableSlotId_idx" ON "ScheduledLesson"("timetableSlotId");
CREATE INDEX "ScheduledLesson_lessonPlanId_idx" ON "ScheduledLesson"("lessonPlanId");
CREATE INDEX "ScheduledLesson_plannedDate_idx" ON "ScheduledLesson"("plannedDate");

CREATE INDEX "LessonDelivery_organizationId_idx" ON "LessonDelivery"("organizationId");
CREATE INDEX "LessonDelivery_scheduledLessonId_idx" ON "LessonDelivery"("scheduledLessonId");
CREATE INDEX "LessonDelivery_lessonPlanId_idx" ON "LessonDelivery"("lessonPlanId");

CREATE INDEX "Discussion_organizationId_idx" ON "Discussion"("organizationId");
CREATE INDEX "Discussion_courseOfferingId_idx" ON "Discussion"("courseOfferingId");
CREATE INDEX "Discussion_lessonPlanId_idx" ON "Discussion"("lessonPlanId");

CREATE INDEX "DiscussionPost_organizationId_idx" ON "DiscussionPost"("organizationId");
CREATE INDEX "DiscussionPost_discussionId_idx" ON "DiscussionPost"("discussionId");
CREATE INDEX "DiscussionPost_parentPostId_idx" ON "DiscussionPost"("parentPostId");

CREATE INDEX "LearningObjectiveEvidence_organizationId_idx" ON "LearningObjectiveEvidence"("organizationId");
CREATE INDEX "LearningObjectiveEvidence_studentProfileId_idx" ON "LearningObjectiveEvidence"("studentProfileId");
CREATE INDEX "LearningObjectiveEvidence_learningObjectiveId_idx" ON "LearningObjectiveEvidence"("learningObjectiveId");

CREATE INDEX "LearningObjectiveProgress_organizationId_idx" ON "LearningObjectiveProgress"("organizationId");
CREATE INDEX "LearningObjectiveProgress_learningObjectiveId_idx" ON "LearningObjectiveProgress"("learningObjectiveId");
CREATE UNIQUE INDEX "LearningObjectiveProgress_student_lo_key" ON "LearningObjectiveProgress"("studentProfileId", "learningObjectiveId");

CREATE INDEX "StudentCourseProgress_organizationId_idx" ON "StudentCourseProgress"("organizationId");
CREATE INDEX "StudentCourseProgress_courseOfferingId_idx" ON "StudentCourseProgress"("courseOfferingId");
CREATE UNIQUE INDEX "StudentCourseProgress_student_co_key" ON "StudentCourseProgress"("studentProfileId", "courseOfferingId");
