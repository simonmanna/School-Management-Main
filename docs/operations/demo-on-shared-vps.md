# Client demo on a shared VPS

Runs the school system as a demo beside another site (the Avida real-estate
site on the Contabo VPS) without touching that site beyond two Caddy blocks.

| | |
|---|---|
| Staff app | https://school-demo.almasiresidence.com |
| Parent / teacher portal | https://portal-demo.almasiresidence.com |
| Portal by IP (no DNS needed) | http://169.58.5.88:8095 — `portal-ip` service, plain HTTP |
| Host | `ssh avida-vps` (Tailscale `100.68.98.67`; public 169.58.5.88:22 is blocked on some networks), files in `/opt/school-demo` |
| Compose project | `school-demo` (`docker-compose.yml` + `docker-compose.demo.yml`) |

## How it fits

```
:443 → avida-caddy ─┬─ almasiresidence.com, api., admin., storage.   (unchanged)
                    ├─ school-demo.*  /api/* → sd-api:3000, else sd-web:80
                    └─ portal-demo.*  /api/* → sd-api:3000, else sd-portal:80
                       (external docker network `school-demo-edge`)
school-demo: db, redis, api, web, portal — no host ports, memory-capped
```

The aliases are prefixed (`sd-*`) because Avida's own services are also named
`api` and `web`.

## Demo logins (organization `SUNRISE`)

Sunrise Academy is a nursery + primary school (Baby/Middle/Top Class, P.1–P.7,
colour streams, ~700 pupils) with 2025 history and 2026 Terms 1–2 results and
report cards published. Term 3 is live: Beginning-of-Term exam closed, P.7 Mock
results ready, Mid-Term in marking (approval queue), End-of-Term timetabled;
68 P.7 candidates registered for PLE. Also: NCDC topics, learning outcomes and
competency judgements, weekly homework, 40 built-out LMS courses (P.4–P.7, every
stream) with quiz attempts, schemes of work and lesson plans, rooms, the 2026
calendar (holidays, visiting days, PLE), notices and school policies.

Teaching & Assessment trail: every teacher has a login (`<key>@sunrise.test`,
e.g. `ct-p1-red@` for the P.1 Red class teacher, `eng@`/`sci@` for subject
teachers, all `Staff@123`); marks carry who entered, submitted and approved
them; question papers with a hash-chained custody log; Mid Term scripts
allocated to markers; moderation samples; exam incidents and SNE extra time;
2025→2026 promotion decisions; merit and nursery-completion certificates; and
schemes of work + weekly lesson plans for nursery and P.1–P.3 as well as
P.4–P.7. Lesson plans are reviewed by `deputy@` (Deputy Head role).

| Who | Email | Password |
|---|---|---|
| Administrator (pre-filled and shown on the sign-in form) | admin@sunrise.test | admin |
| Head teacher | head@sunrise.test | Staff@123 |
| Deputy head | deputy@sunrise.test | Staff@123 |
| Director of studies | dos@sunrise.test | Staff@123 |
| Bursar | bursar@sunrise.test | Staff@123 |
| Registrar | registrar@sunrise.test | Staff@123 |
| P.5 Red class teacher | teacher@sunrise.test | Staff@123 |
| Mathematics teacher | mtc@sunrise.test | Staff@123 |
| Pupil (portal) | pupil@sunrise.test | Portal@123 |
| Parent (portal, 2 children) | parent@sunrise.test | Portal@123 |

These are seeded demo passwords on demo data. Set `SEED_*_PASSWORD` /
`DEMO_STAFF_PASSWORD` / `DEMO_PORTAL_PASSWORD` when building the dump if the
demo link will circulate widely. `reset` restores them.

## Build (Windows workstation, Docker Desktop ≥ 8 GB)

