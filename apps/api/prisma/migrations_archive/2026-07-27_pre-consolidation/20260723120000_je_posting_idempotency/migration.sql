-- Phase 0: GL-layer posting idempotency + posting-type classification.
-- postingType classifies a source's postings (primary/reversal/partial_refund…).
-- postingKey is an optional idempotency token; NULLs are distinct in Postgres so
-- repeatable postings (e.g. successive partial refunds) never collide.

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN "postingType" TEXT NOT NULL DEFAULT 'primary';
ALTER TABLE "JournalEntry" ADD COLUMN "postingKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_organizationId_postingKey_key" ON "JournalEntry"("organizationId", "postingKey");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_postingType_idx" ON "JournalEntry"("organizationId", "postingType");
