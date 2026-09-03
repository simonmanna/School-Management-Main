# School Management System — production delivery plan

Prepared **3 September 2026** against commit **`6acb599`**.

Read with [the system review and findings register](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/docs/audit/SYSTEM_PRODUCTION_REVIEW_2026-09-03.md). This is a new release roadmap, not a restatement of the repository's earlier “Academics Phase 0–8” implementation labels. Those changes are existing assets; this plan closes their integration, correctness and operational acceptance gaps.

## T. Phase-by-phase development roadmap

### Delivery approach and scope

Launch a coherent core: school/programme setup, student and guardian records, admissions and annual enrollment, teaching allocation, attendance, ordinary assignments/assessments, certified result/report generation, controlled fees/receipts/reconciliation, role-specific portals, essential reporting and recoverable operations.

HR master data may be included when identity and access controls pass. **Payroll and live provider collection require separate certification.** If they are excluded, disable their backend commands, permissions and UI. Retain a controlled bank/mobile-money statement-import process only after that process passes finance tests. Advanced LMS/LTI, manufacturing/rentals and optional school services should not consume the core release's critical path without an explicit school requirement.

Retain the modular monolith, PostgreSQL, shared posting/payment services, annual enrollment model and assessment core. Prefer small domain changes over broad table renaming or a new universal Person model. Financial and academic rule changes require: document old rule → describe defect → agree new rule → identify affected data/readers → define migration → regression test → implementation → school sign-off.

### Planning assumptions and estimate

Budget approximately **12–18 calendar weeks for the core release including a 2–4 week controlled pilot**, assuming three experienced engineers, a QA owner, part-time infrastructure support and regular access to a registrar, teacher/exams officer and accountant. This is a planning range, not a delivery promise. Re-estimate after Phase 0; test-harness repair, live data quality and integration defects can dominate the schedule.

Full payroll certification or substantial optional-module delivery may add **3–6 weeks** unless separately staffed. A single developer should plan in months, approximately **5–8 months** for this breadth with the same evidence gates. Avoid calculating progress from the number of screens or committed phases.

The phases overlap only when their interfaces and owners are clear. Security and operations begin immediately. Finance can proceed alongside teaching/results once the annual enrollment contract is fixed. UX/reporting work should be delivered within each domain phase and consolidated in Phase 9.

| Phase | Planning effort / elapsed window | Accountable owner | Outcome | Depends on |
|---|---|---|---|---|
| 0. Baseline and release scope | 3–5 working days | Tech lead + QA | Reproducible evidence, prioritized scope and defects | None |
| 1. Security and runtime boundary | 1–2 weeks | Backend/security + infrastructure | Safe tenant execution and deployable restricted runtime | 0 |
| 2. Annual enrollment ownership | 1–2 weeks | SIS/backend + registrar | One writer for membership and placement | 0; tested under 1 |
| 3. Admissions completion | About 1 week | SIS/product + registrar | Applicant becomes a usable annual enrollment | 2 |
| 4. Teaching, curriculum and attendance | 1–2 weeks | Academic team + teachers | One teaching context and historical roster model | 2 |
| 5. Assessments and reproducible reports | 1–2 weeks | Academic team + exams officer | Correct, explainable and immutable issued results | 4 |
| 6. Fees certification | 2–3 weeks | Finance/backend + accountant | Safe billing/collection/reversal/reconciliation | 1, 2; parallel with 4–5 |
| 7. HR identity and lifecycle | About 1 week | HR/backend + HR owner | Consistent employee/teacher identity and offboarding | 1, 2 |
| 8. Payroll certification — optional launch track | 2–3 weeks | Payroll/finance + accountant | Correct approved payroll and instrument balances | 6, 7 |
| 9. Role workflows and report consistency | 1–2 weeks, much delivered earlier | Frontend/product + QA | Simple daily workspaces and matching outputs | Relevant domain phases |
| 10. Migration, performance and recovery | 1–2 weeks | QA/data + infrastructure | Signed migrated data and proven operations | 1–7, 9; 8 if enabled |
| 11. Controlled pilot | 2–4 weeks minimum observation | School sponsor + release lead | Real use with daily reconciliation | 10 |
| 12. Rollout and controlled retirement | About 1 week rollout; retirement after a term | Release lead + school | Supported adoption and removal of old writers | 11 |

Durations are not additive because separate owners can work concurrently. Business acceptance dependencies must not be bypassed to preserve a target date.

### Phase 0 — establish the release baseline

**Scope:** capture exact SHA, lockfile, tool versions, feature flags and first-school launch scope. Reproduce current failures. Repair safe test classification and CI selection. Record a decision owner for each P0/P1 issue. Do not start a blanket rewrite.

