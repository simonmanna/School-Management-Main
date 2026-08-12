# Beta POS — Deployment Guide

> Audience: the operator deploying the POS beta in the next 5 days.

This guide covers **everything needed to take the foundation (Days 0–5) from a
clean clone to a running POS beta**. It deliberately omits the post-beta work
(the original audit's "real-world readiness" issues).

---

## 0. Architecture (what you are deploying)

A single Postgres 16 + single Node 22 API pod + a single-web-pod browser
client. The API exposes the full set of money-mutating endpoints
(invoice, payment, vendor-bill, journal, stock move, cash session), each
protected by:

- **Idempotency-Key** middleware — replays return the cached response
  without re-running the handler. Critical for POS retries on flaky
  network.
- **Audit-in-tx** — every mutation writes its audit row inside the same DB
  transaction. If audit fails, the business write rolls back. SOX / IFRS
  compliant.
- **Postgres RLS** — second line of tenancy defense. Every row scoped by
  `organizationId`. Enabled by the migration; enforced only when the app
  connects via the `app` role (one-off setup, see step 4).
- **Native SEQUENCE** — document numbering is atomic; concurrent first-time
  callers cannot crash on unique-violation.
- **Transactional outbox** — domain events are written to `EventOutbox`
  inside the same tx as the business write; a worker drains and dispatches.
  Survives restarts; no event loss on a crash.
- **Refresh-token rotation** — refresh tokens are stored as SHA-256 hashes;
  each refresh issues a new token and revokes the old one. Reuse triggers
  401.
- **Reporting snapshots** — Trial Balance, P&L, Balance Sheet, AP Aging, and
  AR/AP tie-out are rebuilt nightly and on operator demand. Reports read
  from snapshots, not the live ledger, so a 1M-line tenant returns in
  <500ms.

---

## 1. Prerequisites

- Node.js 20+ (`node --version`)
- pnpm 10+ (`npm i -g pnpm@10.14.0`)
- Docker (for Postgres)
- 1 vCPU / 2 GB RAM minimum for the beta (single replica)

---

## 2. First-time setup

```bash
# Clone + install
git clone <repo-url> && cd generic-1
pnpm install

# Build the shared package (publishes types to apps/api)
pnpm shared:build

# Bring up Postgres
pnpm db:up

# Apply migrations + seed (creates the demo org, admin user, chart of accounts)
pnpm db:migrate
pnpm db:seed
```

---

## 3. Environment variables

Create `apps/api/.env` (do NOT commit):

```
# --- D4-1: required, refuse-to-start if weak ---
NODE_ENV=production
JWT_ACCESS_SECRET=<at least 32 random chars>
JWT_REFRESH_SECRET=<at least 32 random chars>

# --- Database ---
DATABASE_URL=postgresql://cafe-pos:cafe-pos@localhost:5433/cafe-pos?schema=public

# --- CORS ---
CORS_ORIGINS=http://localhost:5173

# --- Server ---
PORT=3000

# --- Optional: outbox / snapshots / permissions ---
# OUTBOX_POLL_MS=1000
# SNAPSHOT_RUN_HOUR_UTC=2
# PERMISSIONS_DB_LOOKUP=true     # default true; set to "false" to use JWT cache
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

---

## 4. Postgres RLS role (recommended for the beta)

RLS is enabled in the migration but only takes effect when the app connects
via the `app` role (NOBYPASSRLS). The role setup is a one-off:

```bash
# Requires the DATABASE_URL to point at a superuser (default).
# This script creates the `app` role, grants CRUD on every table, and
# disables BYPASSRLS so RLS applies.
pnpm tsx scripts/setup-rls-role.ts
```

It prints a new connection string for the `app` role. Paste it as
`DATABASE_URL` in `.env`. Restart the API.

To verify RLS works end-to-end:

```bash
# psql as the `app` role:
psql "postgresql://app:<pwd>@localhost:5433/cafe-pos" -c "
  SET app.org_id = '<other-organization-uuid>';
  SELECT * FROM \"Partner\";   -- should return 0 rows
"
```

---

## 5. Run the API

```bash
pnpm --filter @erp/api build
pnpm --filter @erp/api start
```

The API listens on `http://localhost:3000`. Health probe at
`GET /api/health`.

The first nightly snapshot rebuild fires at 02:00 UTC (configurable via
`SNAPSHOT_RUN_HOUR_UTC`). You can trigger an immediate rebuild at any
time:

```bash
curl -X POST http://localhost:3000/api/reports/accounting/rebuild-snapshots \
  -H "Authorization: Bearer <admin-access-token>"
```

---

## 6. Smoke test the POS beta

```bash
API_BASE=http://localhost:3000/api \
ORG_CODE=DEMO \
ADMIN_EMAIL=admin@demo.test \
ADMIN_PASSWORD='Admin@123' \
  pnpm tsx scripts/smoke-pos.ts
```

Expected output:

```
POS smoke — base=http://localhost:3000/api org=DEMO
Cash account: 1100 Cash
Cash register: POS-1 (id=...)
Session opened: ...
Customer: CUST-001  Product: PRD-001
  Sale 1: invoice INV-... payment PAY-...
  ...
Session closed. expected=150 counted=150 variance=0

Z-Report
  Opening float:     100.00
  Sales (5 × $10):   50.00
  Expected close:    150
  Counted close:     150
  Variance:          0
```

---

## 7. Tests

```bash
# Unit tests + accounting invariants (no DB)
pnpm --filter @erp/api test

# Integration tests (require DATABASE_URL; auto-skip if not set)
DATABASE_URL=postgresql://... pnpm --filter @erp/api test:integration

# Architecture boundary check
pnpm lint:arch
```

CI should run all three.

---

## 8. Day-to-day operations

| Task | Command |
|---|---|
| View the Trial Balance | `GET /api/reports/accounting/trial-balance` |
| View the P&L | `GET /api/reports/accounting/profit-and-loss` |
| View the Balance Sheet | `GET /api/reports/accounting/balance-sheet?asOf=YYYY-MM-DD` |
| View AP Aging | `GET /api/reports/ap/aging` |
| View the tie-out | `GET /api/reports/accounting/tieout` |
| Force a snapshot rebuild | `POST /api/reports/accounting/rebuild-snapshots` |
| Close a fiscal period | `POST /api/fiscal-periods/:id/close` |
| Lock a fiscal period | `POST /api/fiscal-periods/:id/lock` |
| List my active sessions | `GET /api/auth/sessions` |
| Revoke a session | `DELETE /api/auth/sessions/:id` |

---

## 9. Backups

For the beta, daily `pg_dump` to object storage is sufficient. Document the
path in your runbook; restore quarterly.

```bash
# Cron entry — run at 03:00 UTC daily
0 3 * * * pg_dump "$DATABASE_URL" | gzip > /backups/cafe-pos-$(date +\%F).sql.gz
```

---

## 10. Rollback procedure

If something goes wrong:

1. **API**: roll back the deploy. The outbox + RLS migrations are reversible.
2. **Database**: `pnpm db:reset` reseeds. Run only if you're OK losing
   tenant data — this is a beta, so a reset is acceptable during the
   first week.
3. **Idempotency**: if a key is stuck `pending` after a crashed request,
   it's safe to `DELETE FROM "IdempotencyRecord" WHERE key = '<key>'`
   manually. The retry will then succeed.
4. **Outbox**: pending events drain on next boot. Stalled events with
   `attempts > 10` are likely poisoned — inspect `lastError` and either
   ship manually or delete.

---

## 11. What's NOT in this beta (call out to your beta customers)

These are documented gaps for honesty. They were deferred from the 5-day
plan and will be addressed in subsequent milestones.

- **Multi-currency / FX revaluation** — single-currency only.
- **Bank reconciliation** — not built.
- **Intercompany / consolidation** — single org per tenant.
- **MFA / rate-limit / field-level encryption** — auth is hardened (rotation,
  DB-permission-lookup, secret guard) but lacks these. Put the beta behind
  a VPN or IP allow-list.
- **Multi-replica HA** — single app pod. The outbox polling assumes a single
  instance; multi-replica needs a `pg_try_advisory_xact_lock` to elect a
  leader.
- **Cash Flow + AR Aging live reporting** — only the four snapshotted
  reports (TB, P&L, BS, AP Aging) are snapshot-backed. Cash Flow and AR Aging
  continue to read live data; performance is acceptable for tens of
  thousands of rows.
- **Web frontend (POS UI)** — backend is ready. Build the UI on top of the
  documented endpoints.

---

## 12. Acceptance checklist (run before declaring the beta "live")

- [ ] `pnpm db:up && pnpm db:migrate && pnpm db:seed` succeed on a clean DB
- [ ] `pnpm tsx scripts/setup-rls-role.ts` ran; `app` role created; `DATABASE_URL` updated
- [ ] `pnpm lint:arch` passes
- [ ] `pnpm --filter @erp/api typecheck` passes
- [ ] `pnpm --filter @erp/api test` passes (unit + invariants)
- [ ] `pnpm --filter @erp/api test:integration` passes (with DB)
- [ ] `pnpm tsx scripts/smoke-pos.ts` shows Z-report with zero variance
- [ ] `GET /api/reports/accounting/trial-balance` returns balanced=true
- [ ] `POST /api/reports/accounting/rebuild-snapshots` succeeds
- [ ] `GET /api/reports/accounting/tieout` shows `arBalanced: true, apBalanced: true`
- [ ] Attempting to start with weak JWT secrets fails loudly (refuse-to-start guard)
- [ ] Idempotency-Key replay returns the cached response (no second invoice created)

---

## 13. Contact / escalation

The architecture owner is in the `#erp-core` Slack channel. Escalate via
the on-call rotation if you see:

- `EventOutbox` rows with `attempts > 5` and growing (poison message)
- Tie-out variance > $0.01 (books out of sync)
- `snapshot-rebuild` taking > 5 minutes (data volume spike)