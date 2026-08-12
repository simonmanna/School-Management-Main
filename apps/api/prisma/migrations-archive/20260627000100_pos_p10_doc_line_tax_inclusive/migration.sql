-- POS P10 follow-up — store the per-line tax-inclusive flag on DocumentLine.
--
-- The DocumentBuilderService splits the line's unitPrice into net + tax at
-- invoice-creation time when the product (or per-line override) is
-- tax-inclusive. This migration persists the resulting flag on the line so
-- receipts and reports can show "(incl. tax)" without re-deriving it from
-- the price history.

ALTER TABLE "DocumentLine"
  ADD COLUMN "taxInclusive" BOOLEAN NOT NULL DEFAULT false;