-- Wave 14: document numbering under production database roles.
--
-- SequenceService created per-organization sequences in `public` at runtime.
-- The production runtime roles cannot create objects in `public`, and
-- PostgreSQL checks CREATE even for CREATE SEQUENCE IF NOT EXISTS — so with the
-- NOBYPASSRLS/BYPASSRLS roles every admission, invoice and receipt number failed
-- ("permission denied for schema public"). Found booting the release image with
-- the production roles. Sequences now live in `numbering`; the system role is
-- granted CREATE there by scripts/setup-rls-role.ts. Existing counters move
-- with their current values, so no number is ever reissued.
CREATE SCHEMA IF NOT EXISTS numbering;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname LIKE 'seq\_%'
       -- Owned sequences back serial columns; only free-standing numbering ones move.
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i'))
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I SET SCHEMA numbering', r.relname);
  END LOOP;
END $$;

-- Grants for the default runtime roles, when they exist, so a deployment that
-- has not yet re-run scripts/setup-rls-role.ts keeps numbering. The script is
-- still the source of truth (and covers custom role names).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
    EXECUTE 'GRANT USAGE, CREATE ON SCHEMA numbering TO app_system';
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA numbering TO app_system';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA numbering TO app';
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA numbering TO app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA numbering GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
      EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE app_system IN SCHEMA numbering GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app';
    END IF;
  END IF;
END $$;
