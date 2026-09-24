# School Management System — End-to-End Workflow Audit + Remediation Plan

## Context
The user asked for a product-level audit: can a real Ugandan nursery/primary school use this system from configuration → admissions → student → enrollment → placement → academics → finance → portal → reports? It is a read-only audit (no code changes), followed by an ordered remediation plan.

Method:
- Three parallel code traces covering foundation/RBAC/portal/docs, student lifecycle/staff/timetable, and finance/reports/jobs/tests.
- Every P0 was spot-checked by hand (evidence below).
- Build/test run on 2026-09-24.
- Integration specs were **not run**: they write to the dev DB `schooldb-planet`.

Hierarchy as implemented: Organization (= school; no `schoolId`) → AcademicYear → AcademicLevel → GradeLevel → SchoolClass → ClassCohort → Section ("Stream" label) → StudentEnrollment → EnrollmentPlacement.

---

## A. Executive summary — Overall status: **NO-GO**

**The backend is mostly sound:**
- Transactional enrollment state machine; append-only placements.
- DB backstops: one open placement per enrollment, one enrollment per student per year, one conversion per application.
- RLS forced on all org tables, plus a same-org FK trigger.
- Real invoice → receipt → journal for billing.

**The product still cannot be operated end to end:**
1. **Enrollment UI is dead.** The workspace, Student-360 "Place in class" and "Register & place" send the removed `streamId` (400 under `forbidNonWhitelisted`) or call removed `/school/enrollments*` routes (404). Nobody can place a student from the UI.
2. **Security P0s.**
   - Public tenant bootstrap.
   - `user:create` can invite a user straight into the Administrator role.
   - `GET /organizations/users` returns `passwordHash` / `pinHash` / `mfaSecret`.
   - A revoked parent falls back to "staff" and can read every pupil.
   - Teachers can read all finance data.
3. **Ledger integrity P0s.**
   - Reversed allocations still count as paid.
   - Payment reversal double-posts.
   - Reallocation moves cash in the GL.
   - Refunds of unallocated cash can repeat without limit.
   - Untargeted discounts apply to the whole school.
4. **Blocked workflows.**
   - Staff invite and forgot-password emails carry no link.
   - MFA enrolment locks the account.
   - No preset role can decide admissions, take the admission fee, refund, write off or close a period (compound-permission guard).
   - No UI links a teacher login to an employee record, so teachers cannot mark.
   - Parent notifications are never delivered.

### Build/runtime (§34)
| Command | Result |
|---|---|
| `pnpm typecheck` (recursive) | **FAIL** — the pnpm runner exits -1 with no TS errors (likely OOM from parallel tsc). Run per package, all pass: shared ✓, api ✓, web ✓ (0 errors), portal ✓ |
| `jest --selectProjects unit` (api) | 117/118 suites, 2205/2206 tests. **1 FAIL**: `test/backup/backup.service.spec.ts:127` timed out at 5 s (run under load; P3) |
| Integration (`test:integration`) | NOT RUN — needs a mutable DB. Required before sign-off |
| web/portal tests | None exist |

---

## B. End-to-end workflow matrix

