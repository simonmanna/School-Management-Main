-- ---------------------------------------------------------------------------
-- Phase D — decouple `Order` from the verticals.
--
--   1. `transactionKind` moves off the `SaleKind` enum to free text, so a new
--      vertical no longer means editing a shared enum. Validation moves to the
--      service layer (against the module registry's contributed order kinds).
--   2. The per-vertical back-reference columns `rentalAgreementId` /
--      `repairOrderId` are replaced by one polymorphic pair
--      `sourceDocumentType` / `sourceDocumentId` (precedent:
--      `StockReservation.sourceType`/`sourceId`). The old columns are kept and
--      DUAL-WRITTEN for one release; the P1.6 cleanup drops them.
--
-- Loss-free: every existing value maps 1:1.
-- ---------------------------------------------------------------------------

-- 1. transactionKind: SaleKind enum -> TEXT (values are already valid strings).
ALTER TABLE "Order" ALTER COLUMN "transactionKind" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "transactionKind" TYPE TEXT USING "transactionKind"::text;
ALTER TABLE "Order" ALTER COLUMN "transactionKind" SET DEFAULT 'sale';

-- 2. Polymorphic source document.
ALTER TABLE "Order" ADD COLUMN "sourceDocumentType" TEXT;
ALTER TABLE "Order" ADD COLUMN "sourceDocumentId" TEXT;

-- 3. Backfill from the two legacy columns.
UPDATE "Order"
   SET "sourceDocumentType" = 'rental_agreement', "sourceDocumentId" = "rentalAgreementId"
 WHERE "rentalAgreementId" IS NOT NULL;
UPDATE "Order"
   SET "sourceDocumentType" = 'repair_order', "sourceDocumentId" = "repairOrderId"
 WHERE "repairOrderId" IS NOT NULL;

-- Index the new lookup axis (a document -> its order).
CREATE INDEX "Order_organizationId_sourceDocumentType_sourceDocumentId_idx"
    ON "Order" ("organizationId", "sourceDocumentType", "sourceDocumentId");

-- NB: the `SaleKind` enum type is intentionally NOT dropped here — nothing uses
-- it now, but dropping it belongs with the other legacy removals in P1.6.
