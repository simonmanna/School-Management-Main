-- A2 rosters + assignment evidence: AcademicRoster/Member, Rubric/Criterion/
-- Level, AssessmentRubricScore, Assignment, AssignmentSubmission. Hand-written
-- for the same reason as A1 (pre-existing meals drift blocks `migrate dev`).

-- ─────────────────────────────── Enums ───────────────────────────────
CREATE TYPE "RosterScopeType" AS ENUM ('class', 'section', 'subject', 'grade');
CREATE TYPE "RosterSource" AS ENUM ('derived_current_class', 'enrollment', 'manual_import');
CREATE TYPE "AssignmentGradingMode" AS ENUM ('points', 'rubric', 'complete_incomplete');

-- ─────────────────────────────── Tables ───────────────────────────────
CREATE TABLE "AcademicRoster" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "scopeType" "RosterScopeType" NOT NULL DEFAULT 'class',
    "classId" TEXT,
    "sectionId" TEXT,
    "subjectId" TEXT,
    "name" TEXT,
    "source" "RosterSource" NOT NULL DEFAULT 'derived_current_class',
    "capturedById" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozenAt" TIMESTAMP(3),
    "frozenById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "AcademicRoster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcademicRosterMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "classId" TEXT,
    "sectionId" TEXT,
    "gradeLevelId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "joinReason" TEXT,
    "exitReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AcademicRosterMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Rubric" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Rubric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RubricCriterion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rubricId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weight" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "maxScore" DECIMAL(8,2) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RubricCriterion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RubricLevel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "score" DECIMAL(8,2) NOT NULL,
    "descriptor" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RubricLevel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssessmentRubricScore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentAssessmentId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "levelId" TEXT,
    "score" DECIMAL(8,2) NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssessmentRubricScore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "rosterId" TEXT,
    "instructions" TEXT,
    "allowLate" BOOLEAN NOT NULL DEFAULT false,
    "latePenaltyPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lateCutoffAt" TIMESTAMP(3),
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "gradingMode" "AssignmentGradingMode" NOT NULL DEFAULT 'points',
    "rubricId" TEXT,
    "rubricVersion" INTEGER,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssignmentSubmission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentAssessmentId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "content" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "rawScore" DECIMAL(8,2),
    "penaltyApplied" DECIMAL(8,2),
    "rubricSnapshot" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────── Indexes / uniques ───────────────────────────
CREATE INDEX "AcademicRoster_organizationId_idx" ON "AcademicRoster"("organizationId");
CREATE INDEX "AcademicRoster_org_term_class_idx" ON "AcademicRoster"("organizationId", "termId", "classId");

CREATE UNIQUE INDEX "AcademicRosterMember_roster_student_unique" ON "AcademicRosterMember"("rosterId", "studentProfileId");
CREATE INDEX "AcademicRosterMember_organizationId_idx" ON "AcademicRosterMember"("organizationId");
CREATE INDEX "AcademicRosterMember_rosterId_idx" ON "AcademicRosterMember"("rosterId");

CREATE INDEX "Rubric_organizationId_idx" ON "Rubric"("organizationId");

CREATE INDEX "RubricCriterion_organizationId_idx" ON "RubricCriterion"("organizationId");
CREATE INDEX "RubricCriterion_rubricId_idx" ON "RubricCriterion"("rubricId");

CREATE INDEX "RubricLevel_organizationId_idx" ON "RubricLevel"("organizationId");
CREATE INDEX "RubricLevel_criterionId_idx" ON "RubricLevel"("criterionId");

CREATE UNIQUE INDEX "AssessmentRubricScore_student_criterion_unique" ON "AssessmentRubricScore"("studentAssessmentId", "criterionId");
CREATE INDEX "AssessmentRubricScore_organizationId_idx" ON "AssessmentRubricScore"("organizationId");
CREATE INDEX "AssessmentRubricScore_studentAssessmentId_idx" ON "AssessmentRubricScore"("studentAssessmentId");

CREATE UNIQUE INDEX "Assignment_assessmentId_key" ON "Assignment"("assessmentId");
CREATE INDEX "Assignment_organizationId_idx" ON "Assignment"("organizationId");
CREATE INDEX "Assignment_rosterId_idx" ON "Assignment"("rosterId");

CREATE UNIQUE INDEX "AssignmentSubmission_assignment_student_attempt_unique" ON "AssignmentSubmission"("assignmentId", "studentAssessmentId", "attemptNo");
CREATE INDEX "AssignmentSubmission_organizationId_idx" ON "AssignmentSubmission"("organizationId");
CREATE INDEX "AssignmentSubmission_studentAssessmentId_idx" ON "AssignmentSubmission"("studentAssessmentId");

-- ─────────────────────────── Foreign keys ───────────────────────────
ALTER TABLE "AcademicRosterMember" ADD CONSTRAINT "AcademicRosterMember_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "AcademicRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RubricCriterion" ADD CONSTRAINT "RubricCriterion_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RubricLevel" ADD CONSTRAINT "RubricLevel_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "RubricCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssessmentRubricScore" ADD CONSTRAINT "AssessmentRubricScore_studentAssessmentId_fkey" FOREIGN KEY ("studentAssessmentId") REFERENCES "StudentAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_studentAssessmentId_fkey" FOREIGN KEY ("studentAssessmentId") REFERENCES "StudentAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────── CHECK constraints ───────────────────────────
ALTER TABLE "RubricCriterion" ADD CONSTRAINT "RubricCriterion_maxScore_check" CHECK ("maxScore" > 0);
ALTER TABLE "AssessmentRubricScore" ADD CONSTRAINT "AssessmentRubricScore_score_check" CHECK ("score" >= 0);
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_late_penalty_check" CHECK ("latePenaltyPercent" >= 0 AND "latePenaltyPercent" <= 100);
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_maxAttempts_check" CHECK ("maxAttempts" >= 1);
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_rawScore_check" CHECK ("rawScore" IS NULL OR "rawScore" >= 0);

-- ─────────────────────────── RLS (inert; companion to app-side ORG_SCOPED) ───────────────────────────
DO $$
DECLARE
    t text;
    a2_tables text[] := ARRAY[
        'AcademicRoster',
        'AcademicRosterMember',
        'Rubric',
        'RubricCriterion',
        'RubricLevel',
        'AssessmentRubricScore',
        'Assignment',
        'AssignmentSubmission'
    ];
BEGIN
    FOREACH t IN ARRAY a2_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));',
            t
        );
    END LOOP;
END $$;
