-- CreateEnum
CREATE TYPE "SaleKind" AS ENUM ('sale', 'rental', 'rental_settlement');

-- CreateEnum
CREATE TYPE "RentalRatePeriod" AS ENUM ('hour', 'day', 'week', 'month');

-- CreateEnum
CREATE TYPE "RentalUnitStatus" AS ENUM ('available', 'reserved', 'checked_out', 'returned', 'cleaning', 'repair', 'damaged', 'lost', 'retired');

-- CreateEnum
CREATE TYPE "RentalAgreementStatus" AS ENUM ('draft', 'pending_approval', 'confirmed', 'checked_out', 'partially_returned', 'returned', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "RentalReservationStatus" AS ENUM ('draft', 'held', 'confirmed', 'expired', 'cancelled', 'converted', 'no_show');

-- CreateEnum
CREATE TYPE "RentalBookingStatus" AS ENUM ('held', 'confirmed', 'active', 'completed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "RentalConditionGrade" AS ENUM ('excellent', 'good', 'fair', 'poor', 'damaged');

-- CreateEnum
CREATE TYPE "RentalServiceType" AS ENUM ('cleaning', 'repair', 'alteration');

-- CreateEnum
CREATE TYPE "RentalServiceStatus" AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "RentalDepositStatus" AS ENUM ('held', 'partially_applied', 'applied', 'refunded', 'forfeited');

-- CreateEnum
CREATE TYPE "RentalDepositMoveType" AS ENUM ('collected', 'applied', 'refunded', 'forfeited');

-- CreateEnum
CREATE TYPE "RentalLocationRole" AS ENUM ('stock', 'out', 'cleaning', 'repair', 'damaged');

-- CreateEnum
CREATE TYPE "RentalPackageItemRole" AS ENUM ('primary', 'accessory', 'consumable');

-- CreateEnum
CREATE TYPE "RentalPackageItemPriceMode" AS ENUM ('included', 'add_on');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "rentalAgreementId" TEXT,
ADD COLUMN     "transactionKind" "SaleKind" NOT NULL DEFAULT 'sale';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "rentalAgreementLineId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isRentable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rentalBufferDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rentalDefaultPeriod" "RentalRatePeriod",
ADD COLUMN     "rentalDepositAmount" DECIMAL(20,6),
ADD COLUMN     "rentalIsPooled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rentalLateFeePerPeriod" DECIMAL(20,6),
ADD COLUMN     "rentalMaxPeriods" INTEGER,
ADD COLUMN     "rentalMinPeriods" INTEGER,
ADD COLUMN     "rentalReplacementCost" DECIMAL(20,6),
ADD COLUMN     "rentalRequiresCleaning" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LifecycleEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "defKey" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "byUserId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "period" "RentalRatePeriod" NOT NULL,
    "minUnits" INTEGER NOT NULL DEFAULT 1,
    "maxUnits" INTEGER,
    "price" DECIMAL(20,6) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RentalRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalUnit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "barcode" TEXT,
    "qrCode" TEXT,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "inventorySerialId" TEXT,
    "assetId" TEXT,
    "status" "RentalUnitStatus" NOT NULL DEFAULT 'available',
    "conditionGrade" "RentalConditionGrade" NOT NULL DEFAULT 'good',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acquisitionCost" DECIMAL(20,6),
    "rentalCount" INTEGER NOT NULL DEFAULT 0,
    "lifetimeRevenue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RentalUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalLocationConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "RentalLocationRole" NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalLocationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalPackage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "productId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RentalPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalPackageItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "role" "RentalPackageItemRole" NOT NULL DEFAULT 'accessory',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "priceMode" "RentalPackageItemPriceMode" NOT NULL DEFAULT 'included',

    CONSTRAINT "RentalPackageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reservationNumber" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "status" "RentalReservationStatus" NOT NULL DEFAULT 'draft',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "holdMinutes" INTEGER NOT NULL DEFAULT 60,
    "notes" TEXT,
    "branchId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalReservationLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,

    CONSTRAINT "RentalReservationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalAgreement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agreementNumber" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "status" "RentalAgreementStatus" NOT NULL DEFAULT 'draft',
    "startAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "orderId" TEXT,
    "invoiceId" TEXT,
    "settlementOrderId" TEXT,
    "settlementInvoiceId" TEXT,
    "depositId" TEXT,
    "packageId" TEXT,
    "branchId" TEXT,
    "cashSessionId" TEXT,
    "termsSnapshot" JSONB NOT NULL DEFAULT '{}',
    "signatureUrl" TEXT,
    "notes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "checkedOutAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "RentalAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalAgreementLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT,
    "packageItemId" TEXT,
    "role" "RentalPackageItemRole" NOT NULL DEFAULT 'primary',
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "ratePeriod" "RentalRatePeriod" NOT NULL,
    "rateUnits" INTEGER NOT NULL DEFAULT 1,
    "unitRate" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "checkedOutAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),

    CONSTRAINT "RentalAgreementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalBooking" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitId" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "RentalBookingStatus" NOT NULL DEFAULT 'held',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "RentalBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalExtension" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agreementLineId" TEXT NOT NULL,
    "previousDueAt" TIMESTAMP(3) NOT NULL,
    "newDueAt" TIMESTAMP(3) NOT NULL,
    "additionalUnits" INTEGER NOT NULL DEFAULT 0,
    "additionalCharge" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "approvedById" TEXT,
    "settlementOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalExtension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalSwap" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agreementLineId" TEXT NOT NULL,
    "fromUnitId" TEXT NOT NULL,
    "toUnitId" TEXT NOT NULL,
    "reason" TEXT,
    "priceDelta" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalSwap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalReturn" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalReturnLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "agreementLineId" TEXT NOT NULL,
    "unitId" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL DEFAULT 1,
    "quantityMissing" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "returnedAt" TIMESTAMP(3),
    "conditionGrade" "RentalConditionGrade",
    "isMissing" BOOLEAN NOT NULL DEFAULT false,
    "inspectedById" TEXT,
    "inspectedAt" TIMESTAMP(3),
    "lateDays" INTEGER NOT NULL DEFAULT 0,
    "lateFeeAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "photos" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,

    CONSTRAINT "RentalReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalDamage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "returnLineId" TEXT NOT NULL,
    "damageType" TEXT NOT NULL,
    "description" TEXT,
    "chargeAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "photos" JSONB NOT NULL DEFAULT '{}',
    "waivedById" TEXT,
    "waiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalDamage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalServiceOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "serviceNumber" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "type" "RentalServiceType" NOT NULL,
    "status" "RentalServiceStatus" NOT NULL DEFAULT 'pending',
    "vendor" TEXT,
    "cost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "expenseId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalServiceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalDeposit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "status" "RentalDepositStatus" NOT NULL DEFAULT 'held',
    "totalCollected" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalApplied" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalRefunded" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalForfeited" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalDepositMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "type" "RentalDepositMoveType" NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "paymentId" TEXT,
    "journalEntryId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalDepositMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalCustomerScore" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "lateReturns" INTEGER NOT NULL DEFAULT 0,
    "damageEvents" INTEGER NOT NULL DEFAULT 0,
    "lostItems" INTEGER NOT NULL DEFAULT 0,
    "unpaidBalance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "cancelledReservations" INTEGER NOT NULL DEFAULT 0,
    "completedRentals" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 100,
    "band" TEXT NOT NULL DEFAULT 'good',
    "manualHold" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalCustomerScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LifecycleEvent_organizationId_defKey_entityId_createdAt_idx" ON "LifecycleEvent"("organizationId", "defKey", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "LifecycleEvent_organizationId_entityType_entityId_idx" ON "LifecycleEvent"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "RentalRate_organizationId_productId_idx" ON "RentalRate"("organizationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalRate_organizationId_productId_period_minUnits_key" ON "RentalRate"("organizationId", "productId", "period", "minUnits");

-- CreateIndex
CREATE INDEX "RentalUnit_organizationId_productId_status_idx" ON "RentalUnit"("organizationId", "productId", "status");

-- CreateIndex
CREATE INDEX "RentalUnit_organizationId_status_idx" ON "RentalUnit"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RentalUnit_organizationId_inventorySerialId_idx" ON "RentalUnit"("organizationId", "inventorySerialId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalUnit_organizationId_unitCode_key" ON "RentalUnit"("organizationId", "unitCode");

-- CreateIndex
CREATE UNIQUE INDEX "RentalUnit_organizationId_barcode_key" ON "RentalUnit"("organizationId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "RentalLocationConfig_role_key" ON "RentalLocationConfig"("role");

-- CreateIndex
CREATE INDEX "RentalLocationConfig_organizationId_idx" ON "RentalLocationConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalLocationConfig_organizationId_role_key" ON "RentalLocationConfig"("organizationId", "role");

-- CreateIndex
CREATE INDEX "RentalPackage_organizationId_idx" ON "RentalPackage"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalPackage_organizationId_code_key" ON "RentalPackage"("organizationId", "code");

-- CreateIndex
CREATE INDEX "RentalPackageItem_organizationId_packageId_idx" ON "RentalPackageItem"("organizationId", "packageId");

-- CreateIndex
CREATE INDEX "RentalReservation_organizationId_status_idx" ON "RentalReservation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RentalReservation_organizationId_partnerId_idx" ON "RentalReservation"("organizationId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalReservation_organizationId_reservationNumber_key" ON "RentalReservation"("organizationId", "reservationNumber");

-- CreateIndex
CREATE INDEX "RentalReservationLine_organizationId_reservationId_idx" ON "RentalReservationLine"("organizationId", "reservationId");

-- CreateIndex
CREATE INDEX "RentalAgreement_organizationId_status_idx" ON "RentalAgreement"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RentalAgreement_organizationId_partnerId_idx" ON "RentalAgreement"("organizationId", "partnerId");

-- CreateIndex
CREATE INDEX "RentalAgreement_organizationId_branchId_idx" ON "RentalAgreement"("organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalAgreement_organizationId_agreementNumber_key" ON "RentalAgreement"("organizationId", "agreementNumber");

-- CreateIndex
CREATE INDEX "RentalAgreementLine_organizationId_agreementId_idx" ON "RentalAgreementLine"("organizationId", "agreementId");

-- CreateIndex
CREATE INDEX "RentalAgreementLine_organizationId_productId_idx" ON "RentalAgreementLine"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "RentalBooking_organizationId_productId_startAt_endAt_idx" ON "RentalBooking"("organizationId", "productId", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "RentalBooking_organizationId_unitId_idx" ON "RentalBooking"("organizationId", "unitId");

-- CreateIndex
CREATE INDEX "RentalBooking_organizationId_status_idx" ON "RentalBooking"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RentalBooking_organizationId_sourceType_sourceId_idx" ON "RentalBooking"("organizationId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "RentalExtension_organizationId_agreementLineId_idx" ON "RentalExtension"("organizationId", "agreementLineId");

-- CreateIndex
CREATE INDEX "RentalSwap_organizationId_agreementLineId_idx" ON "RentalSwap"("organizationId", "agreementLineId");

-- CreateIndex
CREATE INDEX "RentalReturn_organizationId_agreementId_idx" ON "RentalReturn"("organizationId", "agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalReturn_organizationId_returnNumber_key" ON "RentalReturn"("organizationId", "returnNumber");

-- CreateIndex
CREATE INDEX "RentalReturnLine_organizationId_returnId_idx" ON "RentalReturnLine"("organizationId", "returnId");

-- CreateIndex
CREATE INDEX "RentalReturnLine_organizationId_agreementLineId_idx" ON "RentalReturnLine"("organizationId", "agreementLineId");

-- CreateIndex
CREATE INDEX "RentalDamage_organizationId_returnLineId_idx" ON "RentalDamage"("organizationId", "returnLineId");

-- CreateIndex
CREATE INDEX "RentalServiceOrder_organizationId_unitId_status_idx" ON "RentalServiceOrder"("organizationId", "unitId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RentalServiceOrder_organizationId_serviceNumber_key" ON "RentalServiceOrder"("organizationId", "serviceNumber");

-- CreateIndex
CREATE INDEX "RentalDeposit_organizationId_partnerId_idx" ON "RentalDeposit"("organizationId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalDeposit_organizationId_agreementId_key" ON "RentalDeposit"("organizationId", "agreementId");

-- CreateIndex
CREATE INDEX "RentalDepositMovement_organizationId_depositId_idx" ON "RentalDepositMovement"("organizationId", "depositId");

-- CreateIndex
CREATE INDEX "RentalCustomerScore_organizationId_partnerId_idx" ON "RentalCustomerScore"("organizationId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "RentalCustomerScore_organizationId_partnerId_key" ON "RentalCustomerScore"("organizationId", "partnerId");

-- AddForeignKey
ALTER TABLE "RentalRate" ADD CONSTRAINT "RentalRate_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalUnit" ADD CONSTRAINT "RentalUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalPackage" ADD CONSTRAINT "RentalPackage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalPackageItem" ADD CONSTRAINT "RentalPackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "RentalPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalPackageItem" ADD CONSTRAINT "RentalPackageItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalReservationLine" ADD CONSTRAINT "RentalReservationLine_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "RentalReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreement" ADD CONSTRAINT "RentalAgreement_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreementLine" ADD CONSTRAINT "RentalAgreementLine_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreementLine" ADD CONSTRAINT "RentalAgreementLine_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "RentalUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalReturn" ADD CONSTRAINT "RentalReturn_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalReturnLine" ADD CONSTRAINT "RentalReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "RentalReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalDeposit" ADD CONSTRAINT "RentalDeposit_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalDepositMovement" ADD CONSTRAINT "RentalDepositMovement_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "RentalDeposit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalCustomerScore" ADD CONSTRAINT "RentalCustomerScore_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rental Management: calendar-window integrity.
-- btree_gist enables the tstzrange overlap EXCLUDE constraint below.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- A unit cannot be double-booked in overlapping windows. The partial index
-- skips cancelled/expired/completed bookings so released windows stay bookable.
ALTER TABLE "RentalBooking" ADD CONSTRAINT rental_booking_no_overlap
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "unitId" WITH =,
    tsrange("startAt", "endAt") WITH &&
  ) WHERE ("unitId" IS NOT NULL AND "status" IN ('held', 'confirmed', 'active'));

-- Free-form unit attributes (colour/size/brand/fit) — GIN for containment queries.
CREATE INDEX "RentalUnit_attributes_gin" ON "RentalUnit" USING GIN ("attributes");
