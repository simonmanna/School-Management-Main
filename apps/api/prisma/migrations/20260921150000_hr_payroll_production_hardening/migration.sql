-- HR & payroll production hardening (2026-09-21).
-- Per-source payroll lines, employer contributions, LST, payment + disbursement
-- journals, statutory contribution base/ceiling, leave encashment.


-- AlterEnum
ALTER TYPE "HrBankPaymentStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "HrBankPayment" ADD COLUMN     "journalEntryId" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "HrEmployeeLoan" ADD COLUMN     "disbursementJournalEntryId" TEXT,
ADD COLUMN     "disbursementMethod" "HrPaymentMethod";

-- AlterTable
ALTER TABLE "HrLeaveType" ADD COLUMN     "isEncashable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "HrOffboarding" ADD COLUMN     "payrollInputId" TEXT;

-- AlterTable
ALTER TABLE "HrPayrollAllowance" ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- AlterTable
ALTER TABLE "HrPayrollComponent" ADD COLUMN     "deductionCategory" TEXT;

-- AlterTable
ALTER TABLE "HrPayrollDeduction" ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- AlterTable
ALTER TABLE "HrPayrollItem" ADD COLUMN     "employerPensionAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "employerSocialSecurityAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "localTaxAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "otherPayableAmount" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "taxableIncome" DECIMAL(20,6) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "HrPayslip" ADD COLUMN     "bankPaymentId" TEXT,
ADD COLUMN     "paymentJournalEntryId" TEXT;

-- AlterTable
ALTER TABLE "HrSalaryAdvance" ADD COLUMN     "disbursementJournalEntryId" TEXT,
ADD COLUMN     "paymentMethod" "HrPaymentMethod";

-- AlterTable
ALTER TABLE "HrStatutoryConfig" ADD COLUMN     "ceiling" DECIMAL(20,6),
ADD COLUMN     "contributionBase" TEXT NOT NULL DEFAULT 'GROSS';

-- AlterTable
ALTER TABLE "HrTaxBracket" ADD COLUMN     "fixedAmount" DECIMAL(20,6);

-- AlterTable
ALTER TABLE "HrTaxTable" ADD COLUMN     "collectionMonths" TEXT,
ADD COLUMN     "contributionsDeductible" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "HrPayrollAllowance_organizationId_sourceType_sourceId_idx" ON "HrPayrollAllowance"("organizationId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "HrPayrollDeduction_organizationId_sourceType_sourceId_idx" ON "HrPayrollDeduction"("organizationId", "sourceType", "sourceId");

