# Remediation plan v2 — 2026-09-27 production-readiness audit (F01–F21)

## Context
External audit at `8252c54` = **NO-GO** for 2026-09-28 launch. Reproduced: within-school child-data leaks (F01/F02), double-posted money (F03), wrong-pupil adjustment (F04), billing after close (F05), broken guardian pickup (F06), duplicate pupils (F07), 150% attendance (F08), cash recon false zero-variance (F09), broken prod build (F10/F11), no real restore (F12), MTN adapter wrong (F13).

Code spot-check confirms:
- `filter-resolver.service.ts:153` uses widening `DataScopeService.classIds()`; fail-closed `readableSeats()` exists (`data-scope.service.ts:117`).
- `finance-controls.service.ts:95-105` status read outside `$transaction`, no lock; `createAdjustment` never checks doc↔pupil.
- `billing-run.service.ts:40` `start()` calls `assertTermOpen`; `process()` does not.
- `findLikelyDuplicates` (`student-admission.service.ts:279`) used by `StudentService.create` only, not `register()`.

Reuse: `FinanceControlsService.assertTermOpen` / `assertDocumentsPeriodOpen(ids, tx)`, `SELECT … FOR UPDATE` pattern (`advanced.service.ts:341`, `billing.service.ts:1166`), `readableSeats()`, `audit.recordInTx`.

**Core lesson:** 2,408 unit + 619 integration tests passed while these failures existed. Therefore:
- **No phase is "done" on code change + green tests.** Done = invariants hold + D-test evidence retained + equivalent-route search clean + (Phase 5) independent adversarial re-audit passes.
- New D-specs must **fail on current `main` first**, then pass.

**Decision: postpone live launch.** Fictional-data demo only until GO. Est. 3 weeks to GO.

---

## Phase 0 — Policy decisions + invariant registry (days 0–1)

### 0.1 School policies as configuration (not dev assumptions)
Owner decisions recorded 2026-09-27 in `docs/adr/ADR-032-launch-safety-policies.md`:
| Policy | Decision | Config |
|---|---|---|
| Late attendance | **No default** — school must choose 1.0 or 0.5 at setup; rate not shown until set | `SchoolProfile.attendanceLateContribution` |
| Excused absence | School choice | `SchoolProfile.attendanceExcusedInDenominator` |
| Health / safeguarding access | Head + DSL/nurse + **assigned class teacher, own pupils only** | perms `school.early_years.health.read`, `school.safeguarding.read` + pupil scope |
| Cash custody | **Both modes, per-school** (`drawer` \| `cashbook`) | `SchoolProfile.cashCustodyMode` |
| Duplicate override | Registrar w/ perm + reason, audited | perm `school.students.override_duplicate` |
| Financial reopen | Head + bursar, reason, audited | perm `school.finance.term.reopen` |
| Live MoMo | **Excluded from launch** | capability off |

### 0.2 Invariant registry — `docs/invariants.md`
Each row: ID → statement → enforcing code → unit → integration → browser → evidence file.
- **Identity:** I-001 likely duplicate never silently creates pupil · I-002 one active placement per pupil/term · I-003 financial doc has one authoritative pupil.
- **Authorization:** I-010 teacher reads no pupil outside assignment (every entry point) · I-011 unassignment revokes access immediately · I-012 health/safeguarding need explicit perm · I-013 no student-data endpoint implements its own scope logic.
- **Finance:** I-020 one approved adjustment = one economic effect · I-021 closed period accepts no posting (any path) · I-022 adjustment pupil == invoice pupil · I-023 every cash receipt has custody representation or appears as variance.
- **Attendance:** I-030 one session contributes once · I-031 rate ≤100 by correct math, never clamp.
- **Nursery:** I-040 every release answers who/what authority/which pupil/when/released-by.
- **Ops:** I-050 prod artifact boots from clean build · I-051 restore proven by real restore.

Setup: branch `wave14-audit-remediation`; update memory.

## Phase 1 — Authorization / child-data security (F01, F02) — days 1–4

### 1.1 Authorization-boundary inventory (first, before fixes)
Script/grep every controller route touching pupil data (student, guardian, health, immunisation, incident, pickup, care, attendance, assessment, results, reports, exports, search, history, attachments/downloads, notifications, portal). Produce `docs/audit/authz-inventory.md` table classifying each route:
`auth → tenant → role perm → pupil/class/section scope → sensitive-record perm → field redaction → write authz`.
Every row must name the shared helper used. Blank/ad-hoc = defect.