**Likely files/modules:** [root scripts](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/package.json), [API scripts/Jest configuration](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/package.json), [CI](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/.github/workflows/ci.yml), [integration harness](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/test/integration/_setup.ts), [API TypeScript configuration](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/tsconfig.json), release documentation.

**Database:** provision a disposable PostgreSQL instance and separate migrator/application test roles. No production data edits. Run all current migrations from empty and an approved sanitized representative snapshot.

**API/UI:** document which endpoints and screens are launch-supported, legacy read-only, disabled or deferred. Make environment/build flags consistent. No business calculation changes in this phase.

**Migration requirements:** inventory current migration state and manual SQL differences. Preserve applied migrations. Record preflight queries, expected extensions and required seed/catalogue data.

**Tests:** default typecheck, architecture boundaries, lint, unit suite, full enabled-domain integration selection, image builds and smoke boot. Split database-using tests from pure unit gates and fail explicitly if a required integration database is missing.

**Acceptance:** source builds/typechecks with a documented CI resource budget; no unexplained failing required tests; CI cannot silently skip core finance/admissions suites; images are tied to one SHA; migration drift is understood; launch scope and ownership signed. If the API needs more compiler heap, measure and document it, then investigate generated-type/service complexity. Do not call heap exhaustion a proven application memory leak.

**Dependencies/risks:** no prior phase. Hidden dependency/test drift and Windows compiler memory use may expand this phase. A tag alone does not make a release safe.

### Phase 1 — fix security and runtime execution

**Scope:** close P0-01/02/09. Define safe tenant discovery for login, signed downloads and payment callbacks; tenant-bound application queries; sensitive record/file authorization; privileged MFA and key/session handling. Harden the actual production network and final image.

**Likely files/modules:** [Prisma service](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/kernel/prisma/prisma.service.ts), [tenancy extension](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/kernel/prisma/tenancy.extension.ts), [auth](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/kernel/auth), [files](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/kernel/files), [encryption](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/kernel/encryption), [medical service](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/people/medical-record.service.ts), Compose files and [Docker runtime](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/infra/docker/Dockerfile.api).

**Database:** application role is not superuser/BYPASSRLS; migrator is separate. Repair scoped create/upsert/nested-write ownership. Add critical same-organization constraints after checking existing mismatches. Keep restricted system lookups separate from unrestricted business access. Add versioned encryption-key identifiers and provider request lookup keys if needed.

**API:** introduce a tested tenant unit-of-work/query strategy for standalone reads, transaction variants and jobs. Never set tenant context from an unsigned request body. Make sensitive file access pass through owner authorization. Separate medical permission from general school read.

**UI:** privileged MFA setup/recovery, reliable session expiry, shared-device logout and explicit permission-denied states. If adopting refresh cookies, configure CORS/CSRF and origins coherently rather than changing storage alone.

**Migration:** audit wrongly stamped medical/related records and repair through a reviewed mapping. Re-encrypt with key versioning; retain old decryption capability until migration and restore are proven. Migrate role grants deliberately; do not silently grant new sensitive powers to existing roles.

**Tests:** two-tenant create/read/update/delete and relation attacks; same-school owner/field denial; raw/batch/interactive operations; unauthenticated system lookups; connection-pool reuse; worker tenant switching; MFA enrollment/login/recovery/replay; revoked users and portal relationships; signed URL ownership. Render Compose and assert no internal public ports.

**Acceptance:** positive authorized flows and negative isolation cases pass using the production app role; API boots without RLS bypass; only intended HTTPS bindings; no medical cross-organization writes; JWT rotation does not destroy encrypted data; app image contains its functioning Prisma client.

**Dependencies/risks:** Phase 0. Avoid holding external provider or slow report work inside broad request transactions. Switching RLS on before fixing query context can make ordinary reads fail.

### Phase 2 — make annual enrollment authoritative

**Scope:** close P0-03 at the domain boundary. Keep existing AcademicProgramme/ClassCohort/StudentEnrollment/EnrollmentPlacement. Unify all new-student, existing-student, transfer, re-entry, withdrawal, suspension, promotion and repeat writes. Define one capacity policy across paths.

**Likely files/modules:** [canonical enrollment](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/enrollment), [legacy enrollment](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/people/enrollment.service.ts), [legacy promotion](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/people/promotion.service.ts), [admissions](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/admissions), [enrollment UI](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/web/src/pages/school/enrollment), [schema/migrations](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/prisma/schema.prisma).

**Database:** retain annual uniqueness and placement exclusion constraints. Add explicit legacy-to-canonical/application mapping and enforce tenant/year/programme/cohort relations. Add seat reservation/override evidence only where current capacity structures cannot express the agreed policy.

