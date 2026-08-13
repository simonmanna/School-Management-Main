-- H3: formalize StudentGuardian.guardianContactId as a Prisma relation so the
-- guardian list can include the Contact (name/phone). Column already exists.

-- AddForeignKey
ALTER TABLE "StudentGuardian" ADD CONSTRAINT "StudentGuardian_guardianContactId_fkey" FOREIGN KEY ("guardianContactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

