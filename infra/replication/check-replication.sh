#!/usr/bin/env bash
# Replication-slot watchdog for the CAFE LAN Postgres. Run from cron every 15m.
#
# Why this matters more than it looks: an inactive replication slot makes
# Postgres retain WAL indefinitely. On a cafe PC with a small disk that ends
# with the data directory full and Postgres refusing writes — i.e. the till
# stops. This alerts while there is still room to act.
set -euo pipefail

DB="${PGDATABASE:-POS-CAFE}"
SLOT="${SLOT:-pos_cloud_sub}"
WARN_MB="${WARN_MB:-1024}"    # retained WAL warning threshold
CRIT_MB="${CRIT_MB:-4096}"    # retained WAL critical threshold

read -r active retained_bytes < <(
  psql -U "${PGUSER:-postgres}" -d "$DB" -tA -F' ' -c \
    "SELECT active, COALESCE(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn), 0)::bigint
       FROM pg_replication_slots WHERE slot_name = '$SLOT';"
) || { echo "CRITICAL: cannot query Postgres"; exit 2; }

if [[ -z "${active:-}" ]]; then
  echo "WARNING: replication slot '$SLOT' does not exist — cloud mirror is not receiving anything"
  exit 1
fi

retained_mb=$(( retained_bytes / 1024 / 1024 ))
echo "slot=$SLOT active=$active retained_wal=${retained_mb}MB"

if [[ "$active" != "t" ]]; then
  echo "WARNING: slot is INACTIVE — the cloud subscriber is disconnected."
  echo "         WAL is piling up on this machine (${retained_mb}MB). If the cloud is"
  echo "         gone for good: SELECT pg_drop_replication_slot('$SLOT');"
  [[ $retained_mb -ge $CRIT_MB ]] && { echo "CRITICAL: ${retained_mb}MB retained — disk-full risk, act now"; exit 2; }
  exit 1
fi

if [[ $retained_mb -ge $CRIT_MB ]]; then
  echo "CRITICAL: subscriber is ${retained_mb}MB behind — disk-full risk"
  exit 2
elif [[ $retained_mb -ge $WARN_MB ]]; then
  echo "WARNING: subscriber is ${retained_mb}MB behind"
  exit 1
fi

echo "OK"