### 1.2 Single scope policy
- Add to `DataScopeService` (`kernel/auth/data-scope.service.ts`): `assertPupilReadable(id)`, `assertPupilManaged(id)`, `pupilWhere()` — all built on `readableSeats()` (term/section-aware, fail closed).
- `classIds()`: make fail closed (empty assignment → `[]`) or delete after migrating callers (`filter-resolver.service.ts:153`, `core/reporting/report.types.ts:170`, others from inventory).
- Sensitive: health/incident routes require 0.1 perms; guardian phone redacted w/o contact perm.

### 1.3 Apply
`early-years.controller.ts`, `care-log.service.ts`, `pickup.service.ts`, immunisation, incident services, reporting filter resolver + all inventory rows flagged. Seed perms in `packages/shared` + role-grant migration.

### 1.4 Evidence
D01/D02 integration specs: assigned, unassigned, other-class, other-stream, other-school, former (unassigned mid-term), guardian own/other child, DSL. Denials assert DB unchanged + audit row. Inventory rows all green.

## Phase 2 — Financial integrity (F03, F04, F05, F09, F21) — days 3–8

### 2.1 Posting-path inventory (equivalent-bug search)
List every mutation of financial truth: invoice gen (manual/batch/worker), payment (desk/batch/portal/admission fee), refund, reversal, adjustment, penalty, credit/overpayment, waiver/scholarship/bursary, automated jobs. For each record: atomic state claim? doc row lock? period gate inside tx? pupil derived from doc? idempotent replay? → `docs/audit/posting-inventory.md`. Every gap fixed in this phase.

### 2.2 Fixes
- **F03** `approveAdjustment`/reject: inside `$transaction` — `FOR UPDATE` adjustment row, re-check `pending_approval`, `FOR UPDATE` Document before residual math; posted replay returns original.
- **F04** `createAdjustment`: **derive** pupil from invoice (`dto.studentProfileId` = consistency check only, mismatch → 400); require fee-invoice type, posted/not cancelled, period open.
- **F05** rule: *period gate at point of mutation inside posting tx.* `billSingleStudent` (`billing.service.ts:~608`) `assertTermOpen(termId, tx)`; `process()` fails items `term_closed`; close/reopen locks `TermFinancialClose` row so close vs post serialize. Apply to all 2.1 paths.
- **F09** two layers: (A) `fees-subpages.tsx:175` sends active cash session; API rejects cash w/o session in drawer mode; batch path too. (B) `school-finance-query.service.ts:823` iterate all cash payments' methods → missing movement = variance; cashbook mode labels "untracked custody".
- **F21** cashbook day bounds in school TZ; echo requested date.

### 2.3 Evidence
D03 (same-adjustment double approve → exactly one journal, 250k→251k; AND two different legit adjustments same invoice → both apply, no lost update; approve-vs-reject one winner; rollback injection). D04, D05 (race close vs each posting path). D09 end-to-end: session open → collect (single + batch) → receipt → close; payments = allocations = GL = drawer; deliberately missing movement shows 100k variance. F21 at UTC + Kampala.

## Phase 3 — Daily operations (F06, F07, F08) — days 6–9
- **F06** frontend `early-years.tsx:281`: pass collector as arg. Backend `pickup.service.ts:171` `release`: accept `studentGuardianId`, validate current `canPickup` link for *this* pupil. `PickupEvent` persists: `pupilId, collectorType, studentGuardianId|authorizationId, authorizationSource (guardian|authorization|override), releasedById, releasedAt, overrideReason`. Idempotency key. Override needs own perm + reason, never needed for normal guardian.
- **F07** `register()` (`student-admission.service.ts:359`) + import + application conversion: shared `findLikelyDuplicates` → 409 with matches; override = perm + reason + audit. Idempotency key on quick-register. UI match dialog. No name+DOB unique constraint.
- **F08** `student-attendance.service.ts:235`: one contribution per session from policy config; shared calc util for history, class/term reports, portal, print. No clamp. Equivalent search: grep every other attendance-rate computation.
- Evidence D06 (incl. browser + refresh + double-click), D07 (UI/API/concurrent/other admission paths), D08 (independent calc of mixed fixtures; all consumers agree).

