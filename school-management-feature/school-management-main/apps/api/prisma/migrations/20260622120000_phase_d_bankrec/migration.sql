-- Phase D: Bank reconciliation tables.
--
-- BankStatementLine: one row per transaction on the bank side. Imported
-- from a CSV / MT940 / OFX file via BankReconciliationService.import().
-- BankReconciliationRun: an audit row per matching pass.

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "externalRef" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unmatched',
    "matchedPaymentId" TEXT,
    "matchedRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BankStatementLine_organizationId_bankAccountId_postedAt_idx" ON "BankStatementLine"("organizationId", "bankAccountId", "postedAt");
CREATE INDEX "BankStatementLine_status_idx" ON "BankStatementLine"("status");

-- CreateTable
CREATE TABLE "BankReconciliationRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "matched" INTEGER NOT NULL DEFAULT 0,
    "unmatched" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,6) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,

    CONSTRAINT "BankReconciliationRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BankReconciliationRun_organizationId_bankAccountId_startedAt_idx" ON "BankReconciliationRun"("organizationId", "bankAccountId", "startedAt");