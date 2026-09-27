# Wave 14 remediation — verification evidence

Branch `wave14-audit-remediation`, 2026-09-27. Fictional data only. Test databases: `school_wave14` (integration suite, from empty via `prisma migrate deploy`) and `school_probe_w14` (HTTP probe).

## Acceptance tests (plan / audit section 17)

| Test | Finding | Evidence | Result |
|---|---|---|---|
| D01 | F01 nursery privacy | `apps/api/test/integration/wave14-child-data-scope.spec.ts`; HTTP `http-probe-probe.json` | Unassigned, other-stream and former teachers are refused (403) or get empty lists on care logs, immunisations, collectors, incidents and gate log; denied writes leave the database unchanged; the stream teacher reads their own pupils. |
| D02 | F02 report scope | same spec; HTTP `teacher report register` = 0 rows | Unassigned teacher gets an empty register, stream teacher their stream, head the whole class; out-of-scope pupil report refused. |
| D03 | F03 adjustment race | `wave14-finance-integrity.spec.ts`; HTTP `http-probe-extra.json` | Two concurrent approvals over HTTP: 250,000 → 251,000, one journal entry. Two different adjustments both land. Approve vs reject has one winner. |
| D04 | F04 invoice ownership | same | Adjustment naming another pupil → 400, nothing written; cancelled invoice refused; pupil derived from the invoice. |
| D05 | F05 close boundary | same; HTTP `queued billing after close` | Run queued while open is refused after close, no invoice; resumes after reopen (reason required, maker-checker); close racing a posting serializes. |
| D06 | F06 guardian handover | `wave14-child-data-scope.spec.ts`; HTTP `approved guardian release` | canPickup guardian released with `authorizationSource = guardian`, no override; retry and second click are the same handover; wrong child's guardian and off-list guardian refused; override needs its own grant and a reason. |
| D07 | F07 pupil identity | `wave14-identity-attendance.spec.ts`; HTTP `duplicate child rejected` | 409 LIKELY_DUPLICATE with the match, count unchanged, on quick register and admit form; concurrent registrations create one record; override needs the grant and a reason and is audited. |
| D08 | F08 attendance | same; HTTP `late attendance rate` | One late day: null until the school chooses, 100 (policy 1) or 50 (policy 0.5) — never 150; mixed month matches an independent calculation; pupil summary and class report agree. |
| D09 | F09 cash custody | `wave14-finance-integrity.spec.ts`; HTTP `http-probe-extra.json` | Drawer mode refuses cash without an open drawer; a receipt moves the drawer once; a receipt without a movement is a 100,000 variance in drawer mode and 100,000 untracked custody in cashbook mode, never zero. |
| F21 | cash book date | same | Requested 2026-09-27 reported as 2026-09-27, Africa/Kampala. |
| D10 | F10 browser config | `docker compose … config` (rendered) | Only 80/443 published; bundles call same-origin `/api/v1`; web and portal flags match the API's enabled modules; no localhost URL. External-device check still required on the host (Phase 5.2). |
| D11 | F11 image | `docker build -f infra/docker/Dockerfile.api` | Builds; Prisma client asserted from `apps/api` (638 models) in build and runtime stages; `pg_dump 16`; no `.env` in the image. Boots with `NODE_ENV=production` on NOBYPASSRLS/BYPASSRLS roles; health OK. |
| D12 | F12 recovery | `wave14-restore-drill.spec.ts` | Full backup + manifest; drill restores into a scratch DB and verifies counts and ledger balance; a damaged backup fails and is recorded; restoring over the live DB is refused. Host drill with real volumes still required. |
| D13 | F13 MoMo | unit `fees-momo-and-explainer.spec.ts`; HTTP `F13 live MoMo request` = 403 | Live collection off: availability false, request and callback refused. |

## Defects found during verification (fixed in this wave)

1. `apps/api/.env` (database password, JWT secrets) was copied into the API image — `.dockerignore` matched only the root `.env`.
2. `nest build` ran out of heap inside the image build.
3. A fresh production database could not create its first school (no currencies seeded).
4. Under the production database roles every numbered document (admission, invoice, receipt) failed: sequences were created at runtime in `public`. Moved to a `numbering` schema; counters preserved.
5. Backups: tools called with `.exe` on Linux; dump used the RLS-restricted app role; `psql` hung on a password prompt when stray `PG*` variables were set.
6. Meal and transport billing had no financial-close gate.
7. Library dashboard showed hard-coded zeros for overdue books and fines.

## Suites

- Unit: 2,416 passed.
- Integration (fresh database, 3 shards): see `summary.txt`.
- Typecheck: api, web, portal clean. Lint: 0 errors (warnings pre-existing).
- Builds: web (school PWA manifest `/school`), portal, API image.

## Not verified here (Phase 5.1 / 5.2)

- Independent adversarial re-audit (`docs/audit/reaudit-brief-wave14.md`).
- External-device check over TLS on the deployment host; restore drill on that host with real volumes and the offsite copy.
- Head-teacher sign-off of ADR-032 policies and report-card samples.
- Fail-first proof of each D-spec on `8252c54` is represented by the audit's own reproductions (`docs/audit/evidence-20260927/`) and the same probe script re-run here.
