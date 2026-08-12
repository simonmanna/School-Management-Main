-- D3: Reporting snapshot tables (Trial Balance / P&L / Balance Sheet / AP Aging / TieOut).

-- CreateTable
CREATE TABLE "ReportTrialBalanceSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "debit" DECIMAL(20,6) NOT NULL,
    "credit" DECIMAL(20,6) NOT NULL,
    "balance" DECIMAL(20,6) NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportTrialBalanceSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportTrialBalanceSnapshot_organizationId_asOf_accountId_key" ON "ReportTrialBalanceSnapshot"("organizationId", "asOf", "accountId");
CREATE INDEX "ReportTrialBalanceSnapshot_organizationId_asOf_idx" ON "ReportTrialBalanceSnapshot"("organizationId", "asOf");

CREATE TABLE "ReportPnLSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "revenue" DECIMAL(20,6) NOT NULL,
    "contraRevenue" DECIMAL(20,6) NOT NULL,
    "cogs" DECIMAL(20,6) NOT NULL,
    "expense" DECIMAL(20,6) NOT NULL,
    "netIncome" DECIMAL(20,6) NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportPnLSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportPnLSnapshot_organizationId_asOf_key" ON "ReportPnLSnapshot"("organizationId", "asOf");
CREATE INDEX "ReportPnLSnapshot_organizationId_asOf_idx" ON "ReportPnLSnapshot"("asOf");

CREATE TABLE "ReportBalanceSheetSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "balance" DECIMAL(20,6) NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportBalanceSheetSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportBalanceSheetSnapshot_organizationId_asOf_accountId_key" ON "ReportBalanceSheetSnapshot"("organizationId", "asOf", "accountId");
CREATE INDEX "ReportBalanceSheetSnapshot_organizationId_asOf_idx" ON "ReportBalanceSheetSnapshot"("organizationId", "asOf");

CREATE TABLE "ReportApAgingSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerName" TEXT NOT NULL,
    "total" DECIMAL(20,6) NOT NULL,
    "current" DECIMAL(20,6) NOT NULL,
    "b1_30" DECIMAL(20,6) NOT NULL,
    "b31_60" DECIMAL(20,6) NOT NULL,
    "b61_90" DECIMAL(20,6) NOT NULL,
    "b90p" DECIMAL(20,6) NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportApAgingSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportApAgingSnapshot_organizationId_asOf_partnerId_key" ON "ReportApAgingSnapshot"("organizationId", "asOf", "partnerId");
CREATE INDEX "ReportApAgingSnapshot_organizationId_asOf_idx" ON "ReportApAgingSnapshot"("organizationId", "asOf");

CREATE TABLE "ReportTieoutSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "arBalanced" BOOLEAN NOT NULL,
    "arVariance" DECIMAL(20,6) NOT NULL,
    "apBalanced" BOOLEAN NOT NULL,
    "apVariance" DECIMAL(20,6) NOT NULL,
    "arDetails" JSONB NOT NULL,
    "apDetails" JSONB NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportTieoutSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportTieoutSnapshot_organizationId_asOf_key" ON "ReportTieoutSnapshot"("organizationId", "asOf");
CREATE INDEX "ReportTieoutSnapshot_organizationId_asOf_idx" ON "ReportTieoutSnapshot"("organizationId", "asOf");