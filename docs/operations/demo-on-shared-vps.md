# Client demo on a shared VPS

Runs the school system as a demo beside another site (the Avida real-estate
site on the Contabo VPS) without touching that site beyond two Caddy blocks.

| | |
|---|---|
| Staff app | https://school-demo.almasiresidence.com |
| Parent / teacher portal | https://portal-demo.almasiresidence.com |
| Host | root@169.58.5.88 (`~/.ssh/avida_vps`), files in `/opt/school-demo` |
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

| Who | Email | Password |
|---|---|---|
| Administrator | admin@sunrise.test | Admin@123 |
| Head teacher | head@sunrise.test | Staff@123 |
| Bursar | bursar@sunrise.test | Staff@123 |
| Registrar | registrar@sunrise.test | Staff@123 |
| Subject teacher | teacher@sunrise.test | Teacher@123 |

These are seeded demo passwords on demo data. Set `SEED_*_PASSWORD` when
building the dump if the demo link will circulate widely. `reset` restores them.

## Build (Windows workstation, Docker Desktop ≥ 8 GB)

The API image needs ~6 GB of heap to build, so it is never built on the VPS
(it would compete with Avida's Postgres). The runtime image has no TypeScript
sources, so the demo database is also built here and shipped as a dump.

```bash
# images, from a clean export of the committed tree
git archive HEAD | tar -x -C "$BUILD"          # + docker-compose.demo.yml
docker compose -p school-demo --env-file .env.build \
  -f docker-compose.yml -f docker-compose.demo.yml build api web portal
docker save school-demo/api school-demo/web school-demo/portal | gzip > sd-images.tar.gz

# seeded database, in a throwaway Postgres 16
docker run -d --name sd-seed-db -p 127.0.0.1:55440:5432 \
  -e POSTGRES_USER=school_owner -e POSTGRES_PASSWORD=seedpw -e POSTGRES_DB=school postgres:16-alpine
cd apps/api
export DATABASE_URL=postgresql://school_owner:seedpw@localhost:55440/school?schema=public NODE_ENV=development
npx prisma migrate deploy
RLS_APP_PASSWORD=x RLS_SYSTEM_PASSWORD=y pnpm rls:setup-role   # roles + grants
pnpm db:seed                                                  # base catalogue (chart of accounts …)
pnpm exec tsx ../../scripts/seed-school.ts                    # Sunrise Academy, 200 pupils enrolled
pnpm exec tsx ../../scripts/seed-sunrise-academics.ts         # roles, logins, Term 3, P.1 A course
docker exec sd-seed-db pg_dump -U school_owner -d school -Fc -f /tmp/school-demo.dump
docker cp sd-seed-db:/tmp/school-demo.dump .
```

## Deploy (server)

1. DNS (Namecheap): A records `school-demo` and `portal-demo` → 169.58.5.88.
2. Copy to `/opt/school-demo`: `docker-compose.yml`, `docker-compose.demo.yml`,
   `infra/docker/Caddyfile.demo-snippet` (as `Caddyfile.demo-snippet`),
   `scripts/demo/vps-demo.sh`, `school-demo.dump`, `sd-images.tar.gz`.
3. `bash vps-demo.sh up` — generates `.env.demo` (mode 600) on first run,
   loads images, creates the roles, restores the dump, starts the stack.
4. `bash vps-demo.sh wire-caddy avida-caddy` — backs up the live Caddyfile,
   attaches Caddy to `school-demo-edge`, appends the two blocks, validates and
   reloads (zero downtime). Validation failure restores the backup.

### Surviving an Avida redeploy

`deploy.sh` rebuilds `avida-caddy`, which drops both the appended blocks (the
Caddyfile is baked into that image) and the extra network. To make it
permanent, in the Avida repo: append `Caddyfile.demo-snippet` to its
Caddyfile, and give its caddy service

```yaml
    networks: [default, school-demo-edge]
networks:
  school-demo-edge:
    external: true
```

Until then, rerun `wire-caddy` after every Avida deploy.

## Operate

| Task | Command (in `/opt/school-demo`) |
|---|---|
| Fresh demo data | `bash vps-demo.sh reset` |
| Logs | `docker logs -f school-demo-api` |
| Resource use | `docker stats --no-stream $(docker ps -qf name=school-demo)` |
| Remove | delete the two blocks from Avida's Caddyfile, reload, `docker network disconnect school-demo-edge avida-caddy`, then `bash vps-demo.sh down` |

Not included on purpose: SMTP (emails are recorded as not sent), SMS, live
mobile money, operator backup and provisioning APIs, backups of the demo
database (the dump is the backup).