**API:** canonical commands accept an existing transaction; old routes delegate or become read-only. Term opening preserves grade; promotion/repeat require target year and programme. Return canonical enrollment/placement IDs. Backfill is a migration tool, not an everyday synchronization job.

**UI:** one membership/placement workspace with dated moves, preview, history and clear distinction between term rollover and promotion. Hide unused grouping axes; require a reason and appropriate authority for capacity override.

**Migration:** dry-run existing backfill; reconcile every term row into annual membership/placement; quarantine ambiguities; preserve mapping IDs and source evidence. Cut over writes before readers. Keep profile current-class values as a projection only.

**Tests:** admissions/quick registration/import all create the same annual result; final-seat race; move at a boundary instant; no overlapping placement; repeat same grade next year; P7/S4/S6 exit decisions; transfer/re-entry; duplicate request; withdrawal and roster reconciliation; old API cannot bypass new rules.

**Acceptance:** every active learner has a valid membership and applicable placement or an explicitly permitted pending state; zero unexplained legacy/canonical differences; no post-cutover writer independently edits current placement. A registrar can reconstruct class membership for any historical date.

**Dependencies/risks:** Phase 0; security tests under Phase 1. Unmapped grade names, simultaneous primary/secondary policies and ambiguous historic dates need school decisions, not guessed data.

### Phase 3 — finish applicant-to-student workflow

**Scope:** retain admission cycles, configurable stages, structured guardians, documents, offers and decision records. Complete the end-to-end handoff into Phase 2 and consolidate operational UI.

**Likely files/modules:** [admissions backend](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/admissions), [admissions page](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/web/src/pages/school/admissions.tsx), [applications page](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/web/src/pages/school/applications.tsx), canonical enrollment and document/notification interfaces.

**Database:** strengthen application/cycle/person matching keys only after duplicate review. Preserve frozen workflow, offer version, decision actor and seat evidence. Avoid adding a separate Applicant/Person aggregate unless identity reuse cannot be represented safely with existing records.

**API:** server-derived readiness and next action; exact idempotent replay outcome; verified existing-student linking for re-admission; versioned decision/offer changes; scoped attachment verification. Mandatory business records share the enrollment transaction. Invitations/communications dispatch after commit through the outbox.

**UI:** one application register and detail, role-specific review/decision queue, requirements checklist, fees tab, offer/expiry, capacity and complete timeline. Bulk enroll previews and records per-application outcomes; one failed application must be obvious.

**Migration:** reconcile guardians/sibling links, applications already marked enrolled without annual membership, unmatched documents and application-fee links. Preserve prior decisions; corrections are appended.

**Tests:** simple/standard/selective workflow, incomplete/rejected/withdrawn/waitlisted cases, expired offer, duplicate names/phones, returning learner, double fee reference, last-seat race, request timeout/retry, guardian portal ownership and failed notification after successful enrollment.

**Acceptance:** a new applicant becomes a visible learner in the intended annual cohort/course roster without a manual repair step. Counts agree between funnel, enrollment and capacity. No duplicate student/fee charge on retry.

**Dependencies/risks:** Phase 2. Configurable stages must not turn into permission-free bypasses. Capacity and admission fee-waiver policy need named school owners.

### Phase 4 — complete curriculum, teaching and attendance integration

**Scope:** retain CourseOffering, curriculum versions, schemes of work, lesson plans and delivery models. Retire the remaining independent lesson execution writers; align rosters and attendance with dated membership.

**Likely files/modules:** [course offerings](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/course-offerings), [academics](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/academics), [LMS/legacy execution](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/lms), teaching/attendance services and corresponding school pages.

**Database:** offering identity and contextual constraints; effective teacher/membership episodes where repeat assignments need preserved intervals; published curriculum versions; scheduled lesson identity and single applicable delivery. Do not create a second CourseOffering or duplicate curriculum version system.

**API:** one course-context validator; readiness-gated publication; teacher assignment changes independent of offering identity; membership sync with explicit withdrawals/opt-outs; idempotent lesson start/complete/cancel; owned attendance commands for the correct date and roster.

**UI:** teacher Today/My classes, curriculum/course preparation, scheme/lesson workflow, scheduled occurrence and attendance. One screen should connect the class/course, learner list and the lesson being taught. Cover-teacher actions show their effective scope.

**Migration:** map legacy teacher assignments/timetable slots/plans to offerings; reconcile unmapped lessons and memberships; retain historical evidence. Use explicit exception queues rather than inventing arbitrary offering links.

**Tests:** teacher replacement, elective withdrawal/re-entry, late admission, withdrawn learner in historical attendance, wrong-year context, room/teacher/time clash under concurrency, lesson cancellation/retry, daily versus period registers and poor-network draft recovery.

**Acceptance:** every operational lesson/assessment has an authorized offering context; teachers can complete a teaching day without selecting conflicting class/subject/year IDs; historical rosters remain accurate after moves. Course identity survives a teacher change.

