-- POS partial-refund tracking
-- Cumulative refunded amount on the invoice (full + partial) for the over-refund guard.
ALTER TABLE "Invoice" ADD COLUMN "amountRefunded" DECIMAL(20,6) NOT NULL DEFAULT 0;
-- Cumulative refunded quantity per invoice line (per-line over-refund guard).
ALTER TABLE "InvoiceItem" ADD COLUMN "refundedQty" DECIMAL(20,6) NOT NULL DEFAULT 0;
