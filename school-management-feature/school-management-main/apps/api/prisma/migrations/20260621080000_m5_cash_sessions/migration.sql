-- M5 — Cash sessions / cash registers (foundation for POS + School canteen).
-- A CashRegister is metadata about a till. A CashSession is an open shift with
-- an opening float and a closing counted amount. CashMovement tracks every
-- in/out during a session and links to Payment rows for sales/refunds.

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('open', 'closed', 'reconciled');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('sale', 'refund', 'pay_in', 'pay_out', 'adjustment');

-- CreateTable
CREATE TABLE "CashRegister" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "defaultAccountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CashRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cashRegisterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingFloat" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "closingCounted" DECIMAL(20,6),
    "closingExpected" DECIMAL(20,6),
    "closingDifference" DECIMAL(20,6),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "movementType" "CashMovementType" NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "paymentId" TEXT,
    "reason" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashRegister_organizationId_idx" ON "CashRegister"("organizationId");
CREATE UNIQUE INDEX "CashRegister_organizationId_code_key" ON "CashRegister"("organizationId", "code");
CREATE INDEX "CashRegister_locationId_idx" ON "CashRegister"("locationId");

CREATE INDEX "CashSession_organizationId_idx" ON "CashSession"("organizationId");
CREATE INDEX "CashSession_cashRegisterId_idx" ON "CashSession"("cashRegisterId");
CREATE INDEX "CashSession_userId_idx" ON "CashSession"("userId");
CREATE INDEX "CashSession_status_idx" ON "CashSession"("status");

CREATE INDEX "CashMovement_organizationId_idx" ON "CashMovement"("organizationId");
CREATE INDEX "CashMovement_cashSessionId_idx" ON "CashMovement"("cashSessionId");
CREATE INDEX "CashMovement_paymentId_idx" ON "CashMovement"("paymentId");

-- AddForeignKey
ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_defaultAccountId_fkey" FOREIGN KEY ("defaultAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "CashRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;