-- AlterTable
ALTER TABLE "MobileMoneyRequest" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "gatewayAccountId" TEXT,
ADD COLUMN     "receivedAmount" DECIMAL(20,6),
ADD COLUMN     "settlementId" TEXT;

-- AlterTable
ALTER TABLE "PaymentImportRow" ADD COLUMN     "matchReason" TEXT;

-- AlterTable
ALTER TABLE "TermFinancialClose" ADD COLUMN     "academicYearId" TEXT,
ADD COLUMN     "snapshotAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PaymentGatewayAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "merchantCode" TEXT,
    "baseUrl" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'UGX',
    "credentialsCipher" TEXT,
    "credentialsIv" TEXT,
    "credentialsTag" TEXT,
    "callbackSecretCipher" TEXT,
    "callbackSecretIv" TEXT,
    "callbackSecretTag" TEXT,
    "clearingAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "PaymentGatewayAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileMoneySettlement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gatewayAccountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "settlementDate" TIMESTAMP(3) NOT NULL,
    "grossAmount" DECIMAL(20,6) NOT NULL,
    "charges" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(20,6) NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "MobileMoneySettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentGatewayAccount_organizationId_idx" ON "PaymentGatewayAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGatewayAccount_organizationId_provider_key" ON "PaymentGatewayAccount"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "MobileMoneySettlement_organizationId_idx" ON "MobileMoneySettlement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MobileMoneySettlement_organizationId_provider_reference_key" ON "MobileMoneySettlement"("organizationId", "provider", "reference");


-- Tenant-isolation policies (dormant until RLS is enabled org-wide; see
-- 20260920140200_academic_level_rls). App-side scoping is ORG_SCOPED.
DO $$
DECLARE
    t text;
    tables text[] := ARRAY['PaymentGatewayAccount', 'MobileMoneySettlement'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));',
            t
        );
    END LOOP;
END $$;
