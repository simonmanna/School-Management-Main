-- CreateEnum
CREATE TYPE "ProductionRequestStatus" AS ENUM ('draft', 'submitted', 'approved', 'planned', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "ProductionPlanStatus" AS ENUM ('draft', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "ProductionQcStatus" AS ENUM ('pending', 'passed', 'failed', 'rework');

-- AlterEnum
ALTER TYPE "ProductionOrderStatus" ADD VALUE 'qc_hold';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WasteCategory" ADD VALUE 'overmixed';
ALTER TYPE "WasteCategory" ADD VALUE 'packaging_defect';
ALTER TYPE "WasteCategory" ADD VALUE 'qc_rejection';

-- AlterTable
ALTER TABLE "ProductionOrder" ADD COLUMN     "planId" TEXT,
ADD COLUMN     "qcRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProductionRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "requestedById" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "neededBy" TIMESTAMP(3),
    "status" "ProductionRequestStatus" NOT NULL DEFAULT 'draft',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "notes" TEXT,
    "snapshot" JSONB,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRequestLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL,
    "uomId" TEXT,
    "bomId" TEXT,
    "neededBy" TIMESTAMP(3),
    "notes" TEXT,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "plannedLineId" TEXT,

    CONSTRAINT "ProductionRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planNumber" TEXT NOT NULL,
    "name" TEXT,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "locationId" TEXT,
    "status" "ProductionPlanStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionPlanLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "bomId" TEXT,
    "targetQty" DECIMAL(20,6) NOT NULL,
    "scheduledDate" TIMESTAMP(3),
    "uomId" TEXT,
    "sourceRequestLineId" TEXT,
    "generatedOrderId" TEXT,
    "notes" TEXT,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductionPlanLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionQcCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "ProductionQcStatus" NOT NULL DEFAULT 'pending',
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "passedQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "failedQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "reworkQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "wasteCategory" TEXT,
    "inspectorId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionQcCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionRequest_organizationId_status_idx" ON "ProductionRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ProductionRequest_organizationId_neededBy_idx" ON "ProductionRequest"("organizationId", "neededBy");

-- CreateIndex
CREATE INDEX "ProductionRequest_organizationId_sourceType_sourceId_idx" ON "ProductionRequest"("organizationId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRequest_organizationId_requestNumber_key" ON "ProductionRequest"("organizationId", "requestNumber");

-- CreateIndex
CREATE INDEX "ProductionRequestLine_organizationId_requestId_idx" ON "ProductionRequestLine"("organizationId", "requestId");

-- CreateIndex
CREATE INDEX "ProductionRequestLine_organizationId_productId_idx" ON "ProductionRequestLine"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "ProductionPlan_organizationId_status_idx" ON "ProductionPlan"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionPlan_organizationId_planNumber_key" ON "ProductionPlan"("organizationId", "planNumber");

-- CreateIndex
CREATE INDEX "ProductionPlanLine_organizationId_planId_idx" ON "ProductionPlanLine"("organizationId", "planId");

-- CreateIndex
CREATE INDEX "ProductionPlanLine_organizationId_productId_idx" ON "ProductionPlanLine"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "ProductionQcCheck_organizationId_orderId_idx" ON "ProductionQcCheck"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "ProductionQcCheck_organizationId_status_idx" ON "ProductionQcCheck"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "ProductionRequestLine" ADD CONSTRAINT "ProductionRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProductionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPlanLine" ADD CONSTRAINT "ProductionPlanLine_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProductionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

