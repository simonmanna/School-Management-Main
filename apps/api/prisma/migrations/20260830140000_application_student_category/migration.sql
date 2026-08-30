-- AdmissionApplication.studentCategoryId
--
-- The application form, its DTO and the create/update service paths all carried
-- a student-category field, but the model never gained the column. Prisma
-- validated every AdmissionApplication.create() against a client that had no
-- such field, so application creation failed outright with
-- "Unknown argument `studentCategoryId`" and the whole admissions journey was
-- unusable. Nullable: existing applications have no category.

-- AlterTable
ALTER TABLE "AdmissionApplication" ADD COLUMN     "studentCategoryId" TEXT;

