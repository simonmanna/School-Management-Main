-- Admissions review P1-1: applicant records (identity, guardians, documents,
-- history, enquiries) move from `school:read` — held by every Class Teacher —
-- to a dedicated `school:admissions:read` grant.
-- Role.permissions is stored data: every role that already processes, decides
-- or charges admissions keeps its view, plus the Bursar who takes the fee.
-- Administrator roles are re-synced from ALL_PERMISSIONS at boot. Idempotent.
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:admissions:read')
 WHERE (
         'school:admissions:write'  = ANY("permissions")
      OR 'school:admissions:decide' = ANY("permissions")
      OR 'school:admissions:fee'    = ANY("permissions")
      OR "name" = 'Bursar'
       )
   AND NOT ('school:admissions:read' = ANY("permissions"));
