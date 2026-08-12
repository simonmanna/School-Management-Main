-- Add kotPrintCount to Document for delta-KOT sequence numbering
ALTER TABLE "Document" ADD COLUMN "kotPrintCount" INTEGER NOT NULL DEFAULT 0;
