-- Wave 2.3 (E2E audit P1): business actions that no preset role could perform.
-- The permission guard ANDs its list and these grants were held by nobody but
-- the Administrator, so an ordinary school could not approve an adjustment,
-- write off a debt, close a fee period, bill meals or mark an exam script.
-- Role.permissions is stored data, so the preset change alone reaches only NEW
-- organizations; this brings existing preset-named roles in line.
-- Idempotent: array_append only when the key is absent.

-- Head Teacher: approvals, never collection.
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:fees:adjustment:approve')
 WHERE "name" IN ('Administrator', 'Head Teacher') AND NOT ('school:fees:adjustment:approve' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:fees:writeoff')
 WHERE "name" IN ('Administrator', 'Head Teacher') AND NOT ('school:fees:writeoff' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:fees:period:close')
 WHERE "name" IN ('Administrator', 'Head Teacher') AND NOT ('school:fees:period:close' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:certificates:revoke')
 WHERE "name" IN ('Administrator', 'Head Teacher') AND NOT ('school:certificates:revoke' = ANY("permissions"));

-- Bursar: meal money.
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:meals:billing')
 WHERE "name" IN ('Administrator', 'Bursar') AND NOT ('school:meals:billing' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:meals:wallet')
 WHERE "name" IN ('Administrator', 'Bursar') AND NOT ('school:meals:wallet' = ANY("permissions"));

-- Class Teacher: marks the exam scripts allocated to them.
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:exams:mark')
 WHERE "name" IN ('Administrator', 'Class Teacher') AND NOT ('school:exams:mark' = ANY("permissions"));

-- Deputy Head: school-wide lesson plans.
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:lessonplans:write')
 WHERE "name" IN ('Administrator', 'Deputy Head') AND NOT ('school:lessonplans:write' = ANY("permissions"));

-- Student portal role: sit a CBT quiz (the route pins the attempt to the caller).
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:cbt:take')
 WHERE "name" IN ('Administrator', 'Student') AND NOT ('school:cbt:take' = ANY("permissions"));
