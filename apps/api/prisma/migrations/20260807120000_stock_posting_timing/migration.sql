-- ---------------------------------------------------------------------------
-- Phase C — policy-driven inventory posting.
--
-- `StockPostingJob` was keyed `@@unique([organizationId, invoiceId])`, which
-- assumes stock is always deducted at billing. That is one policy among several
-- (`inventory.stockPostingTiming`): a café may deduct when the last kitchen
-- ticket is served, i.e. BEFORE an invoice exists. So:
--   * invoiceId / invoiceNumber become nullable (a pre-invoice job has neither);
--   * `postingTrigger` records which policy enqueued the job;
--   * `idempotencyKey` becomes the exactly-once key across all triggers,
--     replacing the invoice-only unique.
--
-- Backfill is loss-free: every existing job was an at-invoice deduction, so its
-- key is `at_invoice:<invoiceId>`.
-- ---------------------------------------------------------------------------

-- 1. Relax the invoice columns (existing rows keep their values).
ALTER TABLE "StockPostingJob" ALTER COLUMN "invoiceId" DROP NOT NULL;
ALTER TABLE "StockPostingJob" ALTER COLUMN "invoiceNumber" DROP NOT NULL;

-- 2. New columns. Defaults make the backfill a no-op for existing rows.
ALTER TABLE "StockPostingJob" ADD COLUMN "postingTrigger" TEXT NOT NULL DEFAULT 'at_invoice';
ALTER TABLE "StockPostingJob" ADD COLUMN "idempotencyKey" TEXT NOT NULL DEFAULT '';

-- 3. Backfill the key from the existing invoice id (all prior jobs are at-invoice).
UPDATE "StockPostingJob"
   SET "idempotencyKey" = 'at_invoice:' || "invoiceId"
 WHERE "idempotencyKey" = '' AND "invoiceId" IS NOT NULL;

-- 4. Swap the unique constraint: drop the invoice-only one, add the key one.
--    (Prisma named the old one "StockPostingJob_organizationId_invoiceId_key".)
DROP INDEX IF EXISTS "StockPostingJob_organizationId_invoiceId_key";
CREATE UNIQUE INDEX "StockPostingJob_organizationId_idempotencyKey_key"
    ON "StockPostingJob" ("organizationId", "idempotencyKey");
