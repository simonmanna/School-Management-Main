-- Fees & Finance production-hardening models (ADR-013).
-- Hand-authored slice: creates only the new fee-finance tables and the three
-- column extensions, leaving unrelated schema drift untouched. IF NOT EXISTS /
-- IF EXISTS guards make it safe to re-run.

-- ── Column extensions on existing tables ───────────────────────────────────
ALTER TABLE "FeeCredit"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "isRefundable" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Waiver"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

ALTER TABLE "FeeStructure"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS "currentVersionId" TEXT;

-- ── SchoolFeeInvoice ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SchoolFeeInvoice" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "academicYearId" TEXT,
  "termId" TEXT,
  "classId" TEXT,
  "sectionId" TEXT,
  "feeStructureVersionId" TEXT,
  "billingRunId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'issued',
  "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  CONSTRAINT "SchoolFeeInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SchoolFeeInvoice_documentId_key" ON "SchoolFeeInvoice"("documentId");
CREATE UNIQUE INDEX IF NOT EXISTS "SchoolFeeInvoice_org_student_term_version_key" ON "SchoolFeeInvoice"("organizationId","studentProfileId","termId","feeStructureVersionId");
CREATE UNIQUE INDEX IF NOT EXISTS "SchoolFeeInvoice_org_number_key" ON "SchoolFeeInvoice"("organizationId","invoiceNumber");
CREATE INDEX IF NOT EXISTS "SchoolFeeInvoice_organizationId_idx" ON "SchoolFeeInvoice"("organizationId");
CREATE INDEX IF NOT EXISTS "SchoolFeeInvoice_studentProfileId_idx" ON "SchoolFeeInvoice"("studentProfileId");
CREATE INDEX IF NOT EXISTS "SchoolFeeInvoice_termId_idx" ON "SchoolFeeInvoice"("termId");
CREATE INDEX IF NOT EXISTS "SchoolFeeInvoice_billingRunId_idx" ON "SchoolFeeInvoice"("billingRunId");

-- ── FeeCreditAllocation ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FeeCreditAllocation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "feeCreditId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "amount" DECIMAL(20,6) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'posted',
  "journalEntryId" TEXT,
  "reversedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  CONSTRAINT "FeeCreditAllocation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FeeCreditAllocation_organizationId_idx" ON "FeeCreditAllocation"("organizationId");
CREATE INDEX IF NOT EXISTS "FeeCreditAllocation_feeCreditId_idx" ON "FeeCreditAllocation"("feeCreditId");
CREATE INDEX IF NOT EXISTS "FeeCreditAllocation_documentId_idx" ON "FeeCreditAllocation"("documentId");

-- ── FeeAdjustment ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FeeAdjustment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "documentId" TEXT,
  "direction" TEXT NOT NULL,
  "amount" DECIMAL(20,6) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_approval',
  "journalEntryId" TEXT,
  "createdById" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "reversedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeeAdjustment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FeeAdjustment_org_code_key" ON "FeeAdjustment"("organizationId","code");
CREATE INDEX IF NOT EXISTS "FeeAdjustment_organizationId_idx" ON "FeeAdjustment"("organizationId");
CREATE INDEX IF NOT EXISTS "FeeAdjustment_studentProfileId_idx" ON "FeeAdjustment"("studentProfileId");
CREATE INDEX IF NOT EXISTS "FeeAdjustment_documentId_idx" ON "FeeAdjustment"("documentId");

-- ── BillingRun / BillingRunItem ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BillingRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "termId" TEXT NOT NULL,
  "classId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "totalStudents" INTEGER NOT NULL DEFAULT 0,
  "postedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "startedById" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BillingRun_organizationId_idx" ON "BillingRun"("organizationId");
CREATE INDEX IF NOT EXISTS "BillingRun_termId_idx" ON "BillingRun"("termId");

CREATE TABLE IF NOT EXISTS "BillingRunItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "billingRunId" TEXT NOT NULL,
  "studentProfileId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "documentId" TEXT,
  "schoolFeeInvoiceId" TEXT,
  "amount" DECIMAL(20,6),
  "error" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingRunItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BillingRunItem_run_student_key" ON "BillingRunItem"("billingRunId","studentProfileId");
CREATE INDEX IF NOT EXISTS "BillingRunItem_organizationId_idx" ON "BillingRunItem"("organizationId");
CREATE INDEX IF NOT EXISTS "BillingRunItem_billingRunId_idx" ON "BillingRunItem"("billingRunId");
DO $$ BEGIN
  ALTER TABLE "BillingRunItem" ADD CONSTRAINT "BillingRunItem_billingRunId_fkey"
    FOREIGN KEY ("billingRunId") REFERENCES "BillingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── TermFinancialClose ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TermFinancialClose" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "termId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "closedById" TEXT,
  "closedAt" TIMESTAMP(3),
  "reopenedById" TEXT,
  "reopenedAt" TIMESTAMP(3),
  "reopenReason" TEXT,
  "snapshot" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TermFinancialClose_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TermFinancialClose_org_term_key" ON "TermFinancialClose"("organizationId","termId");
