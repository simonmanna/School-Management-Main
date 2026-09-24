-- Outbox (E2E audit Wave 3): claimed rows get status 'claimed' (a claim used
-- to leave them 'pending', so a second tick path re-claimed and re-ran them);
-- failures back off via availableAt and stop at 'dead'; completed handlers are
-- remembered so a retry does not re-run the ones that already succeeded.
ALTER TABLE "EventOutbox" ADD COLUMN IF NOT EXISTS "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "EventOutbox" ADD COLUMN IF NOT EXISTS "completedHandlers" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
CREATE INDEX IF NOT EXISTS "EventOutbox_status_availableAt_idx" ON "EventOutbox" ("status", "availableAt");