**Dependencies/risks:** Phase 2. Simple default grouping is essential for primary users; flexible offerings must not permit context-free subject exams.

### Phase 5 — certify assessments and historical reports

**Scope:** close P0-06 and assessment configuration/legacy gaps. Keep Assessment/StudentAssessment/MarkEntry, deterministic result computation and frozen rosters. Complete issued-document immutability.

**Likely files/modules:** [assessment](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/assessment), [report document service](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/examinations/report-document.service.ts), [report PDF](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/examinations/report-card-pdf.service.ts), [report-card generation](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/examinations/examinations.service.ts), examination/statutory services, assessment/results/report UI.

**Database:** configurable assessment types mapped to engine behavior; pinned result revision and full render snapshot; per-revision source/checksum constraints; preserved attempts/adjustments. Extend existing ReportDocument instead of creating a third report store.

**API:** generate by exact result-set ID and template version, never implicit latest when a revision was selected. Separate activity publication, mark release and report publication. Require reason/independent authorization for corrections; return immutable old and successor records. Reports read frozen identity, attendance, comments and settings.

**UI:** unified assessment board by course and type, clear draft/submitted/approved/released states, unresolved participation queue, weighting/grade explanation, missing-marks readiness and versioned report preview. Exam logistics retain a specialized workspace.

**Migration:** reconcile legacy GradeEntry/homework submissions and grade provenance; retain originals and exception reasons. Label historical reports without adequate snapshots as legacy evidence; do not manufacture certainty. Capture available issued PDFs and checksum before changing renderer behavior.

**Tests:** zero/absent/missing/exempt/late/resubmitted states; boundary rounding/weights; no self-approval; same-version concurrent marks; post-publication edit denial; generate an older selected published revision; reprint after promotion, attendance/configuration/logo changes; approved correction produces successor only. Check both primary and secondary policies.

**Acceptance:** every printed/portal figure traces to the selected result revision; issued documents do not change after current data changes; all legacy mutation paths are delegated/blocked; marks and result gates pass real database and browser tests. Academic officers approve policy examples and national export fixtures.

**Dependencies/risks:** Phase 4. Existing report regeneration restrictions must be reconciled with amendment/reissue rules. No silent change in grading or official historical marks.

### Phase 6 — certify fees, payments and reconciliation

**Scope:** close P0-04/05 and finance-related P1 issues. Preserve the common accounting engine. Certify core cash/bank collection separately from optional live provider integration.

**Likely files/modules:** [fees](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/fees), [shared payments](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/invoicing/payment), [accounting posting](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/accounting/posting), fee/receipt/statement UI and provider adapters.

**Database:** snapshot billing audience and pricing inputs; strengthen billing-run idempotency and leased items; durable provider-event inbox/reference uniqueness; settlement attempts and reconciliation evidence. Preserve existing payment/allocation/credit/GL identities. Add family payment allocations only if needed for launch.

**API:** one billing preview/commit contract bound to term/enrollment/fee version; online idempotent payment collection with outcome lookup; safe allocate/reverse/refund commands; independent relief approval; invoice/account locks or compare-and-set where needed; retryable job claims. Authenticate and tenant-resolve provider events, validate amount/currency/reference and poll unresolved outcomes.

**UI:** collect-payment workflow with learner/family lookup, allocation preview, outstanding and available-credit distinction, durable receipt/status, reprint audit, import exceptions, cash close and reconciliation. Failed/unknown callbacks must be actionable, not indistinguishable from unpaid requests.

**Migration:** source-by-source opening balance import; independent GL/subledger reconciliation; repair historical cached-field drift using approved economic corrections. Quarantine duplicate provider references and unexplained credits. Dry-run historical billing-audience differences; do not reprice posted invoices.

**Tests:** full/partial/overpayment, waiver/scholarship/discount/credit/refund, two collectors, two allocations, refund versus credit application, duplicate import/callback, changed idempotency payload, closed period, GL failure rollback, historical billing after movement, crash after commit and billing worker restart. Provider sandbox tests must follow its real contract rather than homemade callback examples alone.

**Acceptance:** zero unexplained AR/GL and credit-liability differences; receipts/cash/settlement reconcile; no duplicate posting on retry; bills refer to the right term audience; recoverable interrupted jobs; accountant signs end-to-end examples and opening totals. Live provider collection stays disabled until its separate success/failure/lost-callback certification passes.

**Dependencies/risks:** Phases 1 and 2. Provider credentials/onboarding, poor opening data and policy decisions on unallocated funds may delay live payments without blocking a certified cash/bank workflow.

### Phase 7 — consolidate HR identity and employment lifecycle

