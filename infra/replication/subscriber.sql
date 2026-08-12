-- Run on the CLOUD Postgres (the read-only mirror).
--
-- Order matters: the schema must exist BEFORE the subscription starts, because
-- logical replication copies rows, not DDL.
--
--   1. createdb -U postgres "POS-CAFE"
--   2. From the repo, against the cloud DB:  pnpm --filter @erp/api exec prisma migrate deploy
--   3. Then run this file.

-- Edit the connection string: host = the LAN PC's tailscale/VPN address.
CREATE SUBSCRIPTION pos_cloud_sub
  CONNECTION 'host=100.x.y.z port=5432 dbname=POS-CAFE user=pos_replicator password=CHANGE_ME_STRONG_PASSWORD'
  PUBLICATION pos_all
  WITH (
    copy_data = true,      -- initial snapshot of existing rows
    streaming = on,        -- stream large transactions instead of spooling
    slot_name = 'pos_cloud_sub'
  );

-- Verify (should show srsubstate 'r' = ready, once the initial copy finishes):
--   SELECT srrelid::regclass, srsubstate FROM pg_subscription_rel;
--   SELECT * FROM pg_stat_subscription;

-- If a migration is applied on the publisher, apply it here too, then:
--   ALTER SUBSCRIPTION pos_cloud_sub REFRESH PUBLICATION;
