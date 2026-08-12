-- Run on the CAFE LAN Postgres (the source of truth).
-- Prereq: wal_level = logical  (postgresql.conf, needs a restart)

-- 1. A dedicated, least-privilege role for the cloud subscriber.
--    Replication only needs to READ; it must never be able to write back.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_replicator') THEN
    -- Change this password and keep it out of version control.
    CREATE ROLE pos_replicator WITH LOGIN REPLICATION PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE "POS-CAFE" TO pos_replicator;
GRANT USAGE ON SCHEMA public TO pos_replicator;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pos_replicator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO pos_replicator;

-- 2. Publish every table.
--    FOR ALL TABLES automatically includes tables added by future migrations,
--    so a new feature's table does not silently stop replicating.
DROP PUBLICATION IF EXISTS pos_all;
CREATE PUBLICATION pos_all FOR ALL TABLES;

-- 3. Sanity check: logical replication of UPDATE/DELETE needs a replica
--    identity. Every model in schema.prisma has a primary key, so the default
--    (USING INDEX pk) is fine — this query should return zero rows.
SELECT c.relname AS table_without_replica_identity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relreplident = 'n';

-- 4. pg_hba.conf must allow the subscriber's address, e.g. over tailscale:
--      host    POS-CAFE    pos_replicator    100.64.0.0/10    scram-sha-256
--    Never expose 5432 to the public internet.