**Scope:** retain HrEmployee, Partner and StaffProfile as linked roles with one ownership contract. Complete staff onboarding, contract/leave/document history and offboarding. Payroll remains gated separately.

**Likely files/modules:** [HR](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/hr), [employee identity](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/kernel/auth/employee-identity.service.ts), [school staff](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/people/staff.service.ts), user administration and HR/teacher self-service pages.

**Database:** define unique employee↔partner↔staff↔user links as applicable; effective employment/contract/position history; sensitive field classifications. Separate academic subject groups from HR departments unless they truly share a lifecycle.

**API:** one coordinated onboarding/linking command; field ownership/validation; approved salary/bank changes; terminate/suspend access and future teaching assignments consistently; keep historical attribution. Do not automatically grant admin access from a staff/class assignment.

**UI:** employee record with employment, documents, leave and teaching assignment links; clear unlinked/conflicting identity queue; own-record self-service; restricted compensation panels.

**Migration:** reviewed identity matching, no automatic merges on names; resolve orphan users/staff/employees; preserve external IDs and employment dates. Reconcile active staff versus active accounts and effective course assignments.

**Tests:** teacher without payroll, non-teaching employee, renamed/re-hired employee, double identity link, leave dates, contract expiry, termination and session revocation, self-only payslip/leave access and another employee's bank details denial.

**Acceptance:** one resolvable caller identity; no unexplained duplicate/unlinked active teaching accounts; offboarding immediately removes operational access while preserving historical records; HR owner approves field ownership.

**Dependencies/risks:** Phases 1–2. A physical staff-table merge would create unnecessary risk across teaching FKs; prefer validated bridging first.

### Phase 8 — payroll certification, if enabled

**Scope:** close P0-07/08. Correct loan/advance repayment allocation, maker-checker, deduction classification and statutory snapshot behavior. Do not combine this with a general HR screen refresh.

**Likely files/modules:** [payroll service](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/hr/hr-payroll.service.ts), [HR controller](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/hr/hr.controller.ts), payroll schema, shared GL/payment interfaces, payroll roles and approval UI.

**Database:** per-run/per-item/per-instrument repayment allocations; source calculation version; salary/tax/contribution snapshots; immutable approved run revisions; approval actors and attempts; deduction-specific account mappings. Backfill only from reliable per-instrument evidence.

**API:** prepare → calculate → review → independent approve → post/pay → close; actor separation checked in the service. Apply each loan/advance allocation exactly once under lock/version. Reversal uses the same recorded allocations and journal references. Prevent recalculation racing approval.

**UI:** variance/exception review, employee and control totals, separate approval queue, payment status and statutory reports. Explain missing configuration; no silent zero tax when a mandatory table is absent.

**Migration:** detect historical employees with multiple simultaneous loans/advances; independently reconcile principal, payslip deductions and GL. Correct through reviewed adjustment batches; do not overwrite balances just to match a new calculation. Version and retain statutory settings.

**Tests:** two loans/two advances, partial final installment, insufficient net pay, capped recovery, concurrent calculate/approve, repeat approval, full reversal, deduction payable mapping, employer contributions, monthly/year boundary, resident/non-resident/secondary employment and approved statutory examples.

**Acceptance:** deductions on payslip = applied instrument allocations = correct GL movement; journal/payable totals match payroll and settlement; preparer cannot self-approve; official tax/contribution examples signed by accountant; historical exceptions resolved. At least one complete shadow payroll cycle passes before live posting.

**Dependencies/risks:** Phases 6–7. Statutory interpretation and historical data can extend the phase. Core school rollout can exclude payroll until complete.

### Phase 9 — consolidate role workspaces and report contracts

**Scope:** close report-definition violations, duplicated operational navigation and practical workflow gaps. Much of this work ships with Phases 3–8; this phase certifies the combined experience.

**Likely files/modules:** [admin navigation](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/web/src/components/layout/app-shell.tsx), [routes](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/web/src/App.tsx), [portal](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/portal/src), [report definitions](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/reporting/definitions), canonical domain query services and shared role presets.

**Database:** no new transaction tables merely for dashboards. Add measured query indexes/read models only where needed; preserve source IDs, as-of dates and revisions. Store role/workspace preference only when useful.

**API:** canonical query methods for the seven violating report files; consistent financial/academic response semantics; pagination and export authorization; same permission source across guards/services. Keep old read routes as adapters during transition.

**UI:** teacher Today, registrar queue, bursar collection, head approvals, HR people and child-focused portals. Consolidate duplicate Applications/Admissions operator lists. Configuration and migration tools stay out of daily role navigation. Provide empty/loading/error/permission/conflict and offline-draft states, keyboard access and print layouts.

**Migration:** map old bookmarks/routes, role grants and saved filters; redirect retired screens to their equivalent workflow with context preserved. Do not silently remove a task users still need.

