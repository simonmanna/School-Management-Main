-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('percentage', 'fixed_amount');

-- CreateEnum
CREATE TYPE "DiscountSource" AS ENUM ('manual', 'promotion', 'loyalty', 'coupon');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "discountAppliedBy" TEXT,
ADD COLUMN     "discountApprovedAt" TIMESTAMP(3),
ADD COLUMN     "discountApprovedBy" TEXT,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountSource" "DiscountSource" NOT NULL DEFAULT 'manual',
ADD COLUMN     "discountType" "DiscountType" NOT NULL DEFAULT 'percentage',
ADD COLUMN     "discountValue" DECIMAL(20,6) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN     "discountAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "discountAppliedBy" TEXT,
ADD COLUMN     "discountApprovedAt" TIMESTAMP(3),
ADD COLUMN     "discountApprovedBy" TEXT,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountSource" "DiscountSource" NOT NULL DEFAULT 'manual',
ADD COLUMN     "discountType" "DiscountType" NOT NULL DEFAULT 'percentage';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountSource" "DiscountSource" NOT NULL DEFAULT 'manual',
ADD COLUMN     "transactionDiscountAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "transactionDiscountType" "DiscountType" NOT NULL DEFAULT 'percentage';

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "discountAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "discountReason" TEXT,
ADD COLUMN     "discountType" "DiscountType" NOT NULL DEFAULT 'percentage';
