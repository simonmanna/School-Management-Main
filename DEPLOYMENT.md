# Enterprise deployment guide (Linux + Docker + TLS)

This file explains how to take the Generic ERP Platform from a working dev
container (`pnpm dev:api && pnpm dev:web`) to a production deployment suitable
for paying customers.

## Fresh install (empty database only)

```bash
cp .env.example .env
# Edit .env — set JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, SMTP_* etc.
docker compose up -d db
docker compose run --rm api pnpm --filter @erp/api db:migrate
docker compose run --rm api pnpm --filter @erp/api db:seed
docker compose up -d api web
```

> ⚠️ **`db:seed` is for empty databases only.** `prisma/seed.ts` runs
> `deleteMany` on `menuProduct`, `menuItem` and `menuCategory` for the target
> organization — on a live system it **wipes the menu**. It is not part of any
> upgrade path. See the next section.

## Upgrading an existing deployment

Never run the fresh-install block against a database that already holds real
data. Two paths, depending on the release:

**Ordinary release** (additive migrations, no history changes):

```bash
pwsh scripts/update-pos.ps1
```

That script takes a `pg_dump` first, fails hard if `prisma migrate deploy`
fails, gates on a `prisma migrate diff` drift check before restarting services,
and health-checks the API before handing the till back. It never seeds.

**Release with a schema restructure or renamed migration history** — currently
`2026-08-r1`, which replaces `Account.accountType` with a category FK:

```bash
pwsh deployment/2026-08-r1/upgrade.ps1 -DryRun   # rehearse on a staging clone
pwsh deployment/2026-08-r1/upgrade.ps1
```

Read `deployment/2026-08-r1/README.md` before running it. That release drops
columns holding live accounting data and requires a backfill, a mapping-report
sign-off, and an offline-sync drain gate. `update-pos.ps1` cannot do it.

> **The family portal has its own guide.** Students, guardians and teachers sign
> in to `apps/portal`, a separate app from the back office, and it is the one that
> has to face the public internet. See **`docs/PORTAL_DEPLOYMENT.md`** for TLS,
> CORS, SMTP, the Tailscale option for staff, and how the registrar issues logins.

Browse:
- Portal: http://localhost:5175  (families + teachers)
- App:    http://localhost:5173
- API:    http://localhost:3000/api/v1
- Docs:   http://localhost:3000/api/docs
- Adminer (dev only): http://localhost:8080

Default credentials seeded:
- Organization: `DEMO`
- Email:        `admin@demo.test`
- Password:     `Admin@123`

## Production checklist

- [ ] Strong JWT secrets (32+ random chars). The API refuses to start with weak secrets.
- [ ] TLS termination (Caddy / nginx / a load balancer).
- [ ] Postgres backups (pg_dump cron + offsite copy).
- [ ] SMTP provider configured (otherwise password-reset emails won't send).
- [ ] File uploads live on the `uploads` volume (`STORAGE_LOCAL_DIR`). Only the
      `local` driver exists; the API refuses to start with `STORAGE_DRIVER=s3`.
      Include the volume in backups.
- [ ] `ThrottlerModule` is registered globally — verify by hitting login 100×.
- [ ] `JWT_ACCESS_SECRET` rotated quarterly (re-encrypt User.mfaSecret rows).
- [ ] Run `pnpm verify` in CI before every release.
- [ ] **Restore-test the backup.** A dump nobody has restored is not a backup —
      restore it into a scratch database and query it.
- [ ] Optional modules (`ENABLE_BEVERAGE` / `ENABLE_ASSETS` / `ENABLE_TASKS`)
      left `false` unless the site actually uses them. A registered Nest module
      runs its boot hooks, crons and queue consumers whether or not anyone
      navigates to it, so hiding the web nav alone is not enough.
- [ ] `scripts/validate-production.ts` is never pointed at production — it
      writes real sales, refunds and GL entries. Staging only.

## Go-live for a school

### 1. Settings the API needs (`docker-compose.prod.yml` refuses to start without the starred ones)

| Variable | Why |
|---|---|
| `WEB_URL` \* | Staff invitation and password-reset links point here. |
| `PORTAL_URL` \* | Parent portal invitation links point here. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` \* | Email. Without SMTP, emails are recorded as **not sent** (never as sent). |
| `COMM_ENCRYPTION_KEY` \* | Encrypts the SMS gateway's credentials. `openssl rand -base64 32`. |
| `SMS_DEFAULT_COUNTRY_CODE` | `+256` by default: turns `0772…` into `+256772…`. |
| `PROVISIONING_SECRET` | Only while creating a new school; unset it afterwards. |

### 2. Create the school (operator, once)

```bash
curl -X POST https://<api>/api/v1/organizations/bootstrap \
  -H "X-Provisioning-Secret: $PROVISIONING_SECRET" -H 'content-type: application/json' \
  -d '{"organizationCode":"GVPS","organizationName":"Green Valley Primary School","adminEmail":"head@gvps.ug","adminFirstName":"Head"}'
```

The school starts in UGX / Africa/Kampala with Baby–Top and P1–P7 (with the
promotion ladder), attendance statuses, the PLE grading scale and a main campus.
The administrator receives an email link to set their password.

### 3. Connect SMS for parents

Sign in as the administrator → **Communication → Channels** → add an SMS
channel with your gateway's details. Fee, attendance and admission alerts go
through it. Until a channel exists they are recorded as *failed — no SMS gateway*.

### 4. Follow the in-app checklist

The dashboard shows **Get your school ready**: eleven steps computed from real
data (year → terms → classes → subjects → staff → teachers → fees → pupils →
SMS → parents), each linking to the screen that does it. **How it works** (top
of the menu) explains the school year and who does what.

### 5. Roles to hand out

| Person | Role | Can | Cannot |
|---|---|---|---|
| Head teacher | Head Teacher | approve marks, refunds, write-offs; open / close / archive the year | collect money |
| Bursar | Bursar | fees, payments, receipts, refund **requests** | approve their own refund |
| Registrar | Registrar | admissions, pupils, placement, parent accounts | close a year, fees |
| Class teacher | Class Teacher | register and marks for **their** classes only | other classes, fees |
| Front desk | Front Desk | visitors, enquiries | close a year |

## Observability

- `GET /api/v1/health`           — liveness
- `GET /api/v1/health/ready`     — readiness (DB ping)
- `GET /api/v1/health/startup`   — startup
- `GET /api/v1/metrics`          — Prometheus text format
- Pino structured logs to stdout — pipe to Loki / Datadog / CloudWatch.

## Multi-instance

The outbox worker uses Postgres advisory locks (`SKIP LOCKED`) and a claim
token so multiple API replicas can run safely. Webhooks + recurring generator
+ notifications use the same lock pattern.

Set `OUTBOX_POLL_MS=2000` and run at least 2 replicas.

## Backups

A nightly `pg_dump` is the minimum. Enable point-in-time recovery (PITR) on
the Postgres cluster for safety against accidental writes. Test the restore
process quarterly.
