-- Phase 5 — examination operations and result integrity.
-- Additive only. No legacy exam or grade table is dropped, and no existing row
-- changes meaning: every new column carries the behaviour that was already in
-- force (single marking, draft lifecycle, no moderation) as its default.

-- ── enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "ExamLifecycleState" AS ENUM ('draft','setup','scheduled','candidates_locked','in_progress','marking','moderation','results_ready','closed','archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ExamAttendanceStatus" AS ENUM ('present','absent','late','excused','malpractice','withdrawn'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ExamIncidentType" AS ENUM ('malpractice','illness','disruption','missing_script','late_arrival','material_error','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ExamIncidentStatus" AS ENUM ('open','under_review','resolved','dismissed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SpecialConsiderationType" AS ENUM ('extra_time','separate_room','reader','scribe','rest_breaks','enlarged_print','alternative_format','aegrotat','exemption','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SpecialConsiderationStatus" AS ENUM ('requested','approved','rejected','withdrawn'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "MarkingMode" AS ENUM ('single','double','blind_double'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ScriptMarkRole" AS ENUM ('first','second','moderator','reconciliation'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ScriptAllocationStatus" AS ENUM ('allocated','in_progress','submitted','reconciled','void'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "CustodyAction" AS ENUM ('authored','moderated','approved','printed','sealed','stored','dispatched','received','opened','distributed','collected','returned','archived','destroyed','incident'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ModerationSampleStatus" AS ENUM ('drawn','in_review','agreed','adjusted','escalated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ReportDocumentType" AS ENUM ('term_report','competency_report','exam_result_slip','transcript','promotion_notice'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ReportDocumentStatus" AS ENUM ('draft','generated','published','superseded','void'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PromotionDecisionStatus" AS ENUM ('proposed','approved','rejected','applied'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── existing tables: additive columns ────────────────────────────────────────
ALTER TABLE "Exam"
  ADD COLUMN IF NOT EXISTS "lifecycleState" "ExamLifecycleState" NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS "activeSnapshotId" TEXT,
  ADD COLUMN IF NOT EXISTS "markingMode" "MarkingMode" NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS "candidatesLockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "candidatesLockedById" TEXT,
  ADD COLUMN IF NOT EXISTS "resultsReadyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ExamSchedule"
  ADD COLUMN IF NOT EXISTS "markingMode" "MarkingMode" NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS "markToleranceMarks" DECIMAL(8,2) NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "moderationRequired" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "AmendmentRequest"
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "decisionNote" TEXT,
  ADD COLUMN IF NOT EXISTS "evidence" JSONB NOT NULL DEFAULT '[]';

-- Adopt the state an existing exam is already in, rather than resetting every
-- historical exam to 'draft'. `status` remains the legacy flag.
UPDATE "Exam" SET "lifecycleState" = CASE
  WHEN "status" = 'closed' THEN 'closed'::"ExamLifecycleState"
  WHEN "status" = 'published' THEN 'scheduled'::"ExamLifecycleState"
  WHEN "status" = 'scheduled' THEN 'scheduled'::"ExamLifecycleState"
  ELSE 'draft'::"ExamLifecycleState" END
WHERE "lifecycleState" = 'draft';

-- ── candidate snapshot ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ExamCandidateSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "checksum" TEXT NOT NULL,
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "frozenById" TEXT,
  "supersedesId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExamCandidateSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExamCandidateSnapshot_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExamCandidateSnapshot_examId_revision_key" ON "ExamCandidateSnapshot"("examId","revision");
CREATE INDEX IF NOT EXISTS "ExamCandidateSnapshot_organizationId_idx" ON "ExamCandidateSnapshot"("organizationId");
CREATE INDEX IF NOT EXISTS "ExamCandidateSnapshot_examId_idx" ON "ExamCandidateSnapshot"("examId");

CREATE TABLE IF NOT EXISTS "ExamCandidateEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "examRegistrationId" TEXT,
  "classId" TEXT,
  "sectionId" TEXT,
  "streamId" TEXT,
  "candidateNumber" TEXT,
  "indexNumber" TEXT,
  "venueId" TEXT,
  "seatNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExamCandidateEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExamCandidateEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ExamCandidateSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExamCandidateEntry_snapshotId_studentProfileId_key" ON "ExamCandidateEntry"("snapshotId","studentProfileId");
CREATE INDEX IF NOT EXISTS "ExamCandidateEntry_organizationId_idx" ON "ExamCandidateEntry"("organizationId");
CREATE INDEX IF NOT EXISTS "ExamCandidateEntry_snapshotId_idx" ON "ExamCandidateEntry"("snapshotId");
CREATE INDEX IF NOT EXISTS "ExamCandidateEntry_organizationId_studentProfileId_idx" ON "ExamCandidateEntry"("organizationId","studentProfileId");

-- ── session operations ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ExamAttendance" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "examScheduleId" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "status" "ExamAttendanceStatus" NOT NULL DEFAULT 'present',
  "arrivedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3),
  "venueId" TEXT,
  "seatNumber" TEXT,
  "scriptNumber" TEXT,
  "note" TEXT,
  "recordedById" TEXT,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExamAttendance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExamAttendance_examScheduleId_fkey" FOREIGN KEY ("examScheduleId") REFERENCES "ExamSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExamAttendance_examScheduleId_studentProfileId_key" ON "ExamAttendance"("examScheduleId","studentProfileId");
CREATE INDEX IF NOT EXISTS "ExamAttendance_organizationId_idx" ON "ExamAttendance"("organizationId");
CREATE INDEX IF NOT EXISTS "ExamAttendance_examScheduleId_idx" ON "ExamAttendance"("examScheduleId");
CREATE INDEX IF NOT EXISTS "ExamAttendance_organizationId_studentProfileId_idx" ON "ExamAttendance"("organizationId","studentProfileId");

CREATE TABLE IF NOT EXISTS "ExamIncident" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "examScheduleId" TEXT,
  "studentProfileId" TEXT,
  "type" "ExamIncidentType" NOT NULL,
  "status" "ExamIncidentStatus" NOT NULL DEFAULT 'open',
  "severity" TEXT NOT NULL DEFAULT 'medium',
  "description" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reportedById" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "resolution" TEXT,
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExamIncident_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExamIncident_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExamIncident_examScheduleId_fkey" FOREIGN KEY ("examScheduleId") REFERENCES "ExamSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ExamIncident_organizationId_idx" ON "ExamIncident"("organizationId");
CREATE INDEX IF NOT EXISTS "ExamIncident_examId_idx" ON "ExamIncident"("examId");
CREATE INDEX IF NOT EXISTS "ExamIncident_examScheduleId_idx" ON "ExamIncident"("examScheduleId");
CREATE INDEX IF NOT EXISTS "ExamIncident_organizationId_studentProfileId_idx" ON "ExamIncident"("organizationId","studentProfileId");

CREATE TABLE IF NOT EXISTS "SpecialConsideration" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "examScheduleId" TEXT,
  "type" "SpecialConsiderationType" NOT NULL,
  "status" "SpecialConsiderationStatus" NOT NULL DEFAULT 'requested',
  "extraTimeMinutes" INTEGER,
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "exemptsFromResult" BOOLEAN NOT NULL DEFAULT false,
  "requestedById" TEXT,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpecialConsideration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SpecialConsideration_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SpecialConsideration_examScheduleId_fkey" FOREIGN KEY ("examScheduleId") REFERENCES "ExamSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SpecialConsideration_organizationId_idx" ON "SpecialConsideration"("organizationId");
CREATE INDEX IF NOT EXISTS "SpecialConsideration_examId_idx" ON "SpecialConsideration"("examId");
CREATE INDEX IF NOT EXISTS "SpecialConsideration_organizationId_studentProfileId_idx" ON "SpecialConsideration"("organizationId","studentProfileId");

-- ── question-paper custody ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "QuestionPaperCustodyEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "questionPaperId" TEXT NOT NULL,
  "examScheduleId" TEXT,
  "action" "CustodyAction" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" TEXT,
  "actorName" TEXT,
  "custodianId" TEXT,
  "custodianName" TEXT,
  "sealNumber" TEXT,
  "copies" INTEGER,
  "location" TEXT,
  "note" TEXT,
  "previousEventId" TEXT,
  "chainHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionPaperCustodyEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuestionPaperCustodyEvent_questionPaperId_fkey" FOREIGN KEY ("questionPaperId") REFERENCES "QuestionPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "QuestionPaperCustodyEvent_organizationId_idx" ON "QuestionPaperCustodyEvent"("organizationId");
CREATE INDEX IF NOT EXISTS "QuestionPaperCustodyEvent_questionPaperId_occurredAt_idx" ON "QuestionPaperCustodyEvent"("questionPaperId","occurredAt");

-- The custody log is evidence. Append-only at the database boundary, so a
-- service bug or a direct connection cannot quietly rewrite the chain.
CREATE OR REPLACE FUNCTION phase5_custody_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Question paper custody events are append-only';
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "QuestionPaperCustodyEvent_append_only" ON "QuestionPaperCustodyEvent";
CREATE TRIGGER "QuestionPaperCustodyEvent_append_only"
  BEFORE UPDATE OR DELETE ON "QuestionPaperCustodyEvent"
  FOR EACH ROW EXECUTE FUNCTION phase5_custody_append_only();

-- ── script marking + moderation ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ScriptAllocation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "examScheduleId" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "anonymousCode" TEXT NOT NULL,
  "markerId" TEXT NOT NULL,
  "role" "ScriptMarkRole" NOT NULL DEFAULT 'first',
  "status" "ScriptAllocationStatus" NOT NULL DEFAULT 'allocated',
  "maxScore" DECIMAL(8,2) NOT NULL,
  "score" DECIMAL(8,2),
  "comment" TEXT,
  "allocatedById" TEXT,
  "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScriptAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScriptAllocation_examScheduleId_fkey" FOREIGN KEY ("examScheduleId") REFERENCES "ExamSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScriptAllocation_score_range" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= "maxScore"))
);
CREATE UNIQUE INDEX IF NOT EXISTS "ScriptAllocation_examScheduleId_studentProfileId_role_key" ON "ScriptAllocation"("examScheduleId","studentProfileId","role");
CREATE INDEX IF NOT EXISTS "ScriptAllocation_organizationId_idx" ON "ScriptAllocation"("organizationId");
CREATE INDEX IF NOT EXISTS "ScriptAllocation_examScheduleId_idx" ON "ScriptAllocation"("examScheduleId");
CREATE INDEX IF NOT EXISTS "ScriptAllocation_organizationId_markerId_idx" ON "ScriptAllocation"("organizationId","markerId");

