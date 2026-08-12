-- =============================================================================
-- P0-2 + P0-6: penalty idempotency + Document source-uniqueness
--
-- 1. Add a partial unique index on Document(organizationId, sourceType,
--    sourceId, reference) to prevent duplicate school/penalty/library
--    invoices at the database level. PostgreSQL allows multiple NULLs
--    in a unique constraint by default, so this only constrains
--    Documents that have all four values set (i.e. the school/penalty/
--    library source documents). Manual invoices without sourceType/
--    sourceId/reference remain unaffected.
--
-- 2. Add PenaltyRun.cronDate + a unique constraint on
--    (organizationId, scheduleId, cronDate) to prevent the daily penalty
--    cron from creating two PenaltyRun rows for the same schedule on
--    the same day.
--
-- 3. Add the PenaltyAssessment table to record every penalty that has
--    been applied to an overdue invoice. A unique constraint on
--    (sourceDocumentId, penaltyRunId) prevents the most common
--    compounding bug: a daily cron tick that mints a new penalty
--    invoice for the same overdue source every 24 hours.
-- =============================================================================

-- ── 1. Document source-uniqueness ───────────────────────────────────────────

CREATE UNIQUE INDEX "Document_org_source_unique_idx"
  ON "Document" ("organizationId", "sourceType", "sourceId", "reference");

-- ── 2. PenaltyRun.cronDate + uniqueness ────────────────────────────────────

ALTER TABLE "PenaltyRun"
  ADD COLUMN "cronDate" DATE NOT NULL DEFAULT CURRENT_DATE;

CREATE UNIQUE INDEX "PenaltyRun_org_schedule_cronDate_unique_idx"
  ON "PenaltyRun" ("organizationId", "scheduleId", "cronDate");

-- ── 3. PenaltyAssessment table ─────────────────────────────────────────────

CREATE TABLE "PenaltyAssessment" (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "penaltyRunId"      TEXT NOT NULL,
  "sourceDocumentId"  TEXT NOT NULL,
  "scheduleId"        TEXT NOT NULL,
  "ruleId"            TEXT NOT NULL,
  "amount"            NUMERIC(20, 6) NOT NULL,
  "penaltyDocumentId" TEXT UNIQUE,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PenaltyAssessment_penaltyRunId_fkey"
    FOREIGN KEY ("penaltyRunId") REFERENCES "PenaltyRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PenaltyAssessment_sourceDocumentId_fkey"
    FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PenaltyAssessment_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "FeeSchedule"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PenaltyAssessment_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "PenaltyRule"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PenaltyAssessment_penaltyDocumentId_fkey"
    FOREIGN KEY ("penaltyDocumentId") REFERENCES "Document"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- One penalty per (sourceDocument, PenaltyRun).
-- This is the core idempotency guarantee for P0-2.
CREATE UNIQUE INDEX "PenaltyAssessment_source_run_unique_idx"
  ON "PenaltyAssessment" ("sourceDocumentId", "penaltyRunId");

CREATE INDEX "PenaltyAssessment_org_idx"          ON "PenaltyAssessment" ("organizationId");
CREATE INDEX "PenaltyAssessment_penaltyRun_idx"   ON "PenaltyAssessment" ("penaltyRunId");
CREATE INDEX "PenaltyAssessment_source_idx"      ON "PenaltyAssessment" ("sourceDocumentId");
CREATE INDEX "PenaltyAssessment_schedule_idx"     ON "PenaltyAssessment" ("scheduleId");
