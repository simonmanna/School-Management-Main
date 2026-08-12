-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('warehouse', 'store', 'virtual');

-- CreateEnum
CREATE TYPE "StockMoveType" AS ENUM ('receipt', 'issue', 'adjustment_in', 'adjustment_out', 'transfer_in', 'transfer_out', 'opening_balance');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "batchTracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InventoryLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'warehouse',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(20,6),
    "expiryDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ledgerCode" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "batchId" TEXT,
    "type" "StockMoveType" NOT NULL,
    "quantityChange" DECIMAL(20,6) NOT NULL,
    "balanceAfter" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryLocation_organizationId_idx" ON "InventoryLocation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLocation_organizationId_code_key" ON "InventoryLocation"("organizationId", "code");

-- CreateIndex
CREATE INDEX "StockItem_organizationId_idx" ON "StockItem"("organizationId");

-- CreateIndex
CREATE INDEX "StockItem_productId_idx" ON "StockItem"("productId");

-- CreateIndex
CREATE INDEX "StockItem_locationId_idx" ON "StockItem"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_organizationId_productId_locationId_key" ON "StockItem"("organizationId", "productId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryBatch_organizationId_idx" ON "InventoryBatch"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryBatch_productId_locationId_idx" ON "InventoryBatch"("productId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryBatch_expiryDate_idx" ON "InventoryBatch"("expiryDate");

-- CreateIndex
CREATE INDEX "InventoryLedger_organizationId_idx" ON "InventoryLedger"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryLedger_productId_idx" ON "InventoryLedger"("productId");

-- CreateIndex
CREATE INDEX "InventoryLedger_locationId_idx" ON "InventoryLedger"("locationId");

-- CreateIndex
CREATE INDEX "InventoryLedger_organizationId_createdAt_idx" ON "InventoryLedger"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLedger_organizationId_ledgerCode_key" ON "InventoryLedger"("organizationId", "ledgerCode");

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
