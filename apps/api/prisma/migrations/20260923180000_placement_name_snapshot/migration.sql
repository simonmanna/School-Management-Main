-- Placement name snapshot (audit F-39): renaming a class or section must not
-- rewrite how historical placements read. Existing rows are stamped with the
-- names as they stand today (the best available record).
ALTER TABLE "EnrollmentPlacement" ADD COLUMN IF NOT EXISTS "classNameSnapshot" TEXT;
ALTER TABLE "EnrollmentPlacement" ADD COLUMN IF NOT EXISTS "sectionNameSnapshot" TEXT;

UPDATE "EnrollmentPlacement" p
   SET "classNameSnapshot" = c."name"
  FROM "ClassCohort" cc JOIN "SchoolClass" c ON c."id" = cc."classId"
 WHERE cc."id" = p."classCohortId" AND p."classNameSnapshot" IS NULL;

UPDATE "EnrollmentPlacement" p
   SET "sectionNameSnapshot" = s."name"
  FROM "Section" s
 WHERE s."id" = p."sectionId" AND p."sectionNameSnapshot" IS NULL;
