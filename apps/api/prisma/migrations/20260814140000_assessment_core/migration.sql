-- A1 assessment core: the policy → component → assessment → student-assessment →
-- marks spine. Hand-written (not `migrate dev`) because schooldb-planet carries
-- pre-existing meals drift that would force a reset.

-- ─────────────────────────────── Enums ───────────────────────────────
CREATE TYPE "AssessmentKind" AS ENUM ('exam', 'cat', 'homework', 'classwork', 'practical', 'project', 'oral', 'attendance');
CREATE TYPE "AssessmentSourceType" AS ENUM ('manual', 'assignment', 'exam_session', 'quiz');
CREATE TYPE "AssessmentStatus" AS ENUM ('draft', 'scheduled', 'published', 'open', 'closed', 'grading', 'graded', 'archived');
CREATE TYPE "ParticipationStatus" AS ENUM ('present', 'absent', 'exempt', 'excused', 'malpractice', 'special_consideration');
CREATE TYPE "StudentAssessmentStatus" AS ENUM ('assigned', 'opened', 'in_progress', 'submitted', 'resubmitted', 'returned', 'resubmission_requested', 'graded');
CREATE TYPE "MarkRound" AS ENUM ('first', 'second_blind', 'reconciliation');
CREATE TYPE "MarkAdjustmentKind" AS ENUM ('moderation', 'scaling', 'late_penalty', 'special_consideration', 'correction');
CREATE TYPE "RoundingMode" AS ENUM ('half_up', 'half_even', 'floor', 'ceil');
CREATE TYPE "AggregationMethod" AS ENUM ('mean', 'sum', 'best_n', 'last', 'weighted_mean');

-- ─────────────────────────────── Tables ───────────────────────────────
CREATE TABLE "AssessmentPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gradeLevelId" TEXT,
    "classId" TEXT,
    "subjectId" TEXT,
    "termId" TEXT,
    "passMark" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "caCap" DECIMAL(5,2),
    "roundingMode" "RoundingMode" NOT NULL DEFAULT 'half_up',
    "decimalPlaces" INTEGER NOT NULL DEFAULT 2,
    "rankingPolicy" JSONB NOT NULL DEFAULT '{}',
    "aggregationPolicy" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "AssessmentPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssessmentComponent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AssessmentKind" NOT NULL,
    "weight" DECIMAL(6,3) NOT NULL,
    "aggregation" "AggregationMethod" NOT NULL DEFAULT 'mean',
    "bestN" INTEGER,
    "countsAbsentAsZero" BOOLEAN NOT NULL DEFAULT true,
    "examTypeId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "AssessmentComponent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "componentId" TEXT,
    "subjectId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "maxScore" DECIMAL(8,2) NOT NULL DEFAULT 100,
    "weightInComponent" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "sourceType" "AssessmentSourceType" NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'draft',
    "dueAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentAssessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "classId" TEXT,
    "sectionId" TEXT,
    "gradeLevelId" TEXT,
    "termId" TEXT,
    "status" "StudentAssessmentStatus" NOT NULL DEFAULT 'assigned',
    "participation" "ParticipationStatus" NOT NULL DEFAULT 'present',
    "maxScore" DECIMAL(8,2) NOT NULL,
    "originalScore" DECIMAL(8,2),
    "effectiveScore" DECIMAL(8,2),
    "percentage" DECIMAL(6,3),
    "approvalStatus" "GradeEntryStatus" NOT NULL DEFAULT 'draft',
    "enteredById" TEXT,
    "approvedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "StudentAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarkEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentAssessmentId" TEXT NOT NULL,
    "markerId" TEXT,
    "round" "MarkRound" NOT NULL DEFAULT 'first',
    "score" DECIMAL(8,2) NOT NULL,
    "comment" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarkEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarkAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentAssessmentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "MarkAdjustmentKind" NOT NULL,
    "delta" DECIMAL(8,2),
    "replacementScore" DECIMAL(8,2),
    "reason" TEXT NOT NULL,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarkAdjustment_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────── Indexes / uniques ───────────────────────────
CREATE INDEX "AssessmentPolicy_organizationId_idx" ON "AssessmentPolicy"("organizationId");
CREATE INDEX "AssessmentPolicy_scope_idx" ON "AssessmentPolicy"("organizationId", "subjectId", "classId", "gradeLevelId", "termId");