**Tests:** report canonical-contract suite, source/API/export/portal parity, same-school and cross-school denial, smartphone/keyboard flows, duplicate click, timeout recovery, unsaved-draft behavior and A4/receipt output. Observe representative school users without prompting every action.

**Acceptance:** seven report canon failures resolved; reports never recalculate private financial truth; each role can complete critical tasks without admin privileges or a spreadsheet workaround; no enabled broken links or ambiguous state labels; agreed mobile/print acceptance passes.

**Dependencies/risks:** domain phases relevant to each workflow. Menu consolidation must follow ownership decisions; cosmetic simplification alone cannot repair conflicting backends.

### Phase 10 — migration, load, recovery and release rehearsal

**Scope:** prove the actual release with realistic data, actual database role and final images. Complete privacy/governance responsibilities, operational alerts and support procedures.

**Likely files/modules:** [migration/seed tooling](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/prisma), [operational runbooks](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/docs/operations), [deployment](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/deployment), [infrastructure](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/infra), CI and new school browser/load test tooling.

**Database:** production-like sanitized dataset and a fresh school setup; indexes justified by query plans; verified backups/PITR as required; isolated restore target. No unexplained migration drift or constraint exceptions.

**API/UI:** measured concurrency, pagination and slow-job progress; accurate failure/unknown outcomes; liveness/readiness, graceful shutdown and tested alerts. Only optimize demonstrated bottlenecks; do not introduce microservices as a substitute for query fixes.

**Migration:** two rehearsals: empty install and upgrade/import. Produce source/mapped/created/updated/rejected counts, duplicate candidates, identity/placement/mark control totals, opening AR/credit/GL totals and file manifest/checksums. School owners sign totals and exception disposition. Capture a final delta plan and write-freeze procedure.

**Tests:** 1,000 learners/100 teachers/20 admins with realistic peak operations; slow/interrupted network; worker crash/restart; actual-image startup; apply migrations; restore database + uploads + keys; rerender an issued report; replay known payment/mark outcomes without duplication. Check off-host backup age and retention.

**Acceptance:** no unexplained data/reconciliation differences; agreed p95 latency and error thresholds met; proposed RPO ≤15 minutes and RTO ≤4 hours demonstrated or explicitly revised by the school before launch; alerts reach named operators; school UAT and privacy responsibilities signed.

**Dependencies/risks:** all enabled phases. Data quality, upload storage size, network reliability and backup bandwidth are material schedule risks. A successful `pg_dump` is not a successful restore.

### Phase 11 — controlled pilot

**Scope:** one campus, a limited cohort, named registrar/accountant, a few teachers and invited guardians. Enable only certified modules. Operate in parallel with the existing records under an explicit source-of-authority agreement.

**Likely files/modules:** [pilot runbook](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/docs/operations/ACADEMICS_PILOT_ROLLOUT.md), release flags/roles, data reconciliation tooling, monitoring and user quick guides. Any defect fix follows its owning module's regression path.

**Database:** controlled launch data and backup; no experimental schema changes. Preserve transaction references and daily reconciliation snapshots. Synthetic tests do not run in the live organization.

**API/UI:** real role accounts and approved workflows; visible support/escalation route. Enable users by cohort; keep unavailable features explicitly disabled. Collect task completion times and errors, not only satisfaction comments.

**Migration:** final reconciled import plus controlled daily deltas if records remain in parallel. Designate who enters each real transaction and how the other system receives it. Parallel operation must not charge parents twice.

**Tests/acceptance:** see the staged pilot and daily gates below. Include admissions, attendance, one complete assessment/report cycle and limited certified finance; payroll needs a separate complete shadow cycle if included. Zero unresolved P0, daily control totals reconcile, restore/rollback readiness intact and school owners approve expansion.

**Dependencies/risks:** Phase 10. A two-week period without an assessment close or reconciliation cycle is not sufficient evidence merely because time elapsed.

### Phase 12 — full rollout, support and legacy retirement

**Scope:** expand by class/campus/role, monitor daily and complete one school term before deleting compatibility structures. Retire old write routes as soon as their supported adapters are proven; retain historical read evidence.

**Likely files/modules:** release manifests/CI, role provisioning, [legacy people routes](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/people), [legacy LMS routes](C:/Users/Simon/OneDrive/Documents/GitHub/School-Management/apps/api/src/modules/school/lms), deprecated UI routes, migration mappings and operational documentation.

**Database:** additive final constraints after reconciliation. Remove old structures only through a separately reviewed archival/retirement migration with backup and dependency inventory. No destructive cleanup during first-week hypercare.

**API/UI:** roll out certified roles/features; preserve redirects/read compatibility where practical; monitor old endpoint usage and eliminate remaining independent writers. Provide in-product guidance and trained school champions.

