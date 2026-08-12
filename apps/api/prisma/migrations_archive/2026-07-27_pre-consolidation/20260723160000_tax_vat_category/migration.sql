-- Phase 2 (accounting hardening) — explicit VAT-return classification on Tax.
-- Distinguishes zero-rated (taxable at 0%, input recoverable) from exempt (not
-- taxable) instead of overloading `rate = 0`. Existing rows default to standard.

-- AlterTable
ALTER TABLE "Tax" ADD COLUMN "vatCategory" TEXT NOT NULL DEFAULT 'standard';
