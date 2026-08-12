-- ---------------------------------------------------------------------------
-- P1 — make the Order lifecycle domain-neutral.
--
-- `Order` is the operational document for EVERY vertical (café, retail, rental,
-- repair, manufacturing), but its status enum was restaurant-shaped:
--   * `preparing` / `served` describe a kitchen, not an order;
--   * `served` was actually written at INVOICE GENERATION, so it meant "billed";
--   * `draft` and `ready` were never written by any code path.
-- Kitchen states already live on `KitchenTicket.status` (`KdsTicketStatus`).
--
-- This migration is PURELY ADDITIVE — it adds the generic values and drops
-- nothing, so a running old build keeps working. The row backfill is a separate
-- migration because Postgres forbids USING a new enum value in the same
-- transaction that adds it. The legacy values are removed by a later cleanup
-- migration, once the Android wire-compat window has closed.
--
-- `AFTER` clauses keep the physical enum order aligned with schema.prisma.
-- ---------------------------------------------------------------------------

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'confirmed' AFTER 'draft';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'in_progress' AFTER 'confirmed';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'completed' AFTER 'in_progress';
