-- Phase 0: make an academic write traceable from an HTTP error/log line to the
-- durable audit record. Worker-created rows intentionally keep this nullable.
ALTER TABLE "AuditLog" ADD COLUMN "requestId" TEXT;

CREATE INDEX "AuditLog_organizationId_requestId_idx"
  ON "AuditLog"("organizationId", "requestId");
