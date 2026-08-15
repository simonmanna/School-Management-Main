-- A3 result spine: ResultProcessingRun, ResultSet, StudentSubjectResult,
-- StudentTermResult, AmendmentRequest. Published result sets are immutable —
-- enforced by a trigger, the same discipline as posted GL entries.

-- ─────────────────────────────── Enums ───────────────────────────────
CREATE TYPE "ResultScopeType" AS ENUM ('class', 'section', 'grade', 'campus', 'school');
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE "ResultSetStatus" AS ENUM ('draft', 'computing', 'computed', 'approved', 'published', 'locked', 'archived');
CREATE TYPE "AmendmentStatus" AS ENUM ('requested', 'approved', 'rejected', 'applied');
CREATE TYPE "PromotionRecommendation" AS ENUM ('promote', 'repeat', 'graduate', 'review');

-- ─────────────────────────────── Tables ───────────────────────────────
CREATE TABLE "ResultProcessingRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "scopeType" "ResultScopeType" NOT NULL DEFAULT 'class',
    "scopeId" TEXT,
    "rosterId" TEXT,
    "calculationVersion" TEXT NOT NULL DEFAULT 'v1',
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "initiatedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "inputChecksum" TEXT,
    "outputChecksum" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResultProcessingRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResultSet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT,
    "termId" TEXT NOT NULL,
    "scopeType" "ResultScopeType" NOT NULL DEFAULT 'class',
    "scopeId" TEXT,
    "rosterId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "ResultSetStatus" NOT NULL DEFAULT 'draft',
    "calculationVersion" TEXT NOT NULL DEFAULT 'v1',
    "roundingMode" "RoundingMode" NOT NULL DEFAULT 'half_up',
    "gradingSystem" TEXT,
    "policySnapshot" JSONB NOT NULL DEFAULT '{}',
    "gradingScaleSnapshot" JSONB NOT NULL DEFAULT '{}',
    "rankingPolicySnapshot" JSONB NOT NULL DEFAULT '{}',
    "aggregationSnapshot" JSONB NOT NULL DEFAULT '{}',
    "inputChecksum" TEXT,
    "outputChecksum" TEXT,
    "studentCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "ResultSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentSubjectResult" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resultSetId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "classId" TEXT,
    "sectionId" TEXT,
    "gradeLevelId" TEXT,
    "termId" TEXT,
    "caScore" DECIMAL(8,3),
    "examScore" DECIMAL(8,3),
    "finalPercent" DECIMAL(6,3),
    "grade" TEXT,
    "gradePoint" DECIMAL(4,2),
    "points" INTEGER,
    "subjectRank" INTEGER,
    "componentBreakdown" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentSubjectResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudentTermResult" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resultSetId" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "classId" TEXT,
    "sectionId" TEXT,
    "gradeLevelId" TEXT,
    "termId" TEXT,
    "gpa" DECIMAL(4,2),
    "aggregate" INTEGER,
    "division" TEXT,
    "meanPercent" DECIMAL(6,3),
    "classRank" INTEGER,
    "sectionRank" INTEGER,
    "subjectsCount" INTEGER NOT NULL DEFAULT 0,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "promotionRecommendation" "PromotionRecommendation" NOT NULL DEFAULT 'review',
    "incompleteReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentTermResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AmendmentRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resultSetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "status" "AmendmentStatus" NOT NULL DEFAULT 'requested',
    "requestedById" TEXT,
    "reviewedById" TEXT,
    "newResultSetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AmendmentRequest_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────── Indexes / uniques ───────────────────────────
CREATE UNIQUE INDEX "ResultProcessingRun_org_idem_unique" ON "ResultProcessingRun"("organizationId", "idempotencyKey");
CREATE INDEX "ResultProcessingRun_organizationId_idx" ON "ResultProcessingRun"("organizationId");
CREATE INDEX "ResultProcessingRun_org_term_idx" ON "ResultProcessingRun"("organizationId", "termId");

CREATE INDEX "ResultSet_organizationId_idx" ON "ResultSet"("organizationId");
CREATE INDEX "ResultSet_org_term_scope_idx" ON "ResultSet"("organizationId", "termId", "scopeType", "scopeId");
-- One non-archived result set per (org, term, scope). Partial so superseded
-- revisions (archived) don't collide with the live one.
CREATE UNIQUE INDEX "ResultSet_one_live_per_scope" ON "ResultSet"("organizationId", "termId", "scopeType", "scopeId")
    WHERE "status" <> 'archived' AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "StudentSubjectResult_set_student_subject_unique" ON "StudentSubjectResult"("resultSetId", "studentProfileId", "subjectId");
CREATE INDEX "StudentSubjectResult_organizationId_idx" ON "StudentSubjectResult"("organizationId");
CREATE INDEX "StudentSubjectResult_org_student_idx" ON "StudentSubjectResult"("organizationId", "studentProfileId");
CREATE INDEX "StudentSubjectResult_resultSetId_idx" ON "StudentSubjectResult"("resultSetId");

