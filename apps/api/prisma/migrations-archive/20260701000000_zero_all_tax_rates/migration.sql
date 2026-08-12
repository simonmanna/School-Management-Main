-- Client directive: no VAT/tax on any sale or invoice. Zero every tax rate.
-- The tax engine multiplies each line base by Tax.rate, so rate=0 yields
-- taxAmount=0 on all POS sales, invoices, credit notes and vendor bills while
-- keeping subtotal+tax=total balanced (works for inclusive AND exclusive lines:
-- inclusive net = price / (1 + 0) = price, so customer-facing prices are
-- unchanged — only the extracted tax becomes 0).
UPDATE "Tax" SET "rate" = 0;
