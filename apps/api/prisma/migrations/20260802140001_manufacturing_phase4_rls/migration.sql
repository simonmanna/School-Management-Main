-- ---------------------------------------------------------------------------
-- Re-run the catalog-driven tenant-isolation sweep so the five new
-- manufacturing tables (Bom, BomLine, ProductionOrder, ProductionMaterial,
-- ProductionOutput) get a `tenant_isolation` RLS policy.
--
-- The original sweep (20260731093000_rls_all_org_scoped_tables) is one-shot: it
-- only covered tables that existed at the time it ran. New org-scoped tables are
-- unprotected until this block runs again. It is idempotent (DROP POLICY IF
-- EXISTS + recreate), so re-running touches every org-scoped table harmlessly
-- and, crucially, adds the policy to the ones added since.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    t text;
    n integer := 0;
BEGIN
    FOR t IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
        JOIN pg_attribute a  ON a.attrelid = c.oid
        WHERE ns.nspname = 'public'
          AND c.relkind = 'r'
          AND a.attname = 'organizationId'
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I
             USING ("organizationId" = current_setting(''app.org_id'', true))',
            t
        );
        n := n + 1;
    END LOOP;
    RAISE NOTICE 'tenant_isolation policy applied to % org-scoped table(s)', n;
END $$;