CREATE UNIQUE INDEX "StudentTermResult_set_student_unique" ON "StudentTermResult"("resultSetId", "studentProfileId");
CREATE INDEX "StudentTermResult_organizationId_idx" ON "StudentTermResult"("organizationId");
CREATE INDEX "StudentTermResult_org_student_idx" ON "StudentTermResult"("organizationId", "studentProfileId");
CREATE INDEX "StudentTermResult_resultSetId_idx" ON "StudentTermResult"("resultSetId");

CREATE INDEX "AmendmentRequest_organizationId_idx" ON "AmendmentRequest"("organizationId");
CREATE INDEX "AmendmentRequest_resultSetId_idx" ON "AmendmentRequest"("resultSetId");

-- ─────────────────────────── Foreign keys ───────────────────────────
ALTER TABLE "ResultSet" ADD CONSTRAINT "ResultSet_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResultProcessingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudentSubjectResult" ADD CONSTRAINT "StudentSubjectResult_resultSetId_fkey" FOREIGN KEY ("resultSetId") REFERENCES "ResultSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentTermResult" ADD CONSTRAINT "StudentTermResult_resultSetId_fkey" FOREIGN KEY ("resultSetId") REFERENCES "ResultSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AmendmentRequest" ADD CONSTRAINT "AmendmentRequest_resultSetId_fkey" FOREIGN KEY ("resultSetId") REFERENCES "ResultSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────── Immutability trigger ───────────────────────────
-- Once a ResultSet is published/locked/archived it is frozen. The only allowed
-- change is a status transition published→locked or published/locked→archived
-- (superseding). Everything else — and any change to its child result rows — is
-- rejected, so a published result can never be silently rewritten.
CREATE OR REPLACE FUNCTION resultset_immutable() RETURNS trigger AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        IF OLD."status" IN ('published', 'locked', 'archived') THEN
            RAISE EXCEPTION 'ResultSet % is % and cannot be deleted (amend → new revision instead)', OLD."id", OLD."status";
        END IF;
        RETURN OLD;
    END IF;
    -- UPDATE
    IF OLD."status" IN ('published', 'locked', 'archived') THEN
        -- Permit only the forward lifecycle transitions that supersede/lock.
        IF NEW."status" = OLD."status"
           OR (OLD."status" = 'published' AND NEW."status" IN ('locked', 'archived'))
           OR (OLD."status" = 'locked' AND NEW."status" = 'archived') THEN
            -- Allow the status column (and the audit/version bookkeeping) to move,
            -- but block edits to the computed payload.
            IF NEW."inputChecksum" IS DISTINCT FROM OLD."inputChecksum"
               OR NEW."outputChecksum" IS DISTINCT FROM OLD."outputChecksum"
               OR NEW."revision" IS DISTINCT FROM OLD."revision"
               OR NEW."policySnapshot"::text IS DISTINCT FROM OLD."policySnapshot"::text THEN
                RAISE EXCEPTION 'ResultSet % is % — its computed snapshot is immutable', OLD."id", OLD."status";
            END IF;
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'ResultSet % is % and cannot be modified (%->%)', OLD."id", OLD."status", OLD."status", NEW."status";
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resultset_immutability
    BEFORE UPDATE OR DELETE ON "ResultSet"
    FOR EACH ROW EXECUTE FUNCTION resultset_immutable();

-- Child result rows of a published/locked/archived set are fully immutable.
CREATE OR REPLACE FUNCTION result_child_immutable() RETURNS trigger AS $$
DECLARE
    parent_status "ResultSetStatus";
BEGIN
    SELECT "status" INTO parent_status FROM "ResultSet"
        WHERE "id" = COALESCE(OLD."resultSetId", NEW."resultSetId");
    IF parent_status IN ('published', 'locked', 'archived') THEN
        RAISE EXCEPTION 'Result rows of a % result set are immutable', parent_status;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER studentsubjectresult_immutability
    BEFORE UPDATE OR DELETE ON "StudentSubjectResult"
    FOR EACH ROW EXECUTE FUNCTION result_child_immutable();
CREATE TRIGGER studenttermresult_immutability
    BEFORE UPDATE OR DELETE ON "StudentTermResult"
    FOR EACH ROW EXECUTE FUNCTION result_child_immutable();

-- ─────────────────────────── RLS (inert; companion to app-side ORG_SCOPED) ───────────────────────────
DO $$
DECLARE
    t text;
    a3_tables text[] := ARRAY[
        'ResultProcessingRun',
        'ResultSet',
        'StudentSubjectResult',
        'StudentTermResult',
        'AmendmentRequest'
    ];
BEGIN
    FOREACH t IN ARRAY a3_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));',
            t
        );
    END LOOP;
END $$;
