-- ---------------------------------------------------------------------------
-- P1 — backfill existing Order rows onto the generic lifecycle.
--
-- Separate from 20260805120000_order_status_generic because Postgres cannot USE
-- an enum value in the same transaction that adds it.
--
-- Mapping (see the enum doc comment in schema.prisma):
--   open      -> confirmed     accepted, fulfillment not started
--   preparing -> in_progress   a fulfillment document is active
--   served    -> completed     NB: this was written at invoice generation, so
--                              historically it means "billed", not "served"
--   ready     -> (none)        never written by any code path; nothing to map
--   draft / closed / cancelled unchanged
--
-- Idempotent: re-running matches zero rows.
-- ---------------------------------------------------------------------------

UPDATE "Order" SET "status" = 'confirmed'   WHERE "status" = 'open';
UPDATE "Order" SET "status" = 'in_progress' WHERE "status" = 'preparing';
UPDATE "Order" SET "status" = 'completed'   WHERE "status" = 'served';

-- Defensive: `ready` was never written, but map it rather than leave a row on a
-- value the application no longer understands.
UPDATE "Order" SET "status" = 'in_progress' WHERE "status" = 'ready';

-- The column default was `open`; move it to the generic equivalent so inserts
-- that omit `status` land on the new lifecycle.
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'confirmed';
