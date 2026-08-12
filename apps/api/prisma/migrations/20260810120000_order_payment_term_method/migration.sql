-- Alter Order: loose refs for the eventual bill's payment term + method.
-- paymentTermId drives invoice due-date derivation (Invoice.paymentTermId) at
-- billing time; paymentMethod is a pre-selection (authoritative mode is
-- re-derived from tenders at settlement).
ALTER TABLE "Order" ADD COLUMN "paymentTermId" TEXT,
                     ADD COLUMN "paymentMethod" TEXT;