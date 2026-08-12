-- CreateEnum
CREATE TYPE "PaymentTermMethod" AS ENUM ('immediate', 'net_days', 'end_of_following_month');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "paymentTermId" TEXT,
ADD COLUMN     "paymentTermName" TEXT;

-- AlterTable
ALTER TABLE "PaymentTerm" ADD COLUMN     "method" "PaymentTermMethod" NOT NULL DEFAULT 'net_days',
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "PaymentTerm_organizationId_deletedAt_idx" ON "PaymentTerm"("organizationId", "deletedAt");

