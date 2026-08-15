-- A5 CBT engine: question bank, papers, server-authoritative attempts.

CREATE TYPE "QuestionType" AS ENUM ('mcq_single', 'mcq_multi', 'true_false', 'short_answer', 'numeric', 'matching', 'fill_blank', 'essay');
CREATE TYPE "QuizAttemptStatus" AS ENUM ('not_started', 'in_progress', 'submitted', 'auto_submitted', 'abandoned', 'reset');

CREATE TABLE "QuestionBank" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subjectId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "QuestionBank_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "marks" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "answerKey" JSONB NOT NULL DEFAULT '{}',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "difficulty" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersededById" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Paper" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subjectId" TEXT,
    "totalMarks" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "isRandom" BOOLEAN NOT NULL DEFAULT false,
    "blueprint" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "Paper_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaperQuestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "marks" DECIMAL(8,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaperQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "studentAssessmentId" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "QuizAttemptStatus" NOT NULL DEFAULT 'in_progress',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "realisedQuestions" JSONB NOT NULL DEFAULT '[]',
    "autoScore" DECIMAL(8,2),
    "manualPending" INTEGER NOT NULL DEFAULT 0,
    "maxScore" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "serverSequence" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuizResponse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "clientEventId" TEXT,
    "sequenceNumber" INTEGER NOT NULL DEFAULT 0,
    "response" JSONB NOT NULL DEFAULT '{}',
    "autoScore" DECIMAL(8,2),
    "isCorrect" BOOLEAN,
    "needsManual" BOOLEAN NOT NULL DEFAULT false,
    "serverReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuizResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttemptEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttemptEvent_pkey" PRIMARY KEY ("id")
);

-- Indexes / uniques
CREATE INDEX "QuestionBank_organizationId_idx" ON "QuestionBank"("organizationId");
CREATE INDEX "QuestionBank_org_subject_idx" ON "QuestionBank"("organizationId", "subjectId");
CREATE INDEX "Question_organizationId_idx" ON "Question"("organizationId");
CREATE INDEX "Question_bankId_idx" ON "Question"("bankId");
CREATE INDEX "QuestionOption_organizationId_idx" ON "QuestionOption"("organizationId");
CREATE INDEX "QuestionOption_questionId_idx" ON "QuestionOption"("questionId");
CREATE INDEX "Paper_organizationId_idx" ON "Paper"("organizationId");
CREATE UNIQUE INDEX "PaperQuestion_paper_question_unique" ON "PaperQuestion"("paperId", "questionId");
CREATE INDEX "PaperQuestion_organizationId_idx" ON "PaperQuestion"("organizationId");
CREATE INDEX "PaperQuestion_paperId_idx" ON "PaperQuestion"("paperId");
CREATE INDEX "QuizAttempt_organizationId_idx" ON "QuizAttempt"("organizationId");
CREATE INDEX "QuizAttempt_org_student_idx" ON "QuizAttempt"("organizationId", "studentProfileId");
CREATE INDEX "QuizAttempt_paperId_idx" ON "QuizAttempt"("paperId");
CREATE UNIQUE INDEX "QuizResponse_attempt_question_unique" ON "QuizResponse"("attemptId", "questionId");
CREATE INDEX "QuizResponse_organizationId_idx" ON "QuizResponse"("organizationId");
CREATE INDEX "QuizResponse_attemptId_idx" ON "QuizResponse"("attemptId");
CREATE INDEX "AttemptEvent_organizationId_idx" ON "AttemptEvent"("organizationId");
CREATE INDEX "AttemptEvent_attemptId_idx" ON "AttemptEvent"("attemptId");

-- Foreign keys
ALTER TABLE "Question" ADD CONSTRAINT "Question_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "QuestionBank"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaperQuestion" ADD CONSTRAINT "PaperQuestion_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuizResponse" ADD CONSTRAINT "QuizResponse_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttemptEvent" ADD CONSTRAINT "AttemptEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuizAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK
ALTER TABLE "Question" ADD CONSTRAINT "Question_marks_check" CHECK ("marks" >= 0);
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_expiry_check" CHECK ("expiresAt" > "startedAt");

-- Append-only AttemptEvent trigger (reuses the same style as MarkAdjustment).
CREATE OR REPLACE FUNCTION attempt_event_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'AttemptEvent is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attemptevent_no_mutate
    BEFORE UPDATE OR DELETE ON "AttemptEvent"
    FOR EACH ROW EXECUTE FUNCTION attempt_event_append_only();

-- RLS (inert)
DO $$
DECLARE
    t text;
    a5_tables text[] := ARRAY['QuestionBank', 'Question', 'QuestionOption', 'Paper', 'PaperQuestion', 'QuizAttempt', 'QuizResponse', 'AttemptEvent'];
BEGIN
    FOREACH t IN ARRAY a5_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));', t);
    END LOOP;
END $$;
