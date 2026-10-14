-- Academics Phase 0 (review 2026-10-14, findings A1, A2, A12).
--
-- 1. A primary school is never graded on the secondary (UCE) scheme by
--    default. The column default becomes PLE, and every school profile still on
--    the old default that is not a secondary school moves to PLE. Each
--    programme's own reporting config (nursery / lower / upper primary) still
--    overrides this school-wide fallback.
ALTER TABLE "SchoolProfile" ALTER COLUMN "gradingSystem" SET DEFAULT 'PLE';
UPDATE "SchoolProfile" SET "gradingSystem" = 'PLE'
 WHERE "gradingSystem" = 'UCE' AND COALESCE("educationLevel", 'mixed') <> 'secondary';

-- 2. Report-card comments. Role.permissions is stored data, so existing
--    presets receive the new grants here; Administrator roles are re-synced from
--    ALL_PERMISSIONS at boot. Idempotent.
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:reports:comment')
 WHERE "name" IN ('Class Teacher', 'Head Teacher')
   AND "deletedAt" IS NULL
   AND NOT ('school:reports:comment' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:reports:comment:head')
 WHERE "name" = 'Head Teacher'
   AND "deletedAt" IS NULL
   AND NOT ('school:reports:comment:head' = ANY("permissions"));

-- 3. Director of Studies preset for every school that already has the school
--    presets (identified by its Head Teacher role). Mirrors SCHOOL_ROLE_PRESETS
--    in packages/shared/src/permissions.ts; an existing role of that name is
--    left untouched.
INSERT INTO "Role" ("id", "organizationId", "name", "description", "isSystem", "permissions", "dataScope", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, r."organizationId", 'Director of Studies',
       'Runs the academic year: subjects, allocation, exams, mark approval, results and report cards. Does not enter marks or release results.',
       false,
       ARRAY[
         'school:read', 'school:foundation:write', 'school:programmes:write', 'school:courses:write',
         'school:courses:enrol', 'school:lessonplans:write', 'school:lessonplans:review',
         'school:lessonplans:approve', 'school:assessments:write', 'school:exams:write',
         'school:exams:operate', 'school:exams:custody', 'school:exams:allocate', 'school:grades:approve',
         'school:marks:moderate', 'school:results:compute', 'school:results:approve',
         'school:reports:documents:write', 'school:reports:comment', 'school:statutory:read',
         'school:candidates:write', 'school:analytics:read', 'school:analytics:export',
         'school:attendance:write', 'school:lms:read', 'hr:self', 'school:reports:read',
         'school:reports:export', 'school:reports:saved:write'
       ]::text[],
       'school'::"RoleDataScope", now(), now()
  FROM "Role" r
 WHERE r."name" = 'Head Teacher' AND r."deletedAt" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "Role" x WHERE x."organizationId" = r."organizationId" AND x."name" = 'Director of Studies'
   );

-- 4. Nursery Teacher preset (Class Teacher authority + releasing a child at the
--    gate), for every school that already has the presets.
INSERT INTO "Role" ("id", "organizationId", "name", "description", "isSystem", "permissions", "dataScope", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, r."organizationId", 'Nursery Teacher',
       'Runs a nursery class: register, care log, observations, collection at the gate and report comments — own class only.',
       false,
       ARRAY[
         'school:read', 'school:attendance:own', 'school:attendance:status:write', 'school:grades:own',
         'school:assignments:write', 'school:assignments:grade', 'school:lessonplans:own', 'school:timetable:own',
         'school:courses:teach', 'school:documents:read', 'school:communicate', 'school:portal:teacher',
         'school:portal:self', 'hr:self', 'school:reports:read', 'school:carelog:write', 'school:incidents:write',
         'school:incidents:read', 'school:medical:read', 'school:pickup:release', 'school:reports:comment'
       ]::text[],
       'class'::"RoleDataScope", now(), now()
  FROM "Role" r
 WHERE r."name" = 'Head Teacher' AND r."deletedAt" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "Role" x WHERE x."organizationId" = r."organizationId" AND x."name" = 'Nursery Teacher'
   );
