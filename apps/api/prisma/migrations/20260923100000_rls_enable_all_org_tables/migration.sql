-- ---------------------------------------------------------------------------
-- Turn Row-Level Security ON for every org-scoped table (audit F-02).
--
-- The July catalog sweep (20260731093000) enabled RLS on the tables that existed
-- then. Every later migration either created tables with no policy at all
-- (school_vertical, transport, HR, LMS, admissions, ...) or deliberately created
-- the policy WITHOUT `ENABLE ROW LEVEL SECURITY` because the application only
-- set `app.org_id` inside interactive transactions. The result: StudentProfile,
-- EnrollmentPlacement, AcademicYear, StaffProfile, TimetableSlot and ~400 more
-- tables had no database-level isolation at all.
--
-- PrismaService now sets `app.org_id` for every tenant-scoped statement (model
-- or raw, inside or outside a transaction), so the policy can be live everywhere.
-- Pre-tenant work uses the separate BYPASSRLS system role (SYSTEM_DATABASE_URL).
--
-- USING-only: PostgreSQL applies the USING expression as the WITH CHECK for
-- INSERT/UPDATE when none is given, so a row can neither be read nor written
-- under another tenant's `app.org_id`.
--
-- Idempotent and catalog-driven: re-running it covers tables added since.
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
        IF EXISTS (
            SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
             WHERE c.relname = t AND a.attname = 'organizationId' AND NOT a.attnotnull
        ) THEN
            -- Nullable organizationId (Setting, OneTimeToken, LoginAttempt): a NULL
            -- row is platform-wide and readable by every tenant, but a tenant can
            -- only ever write rows stamped with its own organization.
            EXECUTE format(
                'CREATE POLICY tenant_isolation ON %I
                 USING ("organizationId" IS NULL OR "organizationId" = current_setting(''app.org_id'', true))
                 WITH CHECK ("organizationId" = current_setting(''app.org_id'', true))',
                t
            );
        ELSE
            EXECUTE format(
                'CREATE POLICY tenant_isolation ON %I
                 USING ("organizationId" = current_setting(''app.org_id'', true))',
                t
            );
        END IF;
        n := n + 1;
    END LOOP;
    RAISE NOTICE 'tenant_isolation enabled on % org-scoped table(s)', n;
END $$;

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Organization";
CREATE POLICY tenant_isolation ON "Organization"
    USING ("id" = current_setting('app.org_id', true));
