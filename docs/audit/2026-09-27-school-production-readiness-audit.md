# SCHOOL MANAGEMENT SYSTEM FUNCTIONAL AUDIT

Audit date: **27 September 2026**. Proposed launch: **28 September 2026**. Target: Ugandan nursery and primary schools. Repository: `C:\Dev\School-Management`, commit `8252c54`. This is an audit of the existing implementation, not a redesign or a remediation PR.

## 1. Executive Summary

**Production decision: NO-GO. Do not onboard live schools tomorrow on this version.** The system has substantial working business logic, real accounting integration, a strong academic assessment foundation, and useful nursery features. It also has reproduced authorization and financial integrity failures that ordinary passing tests did not detect.

The most serious failures are:

- An unassigned Class Teacher can read another class's private care notes, immunisation records, guardian phone numbers and serious safeguarding incidents, and can edit the care note.
- That teacher's normal pupil list is empty and individual pupil access is denied, yet the student-register report returns pupils. Different entry points apply different access rules.
- Two approvals of one UGX 1,000 adjustment create two journal entries and increase an invoice balance by UGX 2,000.
- A queued billing job can post an invoice after the term's finances are closed.
- The nursery collection screen lists an authorized guardian but cannot record the ordinary guardian handover.
- Quick registration accepts a duplicate child; the attendance API reports 150% attendance for one late day.
- The production Compose configuration bakes `http://localhost:3000` into the staff browser application and defaults its school features off. The API Dockerfile also contains a Prisma resolution problem.

**Feature inventory: 81 bounded features/workflows.** 4 IMPLEMENTED — VERIFIED; 49 PARTIALLY IMPLEMENTED; 9 INCONSISTENT; 7 OPTIONAL; 9 BROKEN; 1 BACKEND ONLY; 1 MISSING; 1 NOT APPLICABLE. There are 12 mandatory P0/P1 finding groups (F01–F12), plus F13 if live mobile-money collection is in scope. No overall numerical readiness score is assigned.

Counts describe the bounded feature inventory in section 3, not every button, permission or endpoint in the ERP. A **PARTIALLY IMPLEMENTED** row can mean an incomplete demonstrated workflow; where completion is unknown, its notes explicitly say **NOT VERIFIED**. It does not imply that untested code is absent. Only narrowly scoped workflows actually demonstrated are called **IMPLEMENTED — VERIFIED**. Optional modules receive the OPTIONAL classification even when some implementation exists.

Verification completed:

| Check | Actual result | Important limit |
| --- | --- | --- |
| Empty database migration | 164 repository migrations applied, no unfinished migration | PostgreSQL 18 locally; production Compose uses PostgreSQL 16, which was not exercised |
| Database invariant preflight | Passed; placement exclusion, unique business indexes, FORCE RLS and same-school FK guards present | Schema presence alone does not prove every caller enforces business policy |
| Unit assertions | 135 suites, 2,408 tests passed | Runtime transpilation with TypeScript diagnostics disabled; runner remained alive after summary and was stopped |
| Integration run | 79 suites passed, 1 failed, 2 skipped; 619 tests passed, 1 failed, 9 skipped | Failure was legacy-mark evidence absent from the fresh database, not a demonstrated result mismatch |
| Dedicated production-style DB role tests | 9/9 passed across two suites | Temporary NOBYPASSRLS application role and BYPASSRLS system role; not a deployed-host test |
| Existing historical exam parity | 1,788 legacy marks; zero missing projections, zero score mismatches, zero status mismatches | Aggregate queries in a READ ONLY transaction; existing database not changed |
| Staff web build | Passed, including TypeScript check | Build is not a successful Docker deployment or a workflow certificate |
| Portal TypeScript check | Passed | Family/teacher browser workflows remain incompletely tested |
| API and portal builds | Both passed; compiled API also booted and handled the final normal billing/close probe | Local builds, not image/TLS/production-role deployment proof |
| Manual recovery | Fresh dump/restore, 642 table counts identical, 60 document residuals identical | Stable fictional DB snapshot only; files, offsite retention and the application's restore job NOT VERIFIED |
| Browser operation | Real staff sign-in, dashboard, menu and nursery guardian collection attempted | One narrow mobile-width browser journey; not all pages/devices/roles |
| External delivery/payment | NOT VERIFIED | No live SMS, email or mobile-money transaction was sent |

Evidence is summarized in [verification-summary.md](C:/Dev/School-Management/docs/audit/evidence-20260927/verification-summary.md), with selected safe JSON results and the screenshot preserved alongside this report. Raw local logs/scripts are under `var/audit-20260927-*`; this report has no production passwords or tokens. Mutating tests used the explicitly separate fictional database `school_audit_20260927`. Existing-school history was inspected read-only. Application code was not repaired during this audit. Temporary servers/browser and role grants were stopped or removed; named fictional audit databases are retained for reproducibility.

## 2. System Architecture Summary

The active workspace is a pnpm monorepo. `apps/web` is the React/Vite staff ERP, `apps/portal` is a separate React/Vite parent/student/teacher portal, `apps/api` is a NestJS API, and `packages/shared` supplies shared contracts and permissions. The nested older `school-management-feature/school-management-main` tree is not the workspace application being assessed.

Prisma exposes 638 models. The tested public database has 642 tables, including migration and SQL-managed tables. Of these, 622 school/organization-scoped tables have the tenant RLS protections checked by the preflight. The academic model includes programmes, grades, classes, sections, years, terms, enrollment and effective-dated placements. Enrollment history is a better authority than mutable current-class projections, and recent code uses it extensively.

JWT authentication, per-request database permission lookup, role grants, data scope, tenant context, Prisma scoping and PostgreSQL RLS form the access layers. RLS protects school boundaries; it does **not** implement which classes or sensitive fields a teacher may access within one school. The reproduced leaks happen within a school despite working tenant isolation.

The school vertical includes foundation, people, admissions, enrollment, academics, teaching, course offerings, attendance, assessment, examinations, early years, fees, analytics, reporting, statutory reporting, portals, library, transport, meals, hostel, front desk, LMS, CBT, certification and documents. Shared ERP modules provide accounting, invoicing, HR/payroll, inventory and communication. Generic manufacturing, rental, repair, orders and other modules are outside the nursery/primary launch scope.

Transactions, sequence generation, idempotency, audit logging and event-outbox infrastructure are present. These are meaningful strengths, but adjustment approval shows that a transaction without an atomic state claim is insufficient. Provider adapters exist for MTN/Airtel and messaging. Their existence is not proof of a working provider connection.

Deployment uses API/web/portal Dockerfiles, PostgreSQL, Redis, Caddy and the production Compose overlay. The overlay correctly removes direct database/Redis/API/web/portal host ports and keeps Adminer behind an operator profile. Caddy exposes the public HTTP/HTTPS ports. Actual image construction, certificate issuance, production health and host recovery are **NOT VERIFIED**, because Docker's daemon was unavailable.

## 3. Feature Coverage Matrix

Evidence abbreviations: **H** = live HTTP against isolated Nest API plus selected database checks; **B** = real browser observation/action; **I** = passing repository integration tests against PostgreSQL; **U** = passing unit assertions; **S** = inspected current source; **D** = database/tool execution. A passing integration suite proves its asserted cases, not every role, UI path or deployment. Finding IDs link to the detailed issues below.

