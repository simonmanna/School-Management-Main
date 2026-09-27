# Independent re-audit brief (plan Phase 5.1)

Give this brief — and nothing from the remediation work — to an auditor who did not take part in it (a fresh AI agent or a person).

## Brief

You are auditing a school management system (Ugandan nursery and primary schools) before live use. Repository: `C:\Dev\School-Management`. Do not trust the developers' claims, test names, comments, commit messages, ADRs or invariant tables. Treat the system as potentially broken.

1. Read `docs/audit/2026-09-27-school-production-readiness-audit.md`, sections 5 and 17 only (the findings F01–F13 and the acceptance tests D01–D13). Do not read `docs/AUDIT_REMEDIATION_PLAN_2026-09-27.md`, `docs/invariants.md`, `docs/audit/authz-inventory.md` or `docs/audit/posting-inventory.md` until your own attempts are complete.
2. Build a fresh database from migrations (`prisma migrate deploy` into an empty database), run the API from source, and create your own fictional school, users and roles. Do not reuse the developers' test fixtures.
3. For each of F01–F13, try to reproduce the original failure through the running API (HTTP), not by calling services. Record request, response and the database state before and after.
4. For each finding, hunt for an **equivalent** failure through another route. At minimum:
   - F01/F02: every route that returns or changes a pupil's data — lists, detail, search, exports, report centre (every report key), history, attachments/downloads, notifications, portal, teacher portal — as an unassigned, other-stream, former and subject teacher.
   - F03/F05: every route that creates or changes an invoice, payment, allocation, credit, waiver, refund, reversal, penalty, meal or transport charge — concurrency (two requests at once) and a financial close between queueing and processing.
   - F06/F07/F08: the nursery gate, every admission path, every place an attendance percentage appears (staff, portal, printed report card).
   - F10–F12: build the images from a clean clone, boot with the production overlay and non-superuser roles, open the apps from another device, run a backup and a restore drill.
5. Report every reproduction as a finding with severity, evidence and the smallest reproduction. A finding that no longer reproduces is reported as "not reproduced" with the attempt, never as "fixed".

## Verdict

GO only if no P0/P1 reproduces, the images build and boot, and a restore drill passes on the deployment host. Otherwise NO-GO with the list.
