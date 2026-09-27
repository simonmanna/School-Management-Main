# Verification evidence — 27 September 2026

Assessed commit: `8252c54`, before adding this report. Application code was not modified. Raw local commands/logs and probe scripts are in the ignored `var` folder. No source-school data was mutated. External SMS/email/payment transports were disabled for the audit.

| Execution | Outcome |
| --- | --- |
| `node var/production-audit-20260927.cjs migrate` | Fresh `school_audit_20260927`: 164 migrations applied, no unfinished migration |
| `node var/production-audit-20260927.cjs preflight` | Required database constraints/indexes/FORCE RLS/tenant FK guards passed |
| `node var/production-audit-20260927.cjs test unit` | 135 suites / 2,408 assertions passed in 110.69s; process remained alive after summary and was interrupted |
| `node var/production-audit-20260927.cjs test integration` | Exit 1: 79 passed, one failed, two skipped suites; 619 passed, one failed, nine skipped tests, 913.827s |
| Legacy parity failure explanation | Fresh database had zero legacy GradeEntry rows; test requires at least one. No unequal marks were demonstrated by that failure |
| `node var/audit-20260927-rls.cjs` | Final dedicated run: two suites, nine tests passed under temporary production-style app/system roles; roles removed afterward |
| `node var/audit-20260927-existing-history.cjs` | Existing API-configured local database, READ ONLY aggregate transaction: 1,788 marks; zero missing projections/score/status mismatches. 164 applied migrations, four rolled-back attempts, zero unfinished |
| `pnpm --filter @erp/web build` | Exit 0; includes TypeScript check and Vite production build. Main chunk 5,235.15 kB, gzip 1,252.17 kB |
| `pnpm --filter @erp/api build` | Exit 0; Nest compilation. Compiled API later booted against the isolated audit database |
| `pnpm --filter @erp/portal typecheck` | Exit 0 |
| `pnpm --filter @erp/portal build` | Exit 0; Vite build and service worker generated. Main index 168.01 kB; separate vendor/query/routes |
| `node var/audit-20260927-recovery.cjs` | Final stable snapshot restored into separate empty `school_audit_restore_final20260927`; 642 table counts and 60 document residuals identical |
| First recovery comparison | Started while integration fixtures were mutating, so counts differed. It was rejected as an acceptance proof and repeated after tests stopped. This is not reported as a product restore defect |
| Docker production merge | `docker compose --env-file var/audit-20260927-compose.env -f docker-compose.yml -f docker-compose.prod.yml config --format json` inspected using fake configuration values |
| Docker build/runtime | NOT VERIFIED: Docker daemon unavailable. Local package resolution and Dockerfile/merged configuration were inspected |
| Browser | Staff successful sign-in, dashboard/menu observation and nursery guardian collection attempt; collection did not persist |

Jest was run sequentially with ts-jest runtime transpilation (`isolatedModules:true`, `diagnostics:false`) to keep execution practical on this machine. Test assertion results do not substitute for type checking. The three separate application builds establish application-source compilation; they do not certify TypeScript correctness of every test file.

The two production-role suites were originally skipped in the full integration run, then executed separately with temporary audit roles. Their final nine passing assertions should be stated separately, not by rewriting the original full-run result as all passing.

Selected preserved evidence:

- [Authorization probe](C:/Dev/School-Management/docs/audit/evidence-20260927/authorization-probe.json): unassigned teacher denial on normal pupil paths but sensitive nursery/report access and care-note update accepted. All names/records are fictional.
- [Database preflight](C:/Dev/School-Management/docs/audit/evidence-20260927/database-preflight.txt) and [RLS test results](C:/Dev/School-Management/docs/audit/evidence-20260927/rls-test-results.txt).
- [Adjustment interleaving](C:/Dev/School-Management/docs/audit/evidence-20260927/adjustment.json): actual balance/GL doubled for one approval.
- [Normal queued billing after close](C:/Dev/School-Management/docs/audit/evidence-20260927/close-natural.json): real HTTP request outcomes and timestamped persisted state; no run-item edits.
- [Attendance/cash/isolation operations](C:/Dev/School-Management/docs/audit/evidence-20260927/http-operations.json).
- [Cash report readback](C:/Dev/School-Management/docs/audit/evidence-20260927/cash-readback.json): receipt included in cashbook, custody check incorrectly omits missing movements, requested-date label shifts.
- [Parent access](C:/Dev/School-Management/docs/audit/evidence-20260927/http-parent.json): fixture activation followed by real access/share/revocation checks; no email acceptance claim.
- [Recovery](C:/Dev/School-Management/docs/audit/evidence-20260927/recovery.json).
- [Existing aggregate history](C:/Dev/School-Management/docs/audit/evidence-20260927/existing-history.json).
- [Feature inventory](C:/Dev/School-Management/docs/audit/evidence-20260927/feature-matrix.json) and [CSV](C:/Dev/School-Management/docs/audit/evidence-20260927/feature-matrix.csv).
- [Nursery collection screenshot](C:/Dev/School-Management/docs/audit/evidence-20260927/nursery-collection.png): fictional child/guardian and no recorded collection.

Temporary servers on 3097/5197 and the audit browser were stopped/closed. Three explicitly named audit databases are retained for reproducibility: `school_audit_20260927`, `school_audit_restore_20260927` (the rejected concurrent comparison), and `school_audit_restore_final20260927` (the accepted stable restore). The fictional dump and fixture are in ignored `var`; the fixture includes audit-only credentials and is not copied into the report/evidence directory. No production deployment, source-school cleanup or migration reset was performed.