-- A second read that is not independent is not a second read.
CREATE OR REPLACE FUNCTION phase5_independent_markers() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ScriptAllocation" a
    WHERE a."examScheduleId" = NEW."examScheduleId"
      AND a."studentProfileId" = NEW."studentProfileId"
      AND a."markerId" = NEW."markerId"
      AND a."role" <> NEW."role"
      AND a."id" <> NEW."id"
      AND a."status" <> 'void'
  ) THEN
    RAISE EXCEPTION 'A script cannot be marked twice by the same marker';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "ScriptAllocation_independent_markers" ON "ScriptAllocation";
CREATE TRIGGER "ScriptAllocation_independent_markers"
  BEFORE INSERT OR UPDATE ON "ScriptAllocation"
  FOR EACH ROW EXECUTE FUNCTION phase5_independent_markers();

CREATE TABLE IF NOT EXISTS "ModerationSample" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "examScheduleId" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'stratified',
  "seed" TEXT,
  "sampleSize" INTEGER NOT NULL DEFAULT 0,
  "toleranceMarks" DECIMAL(8,2) NOT NULL DEFAULT 5,
  "status" "ModerationSampleStatus" NOT NULL DEFAULT 'drawn',
  "drawnById" TEXT,
  "drawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "moderatorId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "outcome" JSONB NOT NULL DEFAULT '{}',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationSample_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModerationSample_examScheduleId_fkey" FOREIGN KEY ("examScheduleId") REFERENCES "ExamSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ModerationSample_organizationId_idx" ON "ModerationSample"("organizationId");
