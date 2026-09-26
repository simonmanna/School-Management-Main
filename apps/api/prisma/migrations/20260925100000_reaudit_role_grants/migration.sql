-- Re-audit P1-1: closing, archiving or re-opening an academic year gets its own
-- grant. It sat behind `school:foundation:write`, which the Front Desk and
-- Registrar presets hold so they can edit classes and terms, so a clerk could
-- archive the school's year (irreversible) with one click.
-- Role.permissions is stored data: bring existing Administrator and Head
-- Teacher roles in line. Idempotent.
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:academicyear:lifecycle')
 WHERE "name" IN ('Administrator', 'Head Teacher')
   AND NOT ('school:academicyear:lifecycle' = ANY("permissions"));

-- Re-audit #8: the Bursar sets up sponsorships, which name a sponsor Partner.
UPDATE "Role" SET "permissions" = array_append("permissions", 'partner:read')
 WHERE "name" = 'Bursar' AND NOT ('partner:read' = ANY("permissions"));
