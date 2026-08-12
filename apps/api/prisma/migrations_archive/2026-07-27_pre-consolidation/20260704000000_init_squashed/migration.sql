-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ModifierGroupType" AS ENUM ('ADD_ON', 'MODIFIER');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('stockable', 'consumable', 'service', 'fee', 'subscription', 'asset');

-- CreateEnum
CREATE TYPE "CostingMethod" AS ENUM ('AVCO', 'FIFO', 'STANDARD');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('vat', 'gst', 'sales_tax', 'withholding');

-- CreateEnum
CREATE TYPE "FiscalPeriodStatus" AS ENUM ('open', 'closed', 'locked');

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('billing', 'shipping', 'office', 'branch', 'home');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'delete', 'login', 'logout', 'approve', 'reject', 'post', 'cancel', 'receive', 'issue', 'adjust', 'transfer', 'reconcile', 'merge', 'clean', 'reserve', 'reprint', 'assign', 'unassign');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense', 'cost_of_goods_sold', 'bank', 'cash', 'mobile_money', 'petty_cash', 'receivable', 'payable', 'tax', 'contra_asset', 'contra_liability');

-- CreateEnum
CREATE TYPE "JournalType" AS ENUM ('general', 'sales', 'purchase', 'cash', 'bank', 'adjustment', 'opening', 'closing');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('draft', 'posted', 'reversed');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('sales_invoice', 'credit_note', 'vendor_bill', 'debit_note', 'proforma_invoice');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('draft', 'submitted', 'approved', 'posted', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('not_paid', 'partial', 'paid', 'overpaid');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "PosStockPolicy" AS ENUM ('block', 'warn', 'silent');

-- CreateEnum
CREATE TYPE "PosHoldStatus" AS ENUM ('open', 'recalled', 'cancelled');

-- CreateEnum
CREATE TYPE "PosStation" AS ENUM ('bar', 'kitchen', 'cafe');

-- CreateEnum
CREATE TYPE "KdsTicketStatus" AS ENUM ('new', 'preparing', 'ready', 'served', 'cancelled');

-- CreateEnum
CREATE TYPE "OnlineOrderStatus" AS ENUM ('received', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('warehouse', 'store', 'virtual', 'main_kitchen', 'bar', 'storage_room', 'walkin_fridge', 'freezer', 'dry_storage', 'front_counter', 'branch');

-- CreateEnum
CREATE TYPE "StockMoveType" AS ENUM ('receipt', 'issue', 'adjustment_in', 'adjustment_out', 'transfer_in', 'transfer_out', 'opening_balance', 'waste', 'return_in', 'return_to_supplier', 'expiry_write_off');

-- CreateEnum
CREATE TYPE "StockDocStatus" AS ENUM ('draft', 'pending', 'approved', 'rejected', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "StockOutCategory" AS ENUM ('general_use', 'kitchen_testing', 'training', 'damaged', 'sample', 'expired', 'complimentary', 'other');

-- CreateEnum
CREATE TYPE "WasteCategory" AS ENUM ('expired', 'spoiled', 'burnt', 'contaminated', 'breakage', 'other');

-- CreateEnum
CREATE TYPE "StockAdjustmentReason" AS ENUM ('cycle_count', 'damaged', 'expired', 'theft', 'found', 'initial_count', 'other');

-- CreateEnum
CREATE TYPE "InventoryCountType" AS ENUM ('opening', 'closing');

-- CreateEnum
CREATE TYPE "InventoryCountStatus" AS ENUM ('draft', 'submitted', 'cancelled');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('open', 'closed', 'reconciled');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('sale', 'refund', 'pay_in', 'pay_out', 'adjustment');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('in_app', 'email', 'sms', 'push');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed', 'read');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('private', 'org', 'public');

-- CreateEnum
CREATE TYPE "OneTimeTokenPurpose" AS ENUM ('password_reset', 'email_verification', 'invite');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('daily', 'weekly', 'monthly', 'quarterly', 'yearly');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('active', 'paused', 'ended');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('pending', 'succeeded', 'failed', 'dead');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'cancelled', 'converted');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('draft', 'submitted', 'approved', 'sent', 'acknowledged', 'partially_received', 'received', 'billed', 'closed', 'cancelled', 'active');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('cash', 'credit');

-- CreateEnum
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('draft', 'posted', 'cancelled');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('pending', 'matched', 'partial', 'mismatch', 'blocked');

-- CreateEnum
CREATE TYPE "DebitNoteReason" AS ENUM ('price_adjustment', 'returned_goods', 'overcharge', 'correction', 'other');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('call', 'email', 'meeting', 'note', 'task', 'deal_stage_change');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "PosTableStatus" AS ENUM ('available', 'occupied', 'reserved', 'out_of_service');

-- CreateEnum
CREATE TYPE "PosTableShape" AS ENUM ('square', 'rectangle', 'circle');

-- CreateEnum
CREATE TYPE "PosTableZone" AS ENUM ('indoor', 'outdoor', 'terrace', 'vip', 'garden', 'bar', 'custom');

-- CreateEnum
CREATE TYPE "PosReservationStatus" AS ENUM ('pending', 'seated', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('dine_in', 'takeaway', 'delivery');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('draft', 'open', 'preparing', 'ready', 'served', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "OrderItemKitchenStatus" AS ENUM ('pending', 'sent', 'preparing', 'ready', 'served');

-- CreateEnum
CREATE TYPE "InvoicePaymentMode" AS ENUM ('cash', 'card', 'mobile_money', 'mixed', 'credit');

-- CreateEnum
CREATE TYPE "InvoiceSettlementStatus" AS ENUM ('unsettled', 'partially_settled', 'settled', 'written_off');

-- CreateEnum
CREATE TYPE "ReceiptType" AS ENUM ('payment_receipt', 'partial_payment_receipt', 'credit_issue_receipt', 'settlement_receipt', 'merchant_copy', 'reprint');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'posted', 'paid', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "SplitBillStatus" AS ENUM ('open', 'settled', 'void');

-- CreateEnum
CREATE TYPE "SplitType" AS ENUM ('item', 'even', 'percent');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED', 'VOID');

-- CreateEnum
CREATE TYPE "ExpensePaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "ExpensePaymentType" AS ENUM ('CASH', 'CREDIT');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "status" "OrganizationStatus" NOT NULL DEFAULT 'active',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "booksLockDate" TIMESTAMP(3),
    "requireFiscalPeriod" BOOLEAN NOT NULL DEFAULT false,
    "receiptHeader" JSONB,
    "receiptFooter" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "decimalPlaces" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "mfaSecret" TEXT,
    "mfaSecretIv" TEXT,
    "mfaSecretTag" TEXT,
    "mfaEnrolledAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "pinHash" TEXT,
    "pinHashRounds" INTEGER,
    "defaultBranchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "deviceLabel" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "actorId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'organization',
    "module" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isCompany" BOOLEAN NOT NULL DEFAULT false,
    "isCustomer" BOOLEAN NOT NULL DEFAULT false,
    "isSupplier" BOOLEAN NOT NULL DEFAULT false,
    "isEmployee" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "taxNumber" TEXT,
    "membershipLevel" TEXT,
    "gender" TEXT,
    "receivableAccountId" TEXT,
    "payableAccountId" TEXT,
    "status" "PartnerStatus" NOT NULL DEFAULT 'active',
    "categoryId" TEXT,
    "notes" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "position" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" "AddressType" NOT NULL DEFAULT 'billing',
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "productType" "ProductType" NOT NULL DEFAULT 'stockable',
    "costingMethod" "CostingMethod" NOT NULL DEFAULT 'AVCO',
    "categoryId" TEXT,
    "brandId" TEXT,
    "supplierId" TEXT,
    "uomId" TEXT,
    "purchaseUomId" TEXT,
    "uomConversion" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "taxId" TEXT,
    "salesPrice" DECIMAL(18,6),
    "costPrice" DECIMAL(18,6),
    "trackInventory" BOOLEAN NOT NULL DEFAULT true,
    "batchTracking" BOOLEAN NOT NULL DEFAULT false,
    "hasVariants" BOOLEAN NOT NULL DEFAULT false,
    "reorderQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "station" "PosStation" NOT NULL DEFAULT 'cafe',
    "minQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "stockPolicy" "PosStockPolicy" NOT NULL DEFAULT 'silent',
    "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "salesPrice" DECIMAL(18,6),
    "costPrice" DECIMAL(18,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "incomeAccountId" TEXT,
    "expenseAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'unit',
    "ratio" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tax" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" "TaxType" NOT NULL DEFAULT 'vat',
    "rate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "isInclusive" BOOLEAN NOT NULL DEFAULT false,
    "isCompound" BOOLEAN NOT NULL DEFAULT false,
    "accountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tax_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "FiscalPeriodStatus" NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FiscalPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

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
    "cashFlowCategory" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isProtected" BOOLEAN NOT NULL DEFAULT false,
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
    "branchId" TEXT,
    "costCenterId" TEXT,
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
    "branchId" TEXT,
    "costCenterId" TEXT,
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
    "paymentMode" "InvoicePaymentMode",
    "settlementStatus" "InvoiceSettlementStatus" NOT NULL DEFAULT 'unsettled',
    "journalEntryId" TEXT,
    "reversedDocumentId" TEXT,
    "branchId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "tableId" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "billPrintCount" INTEGER NOT NULL DEFAULT 0,
    "billLastPrintedAt" TIMESTAMP(3),
    "receiptPrintCount" INTEGER NOT NULL DEFAULT 0,
    "receiptLastPrintedAt" TIMESTAMP(3),
    "lastPrintedById" TEXT,
    "kotPrintCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "productId" TEXT,
    "menuItemId" TEXT,
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
    "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "kitchenPrintCount" INTEGER NOT NULL DEFAULT 0,
    "kitchenLastPrintedAt" TIMESTAMP(3),
    "kitchenPrintedQty" DECIMAL(20,6),
    "cancelPrintCount" INTEGER NOT NULL DEFAULT 0,
    "cancelLastPrintedAt" TIMESTAMP(3),
    "lastKitchenPrintedById" TEXT,
    "billPrintedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPrintLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT,
    "invoiceId" TEXT,
    "documentLineId" TEXT,
    "type" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'PRINT',
    "copies" INTEGER NOT NULL DEFAULT 1,
    "printedById" TEXT,
    "reason" TEXT,
    "printer" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentPrintLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLineModifier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentLineId" TEXT NOT NULL,
    "modifierId" TEXT,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentLineModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosHold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partnerId" TEXT,
    "branchId" TEXT,
    "cashSessionId" TEXT,
    "totalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "status" "PosHoldStatus" NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "heldById" TEXT,
    "recalledById" TEXT,
    "recalledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosHoldLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxId" TEXT,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "PosHoldLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupType" "ModifierGroupType" NOT NULL DEFAULT 'ADD_ON',
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Modifier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "inventoryItemId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Modifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductModifierGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Combo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(20,6) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Combo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ComboItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "image" TEXT,
    "icon" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "basePrice" DECIMAL(20,6),
    "taxId" TEXT,
    "image" TEXT,
    "preparationTime" INTEGER,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemModifierGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MenuItemModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuProduct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,

    CONSTRAINT "MenuProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemVariant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(20,6) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MenuItemVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccompanimentGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "minSelect" INTEGER NOT NULL DEFAULT 1,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AccompanimentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemAccompanimentGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "accompanimentGroupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MenuItemAccompanimentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccompanimentOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceImpact" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "inventoryItemId" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AccompanimentOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenTicket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "orderId" TEXT,
    "label" TEXT NOT NULL,
    "station" "PosStation" NOT NULL,
    "status" "KdsTicketStatus" NOT NULL DEFAULT 'new',
    "items" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyProgram" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pointsPerCurrency" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "currencyPerPoint" DECIMAL(20,6) NOT NULL DEFAULT 100,
    "minPointsToRedeem" INTEGER NOT NULL DEFAULT 50,
    "pointsExpireDays" INTEGER NOT NULL DEFAULT 365,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "delta" DECIMAL(20,6) NOT NULL,
    "balanceAfter" DECIMAL(20,6) NOT NULL,
    "reason" TEXT NOT NULL,
    "documentId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "LoyaltyLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCredit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "balance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "source" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCreditLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeCreditId" TEXT NOT NULL,
    "delta" DECIMAL(20,6) NOT NULL,
    "balanceAfter" DECIMAL(20,6) NOT NULL,
    "reason" TEXT NOT NULL,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "StoreCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerTab" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "balance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "cashSessionId" TEXT,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerTab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerTabLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "delta" DECIMAL(20,6) NOT NULL,
    "balanceAfter" DECIMAL(20,6) NOT NULL,
    "reason" TEXT NOT NULL,
    "documentId" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "CustomerTabLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuQrSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tableNumber" TEXT,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "MenuQrSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "orderType" TEXT NOT NULL DEFAULT 'dine_in',
    "items" JSONB NOT NULL,
    "subtotal" DECIMAL(20,6) NOT NULL,
    "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,6) NOT NULL,
    "invoiceId" TEXT,
    "paymentMethod" TEXT,
    "paymentRef" TEXT,
    "status" "OnlineOrderStatus" NOT NULL DEFAULT 'received',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlineOrder_pkey" PRIMARY KEY ("id")
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
    "branchId" TEXT,
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
    "documentId" TEXT,
    "invoiceId" TEXT,
    "amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'warehouse',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "variantKey" TEXT NOT NULL DEFAULT '',
    "locationId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "runningAverageCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "locationId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(20,6),
    "expiryDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLedger" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ledgerCode" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "locationId" TEXT NOT NULL,
    "batchId" TEXT,
    "type" "StockMoveType" NOT NULL,
    "qtyBefore" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "quantityChange" DECIMAL(20,6) NOT NULL,
    "balanceAfter" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOut" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outCode" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "category" "StockOutCategory" NOT NULL DEFAULT 'general_use',
    "status" "StockDocStatus" NOT NULL DEFAULT 'draft',
    "reason" TEXT,
    "notes" TEXT,
    "performedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "totalValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "StockOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOutItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stockOutId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "unit" TEXT,
    "qty" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "batchNumber" TEXT,
    "distStrategy" TEXT DEFAULT 'FEFO',

    CONSTRAINT "StockOutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wasteCode" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "category" "WasteCategory" NOT NULL DEFAULT 'other',
    "status" "StockDocStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "reportedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "totalValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "WasteRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wasteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "unit" TEXT,
    "qty" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "batchNumber" TEXT,
    "isExpiry" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WasteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "adjCode" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "reason" "StockAdjustmentReason" NOT NULL DEFAULT 'cycle_count',
    "status" "StockDocStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "performedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustmentItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "adjId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "unit" TEXT,
    "qtySystem" DECIMAL(20,6) NOT NULL,
    "qtyActual" DECIMAL(20,6) NOT NULL,
    "qtyDiff" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "batchNumber" TEXT,

    CONSTRAINT "StockAdjustmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "transferCode" TEXT NOT NULL,
    "fromLocId" TEXT NOT NULL,
    "toLocId" TEXT NOT NULL,
    "status" "StockDocStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "performedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "unit" TEXT,
    "qtyRequested" DECIMAL(20,6) NOT NULL,
    "qtyTransferred" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "batchNumber" TEXT,
    "distStrategy" TEXT DEFAULT 'FEFO',
    "unitCost" DECIMAL(20,6) NOT NULL DEFAULT 0,

    CONSTRAINT "StockTransferItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCountSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "countCode" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "countType" "InventoryCountType" NOT NULL DEFAULT 'opening',
    "status" "InventoryCountStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "adjustmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryCountSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCountLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "unit" TEXT,
    "systemQty" DECIMAL(20,6) NOT NULL,
    "countedQty" DECIMAL(20,6),
    "variance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "countedById" TEXT,
    "countedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id")
);

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
    "branchId" TEXT,
    "userId" TEXT NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingFloat" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "closingCounted" DECIMAL(20,6),
    "closingExpected" DECIMAL(20,6),
    "closingDifference" DECIMAL(20,6),
    "varianceReason" TEXT,
    "varianceStatus" TEXT,
    "bankedAmount" DECIMAL(20,6),
    "bankName" TEXT,
    "approvedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "openingDenomination" JSONB,
    "closingDenomination" JSONB,
    "closingByMethod" JSONB,
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

-- CreateTable
CREATE TABLE "PosReportSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cashSessionId" TEXT NOT NULL,
    "reportData" JSONB NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'z',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosReportSnapshot_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "EventOutbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimToken" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shippedAt" TIMESTAMP(3),

    CONSTRAINT "EventOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'in_app',
    "category" TEXT NOT NULL DEFAULT 'general',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "visibility" "FileVisibility" NOT NULL DEFAULT 'private',
    "ownerType" TEXT,
    "ownerId" TEXT,
    "checksum" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneTimeToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "purpose" "OneTimeTokenPurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OneTimeToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "policyId" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "requiredCount" INTEGER NOT NULL DEFAULT 1,
    "decidedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL,
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "minAmount" DECIMAL(20,6),
    "approverPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredCount" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "template" JSONB NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" "RecurringStatus" NOT NULL DEFAULT 'active',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringDocumentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recurringId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "ranAt" TIMESTAMP(3),
    "documentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,

    CONSTRAINT "RecurringDocumentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signingSecret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "succeededAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "schedule" TEXT,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "emailTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReportRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "ranAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "fileId" TEXT,
    "error" TEXT,

    CONSTRAINT "SavedReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationModule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "moduleName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "OrganizationModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "requestedById" TEXT,
    "partnerId" TEXT,
    "branchId" TEXT,
    "description" TEXT,
    "neededBy" TIMESTAMP(3),
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'draft',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "rejectedReason" TEXT,
    "snapshot" JSONB,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequestLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unitOfMeasureId" TEXT,
    "estimatedUnitPrice" DECIMAL(20,6),
    "notes" TEXT,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "branchId" TEXT,
    "description" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDeliveryDate" TIMESTAMP(3),
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'active',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "sentAt" TIMESTAMP(3),
    "paymentType" "PaymentType" NOT NULL DEFAULT 'cash',
    "paymentStatus" "PaymentStatus" DEFAULT 'not_paid',
    "totalPaid" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "snapshot" JSONB,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "requestId" TEXT,
    "parentOrderId" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchasePayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidById" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchasePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "receivedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "billedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "unitOfMeasureId" TEXT,
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "taxRate" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "taxId" TEXT,
    "subtotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "partnerId" TEXT,
    "branchId" TEXT,
    "warehouseId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "GoodsReceiptNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unitCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "batchNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBillLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "vendorBillId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorBillLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreeWayMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "productId" TEXT,
    "orderedQuantity" DECIMAL(20,6) NOT NULL,
    "receivedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "billedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "orderedUnitPrice" DECIMAL(20,6) NOT NULL,
    "billedUnitPrice" DECIMAL(20,6),
    "quantityVariance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "priceVariance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "status" "MatchStatus" NOT NULL DEFAULT 'pending',
    "thresholdExceeded" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreeWayMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebitNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noteNumber" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "partnerId" TEXT NOT NULL,
    "documentId" TEXT,
    "reason" "DebitNoteReason" NOT NULL DEFAULT 'other',
    "reasonNote" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "notes" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "DebitNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebitNoteLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "debitNoteId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "taxId" TEXT,
    "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "DebitNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEventLog" (
    "id" BIGSERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "ownerId" TEXT,
    "stage" "DealStage" NOT NULL DEFAULT 'lead',
    "amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "expectedClose" TIMESTAMP(3),
    "notes" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "dealId" TEXT,
    "partnerId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration" INTEGER,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosTable" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 2,
    "zone" "PosTableZone" NOT NULL DEFAULT 'indoor',
    "customZone" TEXT,
    "shape" "PosTableShape" NOT NULL DEFAULT 'square',
    "posX" INTEGER NOT NULL DEFAULT 40,
    "posY" INTEGER NOT NULL DEFAULT 40,
    "width" INTEGER NOT NULL DEFAULT 120,
    "height" INTEGER NOT NULL DEFAULT 120,
    "status" "PosTableStatus" NOT NULL DEFAULT 'available',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assignedWaiterId" TEXT,
    "mergedIntoId" TEXT,
    "mergedAt" TIMESTAMP(3),
    "mergedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "PosTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosTableOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "orderId" TEXT,
    "customerName" TEXT,
    "guestCount" INTEGER,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "PosTableOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosTableReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "partySize" INTEGER NOT NULL DEFAULT 2,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "PosReservationStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "seatedAt" TIMESTAMP(3),
    "noShowAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "seatedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "PosTableReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "orderType" "OrderType" NOT NULL DEFAULT 'dine_in',
    "status" "OrderStatus" NOT NULL DEFAULT 'open',
    "tableId" TEXT,
    "partnerId" TEXT,
    "waiterId" TEXT,
    "branchId" TEXT,
    "cashSessionId" TEXT,
    "guestCount" INTEGER,
    "notes" TEXT,
    "invoiceId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "transactionDiscountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelledBy" TEXT,
    "kitchenStartedAt" TIMESTAMP(3),
    "kitchenStartedBy" TEXT,
    "kitchenCompletedAt" TIMESTAMP(3),
    "kitchenCompletedBy" TEXT,
    "billPrintCount" INTEGER NOT NULL DEFAULT 0,
    "billLastPrintedAt" TIMESTAMP(3),
    "kotPrintCount" INTEGER NOT NULL DEFAULT 0,
    "lastPrintedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "menuItemId" TEXT,
    "comboId" TEXT,
    "variantId" TEXT,
    "variantName" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxId" TEXT,
    "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "kitchenStatus" "OrderItemKitchenStatus" NOT NULL DEFAULT 'pending',
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "voidedBy" TEXT,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "accompanimentNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accompanimentOptionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kitchenPrintCount" INTEGER NOT NULL DEFAULT 0,
    "kitchenLastPrintedAt" TIMESTAMP(3),
    "kitchenPrintedQty" DECIMAL(20,6),
    "cancelPrintCount" INTEGER NOT NULL DEFAULT 0,
    "cancelLastPrintedAt" TIMESTAMP(3),
    "lastKitchenPrintedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemModifier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "modifierId" TEXT,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "type" "ReceiptType" NOT NULL DEFAULT 'payment_receipt',
    "paymentId" TEXT,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "printedById" TEXT,
    "reason" TEXT,
    "printer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "orderId" TEXT,
    "partnerId" TEXT NOT NULL,
    "branchId" TEXT,
    "cashSessionId" TEXT,
    "waiterId" TEXT,
    "tableId" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "currencyId" TEXT,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "subtotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "amountResidual" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "amountRefunded" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "refundedBy" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'not_paid',
    "paymentMode" "InvoicePaymentMode",
    "settlementStatus" "InvoiceSettlementStatus" NOT NULL DEFAULT 'unsettled',
    "version" INTEGER NOT NULL DEFAULT 0,
    "journalEntryId" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "billPrintCount" INTEGER NOT NULL DEFAULT 0,
    "billLastPrintedAt" TIMESTAMP(3),
    "receiptPrintCount" INTEGER NOT NULL DEFAULT 0,
    "receiptLastPrintedAt" TIMESTAMP(3),
    "kotPrintCount" INTEGER NOT NULL DEFAULT 0,
    "lastPrintedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedBy" TEXT,
    "settledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT,
    "menuItemId" TEXT,
    "variantId" TEXT,
    "variantName" TEXT,
    "accompanimentOptionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "accountId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "taxId" TEXT,
    "taxInclusive" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "refundedQty" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItemModifier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceItemId" TEXT NOT NULL,
    "modifierId" TEXT,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceItemModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "total" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lineNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitBill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "sourceOrderId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "splitType" "SplitType" NOT NULL DEFAULT 'item',
    "sharePercent" DECIMAL(9,4),
    "partnerId" TEXT,
    "invoiceId" TEXT,
    "status" "SplitBillStatus" NOT NULL DEFAULT 'open',
    "subtotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "SplitBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitBillItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "splitBillId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SplitBillItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "ledgerAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "expenseCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(20,6) NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'APPROVED',
    "paymentStatus" "ExpensePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "paymentType" "ExpensePaymentType" NOT NULL DEFAULT 'CREDIT',
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "approvalNotes" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "supplierId" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "amountPaid" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpensePayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "reference" TEXT,
    "paymentNotes" TEXT,
    "accountId" TEXT,
    "paidById" TEXT,
    "journalEntryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpensePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_UserRoles" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserRoles_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Currency_code_key" ON "Currency"("code");

-- CreateIndex
CREATE INDEX "CurrencyRate_fromCode_toCode_asOf_idx" ON "CurrencyRate"("fromCode", "toCode", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "CurrencyRate_fromCode_toCode_asOf_key" ON "CurrencyRate"("fromCode", "toCode", "asOf");

-- CreateIndex
CREATE INDEX "FxRevaluation_organizationId_fiscalPeriodId_idx" ON "FxRevaluation"("organizationId", "fiscalPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "FxRevaluation_organizationId_fiscalPeriodId_accountId_key" ON "FxRevaluation"("organizationId", "fiscalPeriodId", "accountId");

-- CreateIndex
CREATE INDEX "BankStatementLine_organizationId_bankAccountId_postedAt_idx" ON "BankStatementLine"("organizationId", "bankAccountId", "postedAt");

-- CreateIndex
CREATE INDEX "BankStatementLine_status_idx" ON "BankStatementLine"("status");

-- CreateIndex
CREATE INDEX "BankReconciliationRun_organizationId_bankAccountId_startedA_idx" ON "BankReconciliationRun"("organizationId", "bankAccountId", "startedAt");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

-- CreateIndex
CREATE INDEX "Role_organizationId_idx" ON "Role"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_name_key" ON "Role"("organizationId", "name");

-- CreateIndex
CREATE INDEX "RefreshToken_organizationId_idx" ON "RefreshToken"("organizationId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_organizationId_tokenHash_key" ON "RefreshToken"("organizationId", "tokenHash");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_organizationId_createdAt_idx" ON "IdempotencyRecord"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_organizationId_key_key" ON "IdempotencyRecord"("organizationId", "key");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_entity_entityId_idx" ON "AuditLog"("organizationId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_organizationId_createdAt_idx" ON "LoginAttempt"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ipAddress_createdAt_idx" ON "LoginAttempt"("ipAddress", "createdAt");

-- CreateIndex
CREATE INDEX "Setting_organizationId_idx" ON "Setting"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_organizationId_scope_key_key" ON "Setting"("organizationId", "scope", "key");

-- CreateIndex
CREATE INDEX "Partner_organizationId_idx" ON "Partner"("organizationId");

-- CreateIndex
CREATE INDEX "Partner_organizationId_name_idx" ON "Partner"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_organizationId_code_key" ON "Partner"("organizationId", "code");

-- CreateIndex
CREATE INDEX "PartnerCategory_organizationId_idx" ON "PartnerCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCategory_organizationId_name_key" ON "PartnerCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Contact_organizationId_idx" ON "Contact"("organizationId");

-- CreateIndex
CREATE INDEX "Contact_partnerId_idx" ON "Contact"("partnerId");

-- CreateIndex
CREATE INDEX "Address_organizationId_idx" ON "Address"("organizationId");

-- CreateIndex
CREATE INDEX "Address_partnerId_idx" ON "Address"("partnerId");

-- CreateIndex
CREATE INDEX "Product_organizationId_idx" ON "Product"("organizationId");

-- CreateIndex
CREATE INDEX "Product_organizationId_name_idx" ON "Product"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Product_organizationId_brandId_idx" ON "Product"("organizationId", "brandId");

-- CreateIndex
CREATE INDEX "Product_organizationId_supplierId_idx" ON "Product"("organizationId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_code_key" ON "Product"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_barcode_key" ON "Product"("organizationId", "barcode");

-- CreateIndex
CREATE INDEX "Brand_organizationId_idx" ON "Brand"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_organizationId_name_key" ON "Brand"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ProductVariant_organizationId_idx" ON "ProductVariant"("organizationId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_organizationId_productId_name_key" ON "ProductVariant"("organizationId", "productId", "name");

-- CreateIndex
CREATE INDEX "ProductCategory_organizationId_idx" ON "ProductCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_organizationId_name_key" ON "ProductCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX "UnitOfMeasure_organizationId_idx" ON "UnitOfMeasure"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_organizationId_code_key" ON "UnitOfMeasure"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Tax_organizationId_idx" ON "Tax"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Tax_organizationId_name_key" ON "Tax"("organizationId", "name");

-- CreateIndex
CREATE INDEX "FiscalPeriod_organizationId_idx" ON "FiscalPeriod"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalPeriod_organizationId_name_key" ON "FiscalPeriod"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Branch_organizationId_idx" ON "Branch"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_organizationId_code_key" ON "Branch"("organizationId", "code");

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
CREATE INDEX "JournalEntry_organizationId_branchId_postingDate_idx" ON "JournalEntry"("organizationId", "branchId", "postingDate");

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
CREATE INDEX "JournalLine_organizationId_branchId_idx" ON "JournalLine"("organizationId", "branchId");

-- CreateIndex
CREATE INDEX "AccountMapping_organizationId_idx" ON "AccountMapping"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMapping_organizationId_key_key" ON "AccountMapping"("organizationId", "key");

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
CREATE INDEX "Document_organizationId_branchId_idx" ON "Document"("organizationId", "branchId");

-- CreateIndex
CREATE INDEX "Document_organizationId_tableId_idx" ON "Document"("organizationId", "tableId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_organizationId_documentNumber_key" ON "Document"("organizationId", "documentNumber");

-- CreateIndex
CREATE INDEX "DocumentLine_organizationId_idx" ON "DocumentLine"("organizationId");

-- CreateIndex
CREATE INDEX "DocumentLine_documentId_idx" ON "DocumentLine"("documentId");

-- CreateIndex
CREATE INDEX "DocumentLine_menuItemId_idx" ON "DocumentLine"("menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPrintLog_idempotencyKey_key" ON "DocumentPrintLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DocumentPrintLog_organizationId_idx" ON "DocumentPrintLog"("organizationId");

-- CreateIndex
CREATE INDEX "DocumentPrintLog_documentId_idx" ON "DocumentPrintLog"("documentId");

-- CreateIndex
CREATE INDEX "DocumentPrintLog_invoiceId_idx" ON "DocumentPrintLog"("invoiceId");

-- CreateIndex
CREATE INDEX "DocumentPrintLog_documentLineId_idx" ON "DocumentPrintLog"("documentLineId");

-- CreateIndex
CREATE INDEX "DocumentPrintLog_type_idx" ON "DocumentPrintLog"("type");

-- CreateIndex
CREATE INDEX "DocumentPrintLog_idempotencyKey_idx" ON "DocumentPrintLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DocumentLineModifier_organizationId_idx" ON "DocumentLineModifier"("organizationId");

-- CreateIndex
CREATE INDEX "DocumentLineModifier_documentLineId_idx" ON "DocumentLineModifier"("documentLineId");

-- CreateIndex
CREATE INDEX "DocumentLineModifier_modifierId_idx" ON "DocumentLineModifier"("modifierId");

-- CreateIndex
CREATE INDEX "PosHold_organizationId_idx" ON "PosHold"("organizationId");

-- CreateIndex
CREATE INDEX "PosHold_organizationId_status_idx" ON "PosHold"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PosHold_organizationId_cashSessionId_status_idx" ON "PosHold"("organizationId", "cashSessionId", "status");

-- CreateIndex
CREATE INDEX "PosHold_organizationId_branchId_status_idx" ON "PosHold"("organizationId", "branchId", "status");

-- CreateIndex
CREATE INDEX "PosHoldLine_organizationId_idx" ON "PosHoldLine"("organizationId");

-- CreateIndex
CREATE INDEX "PosHoldLine_holdId_idx" ON "PosHoldLine"("holdId");

-- CreateIndex
CREATE INDEX "ModifierGroup_organizationId_idx" ON "ModifierGroup"("organizationId");

-- CreateIndex
CREATE INDEX "ModifierGroup_organizationId_deletedAt_idx" ON "ModifierGroup"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModifierGroup_organizationId_name_key" ON "ModifierGroup"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Modifier_organizationId_idx" ON "Modifier"("organizationId");

-- CreateIndex
CREATE INDEX "Modifier_groupId_idx" ON "Modifier"("groupId");

-- CreateIndex
CREATE INDEX "Modifier_organizationId_deletedAt_idx" ON "Modifier"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "ProductModifierGroup_organizationId_idx" ON "ProductModifierGroup"("organizationId");

-- CreateIndex
CREATE INDEX "ProductModifierGroup_organizationId_deletedAt_idx" ON "ProductModifierGroup"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductModifierGroup_productId_modifierGroupId_key" ON "ProductModifierGroup"("productId", "modifierGroupId");

-- CreateIndex
CREATE INDEX "Combo_organizationId_idx" ON "Combo"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Combo_organizationId_name_key" ON "Combo"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ComboItem_organizationId_idx" ON "ComboItem"("organizationId");

-- CreateIndex
CREATE INDEX "ComboItem_comboId_idx" ON "ComboItem"("comboId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboItem_comboId_productId_key" ON "ComboItem"("comboId", "productId");

-- CreateIndex
CREATE INDEX "MenuCategory_organizationId_idx" ON "MenuCategory"("organizationId");

-- CreateIndex
CREATE INDEX "MenuCategory_parentId_idx" ON "MenuCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCategory_organizationId_name_parentId_key" ON "MenuCategory"("organizationId", "name", "parentId");

-- CreateIndex
CREATE INDEX "MenuItem_organizationId_idx" ON "MenuItem"("organizationId");

-- CreateIndex
CREATE INDEX "MenuItem_categoryId_idx" ON "MenuItem"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_organizationId_code_key" ON "MenuItem"("organizationId", "code");

-- CreateIndex
CREATE INDEX "MenuItemModifierGroup_organizationId_idx" ON "MenuItemModifierGroup"("organizationId");

-- CreateIndex
CREATE INDEX "MenuItemModifierGroup_menuItemId_idx" ON "MenuItemModifierGroup"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemModifierGroup_organizationId_deletedAt_idx" ON "MenuItemModifierGroup"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemModifierGroup_menuItemId_modifierGroupId_key" ON "MenuItemModifierGroup"("menuItemId", "modifierGroupId");

-- CreateIndex
CREATE INDEX "MenuProduct_organizationId_idx" ON "MenuProduct"("organizationId");

-- CreateIndex
CREATE INDEX "MenuProduct_productId_idx" ON "MenuProduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuProduct_menuItemId_productId_key" ON "MenuProduct"("menuItemId", "productId");

-- CreateIndex
CREATE INDEX "MenuItemVariant_organizationId_idx" ON "MenuItemVariant"("organizationId");

-- CreateIndex
CREATE INDEX "MenuItemVariant_menuItemId_idx" ON "MenuItemVariant"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemVariant_organizationId_deletedAt_idx" ON "MenuItemVariant"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemVariant_organizationId_menuItemId_name_key" ON "MenuItemVariant"("organizationId", "menuItemId", "name");

-- CreateIndex
CREATE INDEX "AccompanimentGroup_organizationId_idx" ON "AccompanimentGroup"("organizationId");

-- CreateIndex
CREATE INDEX "AccompanimentGroup_organizationId_deletedAt_idx" ON "AccompanimentGroup"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccompanimentGroup_organizationId_name_key" ON "AccompanimentGroup"("organizationId", "name");

-- CreateIndex
CREATE INDEX "MenuItemAccompanimentGroup_organizationId_idx" ON "MenuItemAccompanimentGroup"("organizationId");

-- CreateIndex
CREATE INDEX "MenuItemAccompanimentGroup_menuItemId_idx" ON "MenuItemAccompanimentGroup"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemAccompanimentGroup_organizationId_deletedAt_idx" ON "MenuItemAccompanimentGroup"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemAccompanimentGroup_menuItemId_accompanimentGroupId_key" ON "MenuItemAccompanimentGroup"("menuItemId", "accompanimentGroupId");

-- CreateIndex
CREATE INDEX "AccompanimentOption_organizationId_idx" ON "AccompanimentOption"("organizationId");

-- CreateIndex
CREATE INDEX "AccompanimentOption_groupId_idx" ON "AccompanimentOption"("groupId");

-- CreateIndex
CREATE INDEX "AccompanimentOption_organizationId_deletedAt_idx" ON "AccompanimentOption"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccompanimentOption_organizationId_groupId_name_key" ON "AccompanimentOption"("organizationId", "groupId", "name");

-- CreateIndex
CREATE INDEX "KitchenTicket_organizationId_station_status_idx" ON "KitchenTicket"("organizationId", "station", "status");

-- CreateIndex
CREATE INDEX "KitchenTicket_organizationId_createdAt_idx" ON "KitchenTicket"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "KitchenTicket_invoiceId_idx" ON "KitchenTicket"("invoiceId");

-- CreateIndex
CREATE INDEX "KitchenTicket_orderId_idx" ON "KitchenTicket"("orderId");

-- CreateIndex
CREATE INDEX "LoyaltyProgram_organizationId_idx" ON "LoyaltyProgram"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProgram_organizationId_name_key" ON "LoyaltyProgram"("organizationId", "name");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_organizationId_partnerId_createdAt_idx" ON "LoyaltyLedger"("organizationId", "partnerId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_organizationId_partnerId_reason_idx" ON "LoyaltyLedger"("organizationId", "partnerId", "reason");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_expiresAt_idx" ON "LoyaltyLedger"("expiresAt");

-- CreateIndex
CREATE INDEX "StoreCredit_organizationId_idx" ON "StoreCredit"("organizationId");

-- CreateIndex
CREATE INDEX "StoreCredit_organizationId_partnerId_idx" ON "StoreCredit"("organizationId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCredit_organizationId_partnerId_key" ON "StoreCredit"("organizationId", "partnerId");

-- CreateIndex
CREATE INDEX "StoreCreditLedger_organizationId_storeCreditId_createdAt_idx" ON "StoreCreditLedger"("organizationId", "storeCreditId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerTab_organizationId_idx" ON "CustomerTab"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerTab_organizationId_partnerId_key" ON "CustomerTab"("organizationId", "partnerId");

-- CreateIndex
CREATE INDEX "CustomerTabLedger_organizationId_tabId_createdAt_idx" ON "CustomerTabLedger"("organizationId", "tabId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MenuQrSession_token_key" ON "MenuQrSession"("token");

-- CreateIndex
CREATE INDEX "MenuQrSession_organizationId_branchId_idx" ON "MenuQrSession"("organizationId", "branchId");

-- CreateIndex
CREATE INDEX "MenuQrSession_organizationId_isActive_idx" ON "MenuQrSession"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "OnlineOrder_organizationId_status_createdAt_idx" ON "OnlineOrder"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OnlineOrder_organizationId_sessionId_idx" ON "OnlineOrder"("organizationId", "sessionId");

-- CreateIndex
CREATE INDEX "OnlineOrder_organizationId_customerPhone_idx" ON "OnlineOrder"("organizationId", "customerPhone");

-- CreateIndex
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_partnerId_idx" ON "Payment"("organizationId", "partnerId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_branchId_idx" ON "Payment"("organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_organizationId_paymentNumber_key" ON "Payment"("organizationId", "paymentNumber");

-- CreateIndex
CREATE INDEX "PaymentAllocation_organizationId_idx" ON "PaymentAllocation"("organizationId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_documentId_idx" ON "PaymentAllocation"("documentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE INDEX "InventoryLocation_organizationId_idx" ON "InventoryLocation"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLocation_organizationId_code_key" ON "InventoryLocation"("organizationId", "code");

-- CreateIndex
CREATE INDEX "StockItem_organizationId_idx" ON "StockItem"("organizationId");

-- CreateIndex
CREATE INDEX "StockItem_productId_idx" ON "StockItem"("productId");

-- CreateIndex
CREATE INDEX "StockItem_locationId_idx" ON "StockItem"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_organizationId_productId_variantKey_locationId_key" ON "StockItem"("organizationId", "productId", "variantKey", "locationId");

-- CreateIndex
CREATE INDEX "InventoryBatch_organizationId_idx" ON "InventoryBatch"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryBatch_productId_locationId_idx" ON "InventoryBatch"("productId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryBatch_expiryDate_idx" ON "InventoryBatch"("expiryDate");

-- CreateIndex
CREATE INDEX "InventoryLedger_organizationId_ledgerCode_idx" ON "InventoryLedger"("organizationId", "ledgerCode");

-- CreateIndex
CREATE INDEX "InventoryLedger_organizationId_idx" ON "InventoryLedger"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryLedger_productId_idx" ON "InventoryLedger"("productId");

-- CreateIndex
CREATE INDEX "InventoryLedger_locationId_idx" ON "InventoryLedger"("locationId");

-- CreateIndex
CREATE INDEX "InventoryLedger_organizationId_createdAt_idx" ON "InventoryLedger"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockOut_organizationId_status_idx" ON "StockOut"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StockOut_organizationId_locationId_idx" ON "StockOut"("organizationId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockOut_organizationId_outCode_key" ON "StockOut"("organizationId", "outCode");

-- CreateIndex
CREATE INDEX "StockOutItem_organizationId_stockOutId_idx" ON "StockOutItem"("organizationId", "stockOutId");

-- CreateIndex
CREATE INDEX "WasteRecord_organizationId_status_idx" ON "WasteRecord"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WasteRecord_organizationId_locationId_idx" ON "WasteRecord"("organizationId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "WasteRecord_organizationId_wasteCode_key" ON "WasteRecord"("organizationId", "wasteCode");

-- CreateIndex
CREATE INDEX "WasteItem_organizationId_wasteId_idx" ON "WasteItem"("organizationId", "wasteId");

-- CreateIndex
CREATE INDEX "StockAdjustment_organizationId_status_idx" ON "StockAdjustment"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StockAdjustment_organizationId_locationId_idx" ON "StockAdjustment"("organizationId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_organizationId_adjCode_key" ON "StockAdjustment"("organizationId", "adjCode");

-- CreateIndex
CREATE INDEX "StockAdjustmentItem_organizationId_adjId_idx" ON "StockAdjustmentItem"("organizationId", "adjId");

-- CreateIndex
CREATE INDEX "StockTransfer_organizationId_status_idx" ON "StockTransfer"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_organizationId_transferCode_key" ON "StockTransfer"("organizationId", "transferCode");

-- CreateIndex
CREATE INDEX "StockTransferItem_organizationId_transferId_idx" ON "StockTransferItem"("organizationId", "transferId");

-- CreateIndex
CREATE INDEX "InventoryCountSession_organizationId_status_idx" ON "InventoryCountSession"("organizationId", "status");

-- CreateIndex
CREATE INDEX "InventoryCountSession_organizationId_locationId_idx" ON "InventoryCountSession"("organizationId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCountSession_organizationId_countCode_key" ON "InventoryCountSession"("organizationId", "countCode");

-- CreateIndex
CREATE INDEX "InventoryCountLine_organizationId_sessionId_idx" ON "InventoryCountLine"("organizationId", "sessionId");

-- CreateIndex
CREATE INDEX "InventoryCountLine_sessionId_idx" ON "InventoryCountLine"("sessionId");

-- CreateIndex
CREATE INDEX "CashRegister_organizationId_idx" ON "CashRegister"("organizationId");

-- CreateIndex
CREATE INDEX "CashRegister_locationId_idx" ON "CashRegister"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "CashRegister_organizationId_code_key" ON "CashRegister"("organizationId", "code");

-- CreateIndex
CREATE INDEX "CashSession_organizationId_idx" ON "CashSession"("organizationId");

-- CreateIndex
CREATE INDEX "CashSession_cashRegisterId_idx" ON "CashSession"("cashRegisterId");

-- CreateIndex
CREATE INDEX "CashSession_userId_idx" ON "CashSession"("userId");

-- CreateIndex
CREATE INDEX "CashSession_status_idx" ON "CashSession"("status");

-- CreateIndex
CREATE INDEX "CashSession_organizationId_branchId_idx" ON "CashSession"("organizationId", "branchId");

-- CreateIndex
CREATE INDEX "CashMovement_organizationId_idx" ON "CashMovement"("organizationId");

-- CreateIndex
CREATE INDEX "CashMovement_cashSessionId_idx" ON "CashMovement"("cashSessionId");

-- CreateIndex
CREATE INDEX "CashMovement_paymentId_idx" ON "CashMovement"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PosReportSnapshot_cashSessionId_key" ON "PosReportSnapshot"("cashSessionId");

-- CreateIndex
CREATE INDEX "PosReportSnapshot_organizationId_cashSessionId_idx" ON "PosReportSnapshot"("organizationId", "cashSessionId");

-- CreateIndex
CREATE INDEX "PosReportSnapshot_organizationId_generatedAt_idx" ON "PosReportSnapshot"("organizationId", "generatedAt");

-- CreateIndex
CREATE INDEX "ReportTrialBalanceSnapshot_organizationId_asOf_idx" ON "ReportTrialBalanceSnapshot"("organizationId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "ReportTrialBalanceSnapshot_organizationId_asOf_accountId_key" ON "ReportTrialBalanceSnapshot"("organizationId", "asOf", "accountId");

-- CreateIndex
CREATE INDEX "ReportPnLSnapshot_organizationId_asOf_idx" ON "ReportPnLSnapshot"("organizationId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "ReportPnLSnapshot_organizationId_asOf_key" ON "ReportPnLSnapshot"("organizationId", "asOf");

-- CreateIndex
CREATE INDEX "ReportBalanceSheetSnapshot_organizationId_asOf_idx" ON "ReportBalanceSheetSnapshot"("organizationId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "ReportBalanceSheetSnapshot_organizationId_asOf_accountId_key" ON "ReportBalanceSheetSnapshot"("organizationId", "asOf", "accountId");

-- CreateIndex
CREATE INDEX "ReportApAgingSnapshot_organizationId_asOf_idx" ON "ReportApAgingSnapshot"("organizationId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "ReportApAgingSnapshot_organizationId_asOf_partnerId_key" ON "ReportApAgingSnapshot"("organizationId", "asOf", "partnerId");

-- CreateIndex
CREATE INDEX "ReportTieoutSnapshot_organizationId_asOf_idx" ON "ReportTieoutSnapshot"("organizationId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "ReportTieoutSnapshot_organizationId_asOf_key" ON "ReportTieoutSnapshot"("organizationId", "asOf");

-- CreateIndex
CREATE INDEX "EventOutbox_status_createdAt_idx" ON "EventOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "EventOutbox_organizationId_status_idx" ON "EventOutbox"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Notification_organizationId_userId_status_createdAt_idx" ON "Notification"("organizationId", "userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "NotificationPreference_organizationId_idx" ON "NotificationPreference"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_organizationId_userId_channel_catego_key" ON "NotificationPreference"("organizationId", "userId", "channel", "category");

-- CreateIndex
CREATE UNIQUE INDEX "File_storageKey_key" ON "File"("storageKey");

-- CreateIndex
CREATE INDEX "File_organizationId_ownerType_ownerId_idx" ON "File"("organizationId", "ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "File_organizationId_createdAt_idx" ON "File"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OneTimeToken_tokenHash_key" ON "OneTimeToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OneTimeToken_userId_purpose_idx" ON "OneTimeToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "OneTimeToken_expiresAt_idx" ON "OneTimeToken"("expiresAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_organizationId_entityType_entityId_idx" ON "ApprovalRequest"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_organizationId_status_idx" ON "ApprovalRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ApprovalDecision_organizationId_idx" ON "ApprovalDecision"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecision_requestId_approverId_key" ON "ApprovalDecision"("requestId", "approverId");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_organizationId_entityType_isActive_idx" ON "ApprovalPolicy"("organizationId", "entityType", "isActive");

-- CreateIndex
CREATE INDEX "RecurringDocument_organizationId_status_nextRunAt_idx" ON "RecurringDocument"("organizationId", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "RecurringDocumentRun_organizationId_status_scheduledFor_idx" ON "RecurringDocumentRun"("organizationId", "status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringDocumentRun_recurringId_scheduledFor_key" ON "RecurringDocumentRun"("recurringId", "scheduledFor");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_organizationId_isActive_idx" ON "WebhookEndpoint"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "WebhookDelivery_organizationId_status_nextAttemptAt_idx" ON "WebhookDelivery"("organizationId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_idx" ON "WebhookDelivery"("endpointId");

-- CreateIndex
CREATE INDEX "FeatureFlag_organizationId_idx" ON "FeatureFlag"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_organizationId_key_key" ON "FeatureFlag"("organizationId", "key");

-- CreateIndex
CREATE INDEX "SavedReport_organizationId_reportKey_idx" ON "SavedReport"("organizationId", "reportKey");

-- CreateIndex
CREATE INDEX "SavedReportRun_organizationId_status_scheduledFor_idx" ON "SavedReportRun"("organizationId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "OrganizationModule_organizationId_isActive_idx" ON "OrganizationModule"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationModule_organizationId_moduleName_key" ON "OrganizationModule"("organizationId", "moduleName");

-- CreateIndex
CREATE INDEX "PurchaseRequest_organizationId_status_idx" ON "PurchaseRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PurchaseRequest_organizationId_neededBy_idx" ON "PurchaseRequest"("organizationId", "neededBy");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_organizationId_requestNumber_key" ON "PurchaseRequest"("organizationId", "requestNumber");

-- CreateIndex
CREATE INDEX "PurchaseRequestLine_organizationId_purchaseRequestId_idx" ON "PurchaseRequestLine"("organizationId", "purchaseRequestId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_organizationId_partnerId_idx" ON "PurchaseOrder"("organizationId", "partnerId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_organizationId_status_idx" ON "PurchaseOrder"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_organizationId_orderDate_idx" ON "PurchaseOrder"("organizationId", "orderDate");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_orderNumber_key" ON "PurchaseOrder"("organizationId", "orderNumber");

-- CreateIndex
CREATE INDEX "PurchasePayment_organizationId_purchaseOrderId_idx" ON "PurchasePayment"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchasePayment_organizationId_paidAt_idx" ON "PurchasePayment"("organizationId", "paidAt");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_organizationId_purchaseOrderId_idx" ON "PurchaseOrderLine"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "GoodsReceiptNote_organizationId_purchaseOrderId_idx" ON "GoodsReceiptNote"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "GoodsReceiptNote_organizationId_status_idx" ON "GoodsReceiptNote"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptNote_organizationId_receiptNumber_key" ON "GoodsReceiptNote"("organizationId", "receiptNumber");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_organizationId_goodsReceiptId_idx" ON "GoodsReceiptLine"("organizationId", "goodsReceiptId");

-- CreateIndex
CREATE INDEX "VendorBillLink_organizationId_vendorBillId_idx" ON "VendorBillLink"("organizationId", "vendorBillId");

-- CreateIndex
CREATE INDEX "VendorBillLink_organizationId_purchaseOrderId_idx" ON "VendorBillLink"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorBillLink_vendorBillId_purchaseOrderId_key" ON "VendorBillLink"("vendorBillId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "ThreeWayMatch_organizationId_purchaseOrderId_idx" ON "ThreeWayMatch"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "ThreeWayMatch_organizationId_status_idx" ON "ThreeWayMatch"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ThreeWayMatch_purchaseOrderLineId_key" ON "ThreeWayMatch"("purchaseOrderLineId");

-- CreateIndex
CREATE INDEX "DebitNote_organizationId_partnerId_idx" ON "DebitNote"("organizationId", "partnerId");

-- CreateIndex
CREATE INDEX "DebitNote_organizationId_direction_status_idx" ON "DebitNote"("organizationId", "direction", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DebitNote_organizationId_noteNumber_key" ON "DebitNote"("organizationId", "noteNumber");

-- CreateIndex
CREATE INDEX "DebitNoteLine_organizationId_debitNoteId_idx" ON "DebitNoteLine"("organizationId", "debitNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_organizationId_userId_idx" ON "PushSubscription"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "DomainEventLog_organizationId_occurredAt_idx" ON "DomainEventLog"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "DomainEventLog_organizationId_entityType_entityId_idx" ON "DomainEventLog"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "Deal_organizationId_stage_idx" ON "Deal"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "Deal_organizationId_partnerId_idx" ON "Deal"("organizationId", "partnerId");

-- CreateIndex
CREATE INDEX "Deal_organizationId_ownerId_idx" ON "Deal"("organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "Activity_organizationId_subjectType_subjectId_idx" ON "Activity"("organizationId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "Activity_organizationId_dealId_idx" ON "Activity"("organizationId", "dealId");

-- CreateIndex
CREATE INDEX "Activity_organizationId_partnerId_idx" ON "Activity"("organizationId", "partnerId");

-- CreateIndex
CREATE INDEX "Activity_organizationId_dueAt_idx" ON "Activity"("organizationId", "dueAt");

-- CreateIndex
CREATE INDEX "Activity_organizationId_status_idx" ON "Activity"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PosTable_organizationId_idx" ON "PosTable"("organizationId");

-- CreateIndex
CREATE INDEX "PosTable_organizationId_status_idx" ON "PosTable"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PosTable_organizationId_zone_idx" ON "PosTable"("organizationId", "zone");

-- CreateIndex
CREATE INDEX "PosTable_organizationId_active_idx" ON "PosTable"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PosTable_organizationId_number_key" ON "PosTable"("organizationId", "number");

-- CreateIndex
CREATE INDEX "PosTableOrder_organizationId_idx" ON "PosTableOrder"("organizationId");

-- CreateIndex
CREATE INDEX "PosTableOrder_organizationId_tableId_closedAt_idx" ON "PosTableOrder"("organizationId", "tableId", "closedAt");

-- CreateIndex
CREATE INDEX "PosTableOrder_organizationId_orderId_idx" ON "PosTableOrder"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "PosTableOrder_organizationId_openedAt_idx" ON "PosTableOrder"("organizationId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosTableOrder_tableId_orderId_key" ON "PosTableOrder"("tableId", "orderId");

-- CreateIndex
CREATE INDEX "PosTableReservation_organizationId_idx" ON "PosTableReservation"("organizationId");

-- CreateIndex
CREATE INDEX "PosTableReservation_organizationId_tableId_idx" ON "PosTableReservation"("organizationId", "tableId");

-- CreateIndex
CREATE INDEX "PosTableReservation_organizationId_status_startAt_idx" ON "PosTableReservation"("organizationId", "status", "startAt");

-- CreateIndex
CREATE INDEX "PosTableReservation_organizationId_startAt_idx" ON "PosTableReservation"("organizationId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_invoiceId_key" ON "Order"("invoiceId");

-- CreateIndex
CREATE INDEX "Order_organizationId_idx" ON "Order"("organizationId");

-- CreateIndex
CREATE INDEX "Order_organizationId_status_idx" ON "Order"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Order_organizationId_tableId_status_idx" ON "Order"("organizationId", "tableId", "status");

-- CreateIndex
CREATE INDEX "Order_organizationId_cashSessionId_idx" ON "Order"("organizationId", "cashSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_organizationId_orderNumber_key" ON "Order"("organizationId", "orderNumber");

-- CreateIndex
CREATE INDEX "OrderItem_organizationId_idx" ON "OrderItem"("organizationId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_menuItemId_idx" ON "OrderItem"("menuItemId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderItemModifier_organizationId_idx" ON "OrderItemModifier"("organizationId");

-- CreateIndex
CREATE INDEX "OrderItemModifier_orderItemId_idx" ON "OrderItemModifier"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemModifier_modifierId_idx" ON "OrderItemModifier"("modifierId");

-- CreateIndex
CREATE INDEX "Receipt_organizationId_idx" ON "Receipt"("organizationId");

-- CreateIndex
CREATE INDEX "Receipt_organizationId_invoiceId_idx" ON "Receipt"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "Receipt_organizationId_type_idx" ON "Receipt"("organizationId", "type");

-- CreateIndex
CREATE INDEX "Receipt_receiptNumber_idx" ON "Receipt"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice"("organizationId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_status_idx" ON "Invoice"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_partnerId_idx" ON "Invoice"("organizationId", "partnerId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_settlementStatus_idx" ON "Invoice"("organizationId", "settlementStatus");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_tableId_idx" ON "Invoice"("organizationId", "tableId");

-- CreateIndex
CREATE INDEX "Invoice_journalEntryId_idx" ON "Invoice"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_invoiceNumber_key" ON "Invoice"("organizationId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceItem_organizationId_idx" ON "InvoiceItem"("organizationId");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_menuItemId_idx" ON "InvoiceItem"("menuItemId");

-- CreateIndex
CREATE INDEX "InvoiceItem_productId_idx" ON "InvoiceItem"("productId");

-- CreateIndex
CREATE INDEX "InvoiceItemModifier_organizationId_idx" ON "InvoiceItemModifier"("organizationId");

-- CreateIndex
CREATE INDEX "InvoiceItemModifier_invoiceItemId_idx" ON "InvoiceItemModifier"("invoiceItemId");

-- CreateIndex
CREATE INDEX "ReceiptItem_organizationId_idx" ON "ReceiptItem"("organizationId");

-- CreateIndex
CREATE INDEX "ReceiptItem_receiptId_idx" ON "ReceiptItem"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "SplitBill_invoiceId_key" ON "SplitBill"("invoiceId");

-- CreateIndex
CREATE INDEX "SplitBill_organizationId_idx" ON "SplitBill"("organizationId");

-- CreateIndex
CREATE INDEX "SplitBill_organizationId_tableId_idx" ON "SplitBill"("organizationId", "tableId");

-- CreateIndex
CREATE INDEX "SplitBill_organizationId_sourceOrderId_idx" ON "SplitBill"("organizationId", "sourceOrderId");

-- CreateIndex
CREATE INDEX "SplitBillItem_organizationId_idx" ON "SplitBillItem"("organizationId");

-- CreateIndex
CREATE INDEX "SplitBillItem_organizationId_splitBillId_idx" ON "SplitBillItem"("organizationId", "splitBillId");

-- CreateIndex
CREATE INDEX "SplitBillItem_sourceItemId_idx" ON "SplitBillItem"("sourceItemId");

-- CreateIndex
CREATE INDEX "ExpenseCategory_organizationId_idx" ON "ExpenseCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_organizationId_name_key" ON "ExpenseCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Expense_organizationId_idx" ON "Expense"("organizationId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_status_idx" ON "Expense"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Expense_organizationId_expenseDate_idx" ON "Expense"("organizationId", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_organizationId_expenseCode_key" ON "Expense"("organizationId", "expenseCode");

-- CreateIndex
CREATE INDEX "ExpensePayment_organizationId_idx" ON "ExpensePayment"("organizationId");

-- CreateIndex
CREATE INDEX "ExpensePayment_expenseId_idx" ON "ExpensePayment"("expenseId");

-- CreateIndex
CREATE INDEX "_UserRoles_B_index" ON "_UserRoles"("B");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_fromCode_fkey" FOREIGN KEY ("fromCode") REFERENCES "Currency"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_toCode_fkey" FOREIGN KEY ("toCode") REFERENCES "Currency"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PartnerCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCategory" ADD CONSTRAINT "PartnerCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PartnerCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_uomId_fkey" FOREIGN KEY ("uomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_purchaseUomId_fkey" FOREIGN KEY ("purchaseUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxId_fkey" FOREIGN KEY ("taxId") REFERENCES "Tax"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "DocumentPrintLog" ADD CONSTRAINT "DocumentPrintLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPrintLog" ADD CONSTRAINT "DocumentPrintLog_documentLineId_fkey" FOREIGN KEY ("documentLineId") REFERENCES "DocumentLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLineModifier" ADD CONSTRAINT "DocumentLineModifier_documentLineId_fkey" FOREIGN KEY ("documentLineId") REFERENCES "DocumentLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosHoldLine" ADD CONSTRAINT "PosHoldLine_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "PosHold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Modifier" ADD CONSTRAINT "Modifier_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModifierGroup" ADD CONSTRAINT "ProductModifierGroup_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MenuCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MenuCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemModifierGroup" ADD CONSTRAINT "MenuItemModifierGroup_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemModifierGroup" ADD CONSTRAINT "MenuItemModifierGroup_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuProduct" ADD CONSTRAINT "MenuProduct_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuProduct" ADD CONSTRAINT "MenuProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemVariant" ADD CONSTRAINT "MenuItemVariant_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemAccompanimentGroup" ADD CONSTRAINT "MenuItemAccompanimentGroup_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemAccompanimentGroup" ADD CONSTRAINT "MenuItemAccompanimentGroup_accompanimentGroupId_fkey" FOREIGN KEY ("accompanimentGroupId") REFERENCES "AccompanimentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccompanimentOption" ADD CONSTRAINT "AccompanimentOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AccompanimentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCreditLedger" ADD CONSTRAINT "StoreCreditLedger_storeCreditId_fkey" FOREIGN KEY ("storeCreditId") REFERENCES "StoreCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTabLedger" ADD CONSTRAINT "CustomerTabLedger_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "CustomerTab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineOrder" ADD CONSTRAINT "OnlineOrder_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "MenuQrSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOut" ADD CONSTRAINT "StockOut_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockOutItem" ADD CONSTRAINT "StockOutItem_stockOutId_fkey" FOREIGN KEY ("stockOutId") REFERENCES "StockOut"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteRecord" ADD CONSTRAINT "WasteRecord_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteItem" ADD CONSTRAINT "WasteItem_wasteId_fkey" FOREIGN KEY ("wasteId") REFERENCES "WasteRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentItem" ADD CONSTRAINT "StockAdjustmentItem_adjId_fkey" FOREIGN KEY ("adjId") REFERENCES "StockAdjustment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromLocId_fkey" FOREIGN KEY ("fromLocId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toLocId_fkey" FOREIGN KEY ("toLocId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountSession" ADD CONSTRAINT "InventoryCountSession_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InventoryCountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_defaultAccountId_fkey" FOREIGN KEY ("defaultAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "CashRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringDocumentRun" ADD CONSTRAINT "RecurringDocumentRun_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReportRun" ADD CONSTRAINT "SavedReportRun_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "SavedReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestLine" ADD CONSTRAINT "PurchaseRequestLine_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceiptNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBillLink" ADD CONSTRAINT "VendorBillLink_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreeWayMatch" ADD CONSTRAINT "ThreeWayMatch_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitNote" ADD CONSTRAINT "DebitNote_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebitNoteLine" ADD CONSTRAINT "DebitNoteLine_debitNoteId_fkey" FOREIGN KEY ("debitNoteId") REFERENCES "DebitNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTable" ADD CONSTRAINT "PosTable_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "PosTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTableOrder" ADD CONSTRAINT "PosTableOrder_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "PosTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTableOrder" ADD CONSTRAINT "PosTableOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosTableReservation" ADD CONSTRAINT "PosTableReservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "PosTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItemModifier" ADD CONSTRAINT "InvoiceItemModifier_invoiceItemId_fkey" FOREIGN KEY ("invoiceItemId") REFERENCES "InvoiceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitBillItem" ADD CONSTRAINT "SplitBillItem_splitBillId_fkey" FOREIGN KEY ("splitBillId") REFERENCES "SplitBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePayment" ADD CONSTRAINT "ExpensePayment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserRoles" ADD CONSTRAINT "_UserRoles_A_fkey" FOREIGN KEY ("A") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserRoles" ADD CONSTRAINT "_UserRoles_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