CREATE INDEX IF NOT EXISTS "ModerationSample_examScheduleId_idx" ON "ModerationSample"("examScheduleId");

CREATE TABLE IF NOT EXISTS "ModerationSampleItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sampleId" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "anonymousCode" TEXT,
  "originalScore" DECIMAL(8,2),
  "moderatedScore" DECIMAL(8,2),
  "delta" DECIMAL(8,2),
  "withinTolerance" BOOLEAN,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModerationSampleItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ModerationSampleItem_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "ModerationSample"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ModerationSampleItem_sampleId_studentProfileId_key" ON "ModerationSampleItem"("sampleId","studentProfileId");
CREATE INDEX IF NOT EXISTS "ModerationSampleItem_organizationId_idx" ON "ModerationSampleItem"("organizationId");
CREATE INDEX IF NOT EXISTS "ModerationSampleItem_sampleId_idx" ON "ModerationSampleItem"("sampleId");

-- ── report documents ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ReportDocument" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "termId" TEXT NOT NULL,
  "documentType" "ReportDocumentType" NOT NULL DEFAULT 'term_report',
  "resultSetId" TEXT,
  "resultSetRevision" INTEGER,
  "reportCardId" TEXT,
  "templateVersionId" TEXT,
  "templateKey" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" "ReportDocumentStatus" NOT NULL DEFAULT 'generated',
  "payload" JSONB NOT NULL DEFAULT '{}',
  "payloadChecksum" TEXT NOT NULL,
  "pdfUrl" TEXT,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generatedById" TEXT,
  "publishedAt" TIMESTAMP(3),
  "publishedById" TEXT,
  "supersedesId" TEXT,
  "supersededById" TEXT,
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ReportDocument_identity_key"
  ON "ReportDocument"("studentProfileId","termId","documentType","resultSetId","templateVersionId","revision");
