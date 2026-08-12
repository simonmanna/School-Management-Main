-- Add membershipLevel and gender to Partner for customer/supplier classification
ALTER TABLE "Partner" ADD COLUMN "membershipLevel" TEXT;
ALTER TABLE "Partner" ADD COLUMN "gender" TEXT;
