-- Re-run of the 20260923110000_tenant_fk_guard catalog block: the Wave 12
-- early-years tables (ChildCareLog, Pickup*, ChildIncident, ImmunisationRecord)
-- were added after it and had no cross-tenant FK guard. Idempotent.
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
