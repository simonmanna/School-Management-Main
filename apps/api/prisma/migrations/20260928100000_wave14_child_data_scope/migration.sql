-- Wave 14 (audit 2026-09-27) Phase 1 + F06.
--
-- F06: a release names its authority. The ordinary handover is to a guardian
-- of this child flagged canPickup; that link is stored, not reconstructed.
ALTER TABLE "PickupEvent" ADD COLUMN "studentGuardianId" TEXT;
ALTER TABLE "PickupEvent" ADD COLUMN "authorizationSource" TEXT NOT NULL DEFAULT 'override';
ALTER TABLE "PickupEvent" ADD COLUMN "idempotencyKey" TEXT;

-- Existing rows: an authorization id means the list was used; otherwise the
-- old contract required an override reason.
UPDATE "PickupEvent" SET "authorizationSource" = 'authorization' WHERE "authorizationId" IS NOT NULL;

ALTER TABLE "PickupEvent"
  ADD CONSTRAINT "PickupEvent_studentGuardianId_fkey"
  FOREIGN KEY ("studentGuardianId") REFERENCES "StudentGuardian"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PickupEvent"
  ADD CONSTRAINT "PickupEvent_authorizationSource_check"
  CHECK ("authorizationSource" IN ('guardian', 'authorization', 'override'));
-- A guardian or authorization release must name it; an override must say why.
ALTER TABLE "PickupEvent"
  ADD CONSTRAINT "PickupEvent_authority_named_check"
  CHECK (
    ("authorizationSource" = 'guardian' AND "studentGuardianId" IS NOT NULL)
    OR ("authorizationSource" = 'authorization' AND "authorizationId" IS NOT NULL)
    OR ("authorizationSource" = 'override' AND "overrideReason" IS NOT NULL AND length(btrim("overrideReason")) > 0)
  ) NOT VALID;
CREATE UNIQUE INDEX "PickupEvent_organizationId_idempotencyKey_key" ON "PickupEvent"("organizationId", "idempotencyKey");

-- ADR-032 P2: the class teacher reads health history of their own pupils
-- (data scope limits it). ADR-032 P4 / F06: new override grants.
-- Role.permissions is stored data: bring existing roles in line. Idempotent.
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:medical:read')
 WHERE "name" = 'Class Teacher' AND NOT ('school:medical:read' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:pickup:override')
 WHERE "name" IN ('Administrator', 'Head Teacher') AND NOT ('school:pickup:override' = ANY("permissions"));
UPDATE "Role" SET "permissions" = array_append("permissions", 'school:students:override_duplicate')
 WHERE "name" IN ('Administrator', 'Registrar') AND NOT ('school:students:override_duplicate' = ANY("permissions"));

DO $$
DECLARE
  r record;
  trg text;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT con.conname,
           child.relname  AS child_tbl,
           ca.attname     AS fk_col,
           parent.relname AS parent_tbl
      FROM pg_constraint con
      JOIN pg_class child   ON child.oid  = con.conrelid
      JOIN pg_class parent  ON parent.oid = con.confrelid
      JOIN pg_namespace ns  ON ns.oid = child.relnamespace
      JOIN pg_attribute ca  ON ca.attrelid = con.conrelid  AND ca.attnum = con.conkey[1]
      JOIN pg_attribute pa  ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
     WHERE con.contype = 'f'
       AND ns.nspname = 'public'
       AND array_length(con.conkey, 1) = 1
       AND pa.attname = 'id'
       AND ca.attname <> 'organizationId'
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = child.oid  AND x.attname = 'organizationId' AND NOT x.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = parent.oid AND x.attname = 'organizationId' AND NOT x.attisdropped)
  LOOP
    trg := 'tenant_fk_' || left(md5(r.conname), 24);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trg, r.child_tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION enforce_same_org_fk(%L, %L)',
      trg, r.fk_col, r.child_tbl, r.fk_col, r.parent_tbl
    );
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'tenant FK guard installed on % foreign key(s)', n;
END $$;
