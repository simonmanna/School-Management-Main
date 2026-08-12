-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('machine', 'labour', 'space');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('pending', 'in_progress', 'paused', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ProductionCostKind" AS ENUM ('material', 'labour', 'machine', 'overhead', 'packaging', 'outsourcing', 'freight', 'utility');

-- CreateTable
CREATE TABLE "WorkCenter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WorkCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL DEFAULT 'machine',
    "workCenterId" TEXT,
    "fixedAssetId" TEXT,
    "userId" TEXT,
    "costPerHour" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "capacityMinsPerDay" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Routing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productId" TEXT,
    "bomId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Routing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingOperation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "routingId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "workCenterId" TEXT,
    "durationMins" INTEGER NOT NULL DEFAULT 0,
    "setupMins" INTEGER NOT NULL DEFAULT 0,
    "instructions" TEXT,

    CONSTRAINT "RoutingOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "routingOperationId" TEXT,
    "operationSequence" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "workCenterId" TEXT,
    "resourceId" TEXT,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'pending',
    "assignedToId" TEXT,
    "plannedDurationMins" INTEGER,
    "startedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "labourMins" INTEGER NOT NULL DEFAULT 0,
    "qtyGood" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "qtyScrap" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionCostComponent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "ProductionCostKind" NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionCostComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkCenter_organizationId_isActive_idx" ON "WorkCenter"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCenter_organizationId_code_key" ON "WorkCenter"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Resource_organizationId_kind_idx" ON "Resource"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_organizationId_code_key" ON "Resource"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Routing_organizationId_productId_idx" ON "Routing"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "Routing_organizationId_bomId_idx" ON "Routing"("organizationId", "bomId");

-- CreateIndex
CREATE INDEX "RoutingOperation_organizationId_routingId_idx" ON "RoutingOperation"("organizationId", "routingId");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_productionOrderId_idx" ON "WorkOrder"("organizationId", "productionOrderId");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_status_idx" ON "WorkOrder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_organizationId_workCenterId_idx" ON "WorkOrder"("organizationId", "workCenterId");

-- CreateIndex
CREATE INDEX "ProductionCostComponent_organizationId_orderId_idx" ON "ProductionCostComponent"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "ProductionCostComponent_organizationId_kind_idx" ON "ProductionCostComponent"("organizationId", "kind");

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingOperation" ADD CONSTRAINT "RoutingOperation_routingId_fkey" FOREIGN KEY ("routingId") REFERENCES "Routing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingOperation" ADD CONSTRAINT "RoutingOperation_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