| Workflow | Status | Broken at | Impact | Evidence |
|---|---|---|---|---|
| Login (staff) | PARTIAL | MFA decrypt; invite/reset email has no token; no server logout | MFA users locked out; new staff can't onboard | `auth.service.ts:34-48`, `one-time-token.service.ts:91-99`, `organizations.service.ts:192-202` |
| Login (portal) | PARTIAL | Revoked identity → staff principal | Revoked parent sees all pupils | `portal-identity.service.ts:53-63,74-90` |
| School setup | PARTIAL | USD/UTC defaults; no seeded grades/years/statuses; bootstrap public and non-transactional | Every new school built by hand; wrong currency | `organizations.controller.ts:52-56`, `organizations.service.ts:74-121` |
| Academic year | PARTIAL | Editing current year clears current term; `/current` returns PLANNING year; no lifecycle UI | School loses "current term" silently | `simple-crud.tsx:118-126`, `academic-year.service.ts:154-160`, `academic-year.controller.ts:29-35` |
| Admissions | PARTIAL | Identity matches have no UI but block enroll; fee charge needs `parentContactId` the form never sends; no CAS on status; term/year mismatch allowed; decide/fee need Admin | Siblings can't be enrolled; admission fee unchargeable from UI | `admissions.service.ts:816-826,1308-1315,801-889`; `admission-fee.service.ts:315-325` |
| Student creation | BROKEN (UI) | `POST /school/enrollments/register` (404) | Front-desk registration fails | `web/src/features/school/api.ts:1311` |
| Enrollment | BROKEN (UI) / COMPLETE (API) | `streamId` in payloads; `POST/GET /school/enrollments` 404 | No placement possible from UI | `workspace.tsx:441,653,1015,1264`; `api.ts:1359,1374`; `main.ts:235` |
| Placement / move | BROKEN (UI) | Same, plus picker crash on `options.streams` | — | `enrollment/_shared.tsx:73,133` |
| Transfer / withdraw / suspend | COMPLETE (API), BROKEN (UI) | UI route as above; suspension untested | — | `student-enrollment.service.ts:337-429` |
| Promotion / rollover | BROKEN | SUSPENDED→COMPLETED not allowed; no grade-ladder UI; UI hides per-row errors; `outcome:'skipped'` rejected | Year-end rollover silently skips learners | `enrollment-fsm.ts:90`, `promotion.tsx:155-208` |
| Staff → teacher access | BROKEN | No UI for `POST /hr/employees/:id/link-user`; suspended staff keep access | Teachers can't take register/marks | `employee-identity.service.ts:65-94`, `HrMyPage.tsx:20` |
| Curriculum / offerings | PARTIAL | No unique offering; cohorts without programme can't get offerings | Duplicate offerings break timetable | `course-offering.service.ts:128,373-380` |
| Timetable | PARTIAL | App-level advisory lock only; overrides: no clash check, no FK (cross-tenant teacher id stored) | Invalid cover entries | `academics.service.ts:533-538`, `timetable-advanced.service.ts:157-200` |
| Finance billing / collect | PARTIAL | Discounts untargeted; multi-schedule not billed; lost-update on concurrent pay; cash has no idempotency key | Over-discounting; double receipts on retry | `billing.service.ts:206-209,504-508`; `payment.service.ts:256-279`; `api.ts:1918-1934` |
| Finance reversal / refund | BROKEN | Balance ignores allocation status; double JE; reallocation posts cash; refund cap always 0 | Wrong balances, GL drift, cash leakage | `school-finance-query.service.ts:101-104,199-203,332-335,950-958`; `allocation-reversal.service.ts:140-165,281-293` |
| Parent portal | PARTIAL | Revoke fallback (P0); no terminology; hardcoded UGX | — | as above |
| Documents | BROKEN | Unsigned download URL → 400; list gated on `school:read`; delete removes bytes before soft-delete | No document can be viewed | `api.ts:5051`, `files.service.ts:185-189,225-238` |
| Notifications | BROKEN | `send()` without `userId` → SMS/email throw; null-user in-app hidden | Parents never notified | `fee-notifications.subscriber.ts:245-283`, `notifications.service.ts:131,149` |
| Reports / dashboards | PARTIAL | Outstanding excludes withdrawn; `dailyCollections` includes POS and cancelled; cash-book refunds include supplier payments; no year/term filter | Totals disagree with AR↔GL | `school-finance-query.service.ts:263-270,1271-1286`; `reporting.service.ts:292-306` |