**Migration:** cutover checklist records SHA, image digest, schema version, data totals, user grants, freeze window and restore point. Code rollback requires schema compatibility; after real transactions begin prefer forward correction or an explicitly reconciled restore/replay procedure.

**Tests/acceptance:** smoke every critical role after expansion; daily finance/enrollment checks; term-end results/fees close; next-year progression rehearsal. Retire a legacy store only after no active writer/reader dependency, successful historical comparison, approved retention and one successful school term.

**Dependencies/risks:** Phase 11. Restoring a database without replaying post-backup receipts/marks can lose legitimate work. There must be a manual-continuity ledger and clear incident ownership.

### First sprint: concrete work queue

| Ticket | Deliverable | Owner | Completion evidence |
|---|---|---|---|
| REL-01 | Baseline SHA, flags, tool/runtime matrix and launch exclusions | Tech lead | Signed scope; reproducible commands and CI artifact. |
| QA-01 | Pure-unit versus DB-test separation and disposable DB bootstrap | QA/backend | Required suites cannot silently skip or use ambient school credentials. |
| REL-02 | Resolve/document API compiler memory requirement | Backend lead | Default documented CI typecheck succeeds; memory observation recorded. |
| OPS-01 | Fix and assert effective Compose port mappings | Infrastructure | Rendered JSON exposes only approved bindings. |
| SEC-01 | Tenant query/transaction design and restricted-role tests | Backend/security | Positive and two-tenant negative tests for all query forms. |
| SEC-02 | Fix medical tenant derivation and scoped-create conflicts | Backend/security | Two-school medical create/update regressions. |
| SIS-01 | Canonical enrollment adapter design and failing handoff regression | SIS/backend | Applicant enrollment must create annual membership and a usable roster. |
| ACD-01 | Exact report-revision and historical-reprint regressions | Academic/backend | Old revision and post-promotion/config-change cases reproduce P0-06. |
| FIN-01 | Historical billing-audience regression and finance gate inventory | Finance/backend | Billing selected term after class movement cannot use current placement. |
| PAY-01 | Multiple-loan/advance repayment regression; disable uncertified payroll | Payroll/backend | 50k + 30k example changes total principal by 80k, never 160k. |
| INT-01 | Public callback tenant-resolution test and provider contract checklist | Integrations | Callback settles without a staff JWT; actual provider recovery path specified. |
| RPT-01 | Public query contracts for seven report definition violations | Domain owners | Contract suite green without relaxing its prohibition. |

This is a sequenced queue, not an instruction to open twelve simultaneous broad refactors. Start with runtime/test safety, write minimal reproductions, then change one domain boundary at a time.

### Migration control contract for every phase

Every migration deliverable includes a dry run, deterministic mapping, rerun behavior, source version/hash, row counts, errors, business control totals, owner approval and rollback/forward-recovery procedure. Record exact source IDs; never use names as sole identifiers.

Keep an explicit compatibility matrix: canonical writer, old writer status, readers not yet migrated, reconciliation query, cutover gate and retirement date. No phase is complete while a newly created business fact requires a recurring manual backfill to become visible elsewhere.

Opening financial balances must reconcile to the chosen GL treatment. Historical report imports should preserve issued PDFs and label unavailable provenance. Never synthesize transactional certainty from a spreadsheet total. Backups must include files and encryption material, not only tables.

## U. Production pilot plan

The observation window starts only after entry criteria pass. Use a primary and a secondary cohort if the target school is combined; include a transfer, a scholarship/waiver and an ordinary unpaid account. Do not invite all parents at once.

| Stage | Who / environment | Required exit criteria |
|---|---|---|
| 1. Internal development validation | Engineering/QA, synthetic school | Build/CI/migrations green; all P0 reproductions fixed; two-tenant isolation; coherent end-to-end journeys. |
| 2. School administrator UAT | Registrar/head/HR in protected staging | Configure programme/year/classes; enroll/move/withdraw/re-enter correctly; school approves counts, roles and naming. |
| 3. Controlled teacher UAT | A few class/subject teachers | Complete attendance, lesson, assignment, marks, moderation and immutable report; no other-teacher access; slow-network recovery works. |
| 4. Finance UAT | Accountant + independent approver | Billing/payment/waiver/credit/refund/close examples reconcile to GL; duplicate/race/recovery scenarios pass; opening balances signed. |
| 5. Parallel operation | One campus/cohort, reconciled copies | Named authority for every transaction; daily differences zero or explicitly explained; no duplicate external collections. |
| 6. Pilot production | Limited real users/data, hypercare | At least 10 consecutive school days without P0 and with daily reconciliation, plus completed admission/assessment/finance cycles. Extend if cycle evidence is missing. |
| 7. Full production expansion | Cohort-by-cohort rollout | Written school/finance/academic/security/operations approval, trained users, working support and recovery; no unresolved launch-scope P0. |

