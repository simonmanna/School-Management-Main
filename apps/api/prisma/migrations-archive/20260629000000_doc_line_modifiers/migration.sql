-- M-D: structured per-line modifier/add-on storage (order_item_modifiers equivalent).
CREATE TABLE "DocumentLineModifier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentLineId" TEXT NOT NULL,
    "modifierId" TEXT,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentLineModifier_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentLineModifier_organizationId_idx" ON "DocumentLineModifier"("organizationId");
CREATE INDEX "DocumentLineModifier_documentLineId_idx" ON "DocumentLineModifier"("documentLineId");
CREATE INDEX "DocumentLineModifier_modifierId_idx" ON "DocumentLineModifier"("modifierId");

ALTER TABLE "DocumentLineModifier"
    ADD CONSTRAINT "DocumentLineModifier_documentLineId_fkey"
    FOREIGN KEY ("documentLineId") REFERENCES "DocumentLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
