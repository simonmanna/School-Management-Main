-- Phase 1 (accounting hardening) — durable inventory posting.
-- StockPostingJob: one job per invoice, drained out-of-band with backoff.
-- InventoryException: structured work-queue replacing the dead
-- `stock_reconcile_needed` audit marker. Both loosely coupled (no FK), matching
-- EventOutbox / SyncOpDeadLetter.

-- CreateTable
CREATE TABLE "StockPostingJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "orderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "StockPostingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryException" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "invoiceNumber" TEXT,
    "locationId" TEXT,
    "productId" TEXT,
    "menuItemId" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "stackTrace" TEXT,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignedToId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockPostingJob_organizationId_invoiceId_key" ON "StockPostingJob"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "StockPostingJob_status_nextRetryAt_idx" ON "StockPostingJob"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "StockPostingJob_organizationId_status_idx" ON "StockPostingJob"("organizationId", "status");

-- CreateIndex
CREATE INDEX "InventoryException_organizationId_status_idx" ON "InventoryException"("organizationId", "status");

-- CreateIndex
CREATE INDEX "InventoryException_organizationId_invoiceId_idx" ON "InventoryException"("organizationId", "invoiceId");
