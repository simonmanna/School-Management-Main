-- Beverage Control — digital-weight alcohol measurement (bar shrinkage control).
-- Adds the MeasurementMethod enum + Product bottle-weighing columns, the bottle
-- count tables (session/line/reading), the immutable BottleMeasurement log, and a
-- new 'measure' audit action.

-- CreateEnum
CREATE TYPE "MeasurementMethod" AS ENUM ('count', 'manual_volume', 'digital_weight');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'measure';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "actualEmptyWeightG" DECIMAL(20,6),
ADD COLUMN     "allowPartialBottle" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "containerVolumeMl" DECIMAL(20,6),
ADD COLUMN     "conversionFactorMlPerG" DECIMAL(20,10),
ADD COLUMN     "emptyBottleWeightG" DECIMAL(20,6),
ADD COLUMN     "fullBottleWeightG" DECIMAL(20,6),
ADD COLUMN     "liquidWeightG" DECIMAL(20,6),
ADD COLUMN     "measurementMethod" "MeasurementMethod" NOT NULL DEFAULT 'count',
ADD COLUMN     "standardPourMl" DECIMAL(20,6),
ADD COLUMN     "varianceToleranceG" DECIMAL(20,6);

-- CreateTable
CREATE TABLE "BottleCountSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "countCode" TEXT NOT NULL,
    "name" TEXT,
    "locationId" TEXT NOT NULL,
    "countType" TEXT NOT NULL DEFAULT 'closing',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "adjustmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BottleCountSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BottleCountLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "unit" TEXT,
    "systemMl" DECIMAL(20,6) NOT NULL,
    "sealedFullCount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "countedMl" DECIMAL(20,6),
    "varianceMl" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "varianceG" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "expectedShots" DECIMAL(20,6),
    "soldShots" DECIMAL(20,6),
    "reason" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'GOOD',
    "countedById" TEXT,
    "countedAt" TIMESTAMP(3),

    CONSTRAINT "BottleCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BottleCountReading" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "bottleNumber" TEXT,
    "measuredWeightG" DECIMAL(20,6) NOT NULL,
    "expectedWeightG" DECIMAL(20,6),
    "remainingMl" DECIMAL(20,6) NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'GOOD',

    CONSTRAINT "BottleCountReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BottleMeasurement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "bottleNumber" TEXT,
    "locationId" TEXT NOT NULL,
    "sessionId" TEXT,
    "openingWeightG" DECIMAL(20,6),
    "expectedWeightG" DECIMAL(20,6),
    "measuredWeightG" DECIMAL(20,6) NOT NULL,
    "remainingMl" DECIMAL(20,6) NOT NULL,
    "varianceMl" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "varianceG" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "measurementSource" TEXT NOT NULL DEFAULT 'MANUAL',
    "confidence" TEXT NOT NULL DEFAULT 'GOOD',
    "measuredById" TEXT,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BottleMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BottleCountSession_organizationId_status_idx" ON "BottleCountSession"("organizationId", "status");

-- CreateIndex
CREATE INDEX "BottleCountSession_organizationId_locationId_idx" ON "BottleCountSession"("organizationId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "BottleCountSession_organizationId_countCode_key" ON "BottleCountSession"("organizationId", "countCode");

-- CreateIndex
CREATE INDEX "BottleCountLine_organizationId_sessionId_idx" ON "BottleCountLine"("organizationId", "sessionId");

-- CreateIndex
CREATE INDEX "BottleCountLine_sessionId_idx" ON "BottleCountLine"("sessionId");

-- CreateIndex
CREATE INDEX "BottleCountReading_organizationId_lineId_idx" ON "BottleCountReading"("organizationId", "lineId");

-- CreateIndex
CREATE INDEX "BottleCountReading_lineId_idx" ON "BottleCountReading"("lineId");

-- CreateIndex
CREATE INDEX "BottleMeasurement_organizationId_productId_idx" ON "BottleMeasurement"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "BottleMeasurement_organizationId_locationId_idx" ON "BottleMeasurement"("organizationId", "locationId");

-- CreateIndex
CREATE INDEX "BottleMeasurement_sessionId_idx" ON "BottleMeasurement"("sessionId");

-- AddForeignKey
ALTER TABLE "BottleCountLine" ADD CONSTRAINT "BottleCountLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BottleCountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BottleCountReading" ADD CONSTRAINT "BottleCountReading_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "BottleCountLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
