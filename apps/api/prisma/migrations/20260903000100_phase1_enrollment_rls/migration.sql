-- Phase 1 enrollment/grouping tables — tenant-isolation policies.
--
-- Same shape as 20260812120001_school_rls: create the policy and FORCE ROW
-- LEVEL SECURITY, but deliberately do NOT `ENABLE ROW LEVEL SECURITY`. In this
-- deployment RLS is inert and isolation is enforced by the app-side Prisma
-- tenancy extension; the policy lies dormant until an operator turns RLS on
-- org-wide via `pnpm rls:setup-role`.
--
-- The matching app-side registration is in ORG_SCOPED
-- (apps/api/src/kernel/prisma/tenancy.extension.ts) and is verified against the
-- schema by tenancy-registration.spec.ts.

DO $$
DECLARE
    t text;
    phase1_tables text[] := ARRAY[
        'AcademicMigrationException',
        'AcademicProgramme',
        'ClassCohort',
        'EnrollmentPlacement',
        'ProgrammeGradeLevel',
        'StudentEnrollment',
        'StudentEnrollmentEvent'
    ];
BEGIN
    FOREACH t IN ARRAY phase1_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));',
            t
        );
    END LOOP;
END $$;
