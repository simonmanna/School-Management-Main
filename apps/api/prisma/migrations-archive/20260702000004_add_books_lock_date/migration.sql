ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "booksLockDate" DateTime;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "requireFiscalPeriod" Boolean NOT NULL DEFAULT false;