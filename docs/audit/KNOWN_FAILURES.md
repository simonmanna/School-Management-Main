# Known failures and deferred defects

Opened at Phase 0 of the [production readiness plan](../architecture/PRODUCTION_DELIVERY_PLAN_2026-09-03.md).
Baseline commit `6acb599`.

A required check may only be red if it appears here, with an owner and a closing phase. Nothing is removed from this file by weakening the check that produces it.

---

## 1. `report-definition-canon.spec.ts` — CLOSED

**Status:** green, 12/12. **Closed in:** Phase 9a. **Owner:** reporting.

Fixed by adding `ReportLookupService` — a canonical, calculation-free read surface on the reports deps bag — and rewriting all 27 violations across the seven files to use it. The rule was not relaxed. The same change removed the last `deps.accounting['rangeFilter']` private-method access, and folded the duplicated override→subject join out of `timetable.reports.ts` into one place.

The service deliberately performs no arithmetic: money still comes from `SchoolFinanceQueryService` and marks still come from the result spine. A lookup there must never become a second place to derive a figure an owning service already answers.

<details><summary>Original violations, for the record</summary>

The spec text-scans `apps/api/src/modules/school/reporting/definitions/*.reports.ts` for four banned tokens — `amountResidual`, `payment.amount`, `prisma.`, `GradeEntry` — after stripping comments. All seven failures are the `prisma.` rule, and all have the same shape: reaching through an injected service to its private Prisma client, usually via an `as any` cast.

| File | Violating lines |
|---|---|
| `timetable.reports.ts` | 23 (direct, uncast), 93, 141, 159, 240, 256, 364, 372, 398 |
| `finance.reports.ts` | 467, 475, 527, 540, 594, 633, 638 |
| `curriculum.reports.ts` | 50, 65, 76, 82 |
| `academics.reports.ts` | 217, 300, 318 |
| `teacher.reports.ts` | 329, 367 |
| `attendance.reports.ts` | 304 |
| `enrollment.reports.ts` | 128 |

</details>

`admissions.reports.ts`, `fees.reports.ts` and `student.reports.ts` were already clean.

**Why it matters:** these definitions re-derive figures outside the canonical query services. That is what produced the dashboard-versus-statement divergence the spec header describes. Seven failing files are not proof of seven wrong reports, but they are a live consistency risk on financial and academic numbers.

**Fix:** add public query methods to the owning services (timetable, accounting, fiscal-period, analytics, attendance, enrollment, report-card) and parity tests asserting report and owner agree. **Do not relax the rule.**

---

## 2. `rls.spec.ts` — cannot run until the app role exists

**Status:** skipped, loudly. **Closes in:** Phase 1 (DB-01/SEC-05). **Owner:** infrastructure.

The spec needs the `NOSUPERUSER NOBYPASSRLS` role created by `scripts/setup-rls-role.ts`, not merely a database. It previously keyed its skip on `DATABASE_URL`, which is present in CI — so it appeared to be covered while the `cafe-pos` role CI connects as is a superuser, for which RLS does not apply at all.

It now keys on `RLS_APP_DATABASE_URL` and prints a `[SKIPPED]` line naming the missing prerequisite. Once DB-01 provisions the role in CI, the skip disappears on its own.

---

## 3. RLS policies are inert across the entire school surface

**Status:** accepted for launch, with justification. **Revisit before:** any multi-school deployment. **Owner:** security.

`20260812120001_school_rls` and every later academic migration run `FORCE ROW LEVEL SECURITY` and `CREATE POLICY` but deliberately skip `ENABLE ROW LEVEL SECURITY`. `FORCE` without `ENABLE` is a no-op in PostgreSQL, so the policies exist in the catalogue and are never evaluated. This covers 67 school tables including `StudentProfile`, `StudentAttendance`, `Enrollment` and `FeeStructure`. The migrations state the reason: `app.org_id` is only set inside interactive transactions, so enabling RLS would reject ordinary standalone queries.

The pre-August-2026 ERP core *does* have RLS enabled; the school surface does not.

**Accepted because** the launch deployment is one school per instance, so tenant isolation is defence in depth rather than the primary control. **Not excused by that:** the tenancy-extension bypasses and the medical ownership defect, which are ordinary correctness bugs and are fixed in Phase 1 (SEC-01, SEC-02).

---

## 4. Permissions guard fail-open — CLOSED (stage 1 of 2)

