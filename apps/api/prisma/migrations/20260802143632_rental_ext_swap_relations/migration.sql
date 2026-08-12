-- AddForeignKey
ALTER TABLE "RentalExtension" ADD CONSTRAINT "RentalExtension_agreementLineId_fkey" FOREIGN KEY ("agreementLineId") REFERENCES "RentalAgreementLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalSwap" ADD CONSTRAINT "RentalSwap_agreementLineId_fkey" FOREIGN KEY ("agreementLineId") REFERENCES "RentalAgreementLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
