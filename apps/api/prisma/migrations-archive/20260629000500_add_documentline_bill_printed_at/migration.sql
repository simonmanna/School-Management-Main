-- Add billPrintedAt to DocumentLine for additional-bill tracking
ALTER TABLE "DocumentLine" ADD COLUMN "billPrintedAt" TIMESTAMP(3);
