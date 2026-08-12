-- Add parent-product columns for variant grouping in stock count lines.
ALTER TABLE "InventoryCountLine" ADD COLUMN "parentProductId"   TEXT;
ALTER TABLE "InventoryCountLine" ADD COLUMN "parentProductName" TEXT;

-- Index for efficient grouping in the frontend.
CREATE INDEX "InventoryCountLine_parent_idx" ON "InventoryCountLine" ("sessionId", "parentProductId", "variantId");
