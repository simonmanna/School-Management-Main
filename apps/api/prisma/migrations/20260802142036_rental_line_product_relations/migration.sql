-- AddForeignKey
ALTER TABLE "RentalReservationLine" ADD CONSTRAINT "RentalReservationLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAgreementLine" ADD CONSTRAINT "RentalAgreementLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