| Module | Feature | Status | Evidence | Severity | Notes |
| --- | --- | --- | --- | --- | --- |
| Access | Staff sign-in | IMPLEMENTED — VERIFIED | B/H: fictional admin authenticated and school home opened | — | Limited to successful local staff sign-in; recovery/MFA/deployment not certified |
| Foundation | Operator school bootstrap | IMPLEMENTED — VERIFIED | H/D: real bootstrap creates school, UGX, programmes and ten classes | — | Operator API workflow; final client customization needs acceptance |
| Foundation | Academic year and terms | PARTIALLY IMPLEMENTED | H/I/S: 2026 and three terms persisted; academic-year suites passed | — | Whole browser close/reopen/overlap/history flow NOT VERIFIED |
| Foundation | Nursery/primary programmes and grades | PARTIALLY IMPLEMENTED | H/D/S: Nursery ECD, Lower/Upper Primary; Baby/Middle/Top/P1–P7 | — | Client-specific curriculum/subjects/templates NOT VERIFIED |
| Academics | Streams, capacity and overrides | PARTIALLY IMPLEMENTED | I/S: enrollment/structure/concurrency suites | — | Full registrar stream/capacity/override UI and reports NOT VERIFIED |
| Academics | Subjects, curriculum and weight configuration | PARTIALLY IMPLEMENTED | I/S: academic foundation/course/assessment modules | — | School-approved thematic/transition/upper-primary configuration NOT VERIFIED |
| Teachers | Teacher/staff creation and employment profile | PARTIALLY IMPLEMENTED | I/S: teacher ownership, HR/people suites | — | New teacher browser setup through assigned timetable NOT VERIFIED |
| Teachers | Class/subject teacher ownership | INCONSISTENT | I: core teacher tests pass; H: specialized nursery/report bypasses | P0 | F01/F02; assignment does not consistently constrain every path |
| Timetable | Teacher/class/room conflict and publication | PARTIALLY IMPLEMENTED | I/S: timetable/academic modules and constraints | — | Complete conflict/UI/publication/parent visibility chain NOT VERIFIED |
| Admissions | Application, review, interview, decisions and conversion | PARTIALLY IMPLEMENTED | I/S: admissions workflow/concurrency suites | — | Full parent/registrar application/document/interview UI NOT VERIFIED |
| Admissions | Application fees and payment reconciliation | PARTIALLY IMPLEMENTED | I/S: admission-fee implementation and workflow tests | — | Live external payment/receipt/browser conversion chain NOT VERIFIED |
| Students | Quick registration and duplicate handling | INCONSISTENT | H/D: register persists identity/placement, accepts duplicate child | P1 | F07; alternative create path has a likely-match check |
| Students | Admission identifiers | PARTIALLY IMPLEMENTED | H/D/I: generated distinct STU identifiers; sequence tests | — | Import/custom-number collision UI and all concurrency paths NOT VERIFIED |
| Guardians | Multiple guardians and family relationships | PARTIALLY IMPLEMENTED | H/I/S: real linked guardian and portal identity | — | Multiple children/guardians/emergency-contact full UI NOT VERIFIED |
| Guardians | Primary/emergency/authorized-collector contact | INCONSISTENT | H/B/S: guardian listed; normal release fails and teacher reads phone | P0 | F01/F06; ordinary contact maintenance otherwise NOT VERIFIED |
| Students | Pupil 360 profile, edits and photo | PARTIALLY IMPLEMENTED | I/S: wave13 atomic registrar/profile/redaction cases passed | — | Complete all-tabs/upload/refresh lifecycle NOT VERIFIED |
| Students | Medical confidentiality | INCONSISTENT | I: generic profile redaction; H: immunisation route leaks | P0 | F01; sensitive policy differs between entry points |
| Enrollment | Initial active enrollment and class placement | PARTIALLY IMPLEMENTED | H/D/I: registered placed pupils; exclusion/unique preflight | — | Whole stream-specific UI capacity/history acceptance NOT VERIFIED |
| Enrollment | Class/stream transfer and withdrawal | PARTIALLY IMPLEMENTED | I/S: placement/lifecycle cases | — | One browser transfer/withdraw/history/fees reconciliation NOT VERIFIED |
| Enrollment | Return, re-admission and repeat | PARTIALLY IMPLEMENTED | I/S: lifecycle and rollover modules | — | Same-identity return and repeat whole-role browser chain NOT VERIFIED |
| Enrollment | Promotion, approval and graduation | PARTIALLY IMPLEMENTED | I/S: rollover/lifecycle suites | — | Full school bulk exceptions and next-year historical reports NOT VERIFIED |
| Enrollment | Historical placements and academic records | PARTIALLY IMPLEMENTED | I/D/S: effective placement tests; legacy marks parity matches | — | All historical report consumers following real transfers NOT VERIFIED |
| Attendance | Daily/bulk attendance and rates | INCONSISTENT | H/D: late saved; student history returns 150% | P1 | F08; selected membership/concurrency cases otherwise pass |
| Attendance | Roster membership, transfers and duplicate marks | PARTIALLY IMPLEMENTED | I/S: attendance/admissions/production invariant suites | — | All real teacher corrections/withdrawn/term-lock UI cases NOT VERIFIED |
| Attendance | Correction, notes and audit history | PARTIALLY IMPLEMENTED | I/S: attendance source and tests | — | Full correction approval/denial/history/report flow NOT VERIFIED |
| Attendance | Subject/session attendance where contracted | OPTIONAL | S: teaching/session capability inspected; end-to-end NOT VERIFIED | — | Separate acceptance if subject attendance is required |
| Early years | Daily care, moods, meals, naps and notes | BROKEN | H/D: real logs; unassigned teacher reads/edits private draft | P0 | F01; value exists but confidentiality fails |
| Early years | Deliberate sharing with guardian | PARTIALLY IMPLEMENTED | H/D: draft excluded, shared own-child included, other child denied | — | Actual parent browser/correction notification workflow NOT VERIFIED |
| Early years | Authorized guardian child collection | BROKEN | B/H/D: guardian button fails; API rejects; zero pickup events | P1 | F06 |
| Early years | Third-party pickup authorization and override | PARTIALLY IMPLEMENTED | I/S: early-years service/test cases | — | Expiry/revocation/replay/full gate browser chain NOT VERIFIED |
| Early years | Immunisations and health history | BROKEN | H: private health returned to unassigned teacher | P0 | F01; full reminder/document browser flow NOT VERIFIED |
| Early years | Incident/safeguarding review and notification | BROKEN | H: serious incident returned to unassigned teacher | P0 | F01; live notification and designated-access workflow NOT VERIFIED |
| Assessment | Nursery observations and rubric authoring | PARTIALLY IMPLEMENTED | I/S: ECD assessment; raw JSON criteria editor | P2 | F15; human-friendly complete rubric/report flow NOT VERIFIED |
| Assessment | Continuous assessment, gradebook and marks | PARTIALLY IMPLEMENTED | I/U/S: unified/core/roster/gradebook/exam suites | — | Configured class browser marking/review journey NOT VERIFIED |
| Assessment | Absent/missing/exempt/invalid marks | PARTIALLY IMPLEMENTED | I/U/S: result/exam/assessment asserted cases | — | Every school-configured boundary and UI state NOT VERIFIED |
| Results | Stage-compatible grades and decimal boundaries | PARTIALLY IMPLEMENTED | I/U/S: wave13/current grading tests and resolver | — | Actual school-scale independent printable sample acceptance NOT VERIFIED |
| Results | Approval, publication and integrity gates | PARTIALLY IMPLEMENTED | I/S: result integrity, segregation, freshness/checksum cases | — | Complete head/teacher/guardian browser release chain NOT VERIFIED |
| Results | Amendment, locked reads and revision history | PARTIALLY IMPLEMENTED | I/S: released revision retained until replacement publication | — | Complete real user correction/print/history journey NOT VERIFIED |
| Results | Nursery/primary report cards and print/export | PARTIALLY IMPLEMENTED | I/S: stage-sensitive report template builders | — | Final PDFs/layout/data/parent delivery NOT VERIFIED |
| Statutory | UNEB continuous assessment/candidate output | PARTIALLY IMPLEMENTED | I/S: school-statutory-phase6 passed | — | Current official submission specification/file acceptance NOT VERIFIED |
| Fees | Fee structure, versions, schedules and assignments | PARTIALLY IMPLEMENTED | H/D/I: tuition publish/schedule/generation; real DB | — | Full bursar configuration/discount/history UI NOT VERIFIED |
| Fees | Invoices and repeat generation | PARTIALLY IMPLEMENTED | H/D/I: invoices persist; already-billed retry skipped | — | Final invoice print/cancel/rebill/reconciliation workflow NOT VERIFIED |
| Fees | Partial payment and allocation | PARTIALLY IMPLEMENTED | H/D/I: 350,000 minus 100,000 equals 250,000 | — | Full UI→printed receipt→day close NOT VERIFIED |
| Fees | Overpayment, advance credit and reconciliation | PARTIALLY IMPLEMENTED | I/S: fees integrity/concurrency modules | — | Complete school-configured credit/refund/browser cases NOT VERIFIED |
| Fees | Discounts, scholarship, waiver and bursary | PARTIALLY IMPLEMENTED | I/S: fee policies/assignments | — | Full approvals and client report effects NOT VERIFIED |
| Fees | Adjustments and approval | BROKEN | H/D: wrong-pupil accepted; real scheduled approvals double-post | P0 | F03/F04 |
| Fees | Financial close and queued billing | BROKEN | H/D/S: pending run posts after successful close | P1 | F05 |
| Fees | Cash collection and session reconciliation | INCONSISTENT | H/D/S: payment/GL exists; zero drawer movement | P1 | F09; shared cash-session capability not wired into fee flow |
| Fees | Bank collection and statement matching | PARTIALLY IMPLEMENTED | I/S: accounting/payment services | — | Real bank import/statement/mixed allocation/receipt chain NOT VERIFIED |
| Fees | Payment reversal/refund and ledger consistency | PARTIALLY IMPLEMENTED | I/S: integrity/concurrency/reversal suites | — | Full authorized bursar browser/receipt/reconcile flow NOT VERIFIED |
| Fees | Live MTN/Airtel collection and settlement | BROKEN | S: MTN reference mismatch; provider contract checked | P1 if enabled | F13; provider acceptance/settlement NOT VERIFIED; defer by disabling |
| Fees | Manual recording of externally confirmed MoMo receipt | PARTIALLY IMPLEMENTED | I/S: mobile_money payment method exists | — | Distinct from initiating live provider charge; full verification/receipt chain NOT VERIFIED |
| Fees | Penalties and period controls | PARTIALLY IMPLEMENTED | I/S: penalty generation and term guard | — | All live schedules, rounding, closed-term UI/report behavior NOT VERIFIED |
| Portal | Parent invitation and account activation | PARTIALLY IMPLEMENTED | H/I/S: invite creates identity; fixture activated for auth test | — | Actual email delivery/acceptance/reset NOT VERIFIED |
| Portal | Own-child profile/fees/result access | PARTIALLY IMPLEMENTED | H/I: own-child dashboard allowed, foreign child pay quote denied | — | Every family endpoint/browser export/result/payment NOT VERIFIED |
| Portal | Identity revocation and token permission refresh | PARTIALLY IMPLEMENTED | H: revoked guardian existing token gets 403 | — | All identities/session/role changes and complete UI lifecycle NOT VERIFIED |
| Portal | Courses/progress/due items with feature flags | INCONSISTENT | H/S: advanced-LMS-off endpoint 404; page substitutes empty | P2 | F14 |
| Portal | Teacher and student full self-service | PARTIALLY IMPLEMENTED | I/S: portal/LMS/teacher ownership assertions | — | Complete current teacher/student browser journeys NOT VERIFIED |
| Communication | Announcements, templates and recipient selection | PARTIALLY IMPLEMENTED | I/S: wave2-notifications/communication modules | — | Full real recipient/approval/history UI NOT VERIFIED |
| Communication | Email/SMS delivery, failure and emergency messages | PARTIALLY IMPLEMENTED | I/S: providers/outbox present; external transport disabled in audit | — | Real school sender, actual delivery/retry/emergency chain NOT VERIFIED |
| Reporting | Student register, filters and export access | BROKEN | H: empty teacher roster but report returns school pupils | P0 | F02 |
| Reporting | Attendance histories and summary reports | INCONSISTENT | H/D: pupil attendance rate 150%; reporting suites pass other cases | P1 | F08; every export/portal consumer requires reconciliation |
| Reporting | Fee/payment/GL/cash reports and historical filters | PARTIALLY IMPLEMENTED | I/H/S: selected amounts and ledger checked | P1 | F03/F09 affect truth/reconciliation; all report totals NOT VERIFIED |
| Dashboard | Current-term pupil/fee/setup/approval overview | PARTIALLY IMPLEMENTED | B/H/D/I: selected real counts and cash collection observed | — | Every metric, cache, historical/date filter and role variant NOT VERIFIED |
| Library | Catalogue, copies, issue/return/renewal/loss | OPTIONAL | I/S: library source/tests; full desk workflow NOT VERIFIED | — | Required only when library service is part of client scope |
| Library | Fine management staff desk | BACKEND ONLY | I/S: backend fine test passes; UI coming soon | P2 if used | F16 |
| Transport | Routes, drivers, pickup points, allocation, capacity and fees | OPTIONAL | S: transport modules; complete operations NOT VERIFIED | — | Client-specific safety/capacity/billing acceptance required if sold |
| Boarding | Rooms/beds/check-in/attendance and boarding charges | OPTIONAL | S: hostel modules; complete workflow NOT VERIFIED | — | Separate boarding-client acceptance |
| Meals | Plans, feeding attendance, kitchen and finance | OPTIONAL | I/S: meal lifecycle/finance-kitchen suites passed | — | Nursery/day-school meal desk full UI NOT VERIFIED |
| HR | Staff/payroll/leave and school bridge | OPTIONAL | I/S: Uganda payroll, proration, people, self-service passed | — | Staff identity needed for scope; payroll full client acceptance separate |
| LMS/CBT | Advanced learning delivery, homework and online exams | OPTIONAL | I/S: LMS/CBT suites; advanced module default off | — | Not a basic nursery/primary launch obligation; hide disabled links |
| Documents | Upload, protected download and document history | PARTIALLY IMPLEMENTED | I/S: DMS snapshot/lifecycle plus school document source | — | Actual school upload, outage, malware/tenant download and files restore NOT VERIFIED |
| Administration | Users, roles, settings and audits | PARTIALLY IMPLEMENTED | H/I/S: invite/revoke, per-request permissions and audit infrastructure | P0 | F01/F02 block safe authorization; full role CRUD/action audit coverage NOT VERIFIED |
| Tenancy | School boundary/RLS defense | PARTIALLY IMPLEMENTED | H/I/D: foreign pupil 404, role tests pass, 622 policies | — | Representative runtime proof; all file/export/search/job paths NOT VERIFIED |
| Database | Fresh migrations and required invariant preflight | IMPLEMENTED — VERIFIED | D: 164 migrations and executable constraint/RLS/FK checks pass | — | Local PostgreSQL 18 only; upgraded production PostgreSQL 16 still needs drill |
| Recovery | Manual isolated database dump/restore | IMPLEMENTED — VERIFIED | D: stable snapshot 642 table counts and 60 residuals match | — | Fictional logical DB only; app automation/files/offsite not certified |
| Recovery | Scheduled actual restore verification | MISSING | S: scheduled check only lists archive via verifyOnly | P1 | F12; actual recurring recovery drill is absent from this scheduled path |
| Deployment | Production images, URLs, capabilities and boot | BROKEN | D/S: merged config and local module resolution expose defects | P1 | F10/F11; Docker daemon unavailable, actual image boot NOT VERIFIED |
| Reliability | Production monitoring, outbox/shutdown and failure recovery | PARTIALLY IMPLEMENTED | I/S: worker infrastructure; test lifecycle errors/open unit runner | P2 | F19; real outage/alerts/replay/production load NOT VERIFIED |
| Installed app | School PWA/mobile/offline experience | INCONSISTENT | B/S: mobile-width selected pages; POS Cafe /pos manifest | P3 | F20; full device accessibility and offline school writes NOT VERIFIED |
| Generic ERP | Manufacturing, rental, repair and unrelated retail workflows | NOT APPLICABLE | S: modules exist and some tests pass | — | Outside defined nursery/primary school launch scope |

