#!/usr/bin/env bash
# Production image + backup/restore drill (audit R08 / D08), fully isolated.
#
# Builds nothing: run `docker build -f infra/docker/Dockerfile.api -t school-api:drill .` first.
# Uses its own Docker network, PostgreSQL 16 containers and volumes (all named
# drill-*), so the dev database and the usual containers are never touched.
#
#   1. "Host A": PostgreSQL 16 + the shipped API image in production mode, the
#      NOBYPASSRLS app role and BYPASSRLS system/backup roles; readiness, closed
#      operator surfaces, restart.
#   2. A school is provisioned, a pupil registered, a document uploaded.
#   3. Operator full database + files backup; the backup is copied OFF host A.
#   4. Host A is destroyed (database volume and uploads volume removed).
#   5. "Host B": a fresh PostgreSQL 16 + fresh volumes; the offsite copy is
#      restored; the API starts; sign-in, the pupil and the document's bytes are
#      checked; AR/GL reconciliation and DB constraints re-run. Timed (RTO).
#   6. A corrupted backup is refused by restore verification.
#
# Output: timings and PASS/FAIL lines; exits non-zero on the first failure.
# Usage: bash scripts/acceptance/prod-drill.sh
set -euo pipefail
# Git Bash rewrites /container/paths in arguments; only docker needs that off.
dk() { MSYS_NO_PATHCONV=1 docker "$@"; }
# ...and then host-side paths must be native (C:\...) for docker.exe.
hp() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else printf %s "$1"; fi; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${DRILL_IMAGE:-school-api:drill}"
NET=drill-net
PG_PORT_A=55432
PG_PORT_B=55433
API_PORT=3100
OWNER=drill_owner
OWNER_PW=drill-owner-pw
DBNAME=school
OPS="drill-operator-secret-0123456789abcdef"
PROV="drill-provisioning-secret-0123456789abcd"
WORK="${DRILL_WORK:-$ROOT/.drill}"
ORG_CODE=GVDRILL
ADMIN_EMAIL=head@greenvalley.test
ADMIN_PW='Drill@2026pass'

say() { printf '\n== %s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; exit 1; }
now() { date +%s; }

cleanup() {
  dk rm -f drill-api drill-db-a drill-db-b >/dev/null 2>&1 || true
  dk volume rm drill-pg-a drill-pg-b drill-up-a drill-up-b drill-bk-a drill-bk-b >/dev/null 2>&1 || true
  dk network rm "$NET" >/dev/null 2>&1 || true
}
trap 'dk logs --tail 200 drill-api > "${WORK:-.}/api-failure.log" 2>&1 || true; echo "API log: ${WORK:-.}/api-failure.log"' ERR
cleanup
rm -rf "$WORK" && mkdir -p "$WORK/offsite"
dk network create "$NET" >/dev/null

start_pg() { # name volume hostPort
  dk run -d --name "$1" --network "$NET" -p "$3:5432" -v "$2:/var/lib/postgresql/data" \
    -e POSTGRES_USER=$OWNER -e POSTGRES_PASSWORD=$OWNER_PW -e POSTGRES_DB=$DBNAME postgres:16-alpine >/dev/null
  for _ in $(seq 1 60); do dk exec "$1" pg_isready -U $OWNER -d $DBNAME >/dev/null 2>&1 && return 0; sleep 1; done
  fail "$1 did not start"
}
psql_in() { dk exec -i "$1" psql -v ON_ERROR_STOP=1 -U $OWNER -d $DBNAME -qAt -c "$2"; }

runtime_roles() { # hostPort — app / app_system via the project script, plus the backup role
  (cd "$ROOT/apps/api" && DATABASE_URL="postgresql://$OWNER:$OWNER_PW@localhost:$1/$DBNAME?schema=public" \
    RLS_APP_PASSWORD=drill-app RLS_SYSTEM_PASSWORD=drill-system pnpm -s rls:setup-role >/dev/null)
}
backup_role() { # container
  psql_in "$1" "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='drill_backup') THEN
    CREATE ROLE drill_backup LOGIN PASSWORD 'drill-backup' BYPASSRLS CREATEDB; END IF; END\$\$;
    GRANT pg_read_all_data TO drill_backup;"
}

start_api() { # dbContainer uploadsVolume backupsVolume
  dk run -d --name drill-api --network "$NET" -p "$API_PORT:3000" \
    -v "$2:/app/var/uploads" -v "$3:/app/var/backups" \
    -e NODE_ENV=production -e PORT=3000 \
    -e DATABASE_URL="postgresql://app:drill-app@$1:5432/$DBNAME?schema=public" \
    -e SYSTEM_DATABASE_URL="postgresql://app_system:drill-system@$1:5432/$DBNAME?schema=public" \
    -e BACKUP_DATABASE_URL="postgresql://drill_backup:drill-backup@$1:5432/$DBNAME?schema=public" \
    -e BACKUP_DIR=/app/var/backups -e STORAGE_DRIVER=local -e STORAGE_LOCAL_DIR=/app/var/uploads \
    -e OPERATOR_SECRET="$OPS" -e PROVISIONING_SECRET="$PROV" -e TRUST_PROXY=1 \
    -e JWT_ACCESS_SECRET=drill-access-secret-0123456789abcdef0123456789 \
    -e JWT_REFRESH_SECRET=drill-refresh-secret-0123456789abcdef012345678 \
    -e JWT_POS_SECRET=drill-pos-secret-0123456789abcdef0123456789abcd \
    -e WEB_URL=https://school.example -e PORTAL_URL=https://portal.school.example \
    -e CORS_ORIGINS=https://school.example -e METRICS_TOKEN=drill-metrics \
    -e PERMISSIONS_FAIL_CLOSED=true -e PERMISSIONS_DB_LOOKUP=true \
    -e ENABLE_SCHOOL=true -e ENABLE_HR=true -e ENABLE_COMMUNICATION=true \
    -e ENABLE_COMMUNICATION_SMS=true -e COMM_ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY= \
    -e ENABLE_ADVANCED_LMS=false -e ENABLE_LIVE_MOBILE_MONEY=false -e SMTP_FROM=drill@school.example \
    "$IMAGE" >/dev/null
  wait_ready
}
wait_ready() {
  for _ in $(seq 1 120); do curl -fsS "http://localhost:$API_PORT/api/v1/health/ready" >/dev/null 2>&1 && return 0; sleep 1; done
  fail "API not ready"
}
api() { curl -sS -H 'Content-Type: application/json' "$@"; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(eval('o'+process.argv[1]))})" "$1"; }

