-- AddForeignKey
ALTER TABLE "RentalDamage" ADD CONSTRAINT "RentalDamage_returnLineId_fkey" FOREIGN KEY ("returnLineId") REFERENCES "RentalReturnLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