The API image needs ~6 GB of heap to build, so it is never built on the VPS
(it would compete with Avida's Postgres). The runtime image has no TypeScript
sources, so the demo database is also built here and shipped as a dump.

```bash
# images, from a clean export of the committed tree
git archive HEAD | tar -x -C "$BUILD"          # + docker-compose.demo.yml
# one image at a time: building api and web together kills BuildKit in an 8 GB VM
for s in portal web api; do
  docker compose -p school-demo --env-file .env.build \
    -f docker-compose.yml -f docker-compose.demo.yml build $s
done
docker save school-demo/api school-demo/web school-demo/portal | gzip > sd-images.tar.gz

# seeded database, in a throwaway Postgres 16
docker run -d --name sd-seed-db -p 127.0.0.1:55440:5432 \
  -e POSTGRES_USER=school_owner -e POSTGRES_PASSWORD=seedpw -e POSTGRES_DB=school postgres:16-alpine
cd apps/api
export DATABASE_URL=postgresql://school_owner:seedpw@localhost:55440/school?schema=public NODE_ENV=development
npx prisma migrate deploy
RLS_APP_PASSWORD=x RLS_SYSTEM_PASSWORD=y pnpm rls:setup-role   # roles + grants
pnpm db:seed                                                  # base catalogue (chart of accounts …)
pnpm exec tsx ../../scripts/seed-school.ts                    # Sunrise org, accounting, fee catalogue
SEED_ADMIN_PASSWORD=admin pnpm exec tsx ../../scripts/seed-sunrise-academics.ts   # roles, admin login (matches VITE_DEMO_LOGIN_* in docker-compose.demo.yml)
pnpm db:reset:sunrise-academics -- --apply                    # drop the legacy P.1 A … S.6 shape
pnpm db:seed:sunrise                                          # nursery + primary structure
pnpm db:seed:sunrise-demo                                     # pupils, staff, marks, results, LMS, planning
pnpm --filter @erp/api build && pnpm db:seed:sunrise-ops       # fees, books, HR, expenses, transport, meals, library, store, purchasing (drives dist/)
pnpm db:seed:sunrise-admissions                               # admissions pipeline
docker exec sd-seed-db pg_dump -U school_owner -d school -Fc -f /tmp/school-demo.dump
docker cp sd-seed-db:/tmp/school-demo.dump .
```

## Deploy (server)

1. DNS (Namecheap): A records `school-demo` and `portal-demo` → 169.58.5.88.
2. Copy to `/opt/school-demo`: `docker-compose.yml`, `docker-compose.demo.yml`,
   `infra/docker/Caddyfile.demo-snippet` (as `Caddyfile.demo-snippet`),
   `infra/docker/Caddyfile.demo-ip` (as `Caddyfile.demo-ip`),
   `scripts/demo/vps-demo.sh`, `school-demo.dump`, `sd-images.tar.gz`.
3. `bash vps-demo.sh up` — generates `.env.demo` (mode 600) on first run,
   loads images, creates the roles, restores the dump, starts the stack.
4. `bash vps-demo.sh wire-caddy avida-prod-caddy-1` — backs up the live Caddyfile,
   attaches Caddy to `school-demo-edge`, appends the two blocks, validates and
   reloads (zero downtime). Validation failure restores the backup.

## Update an existing deploy (over SSH)

Always `ssh avida-vps` / `scp … avida-vps:` (Tailscale). Port 22 on the public
IP is blocked on some networks, and the timeout looks like a ban.

**1. Workstation** (Git Bash, Docker Desktop running, repo clean and pushed):

```bash
BUILD=$(mktemp -d); git archive HEAD | tar -x -C "$BUILD"; cd "$BUILD"
cp /path/to/.env.build .                     # dummy values; keys as in .env.demo.example
for s in portal web api; do
  docker compose -p school-demo --env-file .env.build \
    -f docker-compose.yml -f docker-compose.demo.yml build $s
done
docker save school-demo/api school-demo/web school-demo/portal | gzip > sd-images.tar.gz
sha256sum sd-images.tar.gz
```

**2. Upload** to a dated folder:

```bash
D=/opt/school-demo/incoming-$(date +%Y%m%d)
ssh avida-vps "mkdir -p $D"
echo "reput sd-images.tar.gz $D/sd-images.tar.gz" | sftp -b - avida-vps   # resumable; rerun if the link drops
scp docker-compose.yml docker-compose.demo.yml scripts/demo/vps-demo.sh \
    infra/docker/Caddyfile.demo-ip avida-vps:$D/
scp school-demo.dump avida-vps:$D/           # only when shipping new demo data (see Build)
```

**3. Server**: back up, then load (`ssh avida-vps`, `cd /opt/school-demo`):

```bash
D=incoming-YYYYMMDD
sha256sum $D/sd-images.tar.gz                # must match step 1
S=$(date +%Y%m%d-%H%M%S); mkdir -p backups
docker exec school-demo-db pg_dump -U school_owner -d school -Fc -f /tmp/pre.dump
docker cp school-demo-db:/tmp/pre.dump backups/pre-$S.dump
for f in docker-compose.yml docker-compose.demo.yml vps-demo.sh .env.demo; do cp $f backups/$f.$S; done
for i in api web portal; do docker tag school-demo/$i:latest school-demo/$i:prev-$S; done
cp $D/docker-compose.yml $D/docker-compose.demo.yml $D/vps-demo.sh $D/Caddyfile.demo-ip .
gunzip -c $D/sd-images.tar.gz | docker load
DC="docker compose -p school-demo --env-file .env.demo -f docker-compose.yml -f docker-compose.demo.yml"
$DC config --quiet                           # fails on a new required key: add it to .env.demo
```

**4. Server**: then **one** of:

```bash
# A. keep the data, apply new migrations (owner role; the app role cannot migrate)
set -a; . ./.env.demo; set +a
$DC run --rm --no-deps --entrypoint sh \
  -e DATABASE_URL="postgresql://school_owner:${DEMO_DB_OWNER_PASSWORD}@db:5432/school?schema=public" \
  api -c "cd apps/api && ./node_modules/.bin/prisma migrate deploy"
$DC up -d --no-build api web portal portal-ip

# B. new demo data: replace the dump and restore it (drops the live demo DB)
mv school-demo.dump backups/school-demo.dump.$S && cp $D/school-demo.dump school-demo.dump
bash vps-demo.sh reset
$DC up -d --no-build web portal portal-ip
```

**5. Check**:

```bash
docker exec school-demo-api wget -qO- http://127.0.0.1:3000/api/v1/health/live
$DC ps
docker exec school-demo-db psql -U school_owner -d school -qAtc \
  "select count(*) from _prisma_migrations where finished_at is null"   # 0
curl -s -o /dev/null -w '%{http_code}\n' http://169.58.5.88:8095/     # portal by IP: 200
```

Then sign in to the staff app with the demo login shown on the form. If the
dump's admin password differs from `VITE_DEMO_LOGIN_PASSWORD`, set it. Make the
hash in `apps/api` with `node -e "console.log(require('bcryptjs').hashSync('admin',12))"`:

```bash
docker exec school-demo-db psql -U school_owner -d school -c \
  "UPDATE \"User\" SET \"passwordHash\"='<hash>' WHERE email='admin@sunrise.test'"
```

**Rollback**: `docker tag school-demo/<svc>:prev-$S school-demo/<svc>:latest`
per image, copy the `backups/*.$S` files back, restore `backups/pre-$S.dump`
with `pg_restore --clean`, then `$DC up -d --no-build api web portal portal-ip`.

**Clean up** once happy: old `incoming-*` folders, old `prev-*` tags, backups
older than the last two.

### Surviving an Avida redeploy

`deploy.sh` rebuilds Avida's Caddy (container `avida-prod-caddy-1`), which drops both the appended blocks (the
Caddyfile is baked into that image) and the extra network. To make it
permanent, in the Avida repo: append `Caddyfile.demo-snippet` to its
Caddyfile, and give its caddy service

```yaml
    networks: [default, school-demo-edge]
networks:
  school-demo-edge:
    external: true
```

Until then, rerun `bash vps-demo.sh wire-caddy avida-prod-caddy-1` after every
Avida deploy. Check with `docker network inspect school-demo-edge`: Caddy must
be listed.

## Operate

| Task | Command (in `/opt/school-demo`) |
|---|---|
| Fresh demo data | `bash vps-demo.sh reset` |
| Logs | `docker logs -f school-demo-api` |
| Resource use | `docker stats --no-stream $(docker ps -qf name=school-demo)` |
| Remove | delete the two blocks from Avida's Caddyfile, reload, `docker network disconnect school-demo-edge avida-prod-caddy-1`, then `bash vps-demo.sh down` |

Not included on purpose: SMTP (emails are recorded as not sent), SMS, live
mobile money, operator backup and provisioning APIs, backups of the demo
database (the dump is the backup).