# ── 1. Host A ────────────────────────────────────────────────────────────────
say "Host A: PostgreSQL 16 + migrations + runtime roles"
T0=$(now)
start_pg drill-db-a drill-pg-a $PG_PORT_A
(cd "$ROOT/apps/api" && DATABASE_URL="postgresql://$OWNER:$OWNER_PW@localhost:$PG_PORT_A/$DBNAME?schema=public" npx prisma migrate deploy >/dev/null)
(cd "$ROOT" && DATABASE_URL="postgresql://$OWNER:$OWNER_PW@localhost:$PG_PORT_A/$DBNAME?schema=public" node scripts/assert-db-constraints.mjs >/dev/null) \
  && pass "schema constraints (RLS, tenant FKs, uniqueness)" || fail "constraint preflight"
runtime_roles $PG_PORT_A
backup_role drill-db-a
dk volume create drill-up-a >/dev/null; dk volume create drill-bk-a >/dev/null
start_api drill-db-a drill-up-a drill-bk-a
pass "production image ready in $(( $(now) - T0 ))s (NODE_ENV=production, NOBYPASSRLS app role)"

code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$API_PORT/api/v1/admin/backups/status")
[ "$code" = 403 ] && pass "operator backup API closed without the secret" || fail "backup API answered $code"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$API_PORT/api/v1/organizations/bootstrap")
[ "$code" = 403 ] && pass "tenant provisioning closed without the secret" || fail "provisioning answered $code"

# ── 2. A school with a pupil and a document ─────────────────────────────────
say "Provision Green Valley, register a pupil, upload a document"
api -H "X-Provisioning-Secret: $PROV" -X POST "http://localhost:$API_PORT/api/v1/organizations/bootstrap" \
  -d "{\"organizationCode\":\"$ORG_CODE\",\"organizationName\":\"Green Valley Drill\",\"timezone\":\"Africa/Kampala\",\"currencyCode\":\"UGX\",\"adminEmail\":\"$ADMIN_EMAIL\",\"adminFirstName\":\"Head\",\"adminPassword\":\"$ADMIN_PW\"}" >/dev/null