**Status:** anonymous access closed; 63 handlers still lack an explicit policy. **Closes fully in:** Phase 1 completion. **Owner:** backend/security.

**The defect.** `permissions.guard.ts` returned `true` for any handler with no `@RequirePermissions` metadata, *before* the authentication check — so an undecorated route was reachable **anonymously**.

**Two corrections to the original count of 93.** The ledger over-reported, and I repeated the wrong figure in an earlier progress report:

- `route-permission-coverage.spec.ts` scanned **method-level decorators only**, while the runtime guard resolves metadata with `getAllAndOverride([handler, class])`. **13 of the 93 were class-guarded and therefore already protected** — including `AuditLogController#list` (class-gated on `auditLog.read`) and the nine `AccountingReportingController` handlers. The spec now understands class-level decorators.
- The real figure was **80**, not 93.

**What changed.**

| | Before | After |
|---|---|---|
| Undecorated + no session | allowed | **403** |
| Undecorated + session | allowed, silently | allowed, warned once per handler |
| `PERMISSIONS_FAIL_CLOSED=true` | n/a | **403** regardless of session |
| `@Public` / `@NoPermissionRequired` / `@RequirePermissions` | unchanged | unchanged |

Handlers given an explicit policy: `ApprovalsController` (4 — `decide` now needs `approvals:decide`, so deciding an approval is no longer reachable by any authenticated caller), `AuthController` (7, session-only self-service), `OrganizationsController` (2 session-only, 4 gated — `invite`, `deactivate`, `listUsers`, `updateSettings`).

`DigitalMenuPublicController` was **deliberately anonymous with no `@Public()` decorator** — its intent lived in a header comment and its enforcement was an accident of the fail-open guard. It is now explicitly `@Public()`, which is what let the default be flipped safely.

**Remaining: 63.** Mostly `documents` (19), `task` (16), `expenses` (18) and `pos-menu` (4). Task, expenses and POS are disabled in the launch scope; `documents` is in scope and is the next target. Regression coverage: `test/unit/permissions-guard-fail-closed.spec.ts` (8 tests). Set `PERMISSIONS_FAIL_CLOSED=true` once the ledger reaches zero.

---

## 5. Mobile-money collection — CLOSED

**Status:** closed 2026-09-21.

Every defect listed here is fixed and covered by `test/unit/fees-momo-and-explainer.spec.ts`
and the DB-backed `test/integration/fees-accounting-hardening.spec.ts`:

- Tenant: the callback finds its request by the globally-unique `providerRef` on
  the unscoped client, verifies the signature with that organization's
  `PaymentGatewayAccount` secret (encrypted at rest), and only then enters the
  tenant context.
- Amount/currency: the provider-reported amount is posted; a foreign currency
  goes to `needs_review` instead of posting.
- Atomicity: the request state transition and the payment commit in one
  transaction (`SchoolPaymentService.collect(dto, { tx })`).
- State machine: `pending|failed → succeeded|failed|needs_review`; `succeeded`
  and `needs_review` are terminal; the transition is a conditional update.
- Raw body: a missing raw body is refused, never re-serialised.
- Money lands in a clearing account (Dr MoMo Clearing / Cr AR); payouts post
  Dr Bank + Dr Charges / Cr Clearing.

The `ENABLE_MOMO` flag is removed; availability is per-school gateway
configuration.

Also fixed while closing this: `EncryptionService.decrypt` compared a 3-byte
prefix against the 2-byte `v1` version tag, so it rejected every ciphertext it
produced (MFA secrets, NIN reveal, LTI keys, gateway credentials). Covered by
`src/kernel/encryption/encryption.service.spec.ts`.

---

## 6. Root E2E suite is POS-only and needs a live seeded API

**Status:** not a CI gate. **Closes in:** Phase 10 (OPS-13). **Owner:** QA.

`tests/e2e/pos-sell-loop.spec.ts` is the only root E2E spec. It requires a running API, applied migrations and seeded demo data, and it exercises the POS sell loop rather than any school journey. Adding it to CI now would fail without proving anything about the school product. OPS-13 builds the school browser journeys; this suite is not a substitute for them.

---

## 7. The unit project leaks handles — Jest will not exit

**Status:** unmasked, bounded. **Closes in:** Phase 1 (no owner yet — assign with SEC work). **Owner:** backend.

