# Verification evidence — 29 September 2026

Reviewed `C:/Dev/School-Management`, HEAD `6213872`, with pre-existing uncommitted login-page edits. Target is nursery/primary operation in Uganda. This evidence accompanies [the audit](C:/Dev/School-Management/docs/audit/2026-09-29-school-production-readiness-audit.md).

## Executed checks

| Check | Result | Limit |
| --- | --- | --- |
| Fresh database creation/migration | All 169 migrations applied | Separate fictional `school_audit_20260929`, local PostgreSQL 18; production PostgreSQL 16 NOT VERIFIED |
| Executable schema preflight | Passed, including forced tenant RLS on 622 scoped tables and same-school FK/business guards | Does not establish within-school pupil/field authorization |
| API unit project | 136 suites, 2,416 tests passed | Default strict ts-jest; runner left handles and was stopped after completed summary |
| Selected core integration run | 22 suites, 220 tests passed | Transpiled isolated ts-jest with diagnostics disabled; actual PostgreSQL; teardown errors and open process after summary |
| Remaining integration run | 62 suites, 442 tests passed; exited 0 | Same transpile configuration; excludes selected core and dedicated RLS paths |
| Actual app/system role tests | 2 suites, 9 tests passed; exited 0 | NOBYPASSRLS application and BYPASSRLS system roles in isolated DB; not production-host API boot |
| Total integration assertions | 86 suites, 671 tests passed | Passing assertions do not certify every UI, role or endpoint |
| API TypeScript check | `pnpm --filter @erp/api typecheck` exited 0 | Initial root parallel attempt was interrupted for memory pressure; final sequential API check completed |
| Shared TypeScript check | Passed in initial root typecheck run | Staff/portal checked separately by builds |
| Staff application build | Passed | Includes TS check; approximately 5.6MiB PWA precache and chunk warnings; not image/host proof |
| Portal build | Passed | Includes TS check; approximately 506KiB PWA precache; family/teacher workflow NOT VERIFIED |
| API production bundle/image | NOT VERIFIED in this audit | Source API ran via ts-node/transpile-only; no new Nest bundle/image build assertion is claimed |
| Independent bootstrap/HTTP probes | Real running Nest API, fictional schools and selected persistence checks | Development-mode source server used database owner; separate RLS suites supply role evidence |
| Browser | Actual staff login, dashboard/navigation, nursery Collection history read | Complete ordinary business UI journeys NOT VERIFIED; automation clicks were inconclusive, keyboard used; no app mouse defect inferred |
| Recovery integration | Actual fresh full dump restored to scratch DB, manifest/global ledger checked | Local temporary backup directories; production files/offsite/host/RPO/RTO NOT VERIFIED |
| Damaged backup | Truncated dump rejected and failure recorded | No destructive live restore attempted |
| CI Compose config | Exact CI variables + empty env file fails with missing required COMM_ENCRYPTION_KEY | Compose renderer works without Docker daemon; full image startup NOT VERIFIED |
| Dependency audit | 0 critical, 30 high, 38 moderate, 4 low findings | Package/path counts, not demonstrated exploit counts; reachable parser identified; no DoS attack run |
| Existing configured database | Aggregate counts only under BEGIN READ ONLY / ROLLBACK | No names, content or credentials read; counts may include test/demo history |
| Email/SMS/MoMo | NOT VERIFIED | SMTP/Twilio disabled for audit; no external notice or payment sent |

The `school-gradeentry-parity` test passes on an empty legacy table by design unless `REQUIRE_LEGACY_HISTORY=true`. Its pass on this fictional database is **not proof of historical production grade parity**. That upgrade gate must run against a production-like copy with history required. The scale suite reports calculation/publication for 350 fictional pupils; it is not a production concurrency/load certification.

## Safe probe artifacts

- [initial-http.json](C:/Dev/School-Management/docs/audit/evidence-20260929/initial-http.json): bootstrap, registration, duplicate rejection, scope/care/attendance/pickup probes.
- [extended-http.json](C:/Dev/School-Management/docs/audit/evidence-20260929/extended-http.json): unsafe legacy homework/staff reads, cash and approval probes.
- [final-http.json](C:/Dev/School-Management/docs/audit/evidence-20260929/final-http.json): configured late contribution, AR tie-out and closed-term billing probes.
- [backup-scope-http.json](C:/Dev/School-Management/docs/audit/evidence-20260929/backup-scope-http.json): second school reads first school's backup destination/schedule.
- [initial-db-facts.json](C:/Dev/School-Management/docs/audit/evidence-20260929/initial-db-facts.json), [finance-db-facts.json](C:/Dev/School-Management/docs/audit/evidence-20260929/finance-db-facts.json), [closed-term-db-facts.json](C:/Dev/School-Management/docs/audit/evidence-20260929/closed-term-db-facts.json): selected persistence/journal/invoice counts.
- [existing-read-only-counts.json](C:/Dev/School-Management/docs/audit/evidence-20260929/existing-read-only-counts.json): retained assignment/submission and compensation counts.
- [ci-compose.json](C:/Dev/School-Management/docs/audit/evidence-20260929/ci-compose.json), [dependency-summary.json](C:/Dev/School-Management/docs/audit/evidence-20260929/dependency-summary.json), [feature-counts.json](C:/Dev/School-Management/docs/audit/evidence-20260929/feature-counts.json).

Artifacts contain fictional audit identities only. Token/password/secret-like keys are redacted. No dotenv files or database connection strings were copied. The original probe's empty teacher register response is HTTP 201 (the route is POST) with total zero; its harness expected only 200/403 and recorded `passed:false`. This is a **harness expectation error**, not a product failure. Similarly a finance fact queried a nonexistent total property and recorded the string `undefined`; correct invoice/GL amounts are established by actual API reconciliation, not that erroneous harness field.

The published result and retained homework used for authorization probes were inserted as synthetic fixtures. They do not prove result publication or new homework creation through ordinary actions.

## Reproduction and cleanup

Local ignored scripts/logs are under `var/audit-20260929-*`. The runner reads existing local connection configuration without printing it and overrides the database name. Its create mode refuses an existing named DB. HTTP probes use fixed audit-only credentials and no external providers. Reproduction should use a new explicitly named fictional database or account for retained fixtures; do not run these scripts against live school data.

Temporary API/web processes and browser tab were stopped/closed. Temporary `audit29_app` and `audit29_system` roles were removed after reassigning objects in the isolated DB, preserving fixtures. The named fictional audit DB is retained. The user's original dirty login page and `reference/` were preserved. New tracked-workspace content consists only of this audit report and safe evidence; no commits or source repairs were made.
