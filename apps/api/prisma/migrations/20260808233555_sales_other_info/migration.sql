-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "fiscalPositionId" TEXT,
ADD COLUMN     "fiscalPositionName" TEXT,
ADD COLUMN     "incoterm" TEXT,
ADD COLUMN     "incotermLocation" TEXT,
ADD COLUMN     "invoicingJournalId" TEXT,
ADD COLUMN     "invoicingJournalName" TEXT,
ADD COLUMN     "salespersonId" TEXT,
ADD COLUMN     "salespersonName" TEXT,
ADD COLUMN     "sourceDocument" TEXT;

-- CreateTable
CREATE TABLE "FiscalPosition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FiscalPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalPosition_organizationId_idx" ON "FiscalPosition"("organizationId");

-- CreateIndex
CREATE INDEX "FiscalPosition_organizationId_deletedAt_idx" ON "FiscalPosition"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalPosition_organizationId_code_key" ON "FiscalPosition"("organizationId", "code");