login() { api -X POST "http://localhost:$API_PORT/api/v1/auth/login" -d "{\"organizationCode\":\"$ORG_CODE\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PW\"}" | json .accessToken; }
TOKEN=$(login); [ -n "$TOKEN" ] && [ "$TOKEN" != undefined ] && pass "administrator signs in" || fail "sign-in"
AUTH="Authorization: Bearer $TOKEN"
PUPIL=$(api -H "$AUTH" -X POST "http://localhost:$API_PORT/api/v1/school/students" \
  -d '{"name":"Nakato Drill","admissionNo":"GV-DRILL-1","enrollmentDate":"2026-09-07"}' | json .id)
[ -n "$PUPIL" ] && [ "$PUPIL" != undefined ] && pass "pupil registered ($PUPIL)" || fail "pupil"
{ echo "Green Valley drill document"; head -c 3000 /dev/urandom | base64; } > "$WORK/report.txt"
SHA_A=$(sha256sum "$WORK/report.txt" | cut -d' ' -f1)
# curl may be a native Windows binary: give it a Windows path inside -F.
LOCAL_FILE="$WORK/report.txt"; command -v cygpath >/dev/null && LOCAL_FILE=$(cygpath -w "$LOCAL_FILE")
UP=$(curl -sS -H "$AUTH" -F "file=@$LOCAL_FILE;type=text/plain" -F ownerType=student -F "ownerId=$PUPIL" \
  "http://localhost:$API_PORT/api/v1/files/upload" || true)
FILE=$(echo "$UP" | json .id 2>/dev/null || true)
{ [ -z "$FILE" ] || [ "$FILE" = undefined ]; } && echo "upload response: $UP"
[ -n "$FILE" ] && [ "$FILE" != undefined ] && pass "document uploaded ($FILE)" || fail "upload"
RECON_A=$(api -H "$AUTH" "http://localhost:$API_PORT/api/v1/school/finance/reconciliation/ar-gl")

dk restart drill-api >/dev/null && wait_ready && pass "API restarts and is ready again"

