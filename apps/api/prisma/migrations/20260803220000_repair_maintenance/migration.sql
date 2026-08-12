-- CreateEnum
CREATE TYPE "RepairOrderStatus" AS ENUM ('received', 'diagnosis', 'waiting_approval', 'approved', 'repairing', 'testing', 'ready_pickup', 'delivered', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "RepairPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "RepairOrderType" AS ENUM ('repair', 'maintenance', 'preventive', 'contract', 'field_service');

-- CreateEnum
CREATE TYPE "RepairQuotationStatus" AS ENUM ('draft', 'pending', 'approved', 'rejected', 'revised', 'cancelled');

-- CreateEnum
CREATE TYPE "RepairQuotationLineKind" AS ENUM ('labour', 'part');

-- CreateEnum
CREATE TYPE "RepairJobStatus" AS ENUM ('pending', 'in_progress', 'testing', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "RepairPartStatus" AS ENUM ('reserved', 'issued');

-- CreateEnum
CREATE TYPE "RepairAttachmentKind" AS ENUM ('before', 'after', 'damage', 'receipt', 'warranty', 'signature', 'invoice');

-- CreateEnum
CREATE TYPE "RepairWarrantyType" AS ENUM ('repair_warranty', 'manufacturer', 'extended');

-- CreateEnum
CREATE TYPE "RepairWarrantyStatus" AS ENUM ('active', 'expired', 'claimed', 'void');

-- CreateEnum
CREATE TYPE "RepairClaimStatus" AS ENUM ('pending', 'approved', 'rejected', 'settled');

-- CreateEnum
CREATE TYPE "RepairContractStatus" AS ENUM ('draft', 'active', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "RepairScheduleStatus" AS ENUM ('active', 'paused', 'completed');

-- AlterEnum
ALTER TYPE "SaleKind" ADD VALUE 'repair';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "repairOrderId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "repairFeeType" TEXT,
ADD COLUMN     "repairOrderLineId" TEXT;

-- CreateTable
CREATE TABLE "RepairOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repairNumber" TEXT NOT NULL,
    "partnerId" TEXT,
    "branchId" TEXT,
    "status" "RepairOrderStatus" NOT NULL DEFAULT 'received',
    "priority" "RepairPriority" NOT NULL DEFAULT 'medium',
    "orderType" "RepairOrderType" NOT NULL DEFAULT 'repair',
    "itemType" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "imei" TEXT,
    "assetTag" TEXT,
    "plateNumber" TEXT,
    "vin" TEXT,
    "mileage" TEXT,
    "color" TEXT,
    "storage" TEXT,
    "condition" TEXT,
    "accessories" JSONB NOT NULL DEFAULT '[]',
    "problemDescription" TEXT,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "signatureUrl" TEXT,
    "dueDate" TIMESTAMP(3),
    "technicianId" TEXT,
    "diagnosisId" TEXT,
    "quotationId" TEXT,
    "orderId" TEXT,
    "invoiceId" TEXT,
    "warrantyPeriodMonths" INTEGER NOT NULL DEFAULT 0,
    "warrantyExpiresAt" TIMESTAMP(3),
    "labourTotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "partsTotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diagnosedAt" TIMESTAMP(3),
    "quotedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "testedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "RepairOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairOrderItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "itemType" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "imei" TEXT,
    "assetTag" TEXT,
    "plateNumber" TEXT,
    "vin" TEXT,
    "mileage" TEXT,
    "color" TEXT,
    "storage" TEXT,
    "condition" TEXT,
    "accessories" JSONB NOT NULL DEFAULT '[]',
    "problemDescription" TEXT,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairDiagnosis" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "symptoms" TEXT,
    "rootCause" TEXT,
    "faults" JSONB NOT NULL DEFAULT '[]',
    "estimatedCost" DECIMAL(20,6),
    "estimatedHours" DECIMAL(10,2),
    "recommendedParts" JSONB NOT NULL DEFAULT '[]',
    "riskNotes" TEXT,
    "diagnosedBy" TEXT,
    "diagnosedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairQuotation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "status" "RepairQuotationStatus" NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "labourTotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "partsTotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "validUntil" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "RepairQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairQuotationLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "kind" "RepairQuotationLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "labourTypeId" TEXT,
    "productId" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxId" TEXT,
    "amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairQuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "technicianId" TEXT,
    "status" "RepairJobStatus" NOT NULL DEFAULT 'pending',
    "priority" "RepairPriority" NOT NULL DEFAULT 'medium',
    "deadline" TIMESTAMP(3),
    "estimatedHours" DECIMAL(10,2),
    "actualHours" DECIMAL(10,2),
    "instructions" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "RepairJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairLabourType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "productId" TEXT,
    "price" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RepairLabourType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairTechnician" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "skills" JSONB NOT NULL DEFAULT '[]',
    "certifications" JSONB NOT NULL DEFAULT '[]',
    "availability" TEXT NOT NULL DEFAULT 'available',
    "hourlyRate" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RepairTechnician_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairPart" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "jobId" TEXT,
    "productId" TEXT NOT NULL,
    "locationId" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "unitCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "status" "RepairPartStatus" NOT NULL DEFAULT 'reserved',
    "issuedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairStatusHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "action" TEXT,
    "note" TEXT,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repairOrderId" TEXT NOT NULL,
    "kind" "RepairAttachmentKind" NOT NULL,
    "fileId" TEXT,
    "caption" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "RepairAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairWarranty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repairOrderId" TEXT,
    "assetId" TEXT,
    "warrantyType" "RepairWarrantyType" NOT NULL DEFAULT 'repair_warranty',
    "coverageStart" TIMESTAMP(3),
    "coverageEnd" TIMESTAMP(3),
    "coveredParts" JSONB NOT NULL DEFAULT '[]',
    "coveredLabour" BOOLEAN NOT NULL DEFAULT true,
    "status" "RepairWarrantyStatus" NOT NULL DEFAULT 'active',
    "terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairWarranty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairWarrantyClaim" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "warrantyId" TEXT NOT NULL,
    "claimDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "status" "RepairClaimStatus" NOT NULL DEFAULT 'pending',
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairWarrantyClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairServiceContract" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "partnerId" TEXT,
    "title" TEXT NOT NULL,
    "status" "RepairContractStatus" NOT NULL DEFAULT 'draft',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "frequencyDays" INTEGER NOT NULL DEFAULT 30,
    "slaHours" INTEGER,
    "includedLabour" JSONB NOT NULL DEFAULT '[]',
    "includedParts" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RepairServiceContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractId" TEXT,
    "title" TEXT NOT NULL,
    "assetRef" TEXT,
    "status" "RepairScheduleStatus" NOT NULL DEFAULT 'active',
    "intervalDays" INTEGER NOT NULL DEFAULT 30,
    "lastRunAt" TIMESTAMP(3),
    "nextDueAt" TIMESTAMP(3),
    "taskTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RepairSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepairOrder_organizationId_status_idx" ON "RepairOrder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RepairOrder_organizationId_partnerId_idx" ON "RepairOrder"("organizationId", "partnerId");

-- CreateIndex
CREATE INDEX "RepairOrder_organizationId_technicianId_idx" ON "RepairOrder"("organizationId", "technicianId");

-- CreateIndex
CREATE INDEX "RepairOrder_organizationId_orderType_idx" ON "RepairOrder"("organizationId", "orderType");

-- CreateIndex
CREATE UNIQUE INDEX "RepairOrder_organizationId_repairNumber_key" ON "RepairOrder"("organizationId", "repairNumber");

-- CreateIndex
CREATE INDEX "RepairOrderItem_organizationId_repairOrderId_idx" ON "RepairOrderItem"("organizationId", "repairOrderId");

-- CreateIndex
CREATE INDEX "RepairDiagnosis_organizationId_repairOrderId_idx" ON "RepairDiagnosis"("organizationId", "repairOrderId");

-- CreateIndex
CREATE INDEX "RepairQuotation_organizationId_repairOrderId_status_idx" ON "RepairQuotation"("organizationId", "repairOrderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RepairQuotation_organizationId_quotationNumber_key" ON "RepairQuotation"("organizationId", "quotationNumber");

-- CreateIndex
CREATE INDEX "RepairQuotationLine_organizationId_quotationId_idx" ON "RepairQuotationLine"("organizationId", "quotationId");

-- CreateIndex
CREATE INDEX "RepairJob_organizationId_repairOrderId_status_idx" ON "RepairJob"("organizationId", "repairOrderId", "status");

-- CreateIndex
CREATE INDEX "RepairJob_organizationId_technicianId_idx" ON "RepairJob"("organizationId", "technicianId");

-- CreateIndex
CREATE UNIQUE INDEX "RepairJob_organizationId_jobNumber_key" ON "RepairJob"("organizationId", "jobNumber");

-- CreateIndex
CREATE INDEX "RepairLabourType_organizationId_isActive_idx" ON "RepairLabourType"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RepairLabourType_organizationId_code_key" ON "RepairLabourType"("organizationId", "code");

-- CreateIndex
CREATE INDEX "RepairTechnician_organizationId_availability_idx" ON "RepairTechnician"("organizationId", "availability");

-- CreateIndex
CREATE UNIQUE INDEX "RepairTechnician_organizationId_code_key" ON "RepairTechnician"("organizationId", "code");

-- CreateIndex
CREATE INDEX "RepairPart_organizationId_repairOrderId_status_idx" ON "RepairPart"("organizationId", "repairOrderId", "status");

-- CreateIndex
CREATE INDEX "RepairPart_organizationId_productId_idx" ON "RepairPart"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "RepairStatusHistory_organizationId_repairOrderId_changedAt_idx" ON "RepairStatusHistory"("organizationId", "repairOrderId", "changedAt");

-- CreateIndex
CREATE INDEX "RepairAttachment_organizationId_repairOrderId_idx" ON "RepairAttachment"("organizationId", "repairOrderId");

-- CreateIndex
CREATE INDEX "RepairWarranty_organizationId_status_idx" ON "RepairWarranty"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RepairWarranty_organizationId_repairOrderId_idx" ON "RepairWarranty"("organizationId", "repairOrderId");

-- CreateIndex
CREATE INDEX "RepairWarrantyClaim_organizationId_warrantyId_idx" ON "RepairWarrantyClaim"("organizationId", "warrantyId");

-- CreateIndex
CREATE INDEX "RepairServiceContract_organizationId_status_idx" ON "RepairServiceContract"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RepairServiceContract_organizationId_partnerId_idx" ON "RepairServiceContract"("organizationId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "RepairServiceContract_organizationId_contractNumber_key" ON "RepairServiceContract"("organizationId", "contractNumber");

-- CreateIndex
CREATE INDEX "RepairSchedule_organizationId_status_nextDueAt_idx" ON "RepairSchedule"("organizationId", "status", "nextDueAt");

-- AddForeignKey
ALTER TABLE "RepairOrderItem" ADD CONSTRAINT "RepairOrderItem_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairDiagnosis" ADD CONSTRAINT "RepairDiagnosis_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairQuotation" ADD CONSTRAINT "RepairQuotation_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairQuotationLine" ADD CONSTRAINT "RepairQuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "RepairQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairJob" ADD CONSTRAINT "RepairJob_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairPart" ADD CONSTRAINT "RepairPart_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairStatusHistory" ADD CONSTRAINT "RepairStatusHistory_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairAttachment" ADD CONSTRAINT "RepairAttachment_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairWarranty" ADD CONSTRAINT "RepairWarranty_repairOrderId_fkey" FOREIGN KEY ("repairOrderId") REFERENCES "RepairOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairWarrantyClaim" ADD CONSTRAINT "RepairWarrantyClaim_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "RepairWarranty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

