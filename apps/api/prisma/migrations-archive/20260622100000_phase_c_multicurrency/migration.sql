-- Phase C: multi-currency support.
--
-- Adds CurrencyRate (FX history), FxRevaluation (unrealized gain/loss at
-- period close), and the Currency ↔ Organization base-currency relation.

-- AlterTable (idempotent: column already exists in current Prisma schema)
ALTER TABLE "Currency"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "CurrencyRate" (
    "id" TEXT NOT NULL,
    "fromCode" TEXT NOT NULL,
    "toCode" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CurrencyRate_fromCode_toCode_asOf_key" ON "CurrencyRate"("fromCode", "toCode", "asOf");
CREATE INDEX "CurrencyRate_fromCode_toCode_asOf_idx" ON "CurrencyRate"("fromCode", "toCode", "asOf");

-- CreateTable
CREATE TABLE "FxRevaluation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fiscalPeriodId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "bookBalance" DECIMAL(20,6) NOT NULL,
    "revaluedBalance" DECIMAL(20,6) NOT NULL,
    "fxGain" DECIMAL(20,6) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRevaluation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FxRevaluation_organizationId_fiscalPeriodId_accountId_key" ON "FxRevaluation"("organizationId", "fiscalPeriodId", "accountId");
CREATE INDEX "FxRevaluation_organizationId_fiscalPeriodId_idx" ON "FxRevaluation"("organizationId", "fiscalPeriodId");

-- AddForeignKey (currency base relation)
ALTER TABLE "Organization" DROP CONSTRAINT IF EXISTS "Organization_currencyCode_fkey";
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_currencyCode_fkey"
  FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE SET DEFAULT ON UPDATE CASCADE;

-- AddForeignKey (CurrencyRate FKs)
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_fromCode_fkey"
  FOREIGN KEY ("fromCode") REFERENCES "Currency"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_toCode_fkey"
  FOREIGN KEY ("toCode") REFERENCES "Currency"("code") ON DELETE CASCADE ON UPDATE CASCADE;