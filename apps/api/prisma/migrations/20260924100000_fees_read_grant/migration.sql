-- Finance reads move off `school:read` onto `school:fees:read` (E2E audit S5).
-- Every staff preset holds `school:read`, so teachers, the librarian and the
-- cook could read any family's balance, ledger and receipts. Role.permissions is
-- stored data, so the catalog change alone reaches only NEW organizations.
-- Existing tenants keep finance reads for every role that already works with
-- fees: Administrator (seeded with ALL_PERMISSIONS), and any role — preset or
-- custom — that manages, collects or reports on fees.
-- Idempotent: array_append only when the key is absent.

UPDATE "Role"
   SET "permissions" = array_append("permissions", 'school:fees:read')
 WHERE NOT ('school:fees:read' = ANY("permissions"))
   AND (
         "name" IN ('Administrator', 'Head Teacher', 'Bursar')
      OR "permissions" && ARRAY[
           'school:fees:write',
           'school:fees:collect',
           'school:fees:reconcile',
           'school:reports:finance:read'
         ]::text[]
   );