The inventory covers the requested core and nursery workflows plus applicable school modules. Every page's loading/error/refresh/export behavior, every endpoint and the entire eight-role CRUD/approval matrix have **not** been exhaustively executed. Such certification must not be inferred from this report.

## 4. Workflow Audit

| Workflow and status | Steps traced/tested; passed | Failed steps or missing proof | Rules, database and permission implications |
| --- | --- | --- | --- |
| School setup: partial verified chain | Operator bootstrap → UGX/Kampala school → seeded nursery/lower/upper programmes → ten grade/classes; HTTP create 2026 year and three terms; persisted | Full browser setup with streams, subjects, teachers, conflicts and school-specific configuration NOT VERIFIED | Real foundation exists; final school setup should be reviewed by head teacher before opening |
| Admission/application: partial | Admissions workflow/concurrency suites passed; current services convert accepted applications through shared admission logic | Full application/interview/document UI through enrollment NOT VERIFIED | Do not equate the passing application dedupe path with direct-registration dedupe |
| Direct registration: inconsistent | Quick-register UI call → controller → admission service → pupil/identifier/guardian/enrollment/placement persisted | Same child name, DOB and placement accepted again with HTTP 201, new admission number | F07: shared admission path omits the likely-duplicate check used by the alternative create path |
| Enrollment/lifecycle: partial | Enrollment placement, admission concurrency, lifecycle/rollover suites passed; exclusion/unique constraints exist | One real browser chain covering transfer, withdrawal, return, repeat and graduation with historical reports NOT VERIFIED | Strong invariants protect enrollment, but separate duplicate pupil identities bypass them |
| Attendance: inconsistent | Mark one P1 pupil late → saved row → query pupil's history | History returns total=1, present=1, late=1, rate=150; failed calculation | F08: late counts as present and is added a second time. Correction/locked/unauthorized cases only covered to the extent of existing tests |
| Nursery care: unsafe | Staff write draft → parent own-child read excludes draft → deliberate share → parent sees it; other-family request denied | Unassigned teacher reads/edits another child's draft; health and incidents also exposed | F01: school permission is used without pupil/class/sensitive-record policy |
| Child collection: broken | Browser selects class and pupil; API lists guardian with canPickup; UI displays guardian and Released button | First button press uses old state and asks for collector; API rejects ordinary guardian release; zero handover events persisted | F06: guardian link is not carried into release validation. Do not use an override to disguise normal authorization |
| Assessment/results: backend cases passed, complete release partial | Current tests cover exam/assessment roster, mark validation, approval, result integrity, stage-specific grading, controlled amendments and retained released revisions | Branded nursery and primary PDFs, every absence/exemption setting, all real staff/parent browser approval/publication steps NOT VERIFIED | Do not resurrect earlier fixed grading/revision findings. Need final school-configured sample acceptance |
| Fee collection: happy path persisted, subsystem unsafe | Fee structure publish → schedule → invoice UGX 350,000 → cash payment UGX 100,000 → allocation → residual UGX 250,000 and accounting persistence | F03 duplicate adjustment postings; F04 mismatched pupil/invoice accepted; F05 after-close billing; F09 no drawer movement | Payment engine's successful path is real. All finance entry points must share atomic policies |
| Parent onboarding/access: partial | Invite creates identity; fixture activates identity to test login; own child permitted, other child denied; draft hidden, shared day shown; revocation invalidates token | Actual invitation email receipt/acceptance/password setup NOT VERIFIED; Courses endpoint 404 with advanced LMS off | Fixture activation was setup for authorization testing, not evidence of a working emailed invitation |
| Reporting: unsafe/inconsistent | Register report runs against real pupil records; dashboard selected counts inspected; reporting suites passed | Unassigned teacher receives register rows despite empty normal roster; attendance percentage wrong; all export/print totals NOT VERIFIED | F02: report resolver uses an older scope helper that broadens missing assignments |
| Recovery/deployment: partial and blocked | Fresh schema deploy, constraint checks, manual logical restore, role-level RLS tests, Compose merge inspection | Actual container boot/TLS, backup service in image, uploads restore, offsite recovery and smoke test NOT VERIFIED | F10–F12 require final artifact and operational recovery proof, not documentation alone |