CREATE INDEX IF NOT EXISTS "TermFinancialClose_organizationId_idx" ON "TermFinancialClose"("organizationId");

-- ── PaymentImportBatch / PaymentImportRow ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "PaymentImportBatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "fileHash" TEXT NOT NULL,
  "statementPeriod" TEXT,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "matchedCount" INTEGER NOT NULL DEFAULT 0,
  "postedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "uploadedById" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentImportBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentImportBatch_org_provider_period_hash_key" ON "PaymentImportBatch"("organizationId","provider","statementPeriod","fileHash");
CREATE INDEX IF NOT EXISTS "PaymentImportBatch_organizationId_idx" ON "PaymentImportBatch"("organizationId");

CREATE TABLE IF NOT EXISTS "PaymentImportRow" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "externalRef" TEXT NOT NULL,
  "payerPhone" TEXT,
  "payerName" TEXT,
  "amount" DECIMAL(20,6) NOT NULL,
  "transactionDate" TIMESTAMP(3),
  "narration" TEXT,
  "matchStatus" TEXT NOT NULL DEFAULT 'imported',
  "matchConfidence" TEXT NOT NULL DEFAULT 'none',
  "matchedStudentProfileId" TEXT,
  "paymentId" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentImportRow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentImportRow_org_externalRef_key" ON "PaymentImportRow"("organizationId","externalRef");
CREATE INDEX IF NOT EXISTS "PaymentImportRow_organizationId_idx" ON "PaymentImportRow"("organizationId");
CREATE INDEX IF NOT EXISTS "PaymentImportRow_batchId_idx" ON "PaymentImportRow"("batchId");
CREATE INDEX IF NOT EXISTS "PaymentImportRow_matchStatus_idx" ON "PaymentImportRow"("matchStatus");
DO $$ BEGIN
  ALTER TABLE "PaymentImportRow" ADD CONSTRAINT "PaymentImportRow_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "PaymentImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── FeeStructureVersion / FeeItem ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FeeStructureVersion" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "feeStructureId" TEXT NOT NULL,
  "versionNo" INTEGER NOT NULL,
  "isImmutable" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3),
  "publishedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeeStructureVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FeeStructureVersion_structure_version_key" ON "FeeStructureVersion"("feeStructureId","versionNo");
CREATE INDEX IF NOT EXISTS "FeeStructureVersion_organizationId_idx" ON "FeeStructureVersion"("organizationId");
CREATE INDEX IF NOT EXISTS "FeeStructureVersion_feeStructureId_idx" ON "FeeStructureVersion"("feeStructureId");

CREATE TABLE IF NOT EXISTS "FeeItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "feeStructureVersionId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "productId" TEXT,
  "amount" DECIMAL(20,6) NOT NULL,
  "isOptional" BOOLEAN NOT NULL DEFAULT false,
  "frequency" TEXT NOT NULL DEFAULT 'per_term',
  "appliesTo" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeeItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FeeItem_organizationId_idx" ON "FeeItem"("organizationId");
CREATE INDEX IF NOT EXISTS "FeeItem_feeStructureVersionId_idx" ON "FeeItem"("feeStructureVersionId");
DO $$ BEGIN
  ALTER TABLE "FeeItem" ADD CONSTRAINT "FeeItem_feeStructureVersionId_fkey"
    FOREIGN KEY ("feeStructureVersionId") REFERENCES "FeeStructureVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── FinancialRemediationBatch / Item ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FinancialRemediationBatch" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "sourceReportHash" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "createdById" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinancialRemediationBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FinancialRemediationBatch_org_code_key" ON "FinancialRemediationBatch"("organizationId","code");
CREATE INDEX IF NOT EXISTS "FinancialRemediationBatch_organizationId_idx" ON "FinancialRemediationBatch"("organizationId");

CREATE TABLE IF NOT EXISTS "FinancialRemediationItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "discrepancyType" TEXT NOT NULL,
  "originalAmount" DECIMAL(20,6) NOT NULL,
  "correctedAmount" DECIMAL(20,6) NOT NULL,
  "journalEntryId" TEXT,
  "explanation" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialRemediationItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FinancialRemediationItem_organizationId_idx" ON "FinancialRemediationItem"("organizationId");
CREATE INDEX IF NOT EXISTS "FinancialRemediationItem_batchId_idx" ON "FinancialRemediationItem"("batchId");
DO $$ BEGIN
  ALTER TABLE "FinancialRemediationItem" ADD CONSTRAINT "FinancialRemediationItem_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "FinancialRemediationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
