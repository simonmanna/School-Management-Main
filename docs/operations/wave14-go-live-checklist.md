# Wave 14 go-live checklist

In order. Each step names what proves it. Plan: `docs/AUDIT_REMEDIATION_PLAN_2026-09-27.md`.

1. **Backup the current database** and copy it off the host.
2. **Migrate** as the owner role: `pnpm --filter @erp/api db:deploy` (`MIGRATOR_DATABASE_URL`). Wave 14 adds 5 migrations, including the `numbering` schema that existing sequences move into with their values.
3. **Re-run role setup** (grants on the new `numbering` schema — without it every admission, invoice and receipt number fails):
   `RLS_APP_PASSWORD=… RLS_SYSTEM_PASSWORD=… pnpm --filter @erp/api rls:setup-role`
4. **Create the backup role** (BYPASSRLS, CREATEDB) — `docs/operations/backup-and-restore.md`.
5. **Fill `.env`** from `.env.production.example`; `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` must render without errors.
6. **Build and start**: `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` (Docker VM ≥ 8 GB for the API build).
7. **Integrity audit** (read-only): `psql "$BACKUP_DATABASE_URL" -f apps/api/scripts/integrity/wave14-integrity-audit.sql`. Review every row with the school; correct through the application.
8. **School settings** (head teacher, ADR-032): how late arrivals count; excused absences; cash drawer or cashbook. Attendance percentages stay hidden until the late policy is chosen.
9. **Staff records**: every Class/Subject Teacher account needs its staff record and class/stream assignment — an unassigned teacher now sees no pupils (audit query I-010 lists them).
10. **Restore drill on the host**: `POST /api/v1/backups/restore/drill` → "Restore drill passed". Record RTO.
11. **External device**: open `https://admin.<domain>` and `https://portal.<domain>` from a phone on mobile data; sign in, open a pupil, a fee statement, a care log. No request may go to `localhost`.
12. **Independent re-audit** with `docs/audit/reaudit-brief-wave14.md`. GO only on a clean result.