CREATE INDEX "AssessmentComponent_organizationId_idx" ON "AssessmentComponent"("organizationId");
CREATE INDEX "AssessmentComponent_policyId_idx" ON "AssessmentComponent"("policyId");
CREATE INDEX "AssessmentComponent_org_examType_idx" ON "AssessmentComponent"("organizationId", "examTypeId");

CREATE UNIQUE INDEX "Assessment_origin_unique" ON "Assessment"("organizationId", "sourceType", "sourceRef");
CREATE INDEX "Assessment_organizationId_idx" ON "Assessment"("organizationId");
CREATE INDEX "Assessment_org_class_term_subject_idx" ON "Assessment"("organizationId", "classId", "termId", "subjectId");
CREATE INDEX "Assessment_componentId_idx" ON "Assessment"("componentId");

CREATE UNIQUE INDEX "StudentAssessment_assessment_student_unique" ON "StudentAssessment"("assessmentId", "studentProfileId");
CREATE INDEX "StudentAssessment_organizationId_idx" ON "StudentAssessment"("organizationId");
CREATE INDEX "StudentAssessment_org_student_idx" ON "StudentAssessment"("organizationId", "studentProfileId");
CREATE INDEX "StudentAssessment_org_student_term_idx" ON "StudentAssessment"("organizationId", "studentProfileId", "termId");

CREATE UNIQUE INDEX "MarkEntry_studentAssessment_round_unique" ON "MarkEntry"("studentAssessmentId", "round");
CREATE INDEX "MarkEntry_organizationId_idx" ON "MarkEntry"("organizationId");

CREATE UNIQUE INDEX "MarkAdjustment_studentAssessment_sequence_unique" ON "MarkAdjustment"("studentAssessmentId", "sequence");
CREATE INDEX "MarkAdjustment_organizationId_idx" ON "MarkAdjustment"("organizationId");
CREATE INDEX "MarkAdjustment_studentAssessmentId_idx" ON "MarkAdjustment"("studentAssessmentId");

-- ─────────────────────────── Foreign keys (intra-cluster) ───────────────────────────
ALTER TABLE "AssessmentComponent" ADD CONSTRAINT "AssessmentComponent_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AssessmentPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "AssessmentComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudentAssessment" ADD CONSTRAINT "StudentAssessment_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarkEntry" ADD CONSTRAINT "MarkEntry_studentAssessmentId_fkey" FOREIGN KEY ("studentAssessmentId") REFERENCES "StudentAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarkAdjustment" ADD CONSTRAINT "MarkAdjustment_studentAssessmentId_fkey" FOREIGN KEY ("studentAssessmentId") REFERENCES "StudentAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────── CHECK constraints (structural invariants) ───────────────────────────
ALTER TABLE "AssessmentComponent" ADD CONSTRAINT "AssessmentComponent_weight_check" CHECK ("weight" >= 0 AND "weight" <= 100);
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_maxScore_check" CHECK ("maxScore" > 0);
ALTER TABLE "StudentAssessment" ADD CONSTRAINT "StudentAssessment_score_range_check" CHECK (
    "maxScore" > 0
    AND ("originalScore" IS NULL OR ("originalScore" >= 0 AND "originalScore" <= "maxScore"))
    AND ("effectiveScore" IS NULL OR ("effectiveScore" >= 0 AND "effectiveScore" <= "maxScore"))
);
ALTER TABLE "MarkEntry" ADD CONSTRAINT "MarkEntry_score_check" CHECK ("score" >= 0);
-- Exactly one of delta / replacementScore must be set.
ALTER TABLE "MarkAdjustment" ADD CONSTRAINT "MarkAdjustment_delta_xor_replacement_check" CHECK (
    ("delta" IS NOT NULL AND "replacementScore" IS NULL)
    OR ("delta" IS NULL AND "replacementScore" IS NOT NULL)
);

