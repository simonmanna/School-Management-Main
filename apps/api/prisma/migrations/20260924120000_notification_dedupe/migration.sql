-- Notification idempotency (E2E audit N1). Event-driven sends carry a
-- dedupeKey; a re-emitted event or a second reminder run must not message a
-- parent twice. Partial: ad-hoc notifications (no key) are unconstrained.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Notification_org_channel_dedupeKey_key"
  ON "Notification" ("organizationId", "channel", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;
