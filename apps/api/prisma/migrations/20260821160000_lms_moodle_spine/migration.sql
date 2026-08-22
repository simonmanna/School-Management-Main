-- CreateEnum
CREATE TYPE "LmsContextLevel" AS ENUM ('system', 'organization', 'category', 'course', 'activity', 'user');

-- CreateEnum
CREATE TYPE "LmsPermission" AS ENUM ('inherit', 'allow', 'prevent', 'prohibit');

-- CreateEnum
CREATE TYPE "CourseFormat" AS ENUM ('weeks', 'topics', 'single_activity', 'social', 'flexible');

-- CreateEnum
CREATE TYPE "GroupMode" AS ENUM ('none', 'separate', 'visible');

-- CreateEnum
CREATE TYPE "CompletionMode" AS ENUM ('none', 'manual', 'automatic');

-- CreateEnum
CREATE TYPE "EnrolMethod" AS ENUM ('roster_sync', 'manual', 'self', 'cohort', 'guest');

-- CreateEnum
CREATE TYPE "EnrolStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "CompletionState" AS ENUM ('incomplete', 'complete', 'complete_pass', 'complete_fail');

-- AlterEnum
ALTER TYPE "AssessmentSourceType" ADD VALUE 'lms_activity';

-- AlterTable
ALTER TABLE "CourseOffering" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "completionEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "forceGroupMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "format" "CourseFormat" NOT NULL DEFAULT 'weeks',
ADD COLUMN     "groupMode" "GroupMode" NOT NULL DEFAULT 'none',
ADD COLUMN     "numSections" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "showGradesToStudents" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summaryFormat" TEXT NOT NULL DEFAULT 'html',
ADD COLUMN     "visible" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Discussion" ADD COLUMN     "courseModuleId" TEXT,
ADD COLUMN     "forumGroupId" TEXT,
ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "hiddenFromStudents" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lockedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "QuizResponse" ADD COLUMN     "stepData" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "LmsContext" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "level" "LmsContextLevel" NOT NULL,
    "instanceId" TEXT,
    "parentId" TEXT,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsRole" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shortname" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archetype" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "assignableAt" "LmsContextLevel"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsRoleCapability" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "permission" "LmsPermission" NOT NULL DEFAULT 'inherit',

    CONSTRAINT "LmsRoleCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsRoleAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "userId" TEXT,
    "studentProfileId" TEXT,
    "sourceComponent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsRoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsCapabilityOverride" (
    "id" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "permission" "LmsPermission" NOT NULL,

    CONSTRAINT "LmsCapabilityOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "sectionNo" INTEGER NOT NULL,
    "name" TEXT,
    "summary" TEXT,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "availability" JSONB,
    "weekOf" TIMESTAMP(3),
    "sequence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CourseSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsActivityType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Square',
    "gradable" BOOLEAN NOT NULL DEFAULT false,
    "supportsGroups" BOOLEAN NOT NULL DEFAULT false,
    "supportsCompletionAuto" BOOLEAN NOT NULL DEFAULT true,
    "hasSubmissions" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LmsActivityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseModule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "idnumber" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "visibleOnPage" BOOLEAN NOT NULL DEFAULT true,
    "availability" JSONB,
    "groupMode" "GroupMode" NOT NULL DEFAULT 'none',
    "groupingId" TEXT,
    "completionMode" "CompletionMode" NOT NULL DEFAULT 'manual',
    "completionRules" JSONB NOT NULL DEFAULT '{}',
    "assessmentId" TEXT,
    "openAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "cutoffAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CourseModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModResource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "resourceId" TEXT,
    "fileId" TEXT,
    "displayMode" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModUrl" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "externalUrl" TEXT NOT NULL,
    "display" TEXT NOT NULL DEFAULT 'new_window',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModUrl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "content" TEXT NOT NULL DEFAULT '',
    "contentFormat" TEXT NOT NULL DEFAULT 'html',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModLabel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModFolder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "fileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModAssign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "assignmentId" TEXT,
    "homeworkId" TEXT,
    "allowSubmissionsFrom" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "cutoffDate" TIMESTAMP(3),
    "maxScore" DECIMAL(8,2) NOT NULL DEFAULT 100,
    "submissionTypes" TEXT[] DEFAULT ARRAY['online_text', 'file']::TEXT[],
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "teamSubmission" BOOLEAN NOT NULL DEFAULT false,
    "blindMarking" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModAssign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModForum" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "forumType" TEXT NOT NULL DEFAULT 'general',
    "subscription" TEXT NOT NULL DEFAULT 'optional',
    "maxAttachments" INTEGER NOT NULL DEFAULT 2,
    "ratingScale" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModForum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModForumSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "forumId" TEXT NOT NULL,
    "userId" TEXT,
    "studentProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModForumSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseEnrolmentMethod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "method" "EnrolMethod" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "defaultRoleId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseEnrolmentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseEnrolment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "studentProfileId" TEXT,
    "userId" TEXT,
    "status" "EnrolStatus" NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "lastAccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enrolmentKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "studentProfileId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsGrouping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsGrouping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseModuleCompletion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseModuleId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "state" "CompletionState" NOT NULL DEFAULT 'incomplete',
    "viewed" BOOLEAN NOT NULL DEFAULT false,
    "overriddenById" TEXT,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseModuleCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseCompletionCriteria" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "courseOfferingId" TEXT NOT NULL,
    "criteriaType" TEXT NOT NULL,
    "courseModuleId" TEXT,
    "minGrade" DECIMAL(5,2),
    "byDate" TIMESTAMP(3),
    "aggregation" TEXT NOT NULL DEFAULT 'all',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseCompletionCriteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentGradeOverride" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentAssessmentId" TEXT NOT NULL,
    "overriddenScore" DECIMAL(8,2) NOT NULL,
    "reason" TEXT,
    "overriddenById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentGradeOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAssessmentHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentAssessmentId" TEXT NOT NULL,
    "oldScore" DECIMAL(8,2),
    "newScore" DECIMAL(8,2),
    "source" TEXT NOT NULL,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentAssessmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModQuiz" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "questionPaperId" TEXT,
    "timeLimitSec" INTEGER,
    "attemptsAllowed" INTEGER NOT NULL DEFAULT 0,
    "gradingMethod" TEXT NOT NULL DEFAULT 'highest',
    "navMethod" TEXT NOT NULL DEFAULT 'free',
    "shuffleQuestions" BOOLEAN NOT NULL DEFAULT false,
    "shuffleAnswers" BOOLEAN NOT NULL DEFAULT true,
    "behaviour" TEXT NOT NULL DEFAULT 'deferredfeedback',
    "reviewOptions" JSONB NOT NULL DEFAULT '{}',
    "overallFeedback" JSONB NOT NULL DEFAULT '[]',
    "maxScore" DECIMAL(8,2) NOT NULL DEFAULT 100,
    "openAt" TIMESTAMP(3),
    "closeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModQuiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "info" TEXT,
    "path" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizSlot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "page" INTEGER NOT NULL DEFAULT 1,
    "slotNo" INTEGER NOT NULL,
    "questionId" TEXT,
    "questionVersionId" TEXT,
    "randomCategoryId" TEXT,
    "randomIncludeSub" BOOLEAN NOT NULL DEFAULT false,
    "randomTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxMark" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "requirePrevious" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "QuizSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizOverride" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "studentProfileId" TEXT,
    "groupId" TEXT,
    "openAt" TIMESTAMP(3),
    "closeAt" TIMESTAMP(3),
    "timeLimitSec" INTEGER,
    "attemptsAllowed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "contextId" TEXT,
    "courseOfferingId" TEXT,
    "courseModuleId" TEXT,
    "objectId" TEXT,
    "userId" TEXT,
    "studentProfileId" TEXT,
    "other" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsBadge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "criteriaType" TEXT NOT NULL DEFAULT 'manual',
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "courseOfferingId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsBadgeAward" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "studentProfileId" TEXT,
    "userId" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "awardedById" TEXT,

    CONSTRAINT "LmsBadgeAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModChoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
    "allowUpdate" BOOLEAN NOT NULL DEFAULT true,
    "limitAnswers" BOOLEAN NOT NULL DEFAULT false,
    "showResults" TEXT NOT NULL DEFAULT 'after_answer',
    "publishAnon" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "closeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModChoiceAnswer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "choiceId" TEXT NOT NULL,
    "optionKey" TEXT NOT NULL,
    "studentProfileId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModChoiceAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModGlossary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "allowComments" BOOLEAN NOT NULL DEFAULT false,
    "allowDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModGlossary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModGlossaryEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "glossaryId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModGlossaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModWiki" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "wikiMode" TEXT NOT NULL DEFAULT 'collaborative',
    "firstPageTitle" TEXT NOT NULL DEFAULT 'Home',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModWiki_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModWikiPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wikiId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModWikiPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModWikiVersion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModWikiVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModLesson" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "gradable" BOOLEAN NOT NULL DEFAULT false,
    "maxScore" DECIMAL(8,2) NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModLessonPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "pageType" TEXT NOT NULL DEFAULT 'content',
    "qtype" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "branches" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModLessonPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModFeedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT true,
    "multipleSubmit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModFeedbackItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "itemType" TEXT NOT NULL DEFAULT 'text',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ModFeedbackItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModFeedbackResponse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "studentProfileId" TEXT,
    "userId" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModFeedbackResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModWorkshop" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'setup',
    "instructAuthors" TEXT,
    "instructReviewers" TEXT,
    "submissionStart" TIMESTAMP(3),
    "submissionEnd" TIMESTAMP(3),
    "assessmentStart" TIMESTAMP(3),
    "assessmentEnd" TIMESTAMP(3),
    "gradeSubmission" DECIMAL(8,2) NOT NULL DEFAULT 80,
    "gradeAssessment" DECIMAL(8,2) NOT NULL DEFAULT 20,
    "numReviewers" INTEGER NOT NULL DEFAULT 3,
    "rubric" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModWorkshop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModWorkshopSubmission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workshopId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModWorkshopSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModWorkshopAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workshopId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "reviewerProfileId" TEXT NOT NULL,
    "grade" DECIMAL(8,2),
    "feedback" TEXT,
    "filledRubric" JSONB NOT NULL DEFAULT '{}',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModWorkshopAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModScorm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "packageFileId" TEXT,
    "scormVersion" TEXT NOT NULL DEFAULT '1.2',
    "manifest" JSONB NOT NULL DEFAULT '{}',
    "maxAttempts" INTEGER NOT NULL DEFAULT 0,
    "gradingMethod" TEXT NOT NULL DEFAULT 'highest',
    "maxScore" DECIMAL(8,2) NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModScorm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScormTrack" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scormId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "scoIdentifier" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "cmi" JSONB NOT NULL DEFAULT '{}',
    "lessonStatus" TEXT NOT NULL DEFAULT 'not attempted',
    "scoreRaw" DECIMAL(8,2),
    "totalTimeSec" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScormTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModLti" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "toolUrl" TEXT NOT NULL,
    "clientId" TEXT,
    "deploymentId" TEXT,
    "publicKeyset" TEXT,
    "loginUrl" TEXT,
    "redirectUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customParams" JSONB NOT NULL DEFAULT '{}',
    "launchContainer" TEXT NOT NULL DEFAULT 'new_window',
    "gradable" BOOLEAN NOT NULL DEFAULT false,
    "maxScore" DECIMAL(8,2) NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModLti_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModH5p" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "packageFileId" TEXT,
    "contentJson" JSONB NOT NULL DEFAULT '{}',
    "library" TEXT,
    "gradable" BOOLEAN NOT NULL DEFAULT false,
    "maxScore" DECIMAL(8,2) NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModH5p_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "XapiStatement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "h5pId" TEXT,
    "courseModuleId" TEXT,
    "studentProfileId" TEXT,
    "userId" TEXT,
    "verb" TEXT NOT NULL,
    "object" TEXT NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "raw" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "XapiStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LmsFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "fileArea" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL DEFAULT '/',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LmsFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LmsContext_organizationId_path_idx" ON "LmsContext"("organizationId", "path");

-- CreateIndex
CREATE INDEX "LmsContext_parentId_idx" ON "LmsContext"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsContext_organizationId_level_instanceId_key" ON "LmsContext"("organizationId", "level", "instanceId");

-- CreateIndex
CREATE INDEX "LmsRole_organizationId_idx" ON "LmsRole"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsRole_organizationId_shortname_key" ON "LmsRole"("organizationId", "shortname");

-- CreateIndex
CREATE INDEX "LmsRoleCapability_capability_idx" ON "LmsRoleCapability"("capability");

-- CreateIndex
CREATE UNIQUE INDEX "LmsRoleCapability_roleId_capability_key" ON "LmsRoleCapability"("roleId", "capability");

-- CreateIndex
CREATE INDEX "LmsRoleAssignment_organizationId_userId_idx" ON "LmsRoleAssignment"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "LmsRoleAssignment_organizationId_studentProfileId_idx" ON "LmsRoleAssignment"("organizationId", "studentProfileId");

-- CreateIndex
CREATE INDEX "LmsRoleAssignment_roleId_idx" ON "LmsRoleAssignment"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsRoleAssignment_contextId_roleId_userId_studentProfileId_key" ON "LmsRoleAssignment"("contextId", "roleId", "userId", "studentProfileId");

-- CreateIndex
CREATE INDEX "LmsCapabilityOverride_contextId_idx" ON "LmsCapabilityOverride"("contextId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsCapabilityOverride_contextId_roleId_capability_key" ON "LmsCapabilityOverride"("contextId", "roleId", "capability");

-- CreateIndex
CREATE INDEX "CourseCategory_organizationId_path_idx" ON "CourseCategory"("organizationId", "path");

-- CreateIndex
CREATE INDEX "CourseSection_organizationId_idx" ON "CourseSection"("organizationId");

-- CreateIndex
CREATE INDEX "CourseSection_courseOfferingId_idx" ON "CourseSection"("courseOfferingId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseSection_courseOfferingId_sectionNo_key" ON "CourseSection"("courseOfferingId", "sectionNo");

-- CreateIndex
CREATE UNIQUE INDEX "LmsActivityType_name_key" ON "LmsActivityType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CourseModule_assessmentId_key" ON "CourseModule"("assessmentId");

-- CreateIndex
CREATE INDEX "CourseModule_organizationId_courseOfferingId_idx" ON "CourseModule"("organizationId", "courseOfferingId");

-- CreateIndex
CREATE INDEX "CourseModule_activityType_instanceId_idx" ON "CourseModule"("activityType", "instanceId");

-- CreateIndex
CREATE INDEX "CourseModule_sectionId_idx" ON "CourseModule"("sectionId");

-- CreateIndex
CREATE INDEX "CourseModule_organizationId_dueAt_idx" ON "CourseModule"("organizationId", "dueAt");

-- CreateIndex
CREATE INDEX "ModForumSubscription_forumId_idx" ON "ModForumSubscription"("forumId");

-- CreateIndex
CREATE UNIQUE INDEX "ModForumSubscription_forumId_userId_studentProfileId_key" ON "ModForumSubscription"("forumId", "userId", "studentProfileId");

-- CreateIndex
CREATE INDEX "CourseEnrolmentMethod_organizationId_idx" ON "CourseEnrolmentMethod"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseEnrolmentMethod_courseOfferingId_method_key" ON "CourseEnrolmentMethod"("courseOfferingId", "method");

-- CreateIndex
CREATE INDEX "CourseEnrolment_organizationId_studentProfileId_idx" ON "CourseEnrolment"("organizationId", "studentProfileId");

-- CreateIndex
CREATE INDEX "CourseEnrolment_courseOfferingId_idx" ON "CourseEnrolment"("courseOfferingId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseEnrolment_courseOfferingId_studentProfileId_userId_key" ON "CourseEnrolment"("courseOfferingId", "studentProfileId", "userId");

-- CreateIndex
CREATE INDEX "LmsGroup_organizationId_idx" ON "LmsGroup"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsGroup_courseOfferingId_name_key" ON "LmsGroup"("courseOfferingId", "name");

-- CreateIndex
CREATE INDEX "LmsGroupMember_groupId_idx" ON "LmsGroupMember"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsGroupMember_groupId_studentProfileId_userId_key" ON "LmsGroupMember"("groupId", "studentProfileId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsGrouping_courseOfferingId_name_key" ON "LmsGrouping"("courseOfferingId", "name");

-- CreateIndex
CREATE INDEX "CourseModuleCompletion_organizationId_studentProfileId_idx" ON "CourseModuleCompletion"("organizationId", "studentProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseModuleCompletion_courseModuleId_studentProfileId_key" ON "CourseModuleCompletion"("courseModuleId", "studentProfileId");

-- CreateIndex
CREATE INDEX "CourseCompletionCriteria_organizationId_courseOfferingId_idx" ON "CourseCompletionCriteria"("organizationId", "courseOfferingId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentGradeOverride_studentAssessmentId_key" ON "AssessmentGradeOverride"("studentAssessmentId");

-- CreateIndex
CREATE INDEX "AssessmentGradeOverride_organizationId_idx" ON "AssessmentGradeOverride"("organizationId");

-- CreateIndex
CREATE INDEX "StudentAssessmentHistory_organizationId_studentAssessmentId_idx" ON "StudentAssessmentHistory"("organizationId", "studentAssessmentId");

-- CreateIndex
CREATE INDEX "QuestionCategory_organizationId_contextId_idx" ON "QuestionCategory"("organizationId", "contextId");

-- CreateIndex
CREATE INDEX "QuestionVersion_questionId_idx" ON "QuestionVersion"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_questionId_version_key" ON "QuestionVersion"("questionId", "version");

-- CreateIndex
CREATE INDEX "QuizSlot_quizId_idx" ON "QuizSlot"("quizId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizSlot_quizId_slotNo_key" ON "QuizSlot"("quizId", "slotNo");

-- CreateIndex
CREATE INDEX "QuizOverride_quizId_idx" ON "QuizOverride"("quizId");

-- CreateIndex
CREATE INDEX "LmsEvent_organizationId_courseOfferingId_createdAt_idx" ON "LmsEvent"("organizationId", "courseOfferingId", "createdAt");

-- CreateIndex
CREATE INDEX "LmsEvent_organizationId_studentProfileId_createdAt_idx" ON "LmsEvent"("organizationId", "studentProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "LmsEvent_organizationId_component_action_idx" ON "LmsEvent"("organizationId", "component", "action");

-- CreateIndex
CREATE INDEX "LmsBadge_organizationId_idx" ON "LmsBadge"("organizationId");

-- CreateIndex
CREATE INDEX "LmsBadgeAward_organizationId_idx" ON "LmsBadgeAward"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LmsBadgeAward_badgeId_studentProfileId_userId_key" ON "LmsBadgeAward"("badgeId", "studentProfileId", "userId");

-- CreateIndex
CREATE INDEX "ModChoiceAnswer_choiceId_idx" ON "ModChoiceAnswer"("choiceId");

-- CreateIndex
CREATE INDEX "ModGlossaryEntry_glossaryId_idx" ON "ModGlossaryEntry"("glossaryId");

-- CreateIndex
CREATE INDEX "ModWikiPage_wikiId_idx" ON "ModWikiPage"("wikiId");

-- CreateIndex
CREATE UNIQUE INDEX "ModWikiPage_wikiId_title_key" ON "ModWikiPage"("wikiId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "ModWikiVersion_pageId_version_key" ON "ModWikiVersion"("pageId", "version");

-- CreateIndex
CREATE INDEX "ModLessonPage_lessonId_idx" ON "ModLessonPage"("lessonId");

-- CreateIndex
CREATE INDEX "ModFeedbackItem_feedbackId_idx" ON "ModFeedbackItem"("feedbackId");

-- CreateIndex
CREATE INDEX "ModFeedbackResponse_feedbackId_idx" ON "ModFeedbackResponse"("feedbackId");

-- CreateIndex
CREATE INDEX "ModWorkshopSubmission_workshopId_idx" ON "ModWorkshopSubmission"("workshopId");

-- CreateIndex
CREATE INDEX "ModWorkshopAllocation_workshopId_idx" ON "ModWorkshopAllocation"("workshopId");

-- CreateIndex
CREATE UNIQUE INDEX "ModWorkshopAllocation_submissionId_reviewerProfileId_key" ON "ModWorkshopAllocation"("submissionId", "reviewerProfileId");

-- CreateIndex
CREATE INDEX "ScormTrack_scormId_idx" ON "ScormTrack"("scormId");

-- CreateIndex
CREATE UNIQUE INDEX "ScormTrack_scormId_studentProfileId_scoIdentifier_attempt_key" ON "ScormTrack"("scormId", "studentProfileId", "scoIdentifier", "attempt");

-- CreateIndex
CREATE INDEX "XapiStatement_organizationId_courseModuleId_idx" ON "XapiStatement"("organizationId", "courseModuleId");

-- CreateIndex
CREATE INDEX "XapiStatement_organizationId_studentProfileId_idx" ON "XapiStatement"("organizationId", "studentProfileId");

-- CreateIndex
CREATE INDEX "LmsFile_organizationId_component_fileArea_itemId_idx" ON "LmsFile"("organizationId", "component", "fileArea", "itemId");

-- CreateIndex
CREATE INDEX "LmsFile_contextId_idx" ON "LmsFile"("contextId");

-- CreateIndex
CREATE INDEX "Discussion_courseModuleId_idx" ON "Discussion"("courseModuleId");

-- AddForeignKey
ALTER TABLE "LmsContext" ADD CONSTRAINT "LmsContext_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LmsContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsRoleCapability" ADD CONSTRAINT "LmsRoleCapability_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "LmsRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsRoleAssignment" ADD CONSTRAINT "LmsRoleAssignment_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "LmsContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsRoleAssignment" ADD CONSTRAINT "LmsRoleAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "LmsRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsCapabilityOverride" ADD CONSTRAINT "LmsCapabilityOverride_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "LmsContext"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCategory" ADD CONSTRAINT "CourseCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CourseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSection" ADD CONSTRAINT "CourseSection_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseModule" ADD CONSTRAINT "CourseModule_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseModule" ADD CONSTRAINT "CourseModule_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CourseSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModForumSubscription" ADD CONSTRAINT "ModForumSubscription_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "ModForum"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrolmentMethod" ADD CONSTRAINT "CourseEnrolmentMethod_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrolment" ADD CONSTRAINT "CourseEnrolment_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrolment" ADD CONSTRAINT "CourseEnrolment_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "CourseEnrolmentMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsGroup" ADD CONSTRAINT "LmsGroup_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsGroupMember" ADD CONSTRAINT "LmsGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "LmsGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsGrouping" ADD CONSTRAINT "LmsGrouping_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseModuleCompletion" ADD CONSTRAINT "CourseModuleCompletion_courseModuleId_fkey" FOREIGN KEY ("courseModuleId") REFERENCES "CourseModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCompletionCriteria" ADD CONSTRAINT "CourseCompletionCriteria_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizSlot" ADD CONSTRAINT "QuizSlot_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "ModQuiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizOverride" ADD CONSTRAINT "QuizOverride_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "ModQuiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LmsBadgeAward" ADD CONSTRAINT "LmsBadgeAward_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "LmsBadge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModChoiceAnswer" ADD CONSTRAINT "ModChoiceAnswer_choiceId_fkey" FOREIGN KEY ("choiceId") REFERENCES "ModChoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModGlossaryEntry" ADD CONSTRAINT "ModGlossaryEntry_glossaryId_fkey" FOREIGN KEY ("glossaryId") REFERENCES "ModGlossary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModWikiPage" ADD CONSTRAINT "ModWikiPage_wikiId_fkey" FOREIGN KEY ("wikiId") REFERENCES "ModWiki"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModWikiVersion" ADD CONSTRAINT "ModWikiVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "ModWikiPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModLessonPage" ADD CONSTRAINT "ModLessonPage_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "ModLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModFeedbackItem" ADD CONSTRAINT "ModFeedbackItem_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "ModFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModFeedbackResponse" ADD CONSTRAINT "ModFeedbackResponse_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "ModFeedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModWorkshopSubmission" ADD CONSTRAINT "ModWorkshopSubmission_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "ModWorkshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModWorkshopAllocation" ADD CONSTRAINT "ModWorkshopAllocation_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "ModWorkshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModWorkshopAllocation" ADD CONSTRAINT "ModWorkshopAllocation_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ModWorkshopSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScormTrack" ADD CONSTRAINT "ScormTrack_scormId_fkey" FOREIGN KEY ("scormId") REFERENCES "ModScorm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "XapiStatement" ADD CONSTRAINT "XapiStatement_h5pId_fkey" FOREIGN KEY ("h5pId") REFERENCES "ModH5p"("id") ON DELETE CASCADE ON UPDATE CASCADE;

