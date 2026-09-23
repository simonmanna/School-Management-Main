-- New segregation-of-duty grants (audit F-22, F-24). Role.permissions is stored
-- data, so the catalog change alone reaches only NEW organizations. Existing
-- tenants get the same result the presets now describe:
--   Administrator            → every new key (it is seeded with ALL_PERMISSIONS)
--   Head Teacher             → admissions:decide, enrollment:reactivate
--   Deputy Head              → admissions:decide
-- Idempotent: array_append only when the key is absent.

UPDATE "Role"
   SET "permissions" = array_append("permissions", 'school:admissions:decide')
 WHERE "name" IN ('Administrator', 'Head Teacher', 'Deputy Head')
   AND NOT ('school:admissions:decide' = ANY("permissions"));

UPDATE "Role"
   SET "permissions" = array_append("permissions", 'school:enrollment:reactivate')
 WHERE "name" IN ('Administrator', 'Head Teacher')
   AND NOT ('school:enrollment:reactivate' = ANY("permissions"));

-- Medical documents are no longer readable with `school:documents:read` alone (F-32).
UPDATE "Role"
   SET "permissions" = array_append("permissions", 'school:medical:read')
 WHERE "name" IN ('Administrator', 'Head Teacher', 'Nurse')
   AND NOT ('school:medical:read' = ANY("permissions"));
