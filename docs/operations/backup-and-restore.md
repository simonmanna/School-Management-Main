# Backup and restore — production runbook

Audit 2026-09-27 F12, invariant I-051; operator-only since audit 2026-09-29 A03. Applies to the Compose deployment (`docker-compose.yml` + `docker-compose.prod.yml`).

## What runs

| Job | When | What it proves |
|---|---|---|
| Full database backup (`pg_dump --format=custom`) | Per the operator config file (default daily 02:00) | A consistent logical dump exists. A `<file>.manifest.json` is written beside it with row counts of the tables a school cannot lose and the ledger balance. |
| Files backup | Same schedule when "uploaded files" is enabled | Copies `STORAGE_LOCAL_DIR` (`/app/var/uploads`) into the backup directory. |
| **Restore drill** | Sundays 04:00 (`BACKUP_RESTORE_DRILL_CRON`), or `POST /api/v1/admin/backups/restore/drill` | Restores the newest full backup into a scratch database `restore_drill_<ts>`, checks every drill table has at least the manifest's rows and the ledger balances, then drops the scratch database. A failure is recorded in `logs/backup-history.jsonl` and sent through the configured failure notifications. |

`pg_restore --list` (the old "restore test") only proves the file is readable. It is no longer what the schedule runs.

## Operator access

Backup is a host concern: one dump holds every school, and one process-wide scheduler runs it. No school role can reach it — the old `backup:*` grants are retired and stripped from stored roles. Every `/api/v1/admin/backups/*` route requires the header `X-Operator-Secret` equal to the host's `OPERATOR_SECRET`; with the variable unset the API is closed (403).

The configuration is a file on the host (`BACKUP_CONFIG_PATH`, default `$BACKUP_DIR/backup-config.json`, mode 0600), not a school setting. Stored destination keys and the encryption password come back as `********`; sending `********` back leaves them unchanged.

```bash
H="X-Operator-Secret: $OPERATOR_SECRET"
curl -fsS -H "$H" https://$SCHOOL_DOMAIN/api/v1/admin/backups/status
curl -fsS -H "$H" https://$SCHOOL_DOMAIN/api/v1/admin/backups/settings
curl -fsS -H "$H" -H 'Content-Type: application/json' -X PUT   -d '{"frequency":"daily","dailyConfig":{"times":["02:00"]}}'   https://$SCHOOL_DOMAIN/api/v1/admin/backups/settings
curl -fsS -H "$H" -X POST https://$SCHOOL_DOMAIN/api/v1/admin/backups/full
curl -fsS -H "$H" -X POST https://$SCHOOL_DOMAIN/api/v1/admin/backups/restore/drill
```

## Required configuration

| Variable | Why |
|---|---|
| `BACKUP_DATABASE_URL` | A role with **BYPASSRLS** and **CREATEDB**. The application role (`APP_DATABASE_URL`) is NOBYPASSRLS; with FORCE ROW LEVEL SECURITY a dump through it is refused or empty. The drill needs CREATEDB for its scratch database. Compose refuses to start without it. |
| `BACKUP_DIR` | `/app/var/backups`, a named volume (`backups`). |
| `OPERATOR_SECRET` | Long random value held by the operator only. Unset = backup API closed. |
| `BACKUP_CONFIG_PATH` | Optional. Defaults to `$BACKUP_DIR/backup-config.json` (on the backups volume). |
| `PG_BIN` | Optional. The image installs `postgresql16-client`; the tools are on `PATH`. The client major version must be ≥ the server's. |

Create the backup role once (as the database owner):

```sql
CREATE ROLE school_backup LOGIN PASSWORD '<strong password>' BYPASSRLS CREATEDB;
GRANT pg_read_all_data TO school_backup;
```

## Offsite copy (not optional)

A backup on the same disk as the database does not survive the disk. Configure a second destination through the operator API (`PUT /api/v1/admin/backups/settings`: S3-compatible, SFTP or a network path), or copy the `backups` volume off the host nightly:

```bash
docker run --rm -v school-management_backups:/b -v /mnt/offsite:/o alpine sh -c 'cp -a /b/. /o/'
```