For each critical route, the trace inspected was UI/hook where present → controller/permission → service → Prisma transaction/data → response. Browser completion and refresh were exercised only on the specifically stated journey. Role interleaving was tested in the adjustment probe. Network interruption, database outage, concurrent editing on every module, failed uploads and final delivery retry behavior remain **NOT VERIFIED**.

## 5. Critical Findings

### F01 — P0 — Nursery, health and safeguarding access exceeds teacher scope

**Problem:** a user with the actual seeded Class Teacher role, no linked staff profile and no assigned class can obtain and alter other pupils' nursery information. **Evidence:** normal `GET /school/students` returned zero rows; individual pupil GET and delete returned 403. The same token received 200 from care-log pupil/class routes, immunisations, permitted collectors and outstanding incidents, including a private draft, guardian phone and serious safeguarding note. POST care log returned 201 and changed the stored note.

**Root cause:** [early-years.controller.ts](C:/Dev/School-Management/apps/api/src/modules/school/early-years/early-years.controller.ts:25) checks coarse permissions; [care-log.service.ts](C:/Dev/School-Management/apps/api/src/modules/school/early-years/care-log.service.ts:38) and sibling services do not enforce the student's readable/managed seat or the intended sensitive-record policy. The generic pupil view's improved rules are bypassed by these specialized routes.

**Impact:** confidential child records and safety information become visible to staff with no legitimate assignment; care records can be changed. **Fix:** enforce class/pupil scope inside all nursery read/write/share/history routes, apply explicit health/safeguarding permissions, and minimize returned data. Decide the school's safeguarding-access policy explicitly; a general teacher permission should not silently confer unrestricted access. Regression proof: D01.

### F02 — P0 — Reporting bypasses the pupil access boundary

**Problem/evidence:** the same unassigned teacher, whose ordinary roster was empty, ran `POST /school/reports/v2/student.register/run` and received all three roster rows present at that point. This is a real API leak, not just a visible menu.

**Root cause:** [filter-resolver.service.ts](C:/Dev/School-Management/apps/api/src/modules/school/reporting/filter-resolver.service.ts:153) calls [DataScopeService.classIds](C:/Dev/School-Management/apps/api/src/kernel/auth/data-scope.service.ts:86), which treats absent staff/assignments as broad scope. `readableSeats()` now fails closed, but reporting still uses the earlier helper.

**Impact:** reports/export-capable paths undermine protected pupil screens. **Fix:** share fail-closed term/section-aware scope between reports, roster, summaries and exports; never widen an empty teacher assignment to school-wide data. Proof: D02.

### F03 — P0 — Concurrent adjustment approval double-posts money

**Problem/evidence:** two real FinanceControlsService approval calls both read one pending UGX 1,000 debit adjustment before either transaction begins. The first transaction completed, then the second began. Actual PostgreSQL residual changed from **250,000 to 252,000**, instead of 251,000. Two distinct journal entries were created, with combined debit UGX 2,000.

The probe controlled transaction scheduling with a Prisma proxy; the persistence, posting service and database were real. It is evidence of an unsafe allowed interleaving, not a claim about load-tested HTTP throughput. Ordinary endpoint idempotency cannot protect two approvals with different request keys.

**Root cause:** [finance-controls.service.ts](C:/Dev/School-Management/apps/api/src/modules/school/fees/finance-controls.service.ts:92) checks pending status before `$transaction`, then posts without claiming/re-reading that adjustment atomically. **Impact:** incorrect family balances and duplicate general-ledger entries. **Fix:** lock/conditionally claim the adjustment within the same transaction as invoice/GL changes, serialize document changes, and make replay return the original posting. Proof: D03.

### F04 — P1 — Adjustment can identify a different pupil from the invoice

**Evidence:** creating an adjustment with the P1 pupil ID and the nursery pupil's invoice returned 201 and persisted the P1 pupil ID. **Root cause:** [createAdjustment](C:/Dev/School-Management/apps/api/src/modules/school/fees/finance-controls.service.ts:45) validates the document's school, but not its associated school-fee pupil or eligible state/type.

**Impact:** adjustment history and reports can attribute a change to the wrong family. Posting that mismatched adjustment was not required to establish this contradiction. **Fix:** derive the pupil from the fee invoice, or require an exact association match, inside the posting policy. Validate invoice type, state and period as well. Proof: D04.

### F05 — P1 — Queued billing writes after financial close

**Evidence:** a normal HTTP-only reproduction registered an unbilled P1 pupil, queued billing for all six pupils, closed the term's finances, then processed that existing run. Each operation returned 201. The job posted one new UGX 350,000 invoice and skipped the five previously billed pupils; the term remained `closed`. Close occurred at 11:29:05.659 UTC and the invoice was created at 11:29:05.885 UTC. No manual run-item changes were involved in this final proof. The initial fixture-based probe independently exposed the same missing gate. The final probe's first database readback used a nonexistent Prisma include; corrected read-only lookup and the API request log established the persisted result. See [normal-close evidence](C:/Dev/School-Management/docs/audit/evidence-20260927/close-natural.json).

**Root cause:** [BillingRunService.start](C:/Dev/School-Management/apps/api/src/modules/school/fees/billing-run.service.ts:40) checks the period when queueing; [process](C:/Dev/School-Management/apps/api/src/modules/school/fees/billing-run.service.ts:79) does not. [billSingleStudent](C:/Dev/School-Management/apps/api/src/modules/school/fees/billing.service.ts:608) checks academic writability, not financial close; its posting transaction lacks the required financial gate.

**Impact:** closed balances can change after bursar reconciliation. **Fix:** enforce the financial-period rule inside every posting transaction and coordinate it with close/reopen. Fail the pending item clearly or require an authorized reopening. Proof: D05.

### F06 — P1 — Authorized guardian handover cannot complete

**Evidence:** actual browser shows the allowed guardian and Released button. First press produces “Record who collected the child.” The API also rejects release naming that guardian without a separate pickup authorization. No PickupEvent was created.

**Root cause:** [early-years.tsx](C:/Dev/School-Management/apps/web/src/pages/school/early-years.tsx:281) sets React collector state then immediately reads its old value; [PickupService.release](C:/Dev/School-Management/apps/api/src/modules/school/early-years/pickup.service.ts:171) supports a pickup-authorization ID or override but does not validate the allowed StudentGuardian link displayed by `whoMayCollect`.

**Impact:** nursery staff must use an exception workflow or another record book for routine collection. **Fix:** pass collector identity/name directly, support guardian links with current canPickup checks, and persist the actual authorization source and actor. Proof: D06. [Browser evidence](C:/Dev/School-Management/docs/audit/evidence-20260927/nursery-collection.png).

### F07 — P1 — Quick registration permits duplicate pupil identities

**Evidence:** repeating the same name, DOB, class and term returned 201; pupil count increased from three to four in the recorded probe. Repeat probing produced a third indistinguishable Atim in the nursery selector, each with a different admission number.

**Root cause:** [StudentAdmissionService.register](C:/Dev/School-Management/apps/api/src/modules/school/people/student-admission.service.ts:359) calls `admit()` directly. The likely-duplicate policy used by [StudentService.create](C:/Dev/School-Management/apps/api/src/modules/school/people/student.service.ts:206) is not shared by quick registration.

**Impact:** duplicate bills, separate histories, wrong attendance/collection selection, difficult merges. **Fix:** consistent likely-match checks in all admission paths, explicit authorized override for genuine same-name/DOB children, replay protection and a safe audited merge/correction workflow. Do not impose a universal uniqueness constraint on name+DOB, which can identify different children. Proof: D07.

### F08 — P1 — Attendance rate can exceed 100%

