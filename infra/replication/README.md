# LAN → Cloud replication (P4)

The cafe LAN Postgres is the **single source of truth**. The cloud is a
read-only mirror for remote reports and off-site safety. Sales never depend on
the internet.

```
[cafe LAN PC]  Postgres (publisher)  ──logical replication──►  [cloud] Postgres (subscriber)
     ▲                                                              │
     └── POS terminals + Android devices                            └── API with READ_ONLY_MODE=true
```

## Why logical replication (and not "sync the cloud like a device")

The op-sync protocol (`/sync/push`) exists for *devices that sell offline*. The
cloud does not sell anything — it reads. Pushing the whole database through op
semantics would double the custom-sync surface for zero benefit. Postgres does
this natively and correctly.

**Replication is not a backup.** It faithfully replicates mistakes, including
`DELETE FROM "Invoice"`. Run the nightly dump too (step 5).

## 1. LAN Postgres — enable logical replication

`postgresql.conf` (restart required):

```conf
wal_level = logical
max_replication_slots = 4      # one per subscriber + headroom
max_wal_senders = 4
```

Create the replication role and publication:

```bash
psql -U postgres -d "POS-CAFE" -f publisher.sql
```

## 2. Network path

The subscriber connects **from cloud to LAN**, so the LAN needs to be reachable.
Do NOT port-forward Postgres to the public internet. Use a private tunnel:

```bash
# On the LAN PC and the cloud host:
tailscale up
# Then use the LAN PC's tailscale IP (100.x.y.z) as the subscriber's host.
```

## 3. Cloud — create the subscription

```bash
psql -U postgres -d "POS-CAFE" -f subscriber.sql   # edit the connection string first
```

## 4. Cloud API — read-only

```env
READ_ONLY_MODE=true
DATABASE_URL=postgresql://...@localhost:5432/POS-CAFE
```

`ReadOnlyMiddleware` (apps/api/src/kernel/common/read-only.middleware.ts) then
403s every write with a message pointing back at the cafe server. Login/refresh
still work so managers can read reports.

> Prisma migrations must run on the **publisher** only. Schema changes do not
> replicate — apply them on the LAN first, then on the cloud subscriber
> (`prisma migrate deploy`), then resume the subscription if it errored.

## 5. Backups (separate from replication)

```bash
# crontab / Task Scheduler, nightly on the LAN PC:
pg_dump -U postgres -Fc "POS-CAFE" > /backups/pos-$(date +%F).dump
# keep 14 days, copy off-site
```

Restore drill (do this at least once, on a scratch DB — an untested backup is a
rumour):

```bash
createdb -U postgres pos-restore-test
pg_restore -U postgres -d pos-restore-test /backups/pos-2026-07-16.dump
```

## 6. Monitor the slot

A subscriber that goes away without being dropped makes the LAN PC retain WAL
**forever** until its (small) disk fills and Postgres stops — taking the cafe
down. `check-replication.sh` alerts before that.

```bash
./check-replication.sh          # run from cron every 15 min
```

If the cloud is gone for good, drop the slot on the LAN:

```sql
SELECT pg_drop_replication_slot('pos_cloud_sub');
```
