-- Communication platform Phase 2 — rule-engine idempotency ledger.
--
-- Domain events are at-least-once; this table makes a rule fire effectively-once
-- per (rule, event-instance) via a unique dedupeKey. Additive, and gated behind
-- ENABLE_COMMUNICATION at the app layer.

CREATE TABLE "CommunicationDispatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationDispatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunicationDispatch_organizationId_dedupeKey_key"
    ON "CommunicationDispatch"("organizationId", "dedupeKey");

CREATE INDEX "CommunicationDispatch_organizationId_ruleId_createdAt_idx"
    ON "CommunicationDispatch"("organizationId", "ruleId", "createdAt");

-- Tenant isolation policy — FORCE + policy but NOT ENABLE, matching the Phase 0
-- follow-on and every other org-scoped table in this deployment (RLS stays inert
-- until `pnpm rls:setup-role` turns it on org-wide).
ALTER TABLE "CommunicationDispatch" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CommunicationDispatch";
CREATE POLICY tenant_isolation ON "CommunicationDispatch"
    USING ("organizationId" = current_setting('app.org_id', true));