Record where the offsite copy lives and who can reach it.

## Recovery (planned)

1. Stop the API: `docker compose -f docker-compose.yml -f docker-compose.prod.yml stop api`.
2. Restore into a **new** database and check it before switching:
   `POST /api/v1/admin/backups/restore` with `{ "scope": "database", "backupFile": "<path>", "targetDatabase": "school_recovered" }`.
3. **Re-apply the runtime role privileges** (Wave 17): the restore deliberately skips the dump's GRANT / DEFAULT PRIVILEGES statements, because the backup role is not a superuser and cannot replay them. Run, as the database owner:
   `DATABASE_URL=<owner url of school_recovered> RLS_APP_PASSWORD=… RLS_SYSTEM_PASSWORD=… pnpm --filter @erp/api rls:setup-role`.
4. Run the constraint preflight against it: `node scripts/assert-db-constraints.mjs` with `DATABASE_URL` pointing at the recovered database.
5. Point `APP_DATABASE_URL` / `SYSTEM_DATABASE_URL` / `MIGRATOR_DATABASE_URL` at it, restore the uploads directory from the files backup, start the API, sign in, open a pupil, a fee statement and a care log.

### Recovery onto a different machine (the offsite copy)

1. New host: Docker, the same image tag, PostgreSQL 16.
2. Start PostgreSQL; create the runtime roles first (`CREATE ROLE app LOGIN NOBYPASSRLS; CREATE ROLE app_system LOGIN BYPASSRLS;` plus the backup role above).
3. `pg_restore --no-owner --role=<owner> --exit-on-error -d <db> <offsite>.dump`, then `rls:setup-role` and `assert-db-constraints.mjs` as above.
4. Copy the offsite `files/<uploads>` tree into the new uploads volume, and the backup folder into the new backups volume.
5. Start the API with the production environment; wait for `GET /api/v1/health/ready`; sign in; open a pupil and download a stored document.

Restoring over the live database is refused unless the host sets `ALLOW_RESTORE_OVER_LIVE=true` for that one planned operation.

## Targets and evidence

- RPO: one day (daily full backup). Tighten with WAL archiving (incremental backups) if the school requires it.
- RTO: **59–122 s measured** over two local production-image drills (2026-09-29, small database, shared dev machine: fresh PostgreSQL 16 → restored → privileges → constraint preflight → API ready → verified). Grows with database size; re-measure on the target host.
- Evidence: `apps/api/test/integration/wave14-restore-drill.spec.ts` (drill passes on a good backup, fails and records on a damaged one, refuses to overwrite the live database).
- **End-to-end drill (Wave 17): `bash scripts/acceptance/prod-drill.sh`** after `docker build -f infra/docker/Dockerfile.api -t school-api:drill .`. Isolated (own `drill-*` network, containers, volumes). It boots the shipped image in production mode with the NOBYPASSRLS app role, checks operator/provisioning surfaces are closed, provisions a school, registers a pupil, uploads a document, restarts the API, takes the operator database + files backup, copies it off the host, destroys host A, restores onto a fresh PostgreSQL 16 + fresh volumes, and verifies sign-in, the pupil, the document's bytes, AR/GL reconciliation and the DB constraints; then runs the operator restore drill on the real backup (must pass) and a damaged one (must fail). It found and fixed: the restore and the weekly drill failed under the non-superuser backup role (privilege statements in the dump).

### Before go-live on the school's server (owner's checklist)

- [ ] Run `prod-drill.sh` on the target host (or the same steps by hand) and record the RTO here.
- [ ] `TRUST_PROXY=1` is set (it is in `docker-compose.prod.yml`) — without it sign-in rate limits are shared by the whole school behind Caddy.
- [ ] TLS certificate issued for the school's domain; only 80/443 published (`scripts/assert-compose-ports.mjs`).
- [ ] Offsite destination configured and one copy verified off the host.
- [ ] Rollback: keep the previous image tag; `docker compose … up -d api` with that tag. Migrations are forward-only — restore the pre-upgrade backup if a migration must be undone.
- [ ] Named operator responsible for backups and the secrets (`OPERATOR_SECRET`, `BACKUP_DATABASE_URL`).