## Phase 4 — Deployment / recovery (F10–F13) — days 7–10 (parallel w/ 3)
- **F10** `docker-compose.yml:88` + prod overlay: same-origin API (`/api` via Caddy); web school flag on; portal URL/org code/name build args; `.env.production.example`.
- **F11** `infra/docker/Dockerfile.api:43`: Prisma assertions from `/app/apps/api`.
- **F12** runtime image installs `postgresql16-client`; persistent + offsite backup target incl. uploads; `backup.service.ts:466` scheduled check → real restore into scratch DB + row counts/GL balance/doc residual compare; alert on failure.
- **F13** MoMo capability off + UI hidden; ticket UUID-ref/polling rework post-launch.
- Needs Docker host + domain/TLS. Evidence D10 (external device), D11 (clean lockfile build, cold boot, NOBYPASSRLS roles, restart), D12 (real restore drill, RPO/RTO recorded, corrupt-backup alert).

## Phase 4.5 — Existing-data integrity audit (days 10–11)
Code fixes don't fix stored data. Read-only detection queries (script in `apps/api/scripts/integrity/`) against every existing DB (dev/demo/any school data):
1. Duplicate pupil candidates (name+DOB+class).
2. Duplicate adjustment postings (>1 journal per adjustment).
3. Adjustment pupil ≠ invoice pupil.
4. Postings dated after `TermFinancialClose`.
5. Attendance aggregates >100% / double contributions.
6. Cash payments without CashMovement.
7. Pickups w/o authorization source.
Process: report → human review each → approved correction via app workflows (reversal, merge procedure) not raw SQL → audit record per correction → re-run queries = zero. Queries become permanent scheduled integrity checks.

## Phase 5 — Independent production certification (days 11–15)
### 5.0 Acceptance
1. Empty-DB unit + integration green (fix F19 first: legacy fixtures / separate history gate; close worker handles).
2. D01–D12 evidence under `docs/audit/evidence-<date>/`; invariant registry fully mapped.
3. Eight-role direct-API matrix script (admin, head, teacher assigned/unassigned, bursar, registrar, parent, student).
4. Browser lifecycle per stage (nursery + primary): setup → register → bill/pay → attend → assess → approve → publish → collect → close → promote → historical reports.
5. Head teacher signs off nursery + primary report card samples and 0.1 policies.

### 5.1 Adversarial "no developer trust" re-audit
Fresh agent, no remediation context, not given fix implementation. Prompt: *treat system as broken; ignore test names/comments/claims; reproduce each original F01–F13 failure; hunt equivalent failures via alternative routes (exports, search, history, attachments, workers, portal).* Given only original findings + running system + fictional DB. Any reproduction = back to relevant phase.

### 5.2 Fresh-build smoke
Final artifact, clean clone, fresh DB, prod Compose, prod DB roles, external device, restore drill on that artifact.

### Gate
GO only if 5.0–5.2 all pass. Then controlled pilot: one school, fictional parallel run 1 week, then live.

## Phase 6 — Post-launch P2 (weeks 4–6)
F14 portal capability/errors · F15 visual rubric editor · F16 library fines or hide · F17 role homes + nav · F18 lazy-load routes · pupil merge tool · staging upgrade drill w/ migration checksums · MoMo rework (F13) with provider sandbox D13.

## Phase 7 — P3/P4
F20 PWA manifest · parent receipts · report templates · localisation · guided setup · transport/boarding/LMS per-client acceptance.

---

## Critical files
`kernel/auth/data-scope.service.ts` · `modules/school/reporting/filter-resolver.service.ts` · `modules/school/early-years/*` · `modules/school/fees/{finance-controls,billing,billing-run,school-finance-query}.service.ts` · `modules/school/people/student-admission.service.ts` · `modules/school/attendance/student-attendance.service.ts` · `apps/web/src/pages/school/{early-years,fees-subpages}.tsx` · `docker-compose.yml`, prod overlay, `infra/docker/Dockerfile.api` · `modules/backup/backup.service.ts`.

New docs: `docs/invariants.md`, `docs/audit/authz-inventory.md`, `docs/audit/posting-inventory.md`, ADR-032.

## Verification
Per phase: targeted integration specs on real PG (`school_audit_*` DB) fail-first then pass; inventory tables complete; invariant rows mapped. Browser checks via preview (seed script first). Phase 4 via Docker + external device. Final: Phase 5.0–5.2 gate, adversarial re-audit clean.