**Evidence:** one real late attendance record returned `{total:1,present:1,late:1,absent:0,attendanceRate:150}`. **Root cause:** [student-attendance.service.ts](C:/Dev/School-Management/apps/api/src/modules/school/attendance/student-attendance.service.ts:235) counts the seeded late status as present, then adds `late * 0.5` again.

**Impact:** inaccurate learner history, parent summaries and any downstream consumer of this metric. **Fix:** agree how late/excused sessions affect attendance and denominator, derive one contribution per session from configuration, and apply the policy to all summaries. Clamping to 100 alone would hide the calculation defect. Proof: D08.

### F09 — P1 — Cash custody reconciliation hides missing movements

**Evidence:** actual UGX 100,000 cash payment and accounting records existed, but there were **zero CashMovement records**. The fee-collection UI submits the method without an active cash-session identity; see [fees-subpages.tsx](C:/Dev/School-Management/apps/web/src/pages/school/fees-subpages.tsx:175). The shared payment engine supports drawer movements only when a cash session is provided. More seriously, `GET /school/finance/reconciliation/operational-cash` returned `{byMethod:[],variance:0}` despite the missing movement. The daily cashbook correctly included cashTotal/netCash UGX 100,000, so the receipt is not lost from that report. [Readback evidence](C:/Dev/School-Management/docs/audit/evidence-20260927/cash-readback.json).

**Root cause:** [school-finance-query.service.ts](C:/Dev/School-Management/apps/api/src/modules/school/fees/school-finance-query.service.ts:823) filters payment methods to those already present in the movement map. A completely missing movement is therefore omitted instead of reported as a variance. **Impact:** the custody check can falsely indicate reconciliation. A school using drawer/session close also misses expected cash through this route. **Fix:** compare all required cash methods even when movement total is zero; link fee collectors to sessions, or explicitly represent an approved cashbook-only mode without falsely claiming drawer reconciliation. Proof: D09.

### F10 — P1 — Production browser URL and capability configuration are wrong by default

**Evidence:** rendered base+production Compose still has staff build argument `VITE_API_URL=http://localhost:3000`; the staff school flag defaults false while the production API forces school on. A remote user's localhost is their own device. Production CORS/WEB_URL settings do not rewrite compiled frontend configuration. Portal API URL, org code and name also need explicit production values.

**Root cause:** [docker-compose.yml](C:/Dev/School-Management/docker-compose.yml:88) hard-codes the staff API URL; the production overlay does not supply matching browser build arguments. **Fix:** explicit public/same-origin API contract, coordinated staff/portal capability flags, correct school code and rebuilt images. Validate from an external device. Proof: D10.

### F11 — P1 — API Dockerfile Prisma assertions resolve from the wrong workspace

**Evidence:** `require('@prisma/client')` from the repository root fails MODULE_NOT_FOUND; resolution through `apps/api/node_modules/@prisma/client` succeeds with 638 models. The [Dockerfile](C:/Dev/School-Management/infra/docker/Dockerfile.api:43) runs both Prisma assertions from `/app`, which has no direct root Prisma dependency in this pnpm layout.

**Impact/root cause:** the build/runtime verification commands are expected to fail even with a generated API client. This is a locally reproduced resolution failure and a Dockerfile inference; an actual Docker build was **NOT VERIFIED**. **Fix:** run assertions in the API workspace, verify symlink/client paths after pruning, and prove image build and cold start. Proof: D11.

### F12 — P1 — Shipped backup path has missing prerequisites and incomplete restore proof

**Evidence:** [BackupService](C:/Dev/School-Management/apps/api/src/modules/backup/backup.service.ts:202) invokes `pg_dump`/`pg_restore`; the API runtime Dockerfile installs only `tini`, with no PostgreSQL client tools. The [scheduled restore test](C:/Dev/School-Management/apps/api/src/modules/backup/backup.service.ts:466) uses `verifyOnly:true`, which lists archive contents rather than restoring into a database. Manual local restore succeeded, so the underlying logical backup method can work.

**Impact:** a school can believe recovery was tested when an archive was merely readable, and the image cannot execute its expected tools as shipped. Container executable absence follows the inspected Dockerfile; actual runtime verification remains outstanding. **Fix:** provision compatible backup tooling, writable persistent destination and credentials; perform an isolated actual database-and-files recovery and validate balances/records. Proof: D12.

### F13 — P1 if live mobile money is offered — MTN adapter violates reference contract; delivery unverified

**Evidence:** [mobile-money.service.ts](C:/Dev/School-Management/apps/api/src/modules/school/fees/mobile-money.service.ts:448) generates `SCH-...` references and sends them as X-Reference-Id at line 116. MTN requires UUID v4 references; its official error guide identifies invalid UUID references as a bad-request cause. The adapter also sends no callback URL and has no demonstrated status-poll recovery/token refresh flow. [MTN reference requirements](https://momodeveloper.mtn.com/content/html_widgets/1vu7v.html), [MTN asynchronous handling](https://momodeveloper.mtn.com/content/html_widgets/uv7jo.html).

**Impact:** requested collections can be rejected or remain pending. No provider response was generated in this audit; live MTN/Airtel settlement is **NOT VERIFIED**. The HMAC callback assumption must be checked against the actual contracted provider/gateway, rather than accepted because a mocked test passes.

**Fix:** use separate UUID provider reference and business externalId, provider-approved authentication/callback or polling, and exactly-once settlement/reconciliation. This issue can be safely deferred only by removing live collection capability and its promises from the launch scope; manually recording an independently verified MoMo receipt is a different workflow. Proof: D13.

## 6. Major Findings

| ID / severity | Evidence and impact | Required change |
| --- | --- | --- |
| F14 / P2 — Portal capability/error mismatch | With advanced LMS off, `/school/lms/my/courses` returns 404. [Courses page](C:/Dev/School-Management/apps/portal/src/routes/student/courses.tsx:19) ignores query errors and shows “No courses yet.” API/source verified, portal browser NOT VERIFIED | Hide unavailable course links by server capability; display retryable failures and distinguish unavailable from empty |
| F15 / P2 — Rubric creation requires technical input | [assessment-ops.tsx](C:/Dev/School-Management/apps/web/src/pages/school/assessment-ops.tsx:121) parses a raw JSON textarea and labels copying “Fork”; catch reports “Criteria JSON invalid” even for non-JSON failures. Source verified; teacher usability study NOT VERIFIED | Visual criteria/descriptor editor, Duplicate label, field-level validation and accurate server error display; keep JSON as optional advanced import |
| F16 / P2 if library used — Fines UI is unfinished | [library.tsx](C:/Dev/School-Management/apps/web/src/pages/school/library.tsx:653) advertises fines then says coming soon; backend library-fine integration passes | Connect list/assessment/payment/history and reconciliation, or exclude fines from the sold scope |
| F17 / P2 — Admin navigation obscures the school day | Browser menu includes overlapping Academic Management, Teaching & Assessment, Results and Academics. Generic ERP areas compete with nursery/primary tasks. No claim that every unused API is a defect | Role-specific home/actions and consistent school vocabulary; align navigation to enabled capabilities. Test registrar, teacher and bursar with actual assignments |
| F18 / P2 — Large initial staff bundle | Production web output main chunk 5,235.15 kB, gzip 1,252.17 kB, plus CSS/other chunks; Vite warns. Build measured, mobile performance NOT VERIFIED | Lazy-load school/ERP routes and heavy export/chart dependencies; measure real cold-page load on low-end phone/limited connection |
| F19 / P2 — Test gate is not reproducible from an empty DB | Legacy parity test asserts historic marks >0; full fresh-database integration therefore fails although current source history parity passed. Unit runner also did not exit after successful summary; integration logs include Prisma/outbox lifecycle errors | Separate read-only migration/history gates from seeded CI tests, seed deterministic legacy fixtures, close worker handles and test shutdown/drain reliably |
| F21 / P2 — Daily cashbook date depends on server timezone | Requested `date=2026-09-27` returned `date:2026-09-26` on the Africa/Kampala local host, while totals included the selected receipt. Source uses server-local setHours then UTC date formatting. This is a reproduced report-label defect, not proof that the receipt amount is missing | Derive explicit school-timezone day bounds and preserve the requested date-only label. Validate Kampala and UTC hosts, midnight receipts and month/year boundaries |

These findings should improve ordinary operation. They do not dilute the P0 security and money failures. Branding and styling are secondary to correct pupil identity, safe collection, accurate attendance and reconciled fees.

## 7. Minor Findings

**F20 — P3:** staff PWA [manifest configuration](C:/Dev/School-Management/apps/web/vite.config.ts:23) still uses “POS Cafe”, landscape orientation and `/pos` start URL. Fix the school install identity/start route and test installed-app behavior. Do not promise offline attendance/marks from POS-specific offline infrastructure; school offline write/replay is **NOT VERIFIED**.

**P4 enhancements:** clearer task-based dashboards, parent-friendly fee explanations/receipts, localized school vocabulary, and a visual rubric/assessment preview. Prioritize these after safety and reliability. School-specific printable templates and parent language support should be driven by actual clients, not by the number of extra ERP modules.

## 8. Missing Functionality

Absence is reported only where source or runtime demonstrates it. Many requested features have implementation and tests but incomplete end-to-end verification; these are **not** automatically called missing.

| Need | Category | Actual gap |
| --- | --- | --- |
| Consistent scoped access for nursery records/reports | Core required | Enforcement missing from the tested paths, F01/F02 |
| Atomically single-posted financial approvals | Core required | Missing adjustment claim/lock, F03 |
| Financial close enforced at every posting path | Core required | Queued billing write-time enforcement missing, F05 |
| Routine authorized guardian release | Core nursery required | Guardian authorization source missing from release contract, F06 |
| Safe duplicate registration resolution | Core required | Shared policy/explicit decision missing from quick-register path, F07 |
| Drawer-aware fee collection or verified alternative cashbook | Core if accepting cash | User flow integration missing, F09 |
| Real scheduled restore acceptance | Core operational requirement | Archive listing implemented; automatic actual restore proof missing, F12 |
| Human-friendly ECD rubric configuration | Important | Technical JSON remains the ordinary editing interface, F15 |
| Capability-driven portal availability/errors | Important | Course page does not distinguish disabled API from empty course list, F14 |
| Library fine desk | School-dependent | Backend exists; staff workflow unfinished, F16 |
| Transport/boarding/meal operations | School-dependent | Substantial code/tests; client-specific full workflow NOT VERIFIED, not declared absent |
| Advanced LMS/CBT, remote homework, POS, manufacturing/rental/repair | Optional or outside launch scope | Do not turn unfinished extras into nursery/primary launch obligations |

For best value, sell a reliable core: one pupil record, safe enrollment, quick class attendance, stage-appropriate assessment/report cards, accurate fees/receipts and understandable guardian access. For nursery clients, safe collection and the shared daily care record matter more than extra academic screens. For primary, dependable continuous assessment, retained term history, promotion and fees matter most.

Ugandan stages should remain configurable: nursery learning areas/descriptors, P1–P3 thematic literacy/numeracy and life skills, P4 transition, P5–P7 subject teaching. Current ECD/primary separation is a useful foundation. The school must approve its subject/learning-area setup, weights and report template. These recommendations follow [NCDC stage guidance](https://ncdc.go.ug/directoratesn/) and [NCDC nursery learning framework](https://ncdc.go.ug/books/learning-framework/); they do not certify curriculum or statutory compliance.

## 9. Security & Authorization Findings

The following is the **tested permission matrix**, not a complete authorization certificate. R means read, W means write, D means delete. Other create/approve/publish/reverse/export operations not listed are **NOT VERIFIED** for that role.

| Role | Runtime evidence | Access conclusion |
| --- | --- | --- |
| Operator / Super Admin | Bootstrap provisioning header used only for fictional local setup | Full platform-admin privileges, password/MFA recovery and production provisioning closure NOT VERIFIED |
| School Admin | Logged in through browser; created year/terms/pupils, fee schedule/payment, nursery data, parent invite/revoke | Selected permitted actions work; adjustment/period rules remain unsafe regardless of permission |
| Head Teacher / Principal | Result approval/amendment segregation and teacher ownership integration cases passed | Actual account/browser eight-action matrix NOT VERIFIED |
| Class Teacher, unassigned | Normal pupil R empty; individual R/D denied; nursery R/W and report R allowed unexpectedly | FAILED within-school authorization; F01/F02 |
| Assigned Teacher | Teacher ownership/cover, assessment and LMS authorization suites passed | Full browser timetable/attendance/marks scopes across old/current terms and streams NOT VERIFIED |
| Accountant / Bursar | School-fee integrity/concurrency and finance permission assertions passed | Actual seeded role's complete direct API matrix NOT VERIFIED; finance service defects reproduced as authorized users |
| Registrar | Registrar profile-save/placement and scoped pupil cases in wave13 passed | Actual account's complete browser lifecycle/export matrix NOT VERIFIED |
| Parent / Guardian | Own-child dashboard/care allowed, another child's care/pay quote 403; private draft hidden, shared day shown; identity revocation makes existing token 403 | Selected direct API boundaries passed; email onboarding and all family endpoints NOT VERIFIED |
| Student | Authentication/portal/LMS suites and source inspected | Complete current student browser/direct API matrix NOT VERIFIED |
| Anonymous | Direct pupil endpoint 401 | Representative authentication boundary passed, not all public/upload/download routes |

Multi-school evidence: representative foreign-school pupil read returned 404; school-tenant-isolation integration passed; all nine real low-privilege RLS tests passed across the kernel and production-role suites (raw SQL isolation, cross-school write rejection, no-context default deny, tenant reads/writes, pre-tenant system lookup). This is useful verified defense. Files, signed downloads, every export/search/job and all 622 table access paths are **NOT VERIFIED** end-to-end.

Current per-request permissions correctly invalidate the tested parent's revoked access. Within-school data scope is the problem in F01/F02. Hiding controls will not fix it. Privilege escalation, upload content scanning, account recovery, final rate-limit behavior, CSRF/cookie deployment policy, MFA enforcement and penetration testing on the deployed host are **NOT VERIFIED**. Do not disable the production fail-closed/RLS guards to make deployment boot.

## 10. Data Integrity Findings

Positive evidence: unique current year/term, one active enrollment, placement non-overlap, course/result scope uniqueness and same-school relation triggers were found by executable preflight. Placement/rollover/admission concurrency suites passed. The actual fresh migration set installs these guards. Decimal fields and UGX zero-decimal currency configuration exist; selected integer-UGX payment arithmetic was correct.

Remaining demonstrated contradictions:

| Data invariant | Violation |
| --- | --- |
| One adjustment has one economic effect | F03 creates two journals and twice the debit |
| Adjustment pupil matches invoice pupil | F04 stores conflicting pupil association |
| Closed term cannot acquire new bill postings | F05 accepts queued posting |
| Same likely child prompts a deliberate identity decision | F07 silently creates another identity |
| Attendance percentage reflects one contribution per session | F08 returns 150% |
| An authorized handover is recorded normally | F06 creates no release event |
| Cash close includes all cash collected through fee desk | F09 omits movement |
| Same pupil visibility applies across entry points | F01/F02 violate normal pupil access rules |

Audit infrastructure is present with actor, entity, time, request correlation and before/after values; care writes use `recordInTx`. Actual fixture audit records included six StudentProfile creations, six StudentEnrollment creations, care-log creation/updates, incident creation, fee-structure creation, parent identity changes and term financial changes. Passing audit service tests, these selected records and inspected transactional calls do not prove every login/logout/import/reversal/denial has the required record. A complete action-by-action audit completeness review is **NOT VERIFIED**. Logging an unauthorized successful action does not make it safe.

Existing API-configured database migration history contains **164 successfully applied, four rolled-back attempts and zero unfinished migrations**. Its 168 total history rows therefore do not establish migration drift. Historical marks passed aggregate parity. A production upgrade still needs checksum/provenance and staging-upgrade acceptance; no migration reset or history rewrite was attempted.

## 11. Financial Integrity Findings

The happy-path proof used real entities, not UI numbers. A published UGX 350,000 tuition structure/schedule produced four actual pupil invoices; re-running generation skipped the already billed pupils. A UGX 100,000 cash payment produced an allocation and changed the selected invoice residual to UGX 250,000. Accounting persistence was inspected. The browser dashboard reflected selected actual counts and collected amount at the time it was opened; **all** dashboard filters and figures were not reconciled.

| Chain component | Actual finding |
| --- | --- |
| Invoice | Generation and already-billed replay work for selected case; after-close posting fails policy |
| Payment | Selected partial collection persisted; payment concurrency/reversal/integrity suites passed |
| Receipt | API returned payment/allocation information; final printed receipt numbering, branding and delivery NOT VERIFIED |
| Balance | Selected subtraction correct; adjustment race creates an incorrect balance |
| Ledger | Posting infrastructure and tests are real; adjustment race creates duplicate ledger entries |
| Cash custody/daily cashbook | Cash payment has no drawer movement, and custody reconciliation misleadingly reports zero variance. Daily cashbook amount includes the receipt, but its date label is wrong on the tested Kampala host (F21) |
| Reports | Financial suites passed selected totals; all fee/GL/cash reports and historical filters NOT VERIFIED |
| External settlement | MTN/Airtel actual provider acceptance, callback, polling and bank statement matching NOT VERIFIED |

Bank/cash mixed payments, discounts/scholarships, advances, overpayments, reversals/refunds and penalties have implementation and automated cases. A complete bursar UI → receipt → ledger → period-close chain for each method is **NOT VERIFIED**. Floating/rounding boundaries, negative/zero payment attempts, different keys for identical transactions and failures halfway through every posting need release acceptance, not assumptions from one payment.

Keep one authoritative invoice/allocation/ledger chain; fix shared posting policies so batch, portal, adjustment, refund and worker routes cannot behave differently. F03 is an actual balance defect and alone prevents safe launch.

## 12. Academic Integrity Findings

Current academics are substantially stronger than a screen-only prototype. Passed suites include academic foundation, enrollment placement, teacher ownership/cover, gradebook, unified assessment, assessment roster/core, exam workspace/operations, result integrity, statutory output and rollover.

Current verified source/test behavior includes: fail-closed pupil views, permission-aware medical redaction in the generic profile, atomic registrar profile handling, stage-compatible grading scales, decimal band handling, mixed-programme refusal, requested-year awareness, approved result amendments, preservation of the released revision until replacement publication, freshness/checksum gates, and reading locked results as released results. These recent fixes are not listed as unresolved old bugs.

The ECD built-ins use Support/Beginning/Developing/Confident descriptors and avoid presenting nursery rankings/GPA/PLE divisions. `resolveScale` refuses incompatible scales instead of borrowing the primary default. School-specific bands and rounding still need school-approved samples. Nursery developmental observation is not fully verified merely because a numeric descriptor conversion exists.

Historic evidence: **1,788 GradeEntry marks matched the current Assessment/StudentAssessment projection**, including effective score and approval status. The fresh-database legacy parity test failed only because its precondition required historic rows. This supports existing historic migration parity, not every possible future report.

Attendance arithmetic F08 remains a core academic-data fault. Timetable teacher/class/room conflicts, all publication states/invalid mark combinations, transfer-aware historical report cards, repeat/graduation approvals and primary/nursery print layouts need an accepted school-specific browser scenario. These are **NOT VERIFIED** in full. No incorrect published grade was reproduced in this audit; do not claim that all results are broken.

## 13. Real-World Uganda School Simulation

Created a fictional **Green Valley Nursery and Primary** on a separate test database, with UGX, Africa/Kampala, Nursery ECD/Lower Primary/Upper Primary, Baby/Middle/Top/P1–P7, year 2026 and Terms 1–3. Direct registration created a Baby Class child and P1 child, with a guardian for the nursery child. Tests intentionally created duplicate nursery identities and a late-entry P1 child. The final normal queued-close test added a sixth pupil before queuing billing. These are audit data, not real children.

Admin, unassigned Class Teacher and guardian identities were exercised. The guardian invitation existed, but activation was fixture preparation because external delivery was disabled. The class teacher deliberately had no assignment to test fail-closed behavior. Integration suites additionally created teachers, streams, subjects, rosters, marks, result revisions, promotions and payments in their own fixtures. These separate fixtures must not be represented as one complete browser journey.

The operator setup, direct admission persistence, basic teacher denial, parent own-child sharing boundaries, selected billing/payment, role RLS and manual logical recovery succeeded. Duplicate registration, nursery confidentiality, register report confidentiality, ordinary collection, attendance rate, queued financial close and adjustment replay failed as described above.

The browser sign-in opened a school dashboard with an 11-step setup guide (five steps complete in the fixture), role guidance, approval queues, term context and empty states. These are useful onboarding patterns. The fixture's zero staff and ten classes were visible. The nursery selector contained duplicate identical pupil names, demonstrating the operational consequence of F07; its guardian release button then failed F06.

The full requested chain — school → year/terms → streams/subjects/teachers → parents/pupils → enrollment → billing/payment → attendance → assessment/approval/publication → promotion → all historical reports — **was not verified as one complete UI/API/database/audit/report chain**. Known failures already prevent its safe completion. No developer-only fixture step should be offered to a client as the workaround.

For ease of use, the acceptance flow should be: head teacher finishes school/term settings; registrar resolves identity and registers/places the pupil; bursar bills and collects against the same pupil; teacher lands on their assigned class for attendance and observations/marks; head approves results; guardian sees only approved/shared information; nursery gate staff records collection; administrators close/reconcile and retain the old term. Each role should have one clear current-term home with exceptions and next actions visible.

## 14. PRODUCTION READINESS SCORECARD

No overall score or average is assigned. NOT READY can mean a reproduced failure or insufficient required release evidence; the reason is stated.

| Gate / area | Status | Blocking issue or missing release proof |
| --- | --- | --- |
| A — Student Management | NOT READY | F07; complete return/withdraw/transfer/repeat/graduation browser history acceptance NOT VERIFIED |
| Enrollment | NOT READY | Strong constraints/tests, but complete client setup/capacity/history acceptance NOT VERIFIED; duplicate pupil identities remain |
| Attendance | NOT READY | F08 incorrect rate; all corrections/report consumers require recheck |
| B — Academic Management | NOT READY | Attendance defect, nursery privacy, complete curriculum/timetable/role setup acceptance NOT VERIFIED |
| Assessments | NOT READY | Important backend cases pass; actual school ECD/primary marking/approval/browser acceptance NOT VERIFIED |
| Results | NOT READY | Strong revision/grade/history tests; approved printed nursery/primary samples and complete portal release acceptance NOT VERIFIED |
| C — Finance | NOT READY | F03/F04/F05/F09; F13 if live MoMo offered |
| D — Administration | NOT READY | F10/F11 deployment and final school/role configuration acceptance outstanding |
| E — Parent/Student/Teacher | NOT READY | F01/F02 and F14; invitation delivery and full role portal journeys NOT VERIFIED |
| F — Security | NOT READY | F01/F02 actual unauthorized within-school access despite good tenant isolation |
| G — Data Integrity | NOT READY | F03/F04/F05/F07/F08 |
| H — Reporting | NOT READY | F02 unauthorized report, F08 wrong metric, full financial/historical export reconciliation NOT VERIFIED |
| I — Recovery | NOT READY | Manual DB restore succeeds; F12 and production database/files/offsite recovery still unproved |
| J — Real-World Operation | NOT READY | F06 collection fails; critical safety/money failures; full school browser lifecycle unproved |

## 15. FINAL GO / NO-GO DECISION

**NO-GO for tomorrow's live nursery/primary deployment.** This is based on reproduced business failures, not the presence of TODOs or cosmetic preferences.

Exact mandatory fixes: F01/F02 access leakage; F03 duplicate posting; F04 wrong-pupil adjustment; F05 closed-period billing; F06 normal guardian release; F07 duplicate registration; F08 attendance arithmetic; F09 reconciled cash collection; F10 public browser configuration; F11 container client resolution; F12 real recoverability. F13 must be fixed and provider-tested if live mobile money is included, or the capability must be explicitly excluded.

After fixing those, run and retain the objective acceptance evidence in section 17, complete the real eight-role direct API matrix, approve nursery and primary reports, build/boot the final artifacts with production policies, and perform the full core school lifecycle. A controlled demonstration with fictional data can continue. Do not classify it as a production pilot containing live children, payments or safeguarding records while the P0 failures remain.

Optional library/transport/boarding/advanced LMS features need only be accepted if part of the actual client's scope. Deferral must remove misleading links/promises and prevent partial writes, not conceal essential core errors.

## 16. FIX PRIORITY ROADMAP

Each row states change, dependencies, validation and completion condition; detailed tests follow in section 17.

### Phase 1 — Production Blockers (P0/P1)

| Issue / affected module / why | Required change | Dependencies | Validation and definition of done |
| --- | --- | --- | --- |
| F01/F02 — Auth/data scope; child confidentiality | One fail-closed scope policy in nursery, health, incidents, reports/exports | Agreed safeguarding/health role policy and term/section placement authority | D01/D02 pass for assigned/unassigned/former/other-school/guardian roles; no data leakage or changes |
| F03/F04/F05 — Fee posting; family money and reconciliation | Atomic approval claim + document serialization; association validation; close gate inside shared posting transaction | Accounting transaction contract and close/reopen lock policy | D03–D05 pass with real DB interleavings and exact GL/balance assertions |
| F06 — Nursery handover; safe everyday operation | Explicit guardian/authorization collector contract; direct state arguments; ordinary authenticated release | F01 scope policy and canPickup revocation | D06 passes ordinary/revoked/expired/wrong-child/override/duplicate cases and browser reload |
| F07 — Admissions; one coherent pupil identity | Shared likely-match/replay policy, deliberate override and correction/merge support | Registrar identity policy and admission idempotency | D07 proves no silent duplication or duplicate billing/history |
| F08 — Attendance; truthful academic reporting | One configured contribution/denominator per session in all reports | School late/excused policy | D08 passes independent calculations and printed/portal consumers |
| F09 — Cash; balanced day-end totals | Active-session integration or complete alternative school cashbook | Payment engine and cash-close permission policy | D09 matches receipt totals, expected cash, closing difference and GL |
| F10/F11 — Deployment; users can actually reach school app | Correct build-time public URLs/capabilities, workspace assertions, image smoke test | Docker host, domain/DNS/TLS, finalized enabled scope | D10/D11 pass on fresh artifacts/external device with production DB roles |
| F12 — Recovery; survive failure | Compatible tools and real DB+files/offsite restore drill | Storage policy, backup credentials, compatible PG version | D12 satisfies agreed recovery time/data-loss targets and records evidence |
| F13 — MoMo if sold; successful actual settlement | UUID references, documented auth/status protocol, replay-safe reconciliation | Provider sandbox/contracts and F03–F05 shared policies | D13 passes provider proof; otherwise capability excluded from scope and UI |

### Phase 2 — Core Functional Gaps (P2)

| Issue / reason / module | Required change / dependencies | Validation / definition of done |
| --- | --- | --- |
| F14 portal capability/false empty | Server capability contract and explicit query error state; finalized LMS scope | Disabled service has no active misleading link; actual error shows failure/retry; enabled own-child journey completes |
| F15 teacher-friendly rubric editing | Visual criteria editor and duplicate workflow; stage configuration | Teacher creates/uses nursery rubric without JSON, invalid fields explained accurately, report matches entered descriptors |
| F16 library fines if contracted | Connect existing API and accounting history; agreed school fine policy | Issue/overdue/return/fine/collect/receipt/history works and reconciles; no coming-soon promise |
| Complete core role lifecycle acceptance | Seed realistic assigned roles/classes/streams/subjects and run single scenario; Phase 1 completed | Eight-role direct action matrix, printed reports, promotion/return history and fee ledger reconciled without DB edits |
| Migration/upgrade acceptance | Verify history/checksums with release; backup before upgrade. Four rolled-back history attempts are explained, not evidence of missing applied migrations | Staging upgrade and constraint preflight pass without resetting history; retain recovery and checksum evidence |

### Phase 3 — Reliability / UX (P3, plus important P2 reliability)

| Issue / module / why | Change / dependencies | Validation / done |
| --- | --- | --- |
| F17 navigation; staff task clarity | Consolidate labels and role homes; capability policy | Registrar enrolls, teacher marks, bursar reconciles, gate staff releases without administrator/developer guidance |
| F18 payload; limited connections | Split routes/heavy dependencies; build tooling | Measure agreed cold-load and interaction budget on target phone/network; modules load only when needed |
| F19 CI/shutdown; trust release checks | Deterministic legacy fixtures, separate migration proof, stop/drain workers | Empty-DB suite exits cleanly; history gate explicit; no Prisma-after-disconnect errors or stranded outbox work |
| F21 cashbook date; accurate day-end signatures | School-timezone bounds/date-only label; finance date contract | Same requested school day and totals on Kampala/UTC hosts; midnight/month/year cases reconcile |
| F20 installed identity; wrong opening flow | School PWA name/orientation/start URL; explicit offline contract | Installed app opens school home on phone/desktop; no false offline-save success |

### Phase 4 — Enhancements (P4)

After the core gate passes, improve school-specific report templates, parent language/accessibility, guided setup and role exception dashboards. Dependencies are signed-off school policies and actual staff feedback. Done means a client completes the intended task more reliably with measured observation, not merely another screen added. Transport/boarding/advanced LMS should have separate acceptance plans when required.

## 17. DEFINITION OF DONE

Tests must use the final release build and real PostgreSQL, inspect persisted records and audit entries, and check authorized alternatives. Browser hiding alone is not success. Retain the actor/school/term configuration, request outcomes and expected/actual database totals with sensitive data removed.

| Test | Objective acceptance |
| --- | --- |
| **D01 — F01 nursery privacy** | Create children in two classes/streams and two schools, assigned and unassigned teachers, designated health/safeguarding staff. Call every care/immunisation/collector/incident list/detail/write/share/history/export route directly. Unassigned/other-class/other-school caller receives denial or policy-filtered data with no sensitive values and no writes. Revoked/former teacher also denied. Properly authorized caregiver/designated staff can complete their intended task; parent sees only deliberately shared own-child content. Verify DB unchanged for denials and required audit records |
| **D02 — F02 report scope** | Same users run every pupil/class/attendance/fee/assessment report and export with absent filters, arbitrary class IDs, historical term and pagination. No teacher widens an empty assignment to all. Roster, count, export and detail show the same term/section-authorized pupils; whole-school admin report reconciles to DB |
| **D03 — F03 adjustment concurrency** | Two distinct-key approvals of one pending UGX 1,000 debit start together, including controlled pending-read/commit interleavings. Exactly one journal and one economic change: residual 250,000→251,000. Replay returns original/clear conflict; approval versus rejection has one winner. Two legitimate different adjustments to same invoice accumulate correctly without lost updates. Rollback injection leaves no partial adjustment/GL/balance/audit state |
| **D04 — F04 invoice ownership** | Pupil B submits adjustment for pupil A's invoice, foreign-school invoice, non-fee document, cancelled/draft invoice and closed period. Each forbidden association/state returns clear 4xx with zero adjustment/journal/balance change. Matching eligible invoice permits valid adjustment and correct pupil history |
| **D05 — F05 close boundary** | Queue billing for an unbilled placed pupil, close financial term, then resume/process the existing queue. No new invoice/journal/receivable appears while closed. Race close with synchronous billing, queue processing, portal/payment/adjustment/refund posting: documented ordering is atomic; close snapshot and final ledger agree. Authorized reopen records reason/audit and permits intended work |
| **D06 — F06 safe collection** | In browser, choose canPickup guardian and press Released once. Correct collector, authorization source, pupil, actor/time and handover persist and remain after refresh. Revoked guardian, wrong pupil, expired/revoked third-party authorization and unauthorized staff rejected. Two clicks/retries produce one intended handover. Emergency override requires separate permission/reason and is visibly audited, never needed for normal guardian pickup |
| **D07 — F07 pupil identity** | Same child is quick-registered twice via UI/API and concurrent different-key calls; likely-match prompt/rejection occurs with no silent second record/placement/fee invoice. Repeat via application conversion/import/alternative create. Authorized registrar can distinguish genuinely different children with same name/DOB through documented override and audit; safely resolve accidental duplicates retaining histories |
| **D08 — F08 attendance math** | Independently calculate present/late/absent/excused mixtures including one late-only day. Every rate lies 0–100 with stated denominator/late policy; configuration changes produce expected values, not a clamp. Student history, class/term reports, parent view and printed output agree. Duplicate/correction, transfer/withdrawal and unauthorized edit do not add or expose unintended sessions |
| **D09 — F09 cash reconciliation** | Fee collector opens session, collects UGX 100,000 via individual and batch flows, prints receipt, then closes. Payments/allocations/GL and drawer/verified cashbook all increase once by 100,000. Deliberately missing movement must appear as UGX 100,000 variance or explicit untracked custody, never empty methods/zero variance. Missing session rejected or deliberately routed to accepted alternative; reversal/refund has matching movement. Replayed request adds no cash or GL; close requires exact expected/actual reconciliation |
| **D10 — F10 browser deployment** | Render final production Compose, build images and open staff/portal from an external device. Requests use real public/same-origin API, school features and portal org/name correct. Login/year/pupil/payment/care/result reads work; there are no localhost API calls, mixed content or disabled-menu/API mismatches. Public host exposes intended ports only |
| **D11 — F11 API image** | Build from clean lockfile with Docker daemon, confirm generated Prisma DMMF from actual runtime path, cold-boot with NOBYPASSRLS app/system/migrator roles. Run migrations/preflight and health/read/write smoke tests; restart retains state. Missing secret/unsafe DB role/unpolicyed endpoint fails closed as intended. No source-node_modules dependency on developer's host |
| **D12 — F12 recovery** | On final host image run scheduled backup, copy required uploads/settings with integrity and access controls, store offsite, then restore into a separate empty recovery environment. Compare pupil/enrollment/attendance/results, document residuals, payment allocations and balanced GL, plus opened uploaded files; login/read/write succeeds. Meet agreed RPO/RTO, document operators and record a real restoration, not pg_restore --list. Repeat with failed/corrupt backup and prove failure alerts |
| **D13 — F13 provider settlement** | Provider sandbox confirms UUID reference/token/currency contract, request acceptance, success/failure/timeout and documented callback or status polling. Out-of-order/repeated/forged callbacks, mismatched amount/currency/reference and lost callback do not double-post. One confirmed collection makes one payment/allocation/GL/receipt; statement reconciliation matches. Production low-value verification follows authorized provider procedure before client capability is enabled |

Final release acceptance also requires a single school-configured nursery and primary lifecycle through UI/API/DB/audit/reports, a full role action matrix and a restore of the final deployable artifact. Those proofs remain **NOT VERIFIED** until executed after remediation.

> **“Can this existing system safely and reliably operate a real nursery and primary school in Uganda today, based on the functionality that has actually been verified?”**

**No.** The system has valuable verified foundations, but reproduced child-record access leaks, duplicate money posting, closed-period billing, failed ordinary guardian collection, duplicate pupil creation and incorrect attendance prevent safe reliable production operation. Final deployment and automated recovery also lack the necessary proof. Correct the blockers and satisfy the objective tests above before using live school data.
