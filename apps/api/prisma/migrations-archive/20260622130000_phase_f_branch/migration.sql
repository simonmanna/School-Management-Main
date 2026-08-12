-- Phase F: branch support.
--
-- Adds branchId to the four most-trafficked transactional tables (Document,
-- Payment, CashSession) plus User.defaultBranchId. Existing rows get NULL
-- (backward-compatible).

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "defaultBranchId" TEXT;

ALTER TABLE "Document"
  ADD COLUMN "branchId" TEXT;
CREATE INDEX "Document_organizationId_branchId_idx" ON "Document"("organizationId", "branchId");

ALTER TABLE "Payment"
  ADD COLUMN "branchId" TEXT;
CREATE INDEX "Payment_organizationId_branchId_idx" ON "Payment"("organizationId", "branchId");

ALTER TABLE "CashSession"
  ADD COLUMN "branchId" TEXT;
CREATE INDEX "CashSession_organizationId_branchId_idx" ON "CashSession"("organizationId", "branchId");