## C. Module functionality matrix
| Module | FE | API | DB | Perms | Workflow | Tests | Status |
|---|---|---|---|---|---|---|---|
| Authentication | ✓ | MFA/reset broken | ✓ | ✓ | Partial | unit | PARTIAL |
| Users/Roles | ✓ | Legacy `/organizations/users*` unsafe | `_UserRoles` no org/RLS | Escalation hole | Partial | service-only | BROKEN (security) |
| School config | Partial terminology | ✓ | ✓ | Front Desk can edit currency/capacity | Stored, partly consumed | none | PARTIAL |
| Academic year | No lifecycle UI | Bugs in `/current`, setCurrent | No single-current index | ✓ | Partial | integration | PARTIAL |
| Students | Register 404 | ✓ | ✓ | Teacher reads all | Partial | integration | PARTIAL |
| Admissions | Many APIs no UI | ✓ (no CAS) | Loose ids | Compound gates | Partial | integration | PARTIAL |
| Enrollment/Placement | **Broken** | ✓ | Strong | ✓ | UI-blocked | integration | BROKEN (UI) |
| Staff | No link-user UI | ✓ | ✓ | ✓ | Blocked | integration | PARTIAL |
| Subjects/Curriculum | ✓ | ✓ | No offering unique | ✓ | Partial | partial | PARTIAL |
| Timetable | ✓ | ✓ | No exclusion constraint | ✓ | Partial | slot clashes only | PARTIAL |
| Finance | Stale invalidations | Reversal/refund wrong | Projections | Teacher leak | Broken on corrections | happy path only | BROKEN |
| Reports | ✓ | Source-query bugs | — | v2 ✓, v1 on `school:read` | Partial | v2 tested | PARTIAL |
| Parent Portal | ✓ | ✓ (except revoke) | ✓ | Revoke fallback | Partial | guard tests | PARTIAL |
| Documents | Download broken | ✓ | Polymorphic, no FK | `school:read` | Broken | none | BROKEN |
| Notifications/Jobs | — | Delivery broken; outbox double-claim | — | — | Broken | none | BROKEN |

