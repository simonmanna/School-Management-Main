-- Invoice.paymentTermId — the missing half of 20260810120000_order_payment_term_method.
--
-- That migration added Order.paymentTermId and documented it as driving
-- "invoice due-date derivation (Invoice.paymentTermId)", and PosInvoiceService
-- has been writing the field since efb5597 — but the column was never created,
-- so every tx.invoice.create() failed with "Unknown argument `paymentTermId`"
-- and no POS sale could be billed at all.
--
-- Loose ref (no FK), matching Document.paymentTermId and Order.paymentTermId.
ALTER TABLE "Invoice" ADD COLUMN "paymentTermId" TEXT;