# ── 3. Backup, copied off host A ────────────────────────────────────────────
say "Operator backup (database + files), copied offsite"
OPH="X-Operator-Secret: $OPS"
api -H "$OPH" -X POST "http://localhost:$API_PORT/api/v1/admin/backups/full" | tee "$WORK/full.json" >/dev/null
api -H "$OPH" -X POST "http://localhost:$API_PORT/api/v1/admin/backups/files" | tee "$WORK/files.json" >/dev/null
grep -q '"status":"success"' "$WORK/full.json" && grep -q '"status":"success"' "$WORK/files.json"   && pass "full + files backup succeeded ($(node -e "console.log(JSON.parse(process.argv[1]).sizeBytes)" "$(cat "$WORK/full.json")") bytes, sha256 recorded)" || fail "backup"
BACKUP_AT=$(now)
dk cp drill-api:/app/var/backups/. "$(hp "$WORK/offsite")" && pass "backup copied off host A ($(du -sh "$WORK/offsite" | cut -f1))"
DUMP=$(ls -t "$WORK"/offsite/full/*.dump 2>/dev/null | head -1 || true)
[ -z "$DUMP" ] && DUMP=$(find "$WORK/offsite/full" -type f ! -name '*.json' | head -1)
[ -n "$DUMP" ] && pass "database dump: $(basename "$DUMP")" || fail "no dump in backup"

# ── 4. Disaster: host A is gone ──────────────────────────────────────────────
say "Destroy host A (database, uploads, backups volumes)"
dk rm -f drill-api drill-db-a >/dev/null
dk volume rm drill-pg-a drill-up-a drill-bk-a >/dev/null
pass "host A destroyed"

# ── 5. Host B: restore from the offsite copy ────────────────────────────────
say "Host B: fresh PostgreSQL 16 + restore + start"
R0=$(now)
start_pg drill-db-b drill-pg-b $PG_PORT_B
runtime_roles_first() { psql_in drill-db-b "CREATE ROLE app LOGIN PASSWORD 'drill-app' NOBYPASSRLS; CREATE ROLE app_system LOGIN PASSWORD 'drill-system' BYPASSRLS;"; }
runtime_roles_first
backup_role drill-db-b
dk cp "$(hp "$DUMP")" drill-db-b:/tmp/restore.dump
dk exec drill-db-b pg_restore -U $OWNER -d $DBNAME --no-owner --role=$OWNER --exit-on-error /tmp/restore.dump \
  && pass "database restored" || fail "pg_restore"
runtime_roles $PG_PORT_B
(cd "$ROOT" && DATABASE_URL="postgresql://$OWNER:$OWNER_PW@localhost:$PG_PORT_B/$DBNAME?schema=public" node scripts/assert-db-constraints.mjs >/dev/null) \
  && pass "restored schema passes the constraint preflight" || fail "restored constraints"
dk volume create drill-up-b >/dev/null; dk volume create drill-bk-b >/dev/null
UPSRC=$(find "$WORK/offsite/files" -mindepth 1 -maxdepth 1 -type d | head -1)
dk run --rm -v drill-up-b:/dst -v "$(hp "$UPSRC"):/src:ro" alpine sh -c 'cp -a /src/. /dst/' && pass "uploaded files restored"
dk run --rm -v drill-bk-b:/dst -v "$(hp "$WORK/offsite"):/src:ro" alpine sh -c 'cp -a /src/. /dst/'
start_api drill-db-b drill-up-b drill-bk-b
RTO=$(( $(now) - R0 ))

TOKEN=$(login); [ -n "$TOKEN" ] && [ "$TOKEN" != undefined ] && pass "administrator signs in on host B" || fail "sign-in after restore"
AUTH="Authorization: Bearer $TOKEN"
NAME=$(api -H "$AUTH" "http://localhost:$API_PORT/api/v1/school/students/$PUPIL" | json '.partner?.name ?? o.name')
[ "$NAME" = "Nakato Drill" ] && pass "pupil record intact" || fail "pupil after restore: $NAME"
URL=$(api -H "$AUTH" -X POST "http://localhost:$API_PORT/api/v1/files/$FILE/signed-url" | json .url)
# The signed URL may carry the public web address; fetch its path from this host.
URL_PATH=$(node -e "const u=process.argv[1];const m=u.match(/\/api\/v1\/.*$/);console.log(m?m[0]:u)" "$URL")
curl -fsS -o "$WORK/report.restored" "http://localhost:$API_PORT$URL_PATH"
SHA_B=$(sha256sum "$WORK/report.restored" | cut -d' ' -f1)
[ "$SHA_A" = "$SHA_B" ] && pass "document downloads byte-for-byte after restore" || fail "document bytes differ"
RECON_B=$(api -H "$AUTH" "http://localhost:$API_PORT/api/v1/school/finance/reconciliation/ar-gl")
node -e "const a=JSON.parse(process.argv[1]),b=JSON.parse(process.argv[2]);const k=o=>JSON.stringify({gl:o.glBalance??o.gl,sub:o.subledger??o.subledgerBalance,d:o.difference??o.diff});process.exit(k(a)===k(b)?0:1)" "$RECON_A" "$RECON_B" \
  && pass "AR/GL reconciliation identical before and after" || fail "reconciliation changed"

# ── 6. A damaged backup is refused ───────────────────────────────────────────
say "Restore drill on host B: good backup passes, damaged one fails"
# The operator drill restores the NEWEST full backup into a scratch database and
# compares it with the manifest written at backup time (not just pg_restore --list).
res=$(api -H "$OPH" -X POST "http://localhost:$API_PORT/api/v1/admin/backups/restore/drill")
echo "$res" | grep -q '"success":true' && pass "restore drill passes on the real backup" || fail "restore drill on the real backup: $res"
head -c 20000 "$DUMP" > "$WORK/corrupt.dump"
dk cp "$(hp "$WORK/corrupt.dump")" drill-api:/app/var/backups/full/POS-CAFE_FULL_2099-12-31_235959.dump
res=$(api -H "$OPH" -X POST "http://localhost:$API_PORT/api/v1/admin/backups/restore/drill")
if echo "$res" | grep -q '"success":false'; then pass "damaged backup fails the drill: $(echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).message.slice(0,120)))")"; else fail "damaged backup passed the drill: $res"; fi

say "Result"
echo "RTO (fresh host → restored, verified API ready): ${RTO}s"
echo "RPO: data after the last backup is lost; last backup was taken $(( $(now) - BACKUP_AT ))s before this line (daily schedule ⇒ up to 24h)."
echo "Image: $IMAGE   PostgreSQL: $(dk exec drill-db-b postgres --version)"
cleanup
rm -rf "$WORK"