## D. Role matrix (presets vs guards)
| Area | Admin | Admissions (Registrar) | Teacher | Finance (Bursar) | Parent | Student |
|---|---|---|---|---|---|---|
| Login | PARTIAL | PARTIAL | PARTIAL | PARTIAL | ALLOWED | ALLOWED |
| Students | ALLOWED | ALLOWED | UNEXPECTED ACCESS (whole school) | ALLOWED read | ALLOWED own / UNEXPECTED after revoke | ALLOWED self |
| Admissions | ALLOWED | PARTIAL (can't decide / take fee / waive) | read | DENIED | NOT IMPLEMENTED | NOT IMPLEMENTED |
| Enrollment / Placement | BROKEN (UI) | BROKEN (UI) | read | read | DENIED | DENIED |
| Staff | ALLOWED | read | read | read | DENIED | DENIED |
| Subjects / Year config | ALLOWED | UNEXPECTED (foundation:write closes years, edits currency) | read | read | DENIED | DENIED |
| Timetable | ALLOWED | UNEXPECTED (foundation:write) | ALLOWED own + reads all | read | scoped | ALLOWED self |
| Fees | ALLOWED | UNEXPECTED read | **UNEXPECTED read** | ALLOWED collect; refund/writeoff/close NOT POSSIBLE | ALLOWED own | DENIED |
| Reports | ALLOWED | ALLOWED | PARTIAL | ALLOWED | report cards | report cards |
| Documents | BROKEN download | BROKEN | UNEXPECTED list + BROKEN | UNEXPECTED list + BROKEN | ALLOWED (report cards) | ALLOWED |

---

## E. Findings register

### P0 — Blocking (12)
| ID | Finding | Evidence (verified) |
|---|---|---|
| S1 | `POST /organizations/bootstrap` is `@Public()`, has no throttle or secret, and is non-transactional | `organizations.controller.ts:52-56` ✔ |
| S2 | Invite escalation: `user:create` → any `roleId` (Administrator, even another org's) via `prisma.raw`; `inviteToken` returned to caller | `organizations.service.ts:175-203` ✔ |
| S3 | `GET /organizations/users` returns full User rows (passwordHash, pinHash, mfaSecret) | `organizations.controller.ts:101-108` ✔ |
| S4 | Revoked or unlinked portal account → `principal()` = staff → `filterAccessibleStudents` passes every id | `portal-identity.service.ts:53-63,74-90` ✔ |
| S5 | Teachers (and every staff preset) read all finance data (68 routes on `school:read`) | `permissions.ts:1094-1101`; `school-finance-query.controller.ts:16-171` |
| E1 | Enrollment workspace sends `streamId` (400) and reads `options.streams` (crash) | `workspace.tsx:441` ✔; `main.ts:235` ✔ |
| E2 | Student-360 place / history and Register & place call nonexistent `/school/enrollments`, `/school/enrollments/register` | `api.ts:1311,1359,1374` ✔ |
| F1 | Balance, statement and portal sum allocations without `status:'posted'` | `school-finance-query.service.ts:101-104,199-203,332-335` ✔ (vs `:686`) |
| F2 | Payment reversal posts per-allocation Dr AR/Cr Cash **and** reverses the receipt JE | `allocation-reversal.service.ts:146-165,281-293` |
| F3 | Reallocation posts a cash leg although no cash moved | `allocation-reversal.service.ts:140-143,223` |
| F4 | Unallocated-cash refunds are repeatable: already-refunded is always 0; entitlement read outside the tx | `school-finance-query.service.ts:942-958`; `billing.service.ts:1496,1587-1598` |
| F5 | Untargeted discount matches every pupil; fixed discount applied per fee line | `fees-operations.tsx:1094-1099`; `billing.service.ts:504-508,753-754` |

### P1 — Critical (26)
- **Auth**
  - A1: MFA readback ignores iv/tag, so the account locks.
  - A2: Forgot-password email has no link; raw token stored in `Notification.payload`.
  - A3: Staff invite has no link and there is no web `/accept-invite` / `/reset-password`.
  - A4: `PATCH /organizations/users/:id/deactivate` skips last-admin/manage guards and audit.
  - A5: `_UserRoles` has no org / RLS / FK-guard.
- **Setup**
  - C1: USD/UTC defaults.
  - C2: No runtime seeding of grades (Baby–Top, P1–P7), attendance statuses, grading scale.
  - Y1: Editing the current year clears the current term.
- **Access / Docs**
  - R1: Teachers read whole-school students / registers / statements (`ScopedToClass` unused).
  - D1: Document download URL unsigned, always 400.
  - D2: School docs gated on `school:read`.
  - P1: Compound-permission routes no preset can satisfy: admissions decide / fee pay / waive, refund, adjustment approve, write-off, period close.
- **Admissions**
  - AD1: No compare-and-set on application status.
  - AD2: Enroll term not validated against application year.
  - AD3: Identity-match review has no UI but blocks enroll.
  - AD4: Admission fee requires `parentContactId`, which the form never sends.
  - AD5: Portal magic link never emailed; raw token in body.
- **Lifecycle**
  - L1: Promotion / graduate fails for SUSPENDED; rollover UI reports success.
  - L2: No grade-ladder / academic-level UI, so rollover skips everyone.
  - T1: No UI to link User↔HrEmployee, so teachers can't act.
- **Finance**
  - F6: Refund of allocated payment fails or double-posts.
  - F7: Concurrent payments lose updates (absolute writes, no lock); same in admission-fee pay.
  - F8: Partial waiver re-appliable for full amount.
  - F9: Web cash collect sends no Idempotency-Key; admission-fee pay generates a new key each call.
  - F10: Outstanding excludes withdrawn / graduated debtors.
- **Jobs**
  - N1: Fees / attendance / admissions notifications sent without userId, so never delivered; `remind` reports sent++.

### P2 — Important (≈40, grouped)
- **Auth/RBAC:** no server logout; case-sensitive email; `role:update` rewrites held roles; system roles deletable; Front Desk `foundation:write` edits currency/capacity; tests don't cover `OrganizationsController`.
- **Config/Year:** terminology hardcoded in ~19 web pages + portal; UGX hardcoded in formatters; `/academic-years/current` wrong; closing a year leaves current term; no single-current / date-check DB constraints; closed-year guard not applied to attendance/marks/exams/fees/timetable/report cards; no lifecycle UI.
- **Admissions:** `review` accepts offer actions bypassing offer permission; name+DOB dup check has no DB index and a hard 409 with no override; register / transferIn skip dup detection; direct submit skips required-docs; guardians not editable; ~12 admission APIs with no UI; offer-expiry loop has no per-org try/catch.
- **Lifecycle:** promoting WITHDRAWN/TRANSFERRED creates an ACTIVE next-year enrollment; no cross-year single-ACTIVE rule; `outcome:'skipped'` rejected; `RolloverPlan` lacks `repeat`; Students "Add" fails for multi-section classes with a generic error; `streamId` query params silently ignored (marks, gradebook, exam results → whole class shown); `groupingMode` PATCH 400 (`programmes.tsx`); dead `/school/streams/:id/section` and `/school/enrollment-migration/*` routes still in UI.
- **Staff/Curriculum/Timetable:** suspended staff keep access; TeacherAssignment not ended on leave; no subject↔level applicability check; no offering unique index; programme-null cohorts can't get offerings; overrides have no FK / clash check; `setAvailability` upsert likely invalid; cover doesn't check substitute status.
- **Finance:** only the first schedule billed per term; skipped/unplaced pupils not reported; stuck billing-run items never retried; unvalidated nested `allocations[]` / collect-batch body; events published mid-tx in a separate outbox tx; credit creation single-approver with `any` body; stale React Query invalidations after collect/refund/waiver; billing run processed synchronously over HTTP.
- **Reports:** `dailyCollections` includes POS/cancelled; cash-book refunds include supplier payments; budget variance uses the same actual for every line; attendance buckets hardcoded; no year/term filter on v1 dashboards; class counts all-time.
- **Jobs:** outbox claim doesn't change status (double-claim across two tick paths); no max-attempts / dead-letter; `setInterval` workers reset on deploy; inactive users not skipped.
- **Docs:** delete removes bytes before soft-delete; no audit; `any` DTOs; medical category heuristic misses SchoolDoc.
- **Public site:** placeholder "Sunrise Academy" content, fake stats and dates shown publicly.

### P3 — Minor (≈20)
- Lockout counter not reset after expiry.
- `@Idempotent` on public login → 500.
- `/auth/refresh` unthrottled; stale web permissions after refresh.
- Unsigned sender `no-reply@cafe-pos.local`.
- DEMO prefill on login.
- `seed.ts` is a café tenant.
- Term CRUD not audited.
- `library.tsx` searches by `currentClassId`.
- Stale portal/statutory `currentClassId` types.
- `StudentStatus` web type stale.
- Holiday placement gap after promotion.
- Guardian re-link 500.
- TimetableVersion NULL-section duplicates.
- Random weekend `generate`.
- Offboarding always `terminated`.
- UGX in dashboard.
- Reminder-log NULL user escapes the unique index.
- Controller-level `school:read` on academic writes (service blocks them).
- Backup spec timeout.
- Recursive typecheck OOM.

**Totals: P0 12 · P1 26 · P2 ≈40 · P3 ≈20**

---

## F. Most important findings (§37)
1. **Broken E2E workflows:**
   - Admin places / moves / registers a student from the UI.
   - Year-end rollover with suspended learners or without a ladder.
   - Teacher onboarding (login ↔ employee).
   - Staff invite / password reset.
   - Payment correction (reversal / reallocation / refund).
   - Document viewing.
   - Parent notifications.
2. **Cross-module failures:**
   - Admissions → Finance: fee charge needs `parentContactId`.
   - Admissions → Enrollment: identity match with no UI; term/year mismatch.
   - Enrollment → Placement: UI contract drift.
   - Staff → User access: no link UI.
   - Payment → Accounting: reversal / refund JEs.
   - Finance → Reports: status filters and source mismatches.
   - Events → Notifications: no recipient.
3. **Appear implemented but incomplete:** discounts, refunds, reversal, notifications, terminology, closed-year protection, academic-year lifecycle, admission advanced config (cycles, capacity, criteria, waitlist, bulk).
4. **FE/BE mismatch:** `streamId` / `groupingMode` / `/school/enrollments*` / `/school/streams/*` / enrollment-migration / `outcome:'skipped'` / `RolloverPlan.repeat` / unsigned file URLs / stale invalidation keys / missing idempotency header.
5. **DB/business-rule mismatch:**
   - No constraints enforcing: single current year/term; term within year; one ACTIVE enrollment across years; offering uniqueness; timetable slot exclusion; non-negative capacity.
   - Loose ids with no FK: `AdmissionCapacity`, `WaitingList`, `parentContactId`, `TimetableOverride`, `SchoolDoc.ownerId`.
6. **Incorrect data risk:** F1–F10, AD1, Y1, L1.
7. **Cross-tenant risk:** S2 + A5 (`_UserRoles`), `TimetableOverride` ids with no FK, polymorphic document owners. Otherwise RLS + FK trigger are solid.
8. **Missing workflows:** tenant onboarding UI; academic-year close/archive UI; identity-match review; admissions config screens; link-user; online application in portal.
9. **Missing tests:**
   - No HTTP / guard-level tests except enrollment validation.
   - No web or portal tests at all.
   - No FE↔BE contract test.
   - No reversal / refund / waiver ledger assertions.
   - No suspension, rollover execute, offer-expiry, notification delivery or outbox claim tests.
   - Integration specs call services with `permissions: []`.
10. **Legacy affecting current flows:** `streamId` / `groupingMode` in web enrollment; `/school/enrollments` client; café `seed.ts`; `/organizations/users*` legacy endpoints bypassing `UsersService`.

---

## G. Remediation plan (ordered)

Each item: **files → fix → DB / API / FE → tests → regression risk.**

### Wave 1 — Security & data-integrity blockers
1. **S1 bootstrap.**
   - Files: `core/organizations.controller.ts`, `organizations.service.ts`.
   - Fix: require env `PROVISIONING_SECRET` header, or platform-admin; add `@Throttle`; wrap in `$transaction`.
   - API: 403 without secret.
   - Tests: anonymous → 403; partial failure rolls back.
   - Risk: low (scripts must pass the secret).
2. **S2 / S3 / A4 legacy user endpoints.**
   - Fix: delete `GET users`, `POST users/invite`, `PATCH users/:id/deactivate` from `OrganizationsController`; point `CompanySettingsPage.tsx:496,594` at `UsersService` routes (which already have `assertCanAssign` / `assertCanManage`, `users.service.ts:301-379`). If kept, route through `UsersService` with an explicit `select`; never return `inviteToken`.
   - Tests: IT Admin inviting with the Admin roleId → 403; list response has no `passwordHash`.
   - Risk: medium (settings page rewiring).
3. **S4 portal fallback.**
   - Files: `kernel/auth/portal-identity.service.ts`.
   - Fix: `principal()` returns `{kind:'none'}` (deny) when the user holds `school:portal:*` without a claim; `canAccessStudent` / `filterAccessibleStudents` require a staff permission for the staff pass-through. `portal-account.service.ts revoke()` also removes the portal role / deactivates when no identities remain.
   - Update `portal-identity.spec.ts:90`.
   - Tests: invite → revoke → login → other child's `/statement` → 403.
   - Risk: medium (LMS/CBT callers of `principal()`).
4. **S5 / R1 read scoping.**
   - Files: `packages/shared/src/permissions.ts`.
   - Fix:
     - Add `school:finance:read`; grant it to Bursar / Head / Admin only.
     - Re-gate all `school/fees/*` GETs, `advanced.controller.ts:198-228` and `reporting.controller.ts:22-56`.
     - Apply `ScopedToClass`, or a service-level teacher scope, to register, by-class, statement and marking reads.
   - Tests: route-permission test asserting no finance GET on `school:read`; HTTP as Teacher → 403.
   - Risk: medium (dashboards for non-finance roles).
5. **F1 balance filter.** Add `status:'posted'` at `school-finance-query.service.ts:101,199,332`.
   - Tests: collect → reverse allocation → balance = statement = clearance = aging.
   - Risk: low.
6. **F2 / F3 / F6 reversal accounting.**
   - Files: `allocation-reversal.service.ts`, `billing.service.ts:1470-1494`.
   - Fix: split modes.
     - `reallocate` → no GL leg.
     - `reverse_payment` → reverse the receipt JE only.
     - `refund` → post Dr AR/Cr Cash only for the outbound payment; return value to the source payment's unallocated amount.
   - Tests: reverse, reallocate and refund each → AR↔GL variance 0; cash unchanged on reallocate.
   - Risk: high — add golden ledger specs first.
7. **F4 refund cap.** Track `refundedAmount` (or a linked outbound allocation) on the source payment; conditional decrement inside the tx; read entitlement in-tx with `FOR UPDATE`.
   - DB: new column plus check `refunded ≤ unallocated`.
   - Tests: second refund rejected; concurrent pair → one wins.
   - Risk: medium.
8. **F5 discounts.**
   - Backend: require targeting (student / class / category) in the DTO; apply fixed discounts once per student (prorate across lines); read per-student assignment discounts.
   - FE: targeting fields on `fees-operations.tsx`.
   - Tests: untargeted create → 400; 50k fixed on a 5-line structure → 50k total.
   - Risk: medium.

### Wave 2 — Broken core workflows
9. **E1 / E2 enrollment UI.**
   - Files: `web/src/features/school/enrollment-api.ts`, `pages/school/enrollment/workspace.tsx`, `_shared.tsx`, `features/school/api.ts:1311,1359,1374`, `students.tsx`, `student-360.tsx`, `programmes.tsx`.
   - Fix:
     - Drop `streamId` / `groupingMode` / `streams` / `requiresStream`.
     - Drive the picker from `allowsSubdivision` / `requiresSection` / `sections` (`class-cohort.service.ts:66-83`).
     - Repoint to `/school/student-enrollments` and `/school/students/register`.
     - Delete the migration page, route `App.tsx:572`, and the streams/section call.
     - Map `streamId` → `sectionId` in marks, gradebook and exam-results queries.
   - Tests: contract test posting web payload shapes through the real ValidationPipe; route-inventory test diffing web client URLs against Nest routes.
   - Risk: medium.
10. **A1 / A2 / A3 / AD5 account links.**
    - Fix: MFA decrypt with iv/tag columns (`auth.service.ts:34-48`) plus admin MFA reset; build invite/reset/magic-link URLs from `WEB_URL` / `PORTAL_URL` into the email body; store a token reference, not the raw token; allow email to a recipient address without a `userId`; add web `/accept-invite` and `/reset-password` pages; add `POST /auth/logout`.
    - Tests: MFA enrol → login; reset email token accepted; logout → refresh 401.
    - Risk: low–medium.
11. **P1 compound permissions.** Either add a Finance-Officer / Accountant preset plus a Head-Teacher `admissions:write`, or split request vs approve routes (`billing.controller.ts:56`, `admissions.controller.ts:212-229,296`). Seed `SCHOOL_ROLE_PRESETS` in `seed.ts`.
    - Tests: preset matrix spec — each business action has ≥1 preset (excluding Admin) able to perform it, with SoD preserved.
    - Risk: low.
12. **T1 teacher link.**
    - FE: "Give system access / Link login" on the staff/employee page, calling `POST /hr/employees/:id/link-user` (`hr.controller.ts:270-274`).
    - Fix the misleading fallback comment in `employee-identity.service.ts:72`.
    - Tests: create staff → link → teacher marks register.
    - Risk: low.
13. **L1 / L2 promotion.**
    - Fix: allow SUSPENDED→COMPLETED in `enrollment-fsm.ts` (or lift suspension inside promotion); refuse promotion unless ACTIVE / SUSPENDED; add grade-ladder (`nextGradeLevelId` / `isTerminal`) and academic-level fields to the grade form; show `executed[].error` in `promotion.tsx`; add `repeat` to `RolloverPlan`; accept or strip `skipped`.
    - Tests: rollover execute with suspended / withdrawn learners.
    - Risk: medium.
14. **AD1–AD4 admissions.**
    - CAS `updateMany({id,status})` in `applyReview`.
    - Validate term.academicYearId in `enroll`.
    - Identity-match panel plus `decision` validation / permission.
    - Fee charge falls back to the primary guardian contact.
    - Remove offer actions from `ReviewApplicationDto`.
    - Tests: concurrent enroll / withdraw; wrong-year term → 400; UI-shape payload → charge OK.
    - Risk: low–medium.
15. **Y1 academic year.**
    - `SimpleCrud` sends `isCurrent` only on change; `update()` doesn't clear terms unless the year changes.
    - Fix `/current`; clear the term on close.
    - Add lifecycle UI (status column plus Activate / Close / Archive / Reopen).
    - Tests as listed in F.
    - Risk: low.
16. **D1 / D2 documents.** Web uses `POST /files/:id/signed-url`; school-docs gated on `school:documents:read`; delete = soft-delete first, check references, `assertMayOpen`, audit; typed DTOs.
    - Tests: download round-trip; Librarian list → 403.
    - Risk: low.
17. **N1 notifications.** Resolve guardian recipients (contact phone / email) via the communication dispatcher; DB-level dedupe key (unique index); `remind` counts real sends.
    - Tests: invoice issued → one SMS row per guardian; re-emit → no duplicate.
    - Risk: medium.

### Wave 3 — Cross-module consistency & concurrency
18. **F7 lost updates:** atomic decrement or `SELECT … FOR UPDATE` in `payment.service.ts:256-279`, `billing.service.ts:1123-1160`.
19. **F8 waiver:** `appliedAmount` column; re-apply only the remainder.
20. **F9 idempotency:** web generates one key per payment attempt and reuses it on retry (`api.ts:1918-1934,7222`).
21. **F10 / report sources:** include non-active debtors in outstanding; restrict `dailyCollections` to fee receipts that are not cancelled; cash-book refunds limited to fee refunds; fix budget actuals.
22. **Outbox:** claim sets `status='processing'`; single tick path; max attempts + dead-letter; per-handler idempotency.
23. **Events mid-tx:** publish via `tx` outbox write (`event-bus.ts:26-44`).
24. **Stale invalidations:** add `['school','finance',…]` keys to collect / refund / waiver mutations.

### Wave 4 — DB constraints (migration, one per group)
- Partial unique: single `isCurrent` AcademicYear per org; single current Term per org.
- CHECK `start < end`; trigger for term within year.
- Partial unique `StudentEnrollment(studentProfileId) WHERE status='ACTIVE'`.
- Unique CourseOffering (term, cohort, subject, COALESCE(section)).
- `btree_gist` EXCLUDE on TimetableSlot (teacher / room / class × day × period range, per version).
- CHECK capacity ≥ 0.
- FKs for `TimetableOverride.teacherPartnerId` / `subjectId`, `AdmissionCapacity.classId`, `WaitingList.classId`, `AdmissionApplication.parentContactId`.
- Add `organizationId` to user-role join (explicit model) + RLS.
- Name + DOB + year dedupe index with override flag.
- Ensure `scripts/assert-db-constraints.mjs` runs in CI.
- Regression risk: medium — run on a dev DB copy first.

### Wave 5 — Missing workflows
- Uganda defaults (UGX, Africa/Kampala) plus a seeded primary structure / statuses / grading at bootstrap.
- Admissions config screens (cycles, capacity, criteria, waitlist, bulk enroll, transfer-in, re-enroll).
- Closed-year guard on attendance / marks / exams / fees / timetable.
- Suspended-staff access check in `teaching-access.service.ts`.
- End TeacherAssignment on leave.

### Wave 6 — Tests
- HTTP-level guard tests per preset (role matrix above as a table-driven spec).
- FE↔BE contract + route inventory.
- Ledger golden specs (reverse / reallocate / refund / waiver).
- Rollover execute; suspension auto-return; offer expiry; notification delivery; outbox claim.
- Minimal Playwright smoke for web: login → place student → collect fee → view statement.

### Wave 7 — UI/API polish, reporting, UX
- Terminology via `useTerminology` in the ~19 pages + portal.
- Currency from org in formatters.
- Replace public-site placeholder content.
- Remove DEMO prefill.
- Replace café `seed.ts`.
- P3 list.

---

## H. Verification (per wave)
1. `node node_modules/typescript/bin/tsc --noEmit` per package (api / web / portal / shared). Fix recursive `pnpm typecheck` OOM (e.g. `--workspace-concurrency=1`).
2. `pnpm --filter @erp/api test` (unit).
3. `pnpm --filter @erp/api test:integration` against a **dedicated test DB** (not `schooldb-planet`), incl. new specs.
4. `pnpm lint && pnpm lint:arch`.
5. Browser pass (`preview_start` web + portal) with the Green Valley seed (`db:seed:green-valley`) walking scenario §32: configure → year → staff + link login → subject / timetable → application → offer → fee → pay → enroll / place → teacher sees class → parent sees child and fee → dashboard / report totals match AR↔GL.

---

```
AUDIT COMPLETE
Overall Status: NO-GO
Total Findings: P0 12 · P1 26 · P2 ≈40 · P3 ≈20
Broken E2E: student registration/placement (UI), year-end rollover, teacher onboarding,
  staff invite/reset, MFA, payment reversal/reallocation/refund, discounts, documents view,
  parent notifications
Top cross-module problems: Payment→Accounting (reversal/refund JEs), Enrollment UI→API
  contract, Staff→User access link, Admissions→Finance (parentContactId), Events→Notifications
Remediation order: Wave1 security+ledger → Wave2 core workflows → Wave3 consistency →
  Wave4 DB constraints → Wave5 missing workflows → Wave6 tests → Wave7 polish
Production readiness: Not ready. Backend foundations are sound; Waves 1–2 are
  the minimum before any pilot school.
```