CREATE INDEX IF NOT EXISTS "ReportDocument_organizationId_idx" ON "ReportDocument"("organizationId");
CREATE INDEX IF NOT EXISTS "ReportDocument_organizationId_studentProfileId_idx" ON "ReportDocument"("organizationId","studentProfileId");
CREATE INDEX IF NOT EXISTS "ReportDocument_organizationId_termId_documentType_idx" ON "ReportDocument"("organizationId","termId","documentType");
CREATE INDEX IF NOT EXISTS "ReportDocument_resultSetId_idx" ON "ReportDocument"("resultSetId");

-- A published document is what a parent already holds. Only status, supersession
-- and the void reason may move afterwards; the payload it was printed from
-- cannot. A correction is a new revision.
CREATE OR REPLACE FUNCTION phase5_report_document_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('published','superseded') THEN
      RAISE EXCEPTION 'A published report document cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'published' AND (
       NEW."payload"::text IS DISTINCT FROM OLD."payload"::text
    OR NEW."payloadChecksum" IS DISTINCT FROM OLD."payloadChecksum"
    OR NEW."resultSetId" IS DISTINCT FROM OLD."resultSetId"
    OR NEW."resultSetRevision" IS DISTINCT FROM OLD."resultSetRevision"
    OR NEW."templateVersionId" IS DISTINCT FROM OLD."templateVersionId"
    OR NEW."revision" IS DISTINCT FROM OLD."revision"
  ) THEN
    RAISE EXCEPTION 'A published report document is immutable; issue a new revision';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "ReportDocument_immutable" ON "ReportDocument";
CREATE TRIGGER "ReportDocument_immutable"
  BEFORE UPDATE OR DELETE ON "ReportDocument"
  FOR EACH ROW EXECUTE FUNCTION phase5_report_document_immutable();

-- ── promotion decisions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PromotionDecision" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "resultSetId" TEXT NOT NULL,
  "termId" TEXT NOT NULL,
  "academicYearId" TEXT,
  "fromGradeLevelId" TEXT,
  "fromClassId" TEXT,
  "recommendation" "PromotionRecommendation" NOT NULL DEFAULT 'review',
  "decision" "PromotionRecommendation",
  "toGradeLevelId" TEXT,
  "toClassId" TEXT,
  "toSectionId" TEXT,
  "toStreamId" TEXT,
  "status" "PromotionDecisionStatus" NOT NULL DEFAULT 'proposed',
  "basis" JSONB NOT NULL DEFAULT '{}',
  "reason" TEXT,
  "proposedById" TEXT,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "appliedById" TEXT,
  "enrollmentPlacementId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromotionDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PromotionDecision_resultSetId_fkey" FOREIGN KEY ("resultSetId") REFERENCES "ResultSet"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PromotionDecision_resultSetId_studentProfileId_key" ON "PromotionDecision"("resultSetId","studentProfileId");
CREATE INDEX IF NOT EXISTS "PromotionDecision_organizationId_idx" ON "PromotionDecision"("organizationId");
CREATE INDEX IF NOT EXISTS "PromotionDecision_organizationId_studentProfileId_idx" ON "PromotionDecision"("organizationId","studentProfileId");
CREATE INDEX IF NOT EXISTS "PromotionDecision_resultSetId_idx" ON "PromotionDecision"("resultSetId");

-- ── tenant isolation ─────────────────────────────────────────────────────────
-- Same shape as 20260903000100_phase1_enrollment_rls: FORCE + policy, but
-- deliberately NOT `ENABLE ROW LEVEL SECURITY`. In this deployment isolation is
-- enforced by the app-side Prisma tenancy extension and the policy lies dormant
-- until an operator turns RLS on org-wide via `pnpm rls:setup-role`. The
-- matching ORG_SCOPED registration is verified by tenancy-registration.spec.ts.
DO $$
DECLARE
    t text;
    phase5_tables text[] := ARRAY[
        'ExamAttendance',
        'ExamCandidateEntry',
        'ExamCandidateSnapshot',
        'ExamIncident',
        'ModerationSample',
        'ModerationSampleItem',
        'PromotionDecision',
        'QuestionPaperCustodyEvent',
        'ReportDocument',
        'ScriptAllocation',
        'SpecialConsideration'
    ];
BEGIN
    FOREACH t IN ARRAY phase5_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));',
            t
        );
    END LOOP;
END $$;
