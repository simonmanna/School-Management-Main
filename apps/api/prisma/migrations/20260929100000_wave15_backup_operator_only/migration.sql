-- Audit 2026-09-29 A03: whole-database backup is an operator surface guarded by
-- the host's OPERATOR_SECRET. No tenant route checks backup:* any more, so the
-- stored grants are inert; strip them so role editors and audits do not show a
-- school authority that does not exist.
UPDATE "Role"
   SET "permissions" = array_remove(array_remove(array_remove("permissions", 'backup:read'), 'backup:update'), 'backup:run')
 WHERE "permissions" && ARRAY['backup:read', 'backup:update', 'backup:run']::text[];

-- The keys leave the permission catalogue too, so the boot-time Administrator
-- sync cannot append them again.
DELETE FROM "Permission" WHERE "key" IN ('backup:read', 'backup:update', 'backup:run');
