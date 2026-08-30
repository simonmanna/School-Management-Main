-- Messaging module, phase 1 — SMS transport + consent ledger.
--
-- Applied manually (this project's Prisma migrate history is not the source of
-- truth for the working database; see prisma/manual/ for the convention).
-- Every statement is idempotent so a re-run on a partially-migrated database is
-- safe.

BEGIN;

-- 1. Cost accounting on the existing delivery/outbox table.
--    `segments` is billable SMS units (1 for every other transport);
--    `costMicros` is integer micro-units of the channel's billing currency, so
--    a broadcast's cost sums exactly and never round-trips through binary FP.
ALTER TABLE "MessageDelivery" ADD COLUMN IF NOT EXISTS "segments" INTEGER;
ALTER TABLE "MessageDelivery" ADD COLUMN IF NOT EXISTS "costMicros" BIGINT;

-- 2. Consent / suppression ledger.
--    Keyed by NORMALIZED address rather than by person: a parent who replies
--    STOP from a phone must stop receiving on that phone even before we know
--    which Contact it belongs to.
CREATE TABLE IF NOT EXISTS "MessagingConsent" (
  "id"             TEXT         NOT NULL,
  "organizationId" TEXT         NOT NULL,
  "channel"        TEXT         NOT NULL DEFAULT 'all',
  "address"        TEXT         NOT NULL,
  "status"         TEXT         NOT NULL DEFAULT 'opted_out',
  "source"         TEXT         NOT NULL DEFAULT 'inbound_keyword',
  "reason"         TEXT,
  "subjectType"    TEXT,
  "subjectId"      TEXT,
  "effectiveAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"      TEXT,
  CONSTRAINT "MessagingConsent_pkey" PRIMARY KEY ("id")
);

-- The uniqueness that makes `set()` idempotent: one row per (org, channel,
-- address), so recording the same STOP twice updates rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "MessagingConsent_organizationId_channel_address_key"
  ON "MessagingConsent" ("organizationId", "channel", "address");

-- Covers the dispatcher's hot lookup: one address, both its channel-specific
-- and blanket rows, immediately before every send.
CREATE INDEX IF NOT EXISTS "MessagingConsent_organizationId_address_idx"
  ON "MessagingConsent" ("organizationId", "address");

-- Covers the admin list ("show me every SMS opt-out").
CREATE INDEX IF NOT EXISTS "MessagingConsent_organizationId_status_channel_idx"
  ON "MessagingConsent" ("organizationId", "status", "channel");

COMMIT;
