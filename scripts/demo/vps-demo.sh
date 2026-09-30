#!/usr/bin/env bash
# Client demo beside another site on a shared host. Run ON THE SERVER from
# /opt/school-demo (see docs/operations/demo-on-shared-vps.md).
#
#   bash vps-demo.sh up          load images, restore the seeded dump, start the stack
#   bash vps-demo.sh wire-caddy  CONTAINER   route the demo hostnames through the host's Caddy
#   bash vps-demo.sh reset       wipe the demo database and restore the dump again
#   bash vps-demo.sh down        stop and remove the demo (volumes too); unwire Caddy first
#
# Expects next to it: docker-compose.yml, docker-compose.demo.yml,
# Caddyfile.demo-snippet, school-demo.dump, sd-images.tar.gz (for `up`).
set -euo pipefail
cd "$(dirname "$0")"

DC=(docker compose -p school-demo --env-file .env.demo -f docker-compose.yml -f docker-compose.demo.yml)
NET=school-demo-edge
say() { printf '\n== %s\n' "$*"; }

ensure_env() {
  [ -f .env.demo ] && return 0
  say "Generating .env.demo"
  umask 077
  cat > .env.demo <<EOF
DEMO_WEB_URL=https://school-demo.almasiresidence.com
DEMO_PORTAL_URL=https://portal-demo.almasiresidence.com
JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_REFRESH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
JWT_POS_SECRET=$(openssl rand -base64 48 | tr -d '\n')
METRICS_TOKEN=$(openssl rand -hex 24)
DEMO_DB_OWNER_PASSWORD=$(openssl rand -hex 24)
DEMO_DB_APP_PASSWORD=$(openssl rand -hex 24)
DEMO_DB_SYSTEM_PASSWORD=$(openssl rand -hex 24)
SCHOOL_DOMAIN=unused.invalid
ACME_EMAIL=unused@unused.invalid
EOF
}

psql_owner() { "${DC[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U school_owner -d "${2:-school}" -qAt -c "$1"; }

wait_db() {
  for _ in $(seq 1 60); do "${DC[@]}" exec -T db pg_isready -U school_owner -d school >/dev/null 2>&1 && return 0; sleep 2; done
  echo "database did not become ready" >&2; exit 1
}

restore_dump() {
  # shellcheck disable=SC1091
  set -a; . ./.env.demo; set +a
  say "Runtime roles (before restore, so the dump's grants apply)"
  psql_owner "DO \$\$BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app') THEN CREATE ROLE app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_system') THEN CREATE ROLE app_system LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS; END IF;
  END\$\$;
  ALTER ROLE app PASSWORD '${DEMO_DB_APP_PASSWORD}';
  ALTER ROLE app_system PASSWORD '${DEMO_DB_SYSTEM_PASSWORD}';"
  say "Restoring seeded demo database"
  "${DC[@]}" cp school-demo.dump db:/tmp/school-demo.dump
  "${DC[@]}" exec -T db pg_restore -U school_owner -d school --exit-on-error /tmp/school-demo.dump
  psql_owner "GRANT CONNECT ON DATABASE school TO app, app_system;"
  "${DC[@]}" exec -T db rm -f /tmp/school-demo.dump
}

wait_api() {
  for _ in $(seq 1 90); do
    docker exec school-demo-api wget -qO- http://127.0.0.1:3000/api/v1/health/live >/dev/null 2>&1 && { echo "api live"; return 0; }
    sleep 2
  done
  docker logs --tail 80 school-demo-api >&2; exit 1
}

cmd_up() {
  ensure_env
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
  if [ -f sd-images.tar.gz ]; then say "Loading images"; gunzip -c sd-images.tar.gz | docker load; fi
  say "Database + cache"
  "${DC[@]}" up -d db redis
  wait_db
  if [ "$(psql_owner "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")" = t ]; then
    echo "database already restored — skipping (use: reset)"
  else
    restore_dump
  fi
  say "API, staff app, portal"
  "${DC[@]}" up -d --no-build api web portal
  wait_api
  "${DC[@]}" ps
}

cmd_reset() {
  ensure_env
  say "Resetting demo data"
  "${DC[@]}" stop api
  psql_owner "DROP DATABASE IF EXISTS school WITH (FORCE)" postgres
  psql_owner "CREATE DATABASE school OWNER school_owner" postgres
  restore_dump
  "${DC[@]}" up -d --no-build api
  wait_api
}

cmd_wire_caddy() {
  local c="${1:?usage: wire-caddy <caddy-container>}"
  local cf=/etc/caddy/Caddyfile stamp; stamp=$(date +%Y%m%d-%H%M%S)
  docker exec "$c" grep -q 'school-demo\.' "$cf" && { echo "already wired"; return 0; }
  say "Backing up $c:$cf → ./Caddyfile.host.bak-$stamp"
  docker cp "$c:$cf" "./Caddyfile.host.bak-$stamp"
  docker network connect "$NET" "$c" 2>/dev/null || true
  local src; src=$(docker inspect "$c" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
  cat "./Caddyfile.host.bak-$stamp" > ./Caddyfile.host.new
  printf '\n' >> ./Caddyfile.host.new
  cat Caddyfile.demo-snippet >> ./Caddyfile.host.new
  if [ -n "$src" ]; then
    echo "Caddyfile is bind-mounted from $src"
    cp "$src" "$src.bak-$stamp"; cat ./Caddyfile.host.new > "$src"
  else
    echo "Caddyfile is baked into the image — patching the running container (lost on its next rebuild)"
    docker cp ./Caddyfile.host.new "$c:$cf"
  fi
  if docker exec "$c" caddy validate --config "$cf" --adapter caddyfile && docker exec "$c" caddy reload --config "$cf" --adapter caddyfile; then
    echo "Caddy reloaded with the demo hostnames"
  else
    echo "validate/reload FAILED — restoring the original Caddyfile" >&2
    if [ -n "$src" ]; then cp "$src.bak-$stamp" "$src"; else docker cp "./Caddyfile.host.bak-$stamp" "$c:$cf"; fi
    docker exec "$c" caddy reload --config "$cf" --adapter caddyfile || true
    exit 1
  fi
}

cmd_down() {
  "${DC[@]}" down -v
  docker network rm "$NET" 2>/dev/null || echo "network $NET still in use (unwire Caddy: remove the demo blocks, reload, docker network disconnect $NET <caddy>)"
}

case "${1:-}" in
  up) cmd_up ;;
  reset) cmd_reset ;;
  wire-caddy) shift; cmd_wire_caddy "$@" ;;
  down) cmd_down ;;
  *) sed -n '2,11p' "$0"; exit 1 ;;
esac
