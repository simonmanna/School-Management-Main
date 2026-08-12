-- Add variance/banking fields to CashSession
ALTER TABLE "CashSession" ADD COLUMN "varianceReason" TEXT;
ALTER TABLE "CashSession" ADD COLUMN "varianceStatus" TEXT;
ALTER TABLE "CashSession" ADD COLUMN "bankedAmount" DECIMAL(20,6);
ALTER TABLE "CashSession" ADD COLUMN "bankName" TEXT;

-- PosReportSnapshot for frozen Z-report reprintability
CREATE TABLE "PosReportSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "reportData" JSONB NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'z',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosReportSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosReportSnapshot_cashSessionId_key" ON "PosReportSnapshot"("cashSessionId");
CREATE INDEX "PosReportSnapshot_organizationId_cashSessionId_idx" ON "PosReportSnapshot"("organizationId", "cashSessionId");
CREATE INDEX "PosReportSnapshot_organizationId_generatedAt_idx" ON "PosReportSnapshot"("organizationId", "generatedAt");
