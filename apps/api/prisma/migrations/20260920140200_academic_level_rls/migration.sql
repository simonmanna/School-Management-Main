-- AcademicLevel — tenant-isolation policy.
--
-- Same shape as 20260903000100_phase1_enrollment_rls: create the policy and
-- FORCE ROW LEVEL SECURITY, but deliberately do NOT `ENABLE ROW LEVEL
-- SECURITY`. In this deployment RLS is inert and isolation is enforced by the
-- app-side Prisma tenancy extension; the policy lies dormant until an operator
-- turns RLS on org-wide via `pnpm rls:setup-role`.
--
-- The matching app-side registration is in ORG_SCOPED and SOFT_DELETE
-- (apps/api/src/kernel/prisma/tenancy.extension.ts) and is verified against the
-- schema by tenancy-registration.spec.ts. A new table registered in neither does
-- not throw and does not warn — it silently returns other tenants' rows, which
-- is why both halves ship together.

DO $$
DECLARE
    t text;
    structure_tables text[] := ARRAY['AcademicLevel'];
BEGIN
    FOREACH t IN ARRAY structure_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));',
            t
        );
    END LOOP;
END $$;
