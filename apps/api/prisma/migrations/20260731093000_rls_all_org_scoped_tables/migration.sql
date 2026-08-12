-- ---------------------------------------------------------------------------
-- Extend tenant-isolation RLS to EVERY org-scoped table.
--
-- The original policy set (20260727120001_rls_and_triggers) listed 35 tables by
-- hand. The schema has roughly quadrupled since: StockOut, WasteRecord,
-- StockAdjustment, StockTransfer, InventoryCountSession, InventorySerial,
-- StockReservation, PurchaseOrder, GoodsReceiptNote, DebitNote, StockPostingJob,
-- InventoryException and many more carried an "organizationId" with no policy
-- protecting it. A hand-maintained list guarantees the next model added is
-- unprotected too, so this discovers the tables from the catalog instead —
-- anything with an "organizationId" column gets the policy, now and on re-run.
--
-- USING-only (no WITH CHECK), matching the established pattern. WITH CHECK would
-- reject every INSERT issued outside an interactive transaction, because that is
-- the only place `app.org_id` is currently set (see PrismaService). Read
-- isolation is the property being bought here; write scoping remains the job of
-- the Prisma tenancy extension.
--
-- LIMITATION (unchanged, and deliberately restated): a Postgres SUPERUSER
-- bypasses RLS even with FORCE. These policies are inert until the application —
-- or an operator running ad-hoc psql, or a BI tool, or a read replica — connects
-- through a non-superuser role. Create one with `pnpm rls:setup-role`.
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

-- ---------------------------------------------------------------------------
-- Organization itself is scoped by its own primary key, not by organizationId,
-- so the catalog sweep above skips it. Same treatment, different column.
-- ---------------------------------------------------------------------------
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Organization";
CREATE POLICY tenant_isolation ON "Organization"
    USING ("id" = current_setting('app.org_id', true));
