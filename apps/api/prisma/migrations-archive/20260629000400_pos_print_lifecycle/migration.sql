-- Print lifecycle tracking (Phase T5)
-- Adds DocumentPrintLog table + lifecycle fields to Document and DocumentLine

-- Document-level counters
ALTER TABLE "Document" ADD COLUMN "billPrintCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Document" ADD COLUMN "billLastPrintedAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN "receiptPrintCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Document" ADD COLUMN "receiptLastPrintedAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN "lastPrintedById" TEXT;

-- Line-level kitchen tracking
ALTER TABLE "DocumentLine" ADD COLUMN "kitchenPrintCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DocumentLine" ADD COLUMN "kitchenLastPrintedAt" TIMESTAMP(3);
ALTER TABLE "DocumentLine" ADD COLUMN "kitchenPrintedQty" DECIMAL(20,6);
ALTER TABLE "DocumentLine" ADD COLUMN "cancelPrintCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DocumentLine" ADD COLUMN "cancelLastPrintedAt" TIMESTAMP(3);
ALTER TABLE "DocumentLine" ADD COLUMN "lastKitchenPrintedById" TEXT;

-- Print event log
CREATE TABLE "DocumentPrintLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentLineId" TEXT,
    "type" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'PRINT',
    "copies" INTEGER NOT NULL DEFAULT 1,
    "printedById" TEXT,
    "reason" TEXT,
    "printer" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentPrintLog_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "DocumentPrintLog_organizationId_idx" ON "DocumentPrintLog"("organizationId");
CREATE INDEX "DocumentPrintLog_documentId_idx" ON "DocumentPrintLog"("documentId");
CREATE INDEX "DocumentPrintLog_documentLineId_idx" ON "DocumentPrintLog"("documentLineId");
CREATE INDEX "DocumentPrintLog_type_idx" ON "DocumentPrintLog"("type");
CREATE UNIQUE INDEX "DocumentPrintLog_idempotencyKey_key" ON "DocumentPrintLog"("idempotencyKey");

-- Foreign keys
ALTER TABLE "DocumentPrintLog" ADD CONSTRAINT "DocumentPrintLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentPrintLog" ADD CONSTRAINT "DocumentPrintLog_documentLineId_fkey" FOREIGN KEY ("documentLineId") REFERENCES "DocumentLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
