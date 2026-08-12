-- M6 — Cash flow categorization field on Account for the Cash Flow report.

-- AlterEnum (no enum used; cashFlowCategory is a free-form string)
-- The valid values are: 'operating', 'investing', 'financing', or null.

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "cashFlowCategory" TEXT;