### Daily pilot reconciliation

- Enrollment counts by year/class/group, admissions enrolled versus annual membership, active placement and roster exceptions.
- Billing documents, receipt count/value, allocations, unallocated amounts, credits/refunds, cashier expected/count, bank/MoMo settlement and AR/GL variance.
- Attendance expected/present/absent/unentered, pending offline drafts and conflicting submissions.
- Assessment audience, submitted/approved/released marks, missing outcomes, report revision and portal/PDF parity.
- Failed/leased/stuck jobs, error rate/latency, backup age, disk health, access incidents and unresolved support requests.

Each difference has owner, severity, amount/count, reference IDs and resolution deadline. Do not hide exceptions in a final “passed” total.

### Stop, contain and recover

Pause the affected workflow immediately for suspected cross-school exposure, duplicate money, unexplained reconciliation variance, lost marks/enrollment or incorrect published reports. Preserve evidence and request IDs; restrict writes to the affected scope where possible. Notify the school incident owner. Reconcile all work since the last good point before reopening.

Choose recovery by failure: compatible application rollback for a code-only issue, approved compensating entries for posted finance, result amendments for published academics, or verified database/file restore plus controlled replay for data loss. Never silently delete a posted receipt or overwrite a published result to make a dashboard agree.

### Sign-off responsibilities

Registrar signs learner identities, enrollment and capacity. Academic lead signs curriculum, grading, moderation and reports. Accountant signs opening balances, receipts, GL and close. HR signs employment and enabled payroll inputs. QA signs coverage/evidence; infrastructure/security signs isolation, runtime, backup/restore and alerts. The school sponsor accepts operating procedures, support and rollout scope.

## V. Final definition of done

**Release and environment**

- Exact reviewed SHA and immutable images; lockfile and supported runtime; default documented build/typecheck/lint/architecture checks pass.
- Required unit, database integration, school browser, security, concurrency and migration gates pass with no hidden skips.
- Final image boots and queries through the real restricted database role; internal services are not publicly exposed.
- No launch-scope P0; P1 exceptions, if any, have documented limited scope, owner and accepted operational control.

**School workflow and data**

- Every admission/registration/import/transfer path creates or updates the canonical annual enrollment and dated placement atomically.
- Current-class fields are projections; term opening cannot promote a learner; promotion/repeat/graduation preserve previous years.
- Curriculum, offering, teacher and roster relations are valid across organization/year/term; obsolete writers cannot bypass them.
- Homework/assignment/exam marks enter one assessment core; zero/missing/absent/exempt and approval/release are distinguishable.
- Issued reports bind exact result/template revision and frozen metadata; historical reprints remain unchanged; corrections produce successors.

**Money and optional payroll**

- Billing uses the correct historical audience and immutable pricing decisions.
- Payments, allocations, cash movement, GL, receipts and audit commit consistently; retry/duplicate/concurrent tests pass.
- Fee receivable, credits, cashier and settlement balances reconcile without unexplained variance; close/reopen is controlled.
- Live providers, if enabled, pass authenticated callback, lost-callback polling, amount/currency/reference, reversal and reconciliation tests.
- Payroll, if enabled, has per-instrument repayment, independent approval, correct statutory/account mapping, complete shadow cycle and accountant sign-off.

**Security, people and operations**

- Two-school and same-school ownership/field tests pass; health/HR/files have restricted access; privileges and relationships revoke as designed.
- Privileged MFA and session recovery work; encryption keys are versioned and recoverable; data/processor/privacy responsibilities are documented.
- Database + upload + key restore is demonstrated against agreed RPO/RTO; backups are off-host and monitored.
- Load/poor-network/restart tests meet agreed targets; alerts, manuals, support escalation and manual-continuity procedures are exercised.
- Migration control totals and user UAT signed; pilot completes its observation and business-cycle gates; rollout has named approval.

**After one successful term**

- Term-end academic and finance closes pass; historical reports and statements remain reproducible.
- Next-year progression rehearsal passes; compatibility access is measured.
- Legacy data/writers are retired only when dependencies, retention, mapping and recovery gates permit it.

### Review verification note

During this audit, `pnpm lint:arch` **passed**: 1,032 modules and 2,992 dependencies checked with no dependency violations. The targeted academic/permission/report run had **129 passing tests and seven failing report-canon tests** across nine suites. Shared/web/portal typechecking passed; API typechecking exhausted the default approximately 4 GB V8 heap. Docker engine was unavailable, and configured database authentication failed for DB-backed checks. These are the starting baseline, not completed release gates.
