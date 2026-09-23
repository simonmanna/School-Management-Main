-- TeacherAssignment integrity (audit F-29).
--
-- 1. The unique key includes nullable sectionId / termId. With default NULL
--    semantics two whole-class (sectionId NULL) or whole-year (termId NULL)
--    assignments of the same teacher/subject/class are "distinct", so the same
--    assignment could be stored twice. NULLS NOT DISTINCT (PostgreSQL 15+) makes
--    NULL compare equal for the key. Existing duplicates are collapsed first,
--    keeping the oldest row.
-- 2. Deleting a StaffProfile CASCADEd to their assignments, silently erasing who
--    taught what. Staff are soft-deleted today, but a hard delete must be refused.

DELETE FROM "TeacherAssignment" t
 USING "TeacherAssignment" k
 WHERE t."organizationId" = k."organizationId"
   AND t."teacherPartnerId" = k."teacherPartnerId"
   AND t."subjectId" = k."subjectId"
   AND t."classId" = k."classId"
   AND t."sectionId" IS NOT DISTINCT FROM k."sectionId"
   AND t."termId" IS NOT DISTINCT FROM k."termId"
   AND (t."createdAt", t."id") > (k."createdAt", k."id");

DROP INDEX IF EXISTS "TeacherAssignment_organizationId_teacherPartnerId_subjectId_key";
CREATE UNIQUE INDEX "TeacherAssignment_organizationId_teacherPartnerId_subjectId_key"
  ON "TeacherAssignment"("organizationId", "teacherPartnerId", "subjectId", "classId", "sectionId", "termId")
  NULLS NOT DISTINCT;

ALTER TABLE "TeacherAssignment" DROP CONSTRAINT IF EXISTS "TeacherAssignment_teacherPartnerId_fkey";
ALTER TABLE "TeacherAssignment" ADD CONSTRAINT "TeacherAssignment_teacherPartnerId_fkey"
  FOREIGN KEY ("teacherPartnerId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
