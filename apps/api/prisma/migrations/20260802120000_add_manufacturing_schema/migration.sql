-- CreateEnum
CREATE TYPE "ManufacturingRole" AS ENUM ('raw', 'semi_finished', 'finished');

-- CreateEnum
CREATE TYPE "BomStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('draft', 'confirmed', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ProductionOutputKind" AS ENUM ('output', 'byproduct');

-- AlterEnum
ALTER TYPE "LocationType" ADD VALUE 'production';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMoveType" ADD VALUE 'production_consume';
ALTER TYPE "StockMoveType" ADD VALUE 'production_output';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "manufacturingRole" "ManufacturingRole";

-- CreateTable
CREATE TABLE "Bom" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outputProductId" TEXT NOT NULL,
    "outputVariantId" TEXT,
    "outputVariantKey" TEXT NOT NULL DEFAULT '',
    "outputQuantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "outputUomId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "BomStatus" NOT NULL DEFAULT 'draft',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "expectedYieldPct" DECIMAL(9,4) NOT NULL DEFAULT 100,
    "overheadCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "defaultLocationId" TEXT,
    "defaultOutputLocationId" TEXT,
    "shelfLifeDays" INTEGER,
    "estimatedDurationMins" INTEGER,
    "qcRequired" BOOLEAN NOT NULL DEFAULT false,
    "routingId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Bom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "componentVariantId" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL,
    "uomId" TEXT,
    "scrapPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "BomLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "bomId" TEXT,
    "bomVersion" INTEGER,
    "requestId" TEXT,
    "outputProductId" TEXT NOT NULL,
    "outputVariantId" TEXT,
    "locationId" TEXT NOT NULL,
    "outputLocationId" TEXT,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'draft',
    "plannedQty" DECIMAL(20,6) NOT NULL,
    "producedQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "scrapQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "uomId" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "materialCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "overheadCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "byproductCredit" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "outputUnitCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "yieldVariance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "batchNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "mfgDate" TIMESTAMP(3),
    "notes" TEXT,
    "cancelReason" TEXT,
    "performedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionMaterial" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "operationId" TEXT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "unit" TEXT,
    "qtyPlanned" DECIMAL(20,6) NOT NULL,
    "qtyConsumed" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "uomId" TEXT,
    "unitCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "batchNumber" TEXT,
    "distStrategy" TEXT DEFAULT 'FEFO',
    "ledgerCode" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductionMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOutput" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "operationId" TEXT,
    "kind" "ProductionOutputKind" NOT NULL DEFAULT 'output',
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "qtyExpected" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "qtyProduced" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "uomId" TEXT,
    "costAllocationPct" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "batchNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "mfgDate" TIMESTAMP(3),
    "batchId" TEXT,
    "ledgerCode" TEXT,

    CONSTRAINT "ProductionOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bom_organizationId_outputProductId_status_idx" ON "Bom"("organizationId", "outputProductId", "status");

-- CreateIndex
CREATE INDEX "Bom_organizationId_deletedAt_idx" ON "Bom"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Bom_organizationId_code_key" ON "Bom"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Bom_organizationId_outputProductId_outputVariantKey_version_key" ON "Bom"("organizationId", "outputProductId", "outputVariantKey", "version");

-- CreateIndex
CREATE INDEX "BomLine_organizationId_bomId_idx" ON "BomLine"("organizationId", "bomId");

-- CreateIndex
CREATE INDEX "BomLine_componentProductId_idx" ON "BomLine"("componentProductId");

-- CreateIndex
CREATE INDEX "ProductionOrder_organizationId_status_idx" ON "ProductionOrder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ProductionOrder_organizationId_outputProductId_idx" ON "ProductionOrder"("organizationId", "outputProductId");

-- CreateIndex
CREATE INDEX "ProductionOrder_organizationId_scheduledFor_idx" ON "ProductionOrder"("organizationId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_organizationId_orderCode_key" ON "ProductionOrder"("organizationId", "orderCode");

-- CreateIndex
CREATE INDEX "ProductionMaterial_organizationId_orderId_idx" ON "ProductionMaterial"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "ProductionMaterial_organizationId_productId_idx" ON "ProductionMaterial"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "ProductionOutput_organizationId_orderId_idx" ON "ProductionOutput"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "ProductionOutput_organizationId_productId_idx" ON "ProductionOutput"("organizationId", "productId");

-- AddForeignKey
ALTER TABLE "BomLine" ADD CONSTRAINT "BomLine_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionMaterial" ADD CONSTRAINT "ProductionMaterial_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOutput" ADD CONSTRAINT "ProductionOutput_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

