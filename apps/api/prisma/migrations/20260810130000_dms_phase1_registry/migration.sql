-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
-- (PG 12+ allows ADD VALUE in a transaction; dev server is PG 18.)

ALTER TYPE "DocumentStatus" ADD VALUE 'rejected';
ALTER TYPE "DocumentStatus" ADD VALUE 'confirmed';
ALTER TYPE "DocumentStatus" ADD VALUE 'issued';
ALTER TYPE "DocumentStatus" ADD VALUE 'active';
ALTER TYPE "DocumentStatus" ADD VALUE 'expired';
ALTER TYPE "DocumentStatus" ADD VALUE 'terminated';
ALTER TYPE "DocumentStatus" ADD VALUE 'revoked';
ALTER TYPE "DocumentStatus" ADD VALUE 'closed';
ALTER TYPE "DocumentStatus" ADD VALUE 'archived';

-- AlterTable
-- documentTypeId added NULLABLE first; backfilled from the legacy enum
-- mirror below, then forced NOT NULL (ADR O4 one-shot migration).
ALTER TABLE "Document" ADD COLUMN     "documentTypeId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "DocumentTypeDef" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'custom',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "numberingKey" TEXT,
    "numberingPrefix" TEXT,
    "numberingPadding" INTEGER NOT NULL DEFAULT 6,
    "lifecycleId" TEXT,
    "approvalPolicy" JSONB,
    "postingPolicy" JSONB,
    "paymentPolicy" JSONB,
    "cancellationPolicy" JSONB,
    "editPolicy" TEXT NOT NULL DEFAULT 'EDITABLE',
    "snapshotPolicy" JSONB,
    "printProfile" JSONB,
    "businessEffects" JSONB,
    "security" JSONB,
    "isFinancial" BOOLEAN NOT NULL DEFAULT false,
    "isInventoryRelevant" BOOLEAN NOT NULL DEFAULT false,
    "requiresPosting" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTypeDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationDocumentType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "configOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationDocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLifecycle" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "states" TEXT[],
    "initialState" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentLifecycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTransition" (
    "id" TEXT NOT NULL,
    "lifecycleId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "guardJson" JSONB,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DocumentTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRelationType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'out',
    "allowedSourceCategories" TEXT[],
    "allowedTargetCategories" TEXT[],
    "cardinality" TEXT NOT NULL DEFAULT 'many',
    "inverseImplicit" BOOLEAN NOT NULL DEFAULT false,
    "duplicatesAllowed" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentRelationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTypeDef_code_key" ON "DocumentTypeDef"("code");

-- CreateIndex
CREATE INDEX "OrganizationDocumentType_organizationId_idx" ON "OrganizationDocumentType"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationDocumentType_organizationId_documentTypeId_key" ON "OrganizationDocumentType"("organizationId", "documentTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLifecycle_code_key" ON "DocumentLifecycle"("code");

-- CreateIndex
CREATE INDEX "DocumentTransition_lifecycleId_idx" ON "DocumentTransition"("lifecycleId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTransition_lifecycleId_fromState_action_key" ON "DocumentTransition"("lifecycleId", "fromState", "action");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRelationType_code_key" ON "DocumentRelationType"("code");

-- CreateIndex
CREATE INDEX "DocumentAction_documentId_action_idx" ON "DocumentAction"("documentId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentAction_organizationId_documentId_action_idempotency_key" ON "DocumentAction"("organizationId", "documentId", "action", "idempotencyKey");

-- =============================================================================
-- ADR O4 one-shot backfill: self-seed the five core DocumentTypeDef rows whose
-- codes equal the legacy enum values, then backfill every Document row 1:1,
-- then force NOT NULL. Idempotent on re-run (ON CONFLICT DO NOTHING).
-- =============================================================================

INSERT INTO "DocumentTypeDef" ("id","code","name","description","category","isSystem","isActive","numberingKey","numberingPrefix","numberingPadding","editPolicy","createdAt","updatedAt")
SELECT gen_random_uuid(), v.code, v.name, v.description, v.category, true, true, v.nk, v.prefix, 6, 'IMMUTABLE_AFTER_ISSUE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
    ('sales_invoice',      'Sales Invoice',      'Universal sales document (POS + manual)', 'retail',      'invoice',    'INV-'),
    ('credit_note',        'Credit Note',        'Reversal counterpart of a sales invoice', 'retail',      'creditnote', 'CN-'),
    ('vendor_bill',        'Vendor Bill',        'Supplier invoice payable',                'procurement', 'vendorbill', 'BILL-'),
    ('debit_note',         'Debit Note',         'Supplier debit (purchase-side adjustment)', 'procurement','debitnote',  'DN-'),
    ('proforma_invoice',   'Proforma Invoice',   'Pre-billing estimate for a sale',         'retail',      'proforma',   'PRO-')
) AS v(code, name, description, category, nk, prefix)
ON CONFLICT ("code") DO NOTHING;

UPDATE "Document" d
SET "documentTypeId" = t.id
FROM "DocumentTypeDef" t
WHERE t.code = d."documentType"::text AND d."documentTypeId" IS NULL;

-- Hard gate: every row must be mapped before the column can be NOT NULL.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "Document" WHERE "documentTypeId" IS NULL) THEN
        RAISE EXCEPTION 'DMS backfill failed: Document rows remain without documentTypeId';
    END IF;
END $$;

ALTER TABLE "Document" ALTER COLUMN "documentTypeId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Document_organizationId_documentTypeId_status_idx" ON "Document"("organizationId", "documentTypeId", "status");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentTypeDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTypeDef" ADD CONSTRAINT "DocumentTypeDef_lifecycleId_fkey" FOREIGN KEY ("lifecycleId") REFERENCES "DocumentLifecycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationDocumentType" ADD CONSTRAINT "OrganizationDocumentType_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentTypeDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTransition" ADD CONSTRAINT "DocumentTransition_lifecycleId_fkey" FOREIGN KEY ("lifecycleId") REFERENCES "DocumentLifecycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAction" ADD CONSTRAINT "DocumentAction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;