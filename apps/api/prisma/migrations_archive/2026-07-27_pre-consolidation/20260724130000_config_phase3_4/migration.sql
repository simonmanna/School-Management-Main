-- Configurable ERP — Phase 3 (inventory) + Phase 4 (accounting).
-- Additive: stock reservations, payment terms, credit control, batch mfg date,
-- product max-quantity. Applied to dev via `prisma db push`; this file is the
-- migration-history record for fresh/production deploys.

-- CreateEnum
CREATE TYPE "StockReservationStatus" AS ENUM ('active', 'released', 'consumed');

-- AlterTable (Phase 3)
ALTER TABLE "Product" ADD COLUMN "maxQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0;
ALTER TABLE "InventoryBatch" ADD COLUMN "mfgDate" TIMESTAMP(3);

-- AlterTable (Phase 4 — AR credit control + payment term link)
ALTER TABLE "Partner" ADD COLUMN "creditLimit" DECIMAL(20,2) NOT NULL DEFAULT 0,
ADD COLUMN "creditHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "paymentTermId" TEXT;

-- CreateTable (Phase 3 — soft stock reservations / ATP)
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "variantKey" TEXT NOT NULL DEFAULT '',
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'active',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockReservation_organizationId_productId_variantKey_locati_idx" ON "StockReservation"("organizationId", "productId", "variantKey", "locationId", "status");
CREATE INDEX "StockReservation_organizationId_sourceType_sourceId_idx" ON "StockReservation"("organizationId", "sourceType", "sourceId");

-- CreateTable (Phase 4 — payment terms)
CREATE TABLE "PaymentTerm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "netDays" INTEGER NOT NULL DEFAULT 0,
    "discountDays" INTEGER,
    "discountPercent" DECIMAL(9,4),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTerm_organizationId_code_key" ON "PaymentTerm"("organizationId", "code");
CREATE INDEX "PaymentTerm_organizationId_idx" ON "PaymentTerm"("organizationId");
