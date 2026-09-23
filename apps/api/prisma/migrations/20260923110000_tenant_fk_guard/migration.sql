-- ---------------------------------------------------------------------------
-- Same-tenant foreign keys (audit F-05).
--
-- Every relation between org-scoped tables is a single-column FK on "id", so
-- the database happily accepts a School A row that points at School B's
-- teacher, section or student: PostgreSQL's referential-integrity checks run
-- with the table owner's rights and ignore RLS, and the Prisma tenancy
-- extension only scopes the top-level WHERE, never the ids inside a payload.
-- Reads through `include` then return the foreign row.
--
-- Composite (organizationId, id) FKs would fix it structurally, but Prisma would
-- see ~570 constraints it did not declare as drift. A trigger is invisible to
-- Prisma's diff and enforces the same rule: on INSERT, or UPDATE of the FK
-- column, the referenced row must exist in the SAME organization.
--
-- Under the RLS app role the parent lookup itself runs with app.org_id set, so a
-- foreign parent is simply not visible — which is reported the same way.
--
-- Catalog-driven and idempotent. `scripts/assert-db-constraints.mjs` fails CI
-- if a qualifying FK is ever left without its trigger; re-run this block (or a
-- later copy of it) after adding tables.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_same_org_fk() RETURNS trigger AS $$
DECLARE
  fk_col     text := TG_ARGV[0];
  parent_tbl text := TG_ARGV[1];
  child_org  text;
  ref_id     text;
  parent_org text;
  found_row  boolean;
BEGIN
  child_org := to_jsonb(NEW) ->> 'organizationId';
  ref_id    := to_jsonb(NEW) ->> fk_col;
  IF ref_id IS NULL OR child_org IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT true, "organizationId" FROM %I WHERE "id" = $1', parent_tbl)
    INTO found_row, parent_org USING ref_id;
  -- A parent with a NULL organizationId is a shared/global row and may be
  -- referenced by any tenant. Not found (or not visible under RLS) or owned by
  -- another organization is a cross-tenant reference.
  IF found_row IS NOT TRUE OR (parent_org IS NOT NULL AND parent_org <> child_org) THEN
    RAISE EXCEPTION 'Cross-tenant reference rejected: %.% = % does not exist in this organization',
      TG_TABLE_NAME, fk_col, ref_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
