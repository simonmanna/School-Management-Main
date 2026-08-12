-- DropIndex
DROP INDEX "RentalUnit_attributes_gin";

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "rentalFeeType" TEXT;
