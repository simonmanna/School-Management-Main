-- Messaging module, phases 3-4 — broadcast engine + transport fallback chains.
--
-- Applied manually (see prisma/manual/ for the convention). Every statement is
-- idempotent so a re-run on a partially-migrated database is safe.

BEGIN;

-- 1. Fallback + broadcast backlinks on the delivery/outbox table.
--    `fallbackPolicy` carries the REMAINING transports for this delivery; each
--    escalation consumes one step, which is what makes a chain strictly finite.
--    `broadcastId`/`broadcastRecipientId` are denormalised so the delivery report
--    is an indexed group-by rather than a join back through Message.
ALTER TABLE "MessageDelivery" ADD COLUMN IF NOT EXISTS "fallbackPolicy" JSONB;
ALTER TABLE "MessageDelivery" ADD COLUMN IF NOT EXISTS "fallbackOfDeliveryId" TEXT;
ALTER TABLE "MessageDelivery" ADD COLUMN IF NOT EXISTS "broadcastId" TEXT;
ALTER TABLE "MessageDelivery" ADD COLUMN IF NOT EXISTS "broadcastRecipientId" TEXT;

CREATE INDEX IF NOT EXISTS "MessageDelivery_broadcastId_status_idx"
  ON "MessageDelivery" ("broadcastId", "status");
CREATE INDEX IF NOT EXISTS "MessageDelivery_broadcastRecipientId_idx"
  ON "MessageDelivery" ("broadcastRecipientId");

-- 2. The broadcast itself. The audience is stored as a SELECTOR and re-resolved
--    at send time — a list frozen at compose time keeps mailing the student who
--    withdrew and skips the one who enrolled this morning.
CREATE TABLE IF NOT EXISTS "MessageBroadcast" (
  "id"               TEXT         NOT NULL,
  "organizationId"   TEXT         NOT NULL,
  "title"            TEXT,
  "body"             TEXT         NOT NULL,
  "templateKey"      TEXT,
  "audience"         JSONB        NOT NULL,
  "channelPolicy"    JSONB        NOT NULL DEFAULT '{}',
  "status"           TEXT         NOT NULL DEFAULT 'draft',
  "scheduledAt"      TIMESTAMP(3),
  "materializedAt"   TIMESTAMP(3),
  "startedAt"        TIMESTAMP(3),
  "completedAt"      TIMESTAMP(3),
  "cancelledAt"      TIMESTAMP(3),
  "cancelledBy"      TEXT,
  "totalRecipients"  INTEGER      NOT NULL DEFAULT 0,
  "queuedCount"      INTEGER      NOT NULL DEFAULT 0,
  "sentCount"        INTEGER      NOT NULL DEFAULT 0,
  "deliveredCount"   INTEGER      NOT NULL DEFAULT 0,
  "failedCount"      INTEGER      NOT NULL DEFAULT 0,
  "suppressedCount"  INTEGER      NOT NULL DEFAULT 0,
  "unreachableCount" INTEGER      NOT NULL DEFAULT 0,
  "estimatedSegments" INTEGER     NOT NULL DEFAULT 0,
  "costMicros"       BIGINT       NOT NULL DEFAULT 0,
  "claimToken"       TEXT,
  "claimedAt"        TIMESTAMP(3),
  "lastError"        TEXT,
  "createdById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageBroadcast_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MessageBroadcast_organizationId_status_scheduledAt_idx"
  ON "MessageBroadcast" ("organizationId", "status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "MessageBroadcast_organizationId_createdAt_idx"
  ON "MessageBroadcast" ("organizationId", "createdAt");
-- Cross-tenant, deliberately: the worker claims due broadcasts for every org in
-- one query, exactly like the outbox worker.
CREATE INDEX IF NOT EXISTS "MessageBroadcast_status_scheduledAt_idx"
  ON "MessageBroadcast" ("status", "scheduledAt");

-- 3. One row per intended recipient — including the ones that will never be
--    reached. A parent with no phone number on file has no delivery row at all,
--    so counting deliveries would make exactly the people who need chasing
--    invisible.
CREATE TABLE IF NOT EXISTS "BroadcastRecipient" (
  "id"                TEXT         NOT NULL,
  "organizationId"    TEXT         NOT NULL,
  "broadcastId"       TEXT         NOT NULL,
  "kind"              TEXT         NOT NULL,
  "subjectType"       TEXT         NOT NULL,
  "subjectId"         TEXT         NOT NULL,
  "displayName"       TEXT         NOT NULL,
  "address"           TEXT,
  "userId"            TEXT,
  "studentProfileId"  TEXT,
  "studentName"       TEXT,
  "className"         TEXT,
  "relationship"      TEXT,
  "dedupeKey"         TEXT         NOT NULL,
  "status"            TEXT         NOT NULL DEFAULT 'pending',
  "providerId"        TEXT,
  "messageId"         TEXT,
  "deliveryId"        TEXT,
  "suppressionReason" TEXT,
  "lastError"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BroadcastRecipient_broadcastId_fkey'
  ) THEN
    ALTER TABLE "BroadcastRecipient"
      ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey"
      FOREIGN KEY ("broadcastId") REFERENCES "MessageBroadcast"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- The materialization idempotency key: re-running pass 1 after a crash cannot
-- duplicate a person. Explicit column rather than a partial unique index,
-- because Postgres does not enforce uniqueness across NULL studentProfileId.
CREATE UNIQUE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_dedupeKey_key"
  ON "BroadcastRecipient" ("broadcastId", "dedupeKey");

CREATE INDEX IF NOT EXISTS "BroadcastRecipient_organizationId_broadcastId_status_idx"
  ON "BroadcastRecipient" ("organizationId", "broadcastId", "status");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_status_idx"
  ON "BroadcastRecipient" ("broadcastId", "status");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_messageId_idx"
  ON "BroadcastRecipient" ("messageId");

COMMIT;
