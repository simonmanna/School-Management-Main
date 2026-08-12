-- AlterTable
ALTER TABLE "RentalUnit" ADD COLUMN     "lastInspectedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "RentalServiceOrder" ADD CONSTRAINT "RentalServiceOrder_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "RentalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
