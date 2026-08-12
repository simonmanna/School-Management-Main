-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense', 'cost_of_goods_sold', 'bank', 'cash', 'receivable', 'payable', 'tax', 'contra_asset', 'contra_liability');

-- CreateEnum
CREATE TYPE "JournalType" AS ENUM ('general', 'sales', 'purchase', 'cash', 'bank', 'adjustment', 'opening', 'closing');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('draft', 'posted', 'reversed');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('sales_invoice', 'credit_note', 'debit_note', 'proforma_invoice');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('draft', 'submitted', 'approved', 'posted', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('not_paid', 'partial', 'paid', 'overpaid');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('inbound', 'outbound');

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "payableAccountId" TEXT,
ADD COLUMN     "receivableAccountId" TEXT;

-- AlterTable
ALTER TABLE "ProductCategory" ADD COLUMN     "expenseAccountId" TEXT,
ADD COLUMN     "incomeAccountId" TEXT;

-- AlterTable
ALTER TABLE "Tax" ADD COLUMN     "accountId" TEXT;

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" "AccountType" NOT NULL,
    "parentAccountId" TEXT,
    "currencyId" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "journalType" "JournalType" NOT NULL DEFAULT 'general',
    "defaultDebitAccountId" TEXT,
    "defaultCreditAccountId" TEXT,
    "sequencePrefix" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "entryNumber" TEXT NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'draft',
    "currencyId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "reversedEntryId" TEXT,
    "reversalOfId" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partnerId" TEXT,
    "description" TEXT,
    "debit" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "credit" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "currencyId" TEXT,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "baseDebit" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "baseCredit" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AccountMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "padding" INTEGER NOT NULL DEFAULT 5,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "currencyId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL DEFAULT 'sales_invoice',
    "partnerId" TEXT NOT NULL,
    "currencyId" TEXT,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "DocumentStatus" NOT NULL DEFAULT 'draft',
    "reference" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "amountResidual" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'not_paid',
    "journalEntryId" TEXT,
    "reversedDocumentId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "productId" TEXT,
    "accountId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxId" TEXT,
    "subtotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "direction" "PaymentDirection" NOT NULL DEFAULT 'inbound',
    "partnerId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
    "journalId" TEXT,
    "accountId" TEXT,
    "currencyId" TEXT,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "allocatedAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "unallocatedAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'posted',
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_organizationId_idx" ON "Account"("organizationId");

-- CreateIndex
CREATE INDEX "Account_organizationId_accountType_idx" ON "Account"("organizationId", "accountType");

-- CreateIndex
CREATE UNIQUE INDEX "Account_organizationId_code_key" ON "Account"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Journal_organizationId_idx" ON "Journal"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Journal_organizationId_code_key" ON "Journal"("organizationId", "code");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_idx" ON "JournalEntry"("organizationId");

-- CreateIndex
CREATE INDEX "JournalEntry_organizationId_postingDate_idx" ON "JournalEntry"("organizationId", "postingDate");

-- CreateIndex
CREATE INDEX "JournalEntry_sourceType_sourceId_idx" ON "JournalEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_organizationId_entryNumber_key" ON "JournalEntry"("organizationId", "entryNumber");

-- CreateIndex
CREATE INDEX "JournalLine_organizationId_idx" ON "JournalLine"("organizationId");

-- CreateIndex
CREATE INDEX "JournalLine_journalEntryId_idx" ON "JournalLine"("journalEntryId");

-- CreateIndex
CREATE INDEX "JournalLine_organizationId_accountId_idx" ON "JournalLine"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "AccountMapping_organizationId_idx" ON "AccountMapping"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMapping_organizationId_key_key" ON "AccountMapping"("organizationId", "key");

-- CreateIndex
CREATE INDEX "Sequence_organizationId_idx" ON "Sequence"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_organizationId_key_key" ON "Sequence"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_accountId_key" ON "BankAccount"("accountId");

-- CreateIndex
CREATE INDEX "BankAccount_organizationId_idx" ON "BankAccount"("organizationId");

-- CreateIndex
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");

-- CreateIndex
CREATE INDEX "Document_organizationId_partnerId_idx" ON "Document"("organizationId", "partnerId");

-- CreateIndex
CREATE INDEX "Document_organizationId_documentType_status_idx" ON "Document"("organizationId", "documentType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Document_organizationId_documentNumber_key" ON "Document"("organizationId", "documentNumber");

-- CreateIndex
CREATE INDEX "DocumentLine_organizationId_idx" ON "DocumentLine"("organizationId");

-- CreateIndex
CREATE INDEX "DocumentLine_documentId_idx" ON "DocumentLine"("documentId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_partnerId_idx" ON "Payment"("organizationId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_organizationId_paymentNumber_key" ON "Payment"("organizationId", "paymentNumber");

-- CreateIndex
CREATE INDEX "PaymentAllocation_organizationId_idx" ON "PaymentAllocation"("organizationId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_documentId_idx" ON "PaymentAllocation"("documentId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLine" ADD CONSTRAINT "DocumentLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
