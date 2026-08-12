-- POS Phase P9 — stockPolicy on Product.
--
-- Adds the PosStockPolicy enum (block / warn / silent) and a default
-- 'silent' column on Product. Existing rows get 'silent' which preserves
-- the current "log to dashboard" behavior. The new checkout flow reads
-- the policy and either refuses the sale (block), allows with a low-stock
-- warning (warn), or allows silently (silent).

CREATE TYPE "PosStockPolicy" AS ENUM ('block', 'warn', 'silent');

ALTER TABLE "Product"
  ADD COLUMN "stockPolicy" "PosStockPolicy" NOT NULL DEFAULT 'silent';