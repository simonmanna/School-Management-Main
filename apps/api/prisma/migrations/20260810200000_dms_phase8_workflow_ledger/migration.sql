-- Phase 8: DMS workflow subscription ledger.
-- Idempotent write-once ledger consumed by the DmsWorkflowSubscriber (DMS
-- domain events → POS inventory / billing / ledger hooks). Re-play safe via
-- the (documentId, action) unique constraint.

CREATE TABLE IF NOT EXISTS "DMSWorkflowLedger" (
    "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "organizationId"  TEXT NOT NULL,
    "documentId"      TEXT NOT NULL,
    "documentTypeCode" TEXT NOT NULL,
    "action"          TEXT NOT NULL,
    "payload"         JSONB NOT NULL DEFAULT '{}'::jsonb,
    "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "DMSWorkflowLedger_documentId_action_key"
    ON "DMSWorkflowLedger" ("documentId", "action");
CREATE INDEX IF NOT EXISTS "DMSWorkflowLedger_organizationId_idx"
    ON "DMSWorkflowLedger" ("organizationId");
CREATE INDEX IF NOT EXISTS "DMSWorkflowLedger_documentTypeCode_action_idx"
    ON "DMSWorkflowLedger" ("documentTypeCode", "action");

-- Row-level security (mirrors the D1-1 tenant_isolation policy pattern).
ALTER TABLE "DMSWorkflowLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DMSWorkflowLedger" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DMSWorkflowLedger";
CREATE POLICY tenant_isolation ON "DMSWorkflowLedger"
    USING ("organizationId" = current_setting('app.org_id', true));