Measured on the Phase 0 baseline: the unit project runs **109 suites / 2,101 tests in 114 seconds**, then Jest prints

> Jest did not exit one second after the test run has completed.

and never exits. Observed hanging for 25+ minutes with frozen CPU and a static 2.3 GB working set before being killed.

This was previously invisible because `test:integration` and `test:tenancy` passed `--forceExit`. Removing it did not create the leak; it revealed one that has presumably existed for some time. Something — a timer, a Prisma client, a Nest app, a Redis or SMTP connection — is not torn down in `afterAll`.

**Operational consequence, handled:** without `--forceExit`, a hang blocks a CI runner rather than failing it. Every job now has `timeout-minutes`, so a leak fails in bounded time with the open-handle report from `--detectOpenHandles` attached. Do not reintroduce `--forceExit` to make this go away.

---

## 8. `prisma/backfill-account-category.ts` does not exist

**Status:** cosmetic, misleading. **Closes in:** any Phase 1 cleanup. **Owner:** accounting.

`accounting/treasury/cash-register.service.ts:34` and `cash-flow.service.ts:106` both instruct an operator to run this script. There is no such file. Either restore it or correct the error messages — a runbook pointing at a missing script is worse than no instruction.

---

## 9. Seed scripts create a pre-drifted database — PARTLY CLOSED

**Status:** the two API seeds now write the canonical spine. **Remaining:** the legacy writers themselves (SIS-02..05) and `scripts/seed-school.ts`. **Owner:** SIS.

`prisma/seed-academics-phase0.ts:66` and `prisma/seed-school-demo.ts:185` write `currentClassId` directly onto `StudentProfile`, and `seed-school-demo.ts:196` creates a legacy `Enrollment`. Neither writes `AcademicProgramme`, `ClassCohort`, `StudentEnrollment` or `EnrollmentPlacement`.

So **every freshly seeded environment starts in exactly the drifted state Phase 2 exists to eliminate**: a `currentClassId` projection with no placement behind it. `CourseOfferingService.syncRoster` reads placements only, so a fresh seed yields empty rosters, and any integration test or manual QA session against seeded data exercises the legacy spine alone.

**Fixed here:** `seed-academics-phase0.ts` and `seed-school-demo.ts` now create `AcademicProgramme`, `ProgrammeGradeLevel`, `ClassCohort`, `StudentEnrollment` and a dated `EnrollmentPlacement` alongside the legacy rows. The phase-0 fixture uses three programmes so programme boundaries are genuinely exercised (a promotion must not walk a P7 learner into S1), closes the placement for the withdrawn learner rather than leaving an open one, and is re-runnable without tripping the one-open-placement partial unique index.

**Still open:** the seeds no longer *create* drift, but the legacy write paths (`enrollNewStudent`, `promoteOne`, `StudentService.create`/`bulkImport`) still do, so a running system drifts as soon as anyone admits a learner. That is SIS-02..05 and remains the keystone.

---

## Verification of the Phase 0 fixes

These were reproduced before the fix and re-checked after:

| Defect | Reproduction | After |
|---|---|---|
| Integration suites silently pass with no DB | `DATABASE_URL= jest --selectProjects integration` reported skipped passes | Suite fails: "Integration tests require DATABASE_URL" |
| `ports: []` does not clear inherited ports | Rendered staging merge published `db 5433`, `redis 6379`, `api 3000`, `web 5173`, `portal 5175` on all interfaces | `!reset` applied; db and redis publish nothing, the rest are loopback-only |
| No port policy check existed | — | `scripts/assert-compose-ports.mjs` exits 1 on the base file, 0 on staging and prod |

Project split, measured after the change:

| Project | Suites | Result |
|---|---|---|
| `unit` | 109 collected, 0 integration specs leaking in | **108 passed, 1 failed** — 2,094 tests passed, 7 failed, all seven in `report-definition-canon.spec.ts` (item 1 above). No regression from the Phase 0 changes. |
| `integration` | 59 collected (56 under `test/integration` plus the 3 DB-backed specs that live in `src/kernel`) | Not run locally — no database on the development host. CI is the first execution. |

**Not verified locally:** the Dockerfile fix (OPS-01). Docker Desktop was not running on the development host, so the image build and boot assertions have only been reasoned about, not executed. The `image` job in CI is what proves them — treat OPS-01 as unconfirmed until that job passes once.
