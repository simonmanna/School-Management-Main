-- POS Phase P10 — Tax-inclusive pricing.
--
-- Adds Product.taxInclusive boolean (default false). When true, the line's
-- unitPrice is GROSS (VAT included); the DocumentBuilderService splits
-- it as net = unitPrice / (1 + rate) and tax = unitPrice - net. Receipts
-- show "(incl. tax)" beside the line. Existing products keep their current
-- additive-VAT behaviour because the default is false.

ALTER TABLE "Product"
  ADD COLUMN "taxInclusive" BOOLEAN NOT NULL DEFAULT false;