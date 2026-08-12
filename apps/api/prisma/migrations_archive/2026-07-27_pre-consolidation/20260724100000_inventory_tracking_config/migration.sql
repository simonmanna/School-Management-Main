-- Product inventory-tracking configuration.
-- Adds SPECIFIC costing, the PickingStrategy + SerialStatus enums, per-product
-- expiry/serial tracking + default picking strategy, the InventorySerial table
-- (one row per serialized unit) and an InventoryLedger.serialId link.

-- AlterEnum
ALTER TYPE "CostingMethod" ADD VALUE 'SPECIFIC';

-- CreateEnum
CREATE TYPE "PickingStrategy" AS ENUM ('FEFO', 'FIFO', 'MANUAL', 'SERIAL');

-- CreateEnum
CREATE TYPE "SerialStatus" AS ENUM ('in_stock', 'issued', 'returned', 'scrapped');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "expiryTracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serialTracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickingStrategy" "PickingStrategy" NOT NULL DEFAULT 'FEFO';

-- AlterTable
ALTER TABLE "InventoryLedger" ADD COLUMN     "serialId" TEXT;

-- CreateTable
CREATE TABLE "InventorySerial" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "locationId" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "batchId" TEXT,
    "unitCost" DECIMAL(20,6),
    "status" "SerialStatus" NOT NULL DEFAULT 'in_stock',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedAt" TIMESTAMP(3),
    "receiptRef" TEXT,
    "issueRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySerial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventorySerial_organizationId_idx" ON "InventorySerial"("organizationId");

-- CreateIndex
CREATE INDEX "InventorySerial_organizationId_productId_locationId_status_idx" ON "InventorySerial"("organizationId", "productId", "locationId", "status");

-- CreateIndex
CREATE INDEX "InventorySerial_batchId_idx" ON "InventorySerial"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "InventorySerial_organizationId_productId_serialNumber_key" ON "InventorySerial"("organizationId", "productId", "serialNumber");

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_serialId_fkey" FOREIGN KEY ("serialId") REFERENCES "InventorySerial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySerial" ADD CONSTRAINT "InventorySerial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySerial" ADD CONSTRAINT "InventorySerial_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySerial" ADD CONSTRAINT "InventorySerial_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySerial" ADD CONSTRAINT "InventorySerial_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
