-- Add petty_cash to AccountType enum
ALTER TYPE "AccountType" ADD VALUE 'petty_cash';

-- Add payment account fields to Account
ALTER TABLE "Account" ADD COLUMN "bankName" TEXT;
ALTER TABLE "Account" ADD COLUMN "accountNumber" TEXT;
ALTER TABLE "Account" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
