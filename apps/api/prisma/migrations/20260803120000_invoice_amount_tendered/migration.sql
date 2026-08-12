-- AlterTable
-- Cash physically tendered for the settling cash payment (may exceed totalAmount).
-- Nullable: non-cash tenders and legacy rows stay NULL. Change = amountTendered - totalAmount.
ALTER TABLE "Invoice" ADD COLUMN     "amountTendered" DECIMAL(20,6);