-- ─────────────────────────── Append-only ledger trigger ───────────────────────────
-- MarkAdjustment is an immutable audit ledger: a moderation is never edited or
-- deleted, only superseded by a later adjustment. Enforce that at the database.
CREATE OR REPLACE FUNCTION assessment_markadjustment_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'MarkAdjustment is append-only: % is not permitted (add a new adjustment to reverse)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER markadjustment_no_mutate
    BEFORE UPDATE OR DELETE ON "MarkAdjustment"
    FOR EACH ROW EXECUTE FUNCTION assessment_markadjustment_append_only();

-- ─────────────────────────── RLS (inert; companion to app-side ORG_SCOPED) ───────────────────────────
-- Same shape as 20260812120001_school_rls: FORCE + policy, deliberately NOT
-- ENABLE. Isolation is enforced by the Prisma tenancy extension until an
-- operator turns RLS on org-wide.
DO $$
DECLARE
    t text;
    assessment_tables text[] := ARRAY[
        'AssessmentPolicy',
        'AssessmentComponent',
        'Assessment',
        'StudentAssessment',
        'MarkEntry',
        'MarkAdjustment'
    ];
BEGIN
    FOREACH t IN ARRAY assessment_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));',
            t
        );
    END LOOP;
END $$;

-- ─────────────────────────── Backfill: project legacy GradeEntry → spine ───────────────────────────
-- One Assessment per ExamSchedule that has grade entries; one StudentAssessment
-- per GradeEntry; one first-round MarkEntry per graded mark. Idempotent via the
-- origin/round/student unique indexes, so re-running is a no-op.

-- 1) Assessment per exam schedule (componentId left null — unmapped until a
--    policy attaches it; the adapter and A3 handle attachment).
INSERT INTO "Assessment" (
    "id", "organizationId", "componentId", "subjectId", "classId", "termId",
    "title", "maxScore", "weightInComponent", "sourceType", "sourceRef",
    "status", "version", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(), es."organizationId", NULL, es."subjectId", es."classId", e."termId",
    COALESCE(sub."name", 'Exam') || ' — ' || e."name", es."maxMarks", 1, 'exam_session', es."id",
    'graded', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ExamSchedule" es
JOIN "Exam" e ON e."id" = es."examId"
LEFT JOIN "Subject" sub ON sub."id" = es."subjectId"
WHERE EXISTS (SELECT 1 FROM "GradeEntry" ge WHERE ge."examScheduleId" = es."id")
ON CONFLICT ("organizationId", "sourceType", "sourceRef") DO NOTHING;

-- 2) StudentAssessment per GradeEntry, linked through the assessment's sourceRef.
INSERT INTO "StudentAssessment" (
    "id", "organizationId", "assessmentId", "studentProfileId", "classId", "termId",
    "status", "participation", "maxScore", "originalScore", "effectiveScore", "percentage",
    "approvalStatus", "enteredById", "approvedById", "version", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(), ge."organizationId", a."id", ge."studentProfileId", es."classId", e."termId",
    'graded', 'present', ge."maxMarks", ge."marksObtained", ge."marksObtained",
    CASE WHEN ge."maxMarks" > 0 AND ge."marksObtained" IS NOT NULL
         THEN ROUND((ge."marksObtained" / ge."maxMarks") * 100, 3) ELSE NULL END,
    ge."status", ge."enteredById", ge."approvedById", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "GradeEntry" ge
JOIN "ExamSchedule" es ON es."id" = ge."examScheduleId"
JOIN "Exam" e ON e."id" = es."examId"
JOIN "Assessment" a ON a."organizationId" = ge."organizationId" AND a."sourceType" = 'exam_session' AND a."sourceRef" = ge."examScheduleId"
ON CONFLICT ("assessmentId", "studentProfileId") DO NOTHING;

-- 3) First-round MarkEntry per graded mark.
INSERT INTO "MarkEntry" (
    "id", "organizationId", "studentAssessmentId", "markerId", "round", "score", "enteredAt"
)
SELECT
    gen_random_uuid(), sa."organizationId", sa."id", sa."enteredById", 'first', sa."originalScore", CURRENT_TIMESTAMP
FROM "StudentAssessment" sa
JOIN "Assessment" a ON a."id" = sa."assessmentId"
WHERE a."sourceType" = 'exam_session' AND sa."originalScore" IS NOT NULL
ON CONFLICT ("studentAssessmentId", "round") DO NOTHING;
