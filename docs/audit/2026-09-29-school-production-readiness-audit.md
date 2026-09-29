# SCHOOL MANAGEMENT SYSTEM FUNCTIONAL AUDIT

Audit date: 29 September 2026. Repository: `C:\Dev\School-Management`. Reviewed HEAD: `6213872`, including the existing uncommitted login-page change. Target: Ugandan nursery and primary schools. This is an independent audit of the current implementation, not a repair or deployment.

## 1. Executive Summary

**Decision: NO-GO for production today.** There is a substantial, working school system here, with considerably more than basic pupil CRUD. It includes nursery operations, enrollment history, assessment and examination workflows, accounting-backed fees, portals and school administration. However, feature breadth is not proof of safe daily operation. Current authorization failures expose children's retained homework and staff compensation; backup configuration crosses school boundaries. Deployment and several complete user workflows remain unverified.

The most important reproduced failures are:

- **A01 / P0:** A Class Teacher with no assigned class and no access to a pupil can nevertheless read that pupil's retained homework, score, feedback and attachments through legacy school endpoints. Disabling advanced LMS does not disable these routes.
- **A02 / P1:** The same teacher can retrieve confidential legacy staff compensation, including a fictional bank-account value, through ordinary staff-list access.
- **A03 / P1:** School B's administrator reads the private backup destination and manual schedule just set by School A. The configuration and scheduler are process-wide, although the UI/API is available to tenant administrators.
- **A04 / P1:** The installed multipart upload parser has high-severity denial-of-service advisories. The public-launch dependency gate needs reachable-path remediation and triage.
- **A05 / P1:** CI's production Compose check lacks required variables and fails configuration rendering. Its separate Prisma-image assertion also runs from a directory without that dependency. The shipped image, TLS and production-role startup were not executed because the Docker daemon was unavailable.

Several earlier audit failures **are fixed in this revision**, based on new independent probes: duplicate registration, late-attendance double counting, unassigned teacher access to nursery care/register reports, normal guardian pickup, concurrent fee-adjustment approval, closed-term queued billing, and fee collection through a cash drawer. The recovery tests now actually restore a backup and reject a damaged backup. These improvements are real; they do not resolve A01–A05.

The answer to “does it have all the functionality?” is therefore: **it has broad coverage of the core nursery/primary requirements, but not all required operational workflows have been demonstrated end to end, and some existing paths are unsafe or broken.** No blanket claim of complete functionality or readiness is justified.

The bounded inventory contains **81 workflows/features**: 6 IMPLEMENTED — VERIFIED, 60 PARTIALLY IMPLEMENTED, 2 INCONSISTENT, 8 OPTIONAL, 4 BROKEN and 1 NOT APPLICABLE. These are narrow workflow classifications, not a numerical readiness score. Independent verification completed 2,416 unit assertions and 671 integration assertions; API TypeScript checking and staff/portal builds passed. Fresh migration deployment and schema preflight passed. Integration tests used transpilation with diagnostics disabled, followed by the separate API TypeScript check. Historical parity, production image/host deployment and complete user journeys must not be inferred from those results.

Verification and limitations are recorded in [verification-summary.md](C:/Dev/School-Management/docs/audit/evidence-20260929/verification-summary.md). All mutating probes used fictional schools in the separate database `school_audit_20260929`. The existing configured database was queried only for aggregate counts inside a read-only transaction. No real pupil names, credentials or bank details were inspected or copied. No source repairs were made, and no messages or provider payments were sent.

## 2. System Architecture Summary

The active pnpm workspace contains a React/Vite staff application (`apps/web`), a separate React/Vite parent/student/teacher portal (`apps/portal`), a NestJS backend (`apps/api`) and shared contracts/permissions (`packages/shared`). The older nested `school-management-feature/school-management-main` is not the deployed workspace assessed here.

Prisma contains 638 models; the current migration directory contains 169 migrations. Fresh migration deployment and executable invariant checks passed on an isolated PostgreSQL 18 database. Production Compose specifies PostgreSQL 16; that target still requires an actual deployment/upgrade drill. The invariant preflight checked FORCE RLS on 622 scoped tables, same-school foreign-key protection and enrollment/placement business constraints.

The school backend includes foundation, people, admissions, enrollment, academics, teaching, course offerings, attendance, assessment, examinations, early years, fees, reporting, statutory reporting, analytics, portals, documents, library, transport, hostel/boarding, meals, front desk, LMS and CBT. Shared accounting, invoicing, HR, inventory and communications support those modules. File/endpoint counts establish inventory only, not completeness.

Authentication uses JWT, account-state checks and database-backed permission lookup. Access also depends on tenant context, Prisma scoping, PostgreSQL RLS and within-school data scope. The production design separates a NOBYPASSRLS application role from a BYPASSRLS system role. Actual role tests passed. **School RLS does not decide which pupils or confidential fields a teacher may see within the same school**; A01 and A02 bypass that second boundary.

StudentEnrollment and effective-dated EnrollmentPlacement represent academic history. Finance uses Decimal amounts, posted accounting documents, journal entries, approvals and shared cash/period controls. Transactions, idempotency, audit infrastructure and an event outbox are present. Individual callers still need correct authorization and atomic business-state transitions.

Production configuration now uses school capability flags, same-origin browser API paths, Caddy TLS and private service ports. Live mobile-money initiation and advanced LMS default off. Local file storage is the supported implementation; S3 storage is rejected rather than silently treated as working. Host persistence, offsite backups and recovery of uploaded files are deployment responsibilities that require proof.

## 3. Feature Coverage Matrix

Evidence: **H** live independent HTTP probes and selected DB checks; **B** actual browser; **I** repository integration assertions; **U** unit assertions; **S** inspected source; **D** executable database/tool checks. “PARTIALLY IMPLEMENTED” includes features with real implementation but incomplete verification. **NOT VERIFIED is not synonymous with MISSING.** Only the narrowly described complete workflow is marked IMPLEMENTED — VERIFIED. Optional modules become mandatory if included in the school's contract.

| Module | Feature | Status | Evidence | Severity | Notes |
| --- | --- | --- | --- | --- | --- |
| Access | Local staff sign-in and school home | IMPLEMENTED — VERIFIED | H/B: admin authenticates, dashboard opens | — | Password reset, MFA and production session lifecycle NOT VERIFIED |
| Foundation | Operator school bootstrap | IMPLEMENTED — VERIFIED | H/D: new school, admin, UGX, Kampala, ten classes | — | Complete operator API workflow; client setup still needs approval |
| Foundation | Baby/Middle/Top and P1–P7 | PARTIALLY IMPLEMENTED | H/D/S: seeded programmes/classes | — | All school-specific settings and subject mappings NOT VERIFIED |
| Foundation | Academic years, terms and boundaries | PARTIALLY IMPLEMENTED | H/I/S: year and term persisted | — | Full close/reopen/history browser journey NOT VERIFIED |
| Academics | Streams, capacity and override reasons | PARTIALLY IMPLEMENTED | I/S: placement/structure/concurrency cases | — | Registrar UI through historical exports NOT VERIFIED |
| Academics | Subjects, curriculum and weights | PARTIALLY IMPLEMENTED | I/S: academic and assessment modules | — | School-approved thematic/P4/upper-primary configuration NOT VERIFIED |
| Teachers | Staff creation and HR identity | PARTIALLY IMPLEMENTED | I/S: people/teacher identity/HR | — | Complete teacher onboarding and timetable UI NOT VERIFIED |
| Teachers | Class/subject assignment and pupil scope | INCONSISTENT | H: normal pupil denied, legacy homework allowed | P0 | A01; core scope fixes do not cover every read surface |
| Teachers | Confidential employment fields | INCONSISTENT | H: teacher gets compensation from staff list | P1 | A02; deprecated data remains exposed |
| Teaching | Schemes of work and lesson delivery | PARTIALLY IMPLEMENTED | S/I: teaching services/workspace | — | Planning → delivery → monitoring browser chain NOT VERIFIED |
| Timetable | Class/teacher/room scheduling and conflicts | PARTIALLY IMPLEMENTED | S/I: academics/timetable checks | — | Complete publication, replacement and role visibility NOT VERIFIED |
| Admissions | Application, interview, review and decision | PARTIALLY IMPLEMENTED | I/S: workflow/concurrency suites | — | Family/registrar document and decision UI NOT VERIFIED |
| Admissions | Accepted application to enrollment | PARTIALLY IMPLEMENTED | I/S: conversion workflow | — | Complete ordinary browser conversion NOT VERIFIED |
| Admissions | Application charges and receipts | PARTIALLY IMPLEMENTED | I/S: admission fee services | — | Provider and printed receipt chain NOT VERIFIED |
| Students | Registration, identity, guardian and placement | PARTIALLY IMPLEMENTED | H/D: valid register persists full chain | — | Full browser create/edit/import/refresh NOT VERIFIED |
| Students | Duplicate registration rejection | IMPLEMENTED — VERIFIED | H: repeated child rejected with 409 | — | Narrow exact duplicate case; fuzzy/import resolution needs acceptance |
| Students | Unique admission numbering | PARTIALLY IMPLEMENTED | H/D/I: generated numbers and sequence checks | — | Imported/custom identifiers across all paths NOT VERIFIED |
| Students | Profile, health and documents | PARTIALLY IMPLEMENTED | H/I/S: profile, care and health scope | — | Complete edit/download/history/UI NOT VERIFIED |
| Students | Transfer and class/stream movement | PARTIALLY IMPLEMENTED | I/S: effective placement lifecycle | — | UI → history → fees/results consequences NOT VERIFIED |
| Students | Withdrawal, reentry and suspension | PARTIALLY IMPLEMENTED | I/S: lifecycle controls | — | Full real-user sequence and reports NOT VERIFIED |
| Students | Repeat, promote and graduate | PARTIALLY IMPLEMENTED | I/S: rollover/promotion services | — | Full head-teacher approved browser rollover NOT VERIFIED |
| Guardians | Multiple guardians and relationships | PARTIALLY IMPLEMENTED | H/I/S: linked fictional guardian | — | Custody change/revoke/duplicate family UI NOT VERIFIED |
| Guardians | Portal onboarding and recovery | PARTIALLY IMPLEMENTED | I/S: onboarding and identity controls | — | Actual invitation delivery/acceptance/reset NOT VERIFIED |
| Guardians | Own-child-only access | PARTIALLY IMPLEMENTED | I/S: portal/tenancy assertions | — | Every family endpoint/export and browser journey NOT VERIFIED |
| Enrollment | Active enrollment and dated placements | PARTIALLY IMPLEMENTED | H/D/I: records, unique/exclusion constraints | — | Complete multi-term browser lifecycle NOT VERIFIED |
| Enrollment | Concurrent admissions and capacity | PARTIALLY IMPLEMENTED | I/D: admission concurrency/invariants | — | All import/admin override/report variants NOT VERIFIED |
| Attendance | Daily/session register and corrections | PARTIALLY IMPLEMENTED | H/I: late mark and history persist | — | Teacher UI/correction/lock/offline chain NOT VERIFIED |
| Attendance | Configured late-day contribution | IMPLEMENTED — VERIFIED | H: one late row → 100% with contribution 1 | — | Missing policy returns explicit null rate, not invented percentage |
| Attendance | Summaries, history and exports | PARTIALLY IMPLEMENTED | H/I/S: attendance/report assertions | — | All filters, exports and role variants NOT VERIFIED |
| Nursery | Care notes, meals, naps and toileting | PARTIALLY IMPLEMENTED | H/I/S: care note persists; scope denies outsider | — | Full classroom/parent handoff UI NOT VERIFIED |
| Nursery | Immunisation, health and safeguarding | PARTIALLY IMPLEMENTED | I/S: sensitive grants and scope controls | — | All authorized roles and incident escalation NOT VERIFIED |
| Nursery | Guardian pickup and replay safety | PARTIALLY IMPLEMENTED | H/D/B: release and replay → one event, UI history | — | API → DB → UI read verified; gate-worker UI release NOT VERIFIED |
| Nursery | ECD observations and developmental reports | PARTIALLY IMPLEMENTED | I/S: nonranking ECD configuration | — | Real developmental narrative through printed parent report NOT VERIFIED |
| Assessment | Setup, roster and assessments | PARTIALLY IMPLEMENTED | I/S: unified roster/core suites | — | Full teacher setup and roster refresh UI NOT VERIFIED |
| Assessment | Marks, absence/exemption and validation | PARTIALLY IMPLEMENTED | I/S: result/assessment assertions | — | Full teacher browser entry and all denial cases NOT VERIFIED |
| Assessment | Moderation and published-state protection | PARTIALLY IMPLEMENTED | I/S: grade separation/result integrity | — | Live multi-user edit/correction/publish chain NOT VERIFIED |
| Exams | Sessions, scheduling and candidate operations | PARTIALLY IMPLEMENTED | I/S: exam workspace/phase suites | — | Whole examination-cycle browser operation NOT VERIFIED |
| Results | Primary grading, weighting and ranking | PARTIALLY IMPLEMENTED | I/S: gradebook/result integrity | — | Independently hand-calculated school report comparison NOT VERIFIED |
| Results | Publication and controlled correction | PARTIALLY IMPLEMENTED | I/S: immutable revision/release controls | — | Actual parent viewing after correction NOT VERIFIED |
| Results | Nursery and primary report-card printing | PARTIALLY IMPLEMENTED | I/S: templates/reporting code | — | Final PDF layout, signatures, totals and printer acceptance NOT VERIFIED |
| Statutory | Candidate/UNEB-related exports | PARTIALLY IMPLEMENTED | I/S: statutory datasets/export suite | — | Current official format and submission acceptance NOT VERIFIED |
| Fees | Versioned fee structures and schedules | PARTIALLY IMPLEMENTED | H/I: publish tuition and generate invoice | — | All school charge/discount/browser configuration NOT VERIFIED |
| Fees | Invoice generation and duplicate prevention | PARTIALLY IMPLEMENTED | H/I/D: invoice persists, integrity tests | — | Print/cancel/rebill/import UI NOT VERIFIED |
| Fees | Partial collections and allocations | PARTIALLY IMPLEMENTED | H/D: 350,000 less 100,000 → 250,000 | — | Full receipt printing/parent visibility NOT VERIFIED |
| Fees | Advance credit, overpayment and allocation | PARTIALLY IMPLEMENTED | I/S: fee integrity/concurrency | — | Full bursar browser settlement NOT VERIFIED |
| Fees | Waivers, scholarships and discounts | PARTIALLY IMPLEMENTED | I/S: fee policies/assignments | — | Approval/report/ledger effects in UI NOT VERIFIED |
| Fees | Adjustment ownership and dual approval | PARTIALLY IMPLEMENTED | H/D: wrong pupil denied, maker denied, one journal | — | HTTP business chain verified; bursar UI NOT VERIFIED |
| Fees | Financial close and queued jobs | PARTIALLY IMPLEMENTED | H/D: closed run and direct billing rejected | — | Every mutation and scheduled job after close NOT VERIFIED |
| Fees | Drawer cash collection and day close | PARTIALLY IMPLEMENTED | H/D: closed drawer rejected, open movement/close | — | Physical cashier/receipt/day report UI NOT VERIFIED |
| Fees | AR subledger versus posted GL | IMPLEMENTED — VERIFIED | H/D: expected 251,000 equals GL, variance 0 | — | Narrow fictional posted scenario, not all historical accounts |
| Fees | Bank import and reconciliation | PARTIALLY IMPLEMENTED | I/S: payment/accounting services | — | Actual statement import/matching and mixed allocations NOT VERIFIED |
| Fees | Refund, reversal and credit notes | PARTIALLY IMPLEMENTED | I/S: financial integrity assertions | — | Full authorized browser/cash/report sequence NOT VERIFIED |
| Fees | Penalties and periodic jobs | PARTIALLY IMPLEMENTED | I/S: services/period guards | — | Actual scheduled runs, rounding and recovery NOT VERIFIED |
| Fees | Live MTN/Airtel initiation and settlement | OPTIONAL | S: provider modules; production default off | P1 if enabled | Provider sandbox and real settlement NOT VERIFIED; keep disabled |
| Fees | Recording externally confirmed MoMo receipts | PARTIALLY IMPLEMENTED | S/I: payment-method support | — | Confirmation/receipt/reconciliation workflow NOT VERIFIED |
| Portal | Parent fees, attendance and results | PARTIALLY IMPLEMENTED | I/S: portal modules and own-child controls | — | Full family browser journey NOT VERIFIED |
| Portal | Teacher self-service and marking | PARTIALLY IMPLEMENTED | I/S: teacher routes and ownership | P2 | A07: marking entry asks for raw Assessment ID |
| Portal | Student home and learning | OPTIONAL | I/S: student routes | — | Age-appropriate client scope and browser acceptance required |
| Communication | Announcements/templates/recipient selection | PARTIALLY IMPLEMENTED | I/S: outbox/communications | — | Staff approval and full recipient UI NOT VERIFIED |
| Communication | Email/SMS delivery and emergency notices | PARTIALLY IMPLEMENTED | S/I: adapters; audit delivery disabled | — | Actual delivery/retry/opt-out/receipt/emergency proof NOT VERIFIED |
| Reports | Student register scope and exports | PARTIALLY IMPLEMENTED | H: unassigned teacher gets empty register | — | Previously leaking path fixed; all formats/roles NOT VERIFIED |
| Reports | Fee, attendance and historical reports | PARTIALLY IMPLEMENTED | H/I: selected figures reconcile | — | Every total/filter/export/refresh NOT VERIFIED |
| Dashboard | Current school pupil/fee overview | PARTIALLY IMPLEMENTED | B/H/D: selected counts and amounts match | — | All metrics and date/role variants NOT VERIFIED |
| Library | Catalogue/issue/return/fines | OPTIONAL | I/S: library services and UI | — | Whole library desk NOT VERIFIED; do not reuse old backend-only claim |
| Transport | Routes, trips, boarding safety and charges | OPTIONAL | S: transport modules | — | Driver/pickup/emergency/capacity/billing acceptance required if used |
| Boarding | Beds, check-in, attendance and charges | OPTIONAL | S: hostel modules | — | Complete boarding operation NOT VERIFIED |
| Meals | Plans, feeding, kitchen and finance | OPTIONAL | I/S: meal lifecycle/finance suites | — | Whole feeding-desk UI NOT VERIFIED |
| HR | Uganda payroll, leave and employment | OPTIONAL | I/S: payroll/proration/HR suites | P1 | A02 applies even if payroll is excluded from launch |
| Legacy LMS | Retained homework read access | BROKEN | H: denied pupil but three homework routes disclose data | P0 | A01; ordinary school module loads these routes |
| Legacy LMS | Submission-list pagination | BROKEN | H: ordinary GET returns 500 | P2 | A06: generic createdAt sort absent from model |
| Advanced LMS/CBT | Online courses and exams | OPTIONAL | I/S: modules, default disabled | — | Full learning/payment/browser scope NOT VERIFIED |
| Documents | Upload, authorized download and versions | PARTIALLY IMPLEMENTED | I/S: DMS/school docs | P1 | A04 parser advisories; files restore and malware handling NOT VERIFIED |
| Administration | User grants, audit and configuration | PARTIALLY IMPLEMENTED | H/I/S: per-request checks and fictional audit rows | — | Complete role/action/export matrix NOT VERIFIED |
| Tenancy | DB boundary and raw-role enforcement | PARTIALLY IMPLEMENTED | D/I: real app/system role tests pass | P1 | A03: process memory is outside RLS |
| Database | Fresh migrations and invariant preflight | IMPLEMENTED — VERIFIED | D: all 169 migrations and preflight pass | — | PostgreSQL 16 upgrade/prod host NOT VERIFIED |
| Recovery | Scratch restore and damaged-backup rejection | PARTIALLY IMPLEMENTED | I: actual restore/manifest/ledger checks | P1 | A03; full host/files/offsite/RTO drill NOT VERIFIED |
| Recovery | Tenant backup configuration and schedule | BROKEN | H: B reads A destination/manual schedule | P1 | A03; scheduler and config shared |
| Deployment | CI and production image/boot gate | BROKEN | D/S: CI Compose render failure; image cwd defect | P1 | A05; actual Docker/TLS startup NOT VERIFIED |
| Reliability | Jobs, shutdown, alerting and outages | PARTIALLY IMPLEMENTED | I/S: outbox/worker assertions | P2 | A08: tests leave handles/shutdown errors; host outages NOT VERIFIED |
| Installed app | Mobile, PWA and offline writes | PARTIALLY IMPLEMENTED | S/B: selected browser pages; PWA build | P3 | Slow links/device accessibility/replay NOT VERIFIED |
| Generic ERP | Manufacturing/rental/repair/retail | NOT APPLICABLE | S/I: outside school launch | — | Exclude from school feature promises |

No MISSING classification is assigned merely because a workflow was not exercised. The demonstrated gaps and unverified operational requirements are separated in section 8.

## 4. Workflow Audit

| Workflow | Actual traced chain and successful evidence | Failure or remaining proof |
| --- | --- | --- |
| School setup | Operator bootstrap → authenticated admin → seeded Baby/Middle/Top/P1–P7 → API-created current year/term → persisted school | Browser setup of streams/subjects/teachers/timetable and final client sign-off NOT VERIFIED |
| Pupil registration | Staff-page call/source → register controller → shared admission/identity logic → partner/profile/guardian/enrollment/dated placement → HTTP response; repeat returns 409 | Full UI entry/edit/import/movement/withdrawal/promotion/history chain NOT VERIFIED |
| Teacher pupil scope | Normal pupil route returns 403; nursery care/pickup-contact routes deny unassigned teacher; register report returns an empty permitted result | Legacy homework routes return the same otherwise forbidden pupil's submission and roster: A01 |
| Attendance | Late session POST → stored row → pupil history query → policy explicitly configured → total 1, late 1, denominator 1, rate 100% | Missing policy correctly signals policyMissing/null; full daily teacher UI/correction/offline/report chain NOT VERIFIED |
| Nursery collection | Guardian linked with collection permission → release POST → replay same request → exactly one DB event → nursery Collection tab displays guardian handover history | Complete gate-worker browser action, denied/custody-change cases and real emergency escalation NOT VERIFIED |
| Nursery sensitive records | Fictional care note persisted; teacher with no placement access denied | Authorized health/safeguarding roles and parent sharing tested only to repository assertion scope; full UI NOT VERIFIED |
| Fees | Publish UGX 350,000 tuition → schedule/generate → no-open-drawer cash rejected → open with 10,000 float → collect 100,000 → residual 250,000 → drawer expected 110,000 → count and close | Printed invoice/receipt, bank/import/refund/full cashier browser journey NOT VERIFIED |
| Adjustment | Wrong-pupil request rejected; valid 1,000 debit created; maker self-approval denied; distinct Head Teacher approves concurrently through two requests → one journal → residual 251,000 | Complete browser approval queue/audit display NOT VERIFIED; no current double-post reproduced |
| Financial close | Queue billing while open → close through ordinary authorized route → queued processing and new direct generation rejected → invoice count unchanged; queued pupil unbilled | Every penalty/transport/meals/job mutation at close NOT VERIFIED |
| Assessment/results | Current UI/API/service/schema traced; assessment, roster, grade separation, result integrity and rollover assertions pass | One independently entered teacher marksheet → hand-calculated grade → moderation/publication → PDF → parent view → controlled correction → promotion has NOT VERIFIED steps |
| Family portal | Source and onboarding/own-child assertions exist; portal build passes | Actual email invitation/activation, password recovery and complete family browser journey NOT VERIFIED |
| Homework | Direct submission/detail/by-class requests execute persisted legacy reads | Incorrect scope returns private content; list additionally fails with 500 (A01/A06) |
| Staff confidentiality | Ordinary teacher → staff-list permission → generic Prisma read → JSON includes compensation | Confidential-field projection absent (A02) |
| Backup/recovery | Integration creates dump → restores scratch DB → compares manifest/global ledger; damaged archive rejected; restore over live DB refused | Separate schools share current config/scheduler (A03); production host/files/offsite/alerts NOT VERIFIED |
| Deployment | Staff and portal production builds pass; merged production Compose examined; fresh DB and role preflight pass | Exact CI config fails; image/TLS/role/schema/volume boot NOT VERIFIED (A05) |

Screens were not counted as successful workflows. Browser evidence is limited to real sign-in, school dashboard/navigation and reading the persisted pickup history. Other positive business probes used direct HTTP, not synthesized UI success.

## 5. Critical Findings — P0/P1

### A01 — P0 — Unassigned teacher reads retained pupil homework

**Module:** school legacy LMS / authorization. **Problem:** an unassigned Class Teacher receives 403 for `/school/students/:id`, yet receives 200 for `/school/submissions/:submissionId`, `/school/homework/:id/detail` and `/school/homework/by-class/:classId`. Responses contain private fictional submission text, score, feedback, attachment URL and, on the detail route, the pupil's name/admission number.

**Evidence:** [extended-http.json](C:/Dev/School-Management/docs/audit/evidence-20260929/extended-http.json). Controllers gate reads with school-read permission at [lms.controller.ts](C:/Dev/School-Management/apps/api/src/modules/school/lms/lms.controller.ts:30). [lms.service.ts](C:/Dev/School-Management/apps/api/src/modules/school/lms/lms.service.ts:165) filters a class but does not authorize it; detail uses placement for roster correctness but does not apply the requesting teacher's scope. SubmissionService inherits an unrestricted within-tenant generic read. [school.module.ts](C:/Dev/School-Management/apps/api/src/modules/school/school.module.ts:67) loads LmsModule independently of advanced-LMS capability.

**Impact:** private child records can be retrieved directly despite the normal pupil screen denying access. No cross-school pupil leak is claimed. **Root cause:** general school permission and tenant filtering substituted for pupil/class authorization. Disabling legacy writes does not secure retained reads. Aggregate read-only inspection found 45 assignments and 44 submissions in the existing configured database, so this is not solely a hypothetical empty-table concern; their provenance was not inspected.

**Fix:** apply the central teacher/pupil scope to every legacy list/detail/class/submission/attachment path, with safe response projection; or intentionally retire all legacy reads through explicit migration/archival and route denial. Keep any authorized historical-view capability documented. See objective acceptance test D01.

### A02 — P1 — Ordinary staff read exposes legacy compensation

**Module:** people/HR confidentiality. **Problem:** the unassigned Class Teacher, without HR/payroll grants, obtains `{basicSalary:900000, bankAccount:"FICTIONAL-PRIVATE-BANK"}` through `/school/staff`.

**Evidence:** extended HTTP results. [staff.controller.ts](C:/Dev/School-Management/apps/api/src/modules/school/people/staff.controller.ts:12) gates lists/details with school-read. [staff.service.ts](C:/Dev/School-Management/apps/api/src/modules/school/people/staff.service.ts:19) inherits BaseCrud; including selected partner fields does not omit StaffProfile scalar JSON. New creation deliberately empties compensation and updates omit it, but older retained values remain readable. Read-only aggregate inspection found 50 staff profiles with nonempty compensation.

**Impact:** sensitive employment/pay/banking data can reach teachers through an otherwise legitimate directory API. **Root cause:** mutation deprecation did not establish read-field confidentiality. **Fix:** explicit public directory DTO/projection; separate HR/payroll response guarded by appropriate grants, with migration/redaction of legacy fields where appropriate. Do not remove real values without an approved migration. See D02.

### A03 — P1 — Backup configuration and scheduling cross school boundaries

**Module:** backup / tenant administration. **Problem:** after School A changes its backup destination to `AUDIT29_PRIVATE_BACKUP_DESTINATION` and frequency to manual, School B's administrator GET returns A's destination and frequency.

**Evidence:** [backup-scope-http.json](C:/Dev/School-Management/docs/audit/evidence-20260929/backup-scope-http.json). [backup.service.ts](C:/Dev/School-Management/apps/api/src/modules/backup/backup.service.ts:87) returns singleton `this.config`; update mutates it, saves under the calling tenant and reschedules shared cron jobs. Tenant database settings/RLS cannot isolate process memory. The global database dump uses the configured privileged backup connection.

**Impact:** one school reads another's private recovery configuration and can affect process-wide backup scheduling. Changing to manual clears normal jobs for the shared instance. Actual backup-download exfiltration, destination credentials and destructive restore were not attempted; do not infer those as reproduced outcomes. **Root cause:** tenant-facing controls manage a shared operator-level resource. **Fix:** separate operator-only whole-database backups from tenant-specific export settings, or implement genuinely keyed configuration/scheduling with appropriate secret redaction. Dedicated one-school hosting reduces the cross-school scenario but does not remove the need for correct backup authority. See D03.

### A04 — P1 — Reachable upload parser needs security remediation

**Module:** dependencies/files. **Problem:** production dependency audit reports 30 high, 38 moderate and 4 low findings (zero critical). These are package/path findings, not 72 demonstrated exploits. Runtime resolution identifies Nest's Multer 2.1.1 plus a direct legacy Multer 1.4.5-lts.2 dependency. The document upload FileInterceptor accepts multipart requests; the installed runtime parser is affected by high-severity field-name/index denial-of-service advisories.

**Evidence:** [dependency-summary.json](C:/Dev/School-Management/docs/audit/evidence-20260929/dependency-summary.json), [files.controller.ts](C:/Dev/School-Management/apps/api/src/kernel/files/files.controller.ts:31), and published advisories [GHSA-72gw-mp4g-v24j](https://github.com/advisories/GHSA-72gw-mp4g-v24j), [GHSA-wc9g-mqfw-jrwm](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm), [GHSA-535w-7cp7-47q4](https://github.com/advisories/GHSA-535w-7cp7-47q4). The latter two specify patched Multer >=2.3.0. No denial-of-service exploit was run.

**Impact:** a permitted upload user can potentially affect shared availability with malformed multipart input; the 25MB file cap does not itself remediate field-parser defects. Other advisories, including Nodemailer and archive-related dependencies, require reachability review. Browser-only Axios paths and optional adapters must not be assumed vulnerable in every deployment merely from the report.

**Fix:** update compatible runtime packages and lockfile, remove obsolete direct copies, exercise uploads and mail/backup paths, and record a defensible disposition for every high/critical advisory. See D04.

### A05 — P1 — Production artifact gate is broken and launch remains unverified

**Module:** CI/deployment. **Problem:** rendering Compose with exactly the variables declared in the CI compose job and an empty env file exits 1: `COMM_ENCRYPTION_KEY` is required but absent. Required public URLs, backup connection and sender/school values also need explicit CI fixtures. Separately, the CI Prisma assertion runs `docker run school-api:ci node -e "require('@prisma/client')"` from `/app`, where the pnpm root lacks that dependency. Local root resolution fails; Dockerfile assertions correctly change to `apps/api`, while CI does not.

**Evidence:** [ci-compose.json](C:/Dev/School-Management/docs/audit/evidence-20260929/ci-compose.json), [ci.yml](C:/Dev/School-Management/.github/workflows/ci.yml:160), and the runtime Dockerfile. The Prisma-image defect is a source/module-resolution finding, not an executed Docker failure. Docker Desktop's daemon pipe was unavailable. Existing image smoke configuration uses development mode and liveness; it is insufficient evidence of production schema/RLS/readiness.

**Impact:** CI cannot currently supply trustworthy deployment acceptance. A passing local build does not prove a school can log in to the shipped artifact. **Fix:** supply nonsecret CI-only required fixtures, use the correct dependency directory in the assertion, then migrate PostgreSQL 16, provision actual roles and boot the production configuration with web, portal, TLS and persistent volumes. Probe readiness and a real school operation. See D05.

## 6. Major Findings — P2

**A06 — Legacy submission listing returns 500.** GET `/school/submissions` as an authenticated teacher fails. [base-crud.service.ts](C:/Dev/School-Management/apps/api/src/kernel/common/base-crud.service.ts:47) defaults to sorting `createdAt`; HomeworkSubmission has `submittedAt`, not `createdAt`. Override the model's sort and then apply A01 scope. Acceptance: permitted list/search/pagination returns stable rows; unauthorized list contains no forbidden pupils; no Prisma field error.

**A07 — Teacher marking entry requires a raw Assessment ID.** [marking.tsx](C:/Dev/School-Management/apps/portal/src/routes/teacher/marking.tsx:70) has an Assessment ID field to open the marksheet. A teacher should be able to choose an assigned class/subject/term/assessment through ordinary navigation. This is a source-confirmed usability gap in this portal entry point, not proof that the staff production markbook lacks a selector. Replace/augment it with assigned assessment navigation. Acceptance: an invited teacher marks and submits without looking up a UUID or using the database/API console.

**A08 — Test shutdown does not reliably complete.** Unit and selected integration runs printed completed assertions but left processes running; the restore/integration teardown also logged disconnected Prisma/outbox shutdown errors. This reduces the reliability of CI and outage tests. It is not evidence that production transactions lost data. Close timers, worker subscriptions, database/event dependencies in order and make suites exit naturally. Acceptance: complete strict tests exit without forceExit, hanging handles or teardown errors, then prove production graceful termination and outbox replay separately.

**A09 — Core acceptance evidence is incomplete.** Complete parent activation/results/fees, teacher marking-to-publication, printed documents, daily cashier and pupil lifecycle browser journeys remain NOT VERIFIED. Deployment, load, offsite files recovery and actual communications also remain NOT VERIFIED. This is an evidence gap, not a claim that every corresponding implementation is absent. Resolve before live use of each contracted function; D06–D09 specify the gate.

## 7. Minor Findings — P3/P4

- **P3:** Staff production build emits large-chunk warnings; PWA precache is approximately 5.6MiB. School operation on slow or intermittent connections, inexpensive phones and keyboard/screen-reader use needs focused acceptance. Large output alone is not a functional failure.
- **P3:** School-specific branding, default nursery age policies and the P4 transition programme configuration need head-teacher review. Defaults should not be represented as regulatory certification.
- **P4:** Library category-breakdown UI remains a “coming soon” enhancement. It is deferrable and does not justify classifying the entire library workflow as missing.
- Optional transport/boarding/online learning features can be deferred by keeping them out of the enabled launch scope and contract. Deferment does not excuse exposed legacy routes or confidential fields.

## 8. Missing Functionality and Incomplete Operational Requirements

**Core required:** No whole core module was conclusively found absent. Required evidence is missing for complete user-operated enrollment/lifecycle, teacher assessment-to-parent report, school report-card print acceptance, real family onboarding, cash receipts/day reporting and production deployment. These remain NOT VERIFIED, not certified features. A07 is an actual incomplete teacher-portal entry workflow.

**Important:** End-to-end SMS/email delivery, sender configuration, failed-message recovery, production monitoring, offsite retrieval and whole-host/files restoration have not been demonstrated. Adapters and recovery code exist. The actual scheduled scratch restore added recently is implemented and tested; do not retain the older claim that scheduled recovery verification is missing.

**School-dependent:** Boarding, transport, library, meals, payroll and statutory export formats require explicit acceptance when included. Schools need a reviewed curriculum/subject/assessment/fee configuration, rather than accepting bootstrap defaults unchanged.

**Optional:** Advanced LMS/CBT, student self-service for very young pupils, live provider-initiated mobile money and library analytics can be excluded. Production live-MoMo is disabled in the reviewed configuration. Provider acceptance is NOT VERIFIED; this audit does not repeat an older provider defect as a current reproduced finding.

## 9. Security & Authorization Findings

Normal pupil, nursery private care, pickup-contact and register-report controls now deny or filter the unassigned teacher in the independent probes. Anonymous pupil access returns 401. Maker self-approval and wrong-pupil adjustments are rejected. Production-style RLS tests pass using actual non-bypass application and bypass system roles.

Nevertheless A01 proves that direct API access defeats intended within-school pupil restrictions, and A02 proves that field confidentiality is not enforced by generic directory permission. A03 demonstrates isolation failure outside the database. These require tests across alternate entry points, not only the ordinary screen. Sensitive read responses need explicit projections and parent/teacher/staff/operator policies.

The entire role/action matrix for administrator, head teacher, registrar, class/subject teacher, bursar, parent, student and operator is **NOT VERIFIED**. Neither is every export/search/file/background-job route. No new unauthorized published-mark write or arbitrary financial posting was reproduced. Current passing tests are supportive evidence, not an exhaustive penetration test or deployment security certificate.

## 10. Data Integrity Findings

Fresh schema preflight passes active-enrollment uniqueness, placement overlaps, required business indexes, same-school FK guards and RLS. Registration creates consistent identity, enrollment and placement rows; the independent duplicate request is rejected. Guardian pickup replay produces one event. Fee-adjustment concurrent approvals produce one journal. No new contradiction was reproduced in those cases.

Authoritative history should remain effective-dated enrollment/placement, with current-class projections kept synchronized. Existing migration repair and legacy backfill need an upgrade drill on a production-like copy before rollout. Counts queried from the existing database establish retained legacy data presence only; they do not certify all historical consistency. Existing-data cleanup, import roundtrips, soft-delete/restoration, every foreign-key path and final migration rollback strategy are NOT VERIFIED.

The synthetic published-result fixture in the HTTP authorization probe was inserted directly solely to test visibility. It is **not evidence that grades were calculated or a report was published through ordinary actions**. Likewise a retained homework fixture was inserted to test unsafe legacy reads; it does not establish new homework creation support.

## 11. Financial Integrity Findings

The tested chain is backed by actual posted documents and ledger queries:

| Stage | Observed result |
| --- | --- |
| Published fee/scheduled invoice | UGX 350,000 |
| Collected cash | UGX 100,000 |
| Initial residual | UGX 250,000 |
| Drawer opening float | UGX 10,000 |
| Drawer expected/count at close | UGX 110,000 |
| Approved debit adjustment | UGX 1,000, exactly one journal under concurrent approval |
| Final residual/subledger | UGX 251,000 |
| Posted AR GL | UGX 251,000 |
| Reconciliation variance | UGX 0 |
| Closed-term queued/direct billing | Rejected; invoice count stays 1; queued pupil invoices stay 0 |

Cash collection without an open drawer is rejected. Wrong-pupil adjustment and maker approval are rejected. These independently reproduce the repaired business rules. Drawer expected amount includes float; fee income/collection is 100,000, not 110,000. The selected browser dashboard read matched collection and debt values at that point.

This is narrower than certifying all finance. Printed receipt identifiers/layout, discounts/waivers, advance credits, refund/reversal, bank imports, opening balances, fee statements, all ancillary charges and every accounting report remain verified only to the cited test/source scope. End-to-end browser acceptance and historical financial reconciliation are NOT VERIFIED. Do not launch live MoMo initiation until provider idempotency, callback authentication, retry, settlement and reconciliation are accepted. Manual recording of independently confirmed MoMo is a separate workflow.

## 12. Academic Integrity Findings

The schema and current services support programmes, class/stream structures, assigned teachers, terms, attendance, assessment rosters, absence policies, grading schemes, moderation, publication revisions and promotion. Passing assessment, result-integrity, grade-separation, enrollment and rollover assertions provide substantial evidence. No current published-grade mutation or result-double-count failure was reproduced.

Nursery is configured as ECD/nonranking rather than simply another ranked examination class. Actual observation narratives and final parent-facing developmental reports need school approval. P1–P3 thematic learning, P4 transition and P5–P7 subject-based learning must be configured and accepted deliberately. NCDC describes those stage distinctions on its [Directorates page](https://ncdc.go.ug/directorates/) and provides an [ECD learning framework](https://ncdc.go.ug/books/learning-framework/). The bootstrap's P4 programme grouping is a configuration review point, not sufficient proof of curriculum compliance.

An independent complete real-teacher marksheet, hand-calculated result comparison, moderation/publish, PDF print, parent visibility, controlled correction, promotion/repeater/graduation and historic retention chain is NOT VERIFIED. Passing assertions must not be substituted for that acceptance. Current UNEB-related file submission acceptance was not tested against an official live submission specification.

## 13. Real-World Uganda School Simulation

The fictional Green Valley Audit Nursery and Primary was bootstrapped through the operator API with Uganda/UGX/Kampala settings and ten classes. A current 2026 academic year and Term 3 were created. Three fictional pupils represented a nursery child, a P1 child and a queued-billing child; a guardian, unassigned teacher, staff fixture and head-teacher approver exercised distinct responsibilities. A second fictional school tested the backup boundary.

1. **Registrar setup and admission:** HTTP registration persists identity, guardian, enrollment and class placement. Duplicate registration fails safely. Full registrar browser lifecycle is NOT VERIFIED.
2. **Nursery daily work:** private care note and late attendance persist. Unauthorized care/contact access is denied. Explicit late policy produces a correct 100% rate. Authorized guardian handover is replay-safe and appears in the Collection UI history. Full gate UI action is NOT VERIFIED.
3. **Bursar:** tuition creation/publication/billing, cash drawer opening, partial collection, adjustment approval, reconciliation and close succeed through API/DB. After normal authorized term close, queued/direct billing is blocked.
4. **Teacher boundary:** ordinary pupil access is denied, but legacy homework detail/submission/by-class reads expose the child's private data. Ordinary staff list exposes legacy compensation. The simulated day fails the safe-access requirement here.
5. **Recovery administrator:** an actual scratch restore passes integration assertions, but School B reads School A's backup destination/schedule. This fails the multi-school administration boundary.
6. **Head teacher and family:** complete assessment-to-published printed report, promotion and parent browser consumption remain NOT VERIFIED. Synthetic authorization fixtures do not count as completing them.
7. **Operator deployment:** local application builds and fresh database preflight pass. CI rendering fails, and the actual production host/image/TLS/files/recovery chain remains NOT VERIFIED.

This simulation is deliberately described as partial. A full three-term school-year simulation with multiple streams, siblings, transfers, repeaters, withdrawals, scholarships, mixed payment methods, published reports and rollover was not completed through the ordinary UI.

## 14. Production Readiness Gates

No overall score, percentage or ranking is assigned. NOT READY can reflect an unsafe path or missing required proof; it does not mean the entire module is absent.

| Area | Status | Blocking issues / remaining gate |
| --- | --- | --- |
| Student management | NOT READY | A01 alternative record disclosure; full lifecycle/browser acceptance |
| Enrollment | NOT READY | Strong invariants pass; school-year UI/history/upgrade acceptance incomplete |
| Attendance | NOT READY | Correct rate verified; full register/correction/offline/report acceptance incomplete |
| Academics | NOT READY | School-approved curriculum/teacher/timetable configuration and complete chain |
| Assessments | NOT READY | Teacher entry → moderation → publish browser proof; A07 portal entry |
| Results | NOT READY | Hand-calculated result, PDF and parent correction/publication acceptance |
| Finance | NOT READY | Selected API/GL cases pass; complete receipts, refunds/bank/history/day acceptance |
| Administration | NOT READY | A02 confidential staff data and A03 backup authority/isolation |
| Security | NOT READY | A01–A04; complete sensitive endpoint/field/role matrix |
| Reporting | NOT READY | Final report/receipt/exports and all role/filter totals incomplete |
| Data integrity | NOT READY | Fresh invariants pass; historical upgrade/import/complete lifecycle proof incomplete |
| Recovery | NOT READY | A03; production files/offsite retrieval/RTO/alerts unverified |
| Deployment | NOT READY | A05; real PostgreSQL 16 images, role/readiness/TLS/persistence unverified |
| Communications | NOT READY | Actual authorized delivery, failure/retry/emergency journey unverified |

## 15. Final GO / NO-GO Decision

**NO-GO.** Required blockers are A01 pupil disclosure, A02 staff confidentiality, A03 shared backup administration, A04 reachable dependency remediation and A05 deployment gate repair plus actual deployment acceptance. Essential user-operated school workflows and production recovery also need proof (A09).

A limited staging pilot with fictional data is appropriate for completing acceptance. A live-school pilot still exposes real children's and staff data; calling it a pilot does not resolve the privacy defects. A conditional GO cannot currently be justified for the reviewed deployment scope.

## 16. Fix Priority Roadmap

| Phase / issue | Why it matters; affected module | Required change / dependencies | Validation and definition of done |
| --- | --- | --- | --- |
| 1 — A01 | Child privacy; legacy LMS | Central class/pupil scope or explicitly retire reads; include history/attachments; depends on teacher assignments | D01 passes across direct APIs and UI with unchanged forbidden data |
| 1 — A02 | Employment confidentiality; people/HR | Safe directory projection plus privileged payroll view; review legacy migration | D02 shows no salary/bank fields to ordinary teacher |
| 1 — A03 | School isolation/recovery; backup | Separate privileged global backups from tenant export settings; key any tenant scheduling | D03 proves independent A/B config and operator authority |
| 1 — A04 | Availability; files/dependencies | Compatible upgrades/lockfile and removal of obsolete copies; reachable-path triage | D04 proves parser patch, normal upload behavior and advisory disposition |
| 1 — A05 | Deployable artifact; CI/ops | Required CI fixtures, image cwd fix, real prod migration/role/boot; Docker host needed | D05 actual production image/URLs/readiness/persistence succeeds |
| 1 — A09 recovery/communication gates | Recoverable and operable school | Offsite and file drill, monitored workers, accepted sender; depends on A03/A04/A05 | D08/D09 complete with agreed RPO/RTO and delivered test notices |
| 2 — A06 | Existing retained-work browser fails; legacy LMS | Correct submittedAt sort and scope; depends on A01 policy | Allowed list paginates without 500 and without forbidden records |
| 2 — A07 | Teacher cannot navigate marking naturally; portal | Assigned class/subject/assessment selector or deep-linked inbox; requires scoped query | Teacher finishes D06 without UUID/API/database lookup |
| 2 — A09 school acceptance | Core usability and correctness; all core modules | Execute real-role school-year and finance scenarios, correct exposed gaps | D06/D07 pass with expected DB/ledger/history and printed artifacts |
| 3 — A08 | Reliable verification/shutdown; workers/tests | Close resources in order, test natural exit and termination/replay | Strict suites terminate cleanly; production shutdown leaves replayable work |
| 3 — usability | Low bandwidth/mobile operation; web/portal | Measure school devices and link speeds, chunk when warranted, review errors/offline | Agreed device and outage tests pass; no duplicate offline writes |
| 4 — optional scope | Avoid selling unverified extras | Client-specific transport/boarding/library/payroll/LMS acceptance; dependencies vary | Enable only after module-specific acceptance and recovery tests |

## 17. Objective Definition of Done

**D01 — Pupil authorization:** Create two classes and teachers, with one unassigned user, retained submissions and a transferred pupil. Verify own assigned records are usable; direct list/detail/by-class/submission/export/file routes return denial or empty scope for forbidden records, including old placement periods. Parent can read only linked permitted records. Confirm responses contain no forbidden content/identity/attachment URL, DB unchanged, and required access-attempt logging. Retest with advanced LMS off and with real NOBYPASSRLS application credentials.

**D02 — Confidential staff fields:** Seed retained compensation plus current HR salary/bank fields. Teacher and registrar directory list/detail/campus/department/search/export return only approved public fields. Authorized payroll staff can perform intended duties. Confirm nested/scalar JSON cannot leak confidential values, and role revocation takes effect on an existing token.

**D03 — Backup authority/isolation:** In one process, A sets private destination/schedule, then B reads and changes its own configuration. B must neither see nor alter A's config/jobs/secrets. Tenant admins cannot start/download/restore a whole shared database backup. Authorized operator can run a full dump/restore drill. Restart and multiple instances retain correct authority/configuration. Verify notification recipients, artifact/history visibility and permissions as well as database settings.

**D04 — Dependencies:** Runtime-resolve the patched multipart package in the shipped image. Exercise permitted file uploads and controlled malformed-field rejection in isolated staging under bounded resource limits. Confirm denied uploads are rejected and normal downloads work. Re-run production audit; fix every reachable high/critical vulnerability, or record an evidence-backed accepted disposition for an unreachable/mitigated path. Validate Nodemailer/archive paths in use, not just version strings.

**D05 — Production deployment:** Clean CI with no developer `.env` renders Compose and verifies private ports/capabilities. Build all actual images; Prisma assertion resolves generated models in the runtime location. Deploy PostgreSQL 16, apply all migrations and invariant checks, provision distinct application/system/backup roles and boot NODE_ENV=production. From public HTTPS URLs sign in to staff and portal, register a fictional pupil and read persisted data. Readiness must reflect DB/schema failure; school flags and provider-disabled UI must match scope. Restart containers and confirm DB/uploads survive. Rollback/restore procedure is executed on a disposable copy.

**D06 — Academic/lifecycle acceptance:** Through UI as registrar, create Baby/Middle/Top and P1–P7 streams, years/terms, subjects, class/subject teachers and capacity. Register siblings/guardians, reject duplicates and overflow, transfer a pupil, record attendance and authorized nursery care/collection. Teacher chooses assigned assessment, enters present/absent/exempt cases; independently calculate weights/grades. Head moderates/publishes; parent sees only released own-child reports. Print and approve nursery/primary PDFs. Attempt unauthorized and post-publication mark changes, then execute controlled correction. Promote/repeat/withdraw/graduate and open next year; historic class/results/fees remain correct. No manual database fixes or raw identifiers are needed.

**D07 — Finance acceptance:** UI creates tuition and selected ancillary charges, scholarships/discounts and invoices; cashier opens drawer, takes partial/full/overpayment via cash/bank/confirmed manual MoMo and prints uniquely numbered receipts. Allocate credit, reverse/refund through dual control, attempt wrong-pupil and concurrent approvals. Tie invoice minus credits/payments to residual, AR subledger to posted GL, cash movements to drawer count, and reports to journal source. Close term then attempt every supported mutation and queued job; no unauthorized document appears. Confirm guardian sees correct balance and receipt after refresh.

**D08 — Recovery/operations:** On the production-like host, back up DB, uploads and required configuration securely. Retrieve an offsite copy to a clean host, restore and verify school/role/history/fees/ledger/attachment bytes with documented checks. Record actual RPO/RTO against school-approved targets. Damaged archives fail clearly without live restore; failure alert reaches the operator. Prove disk-full, DB unavailable, restart and outbox retry behavior with no lost/duplicated business action. Schedule recurring real restore drills and verify execution, not merely archive listing.

**D09 — Communications/family access:** Using explicitly authorized test recipients, invite and activate parent/teacher accounts through actual email, recover credentials, select correct recipient groups and send accepted SMS/email notices. Test invalid provider credentials, retry/duplicate suppression, opted-out numbers and an emergency message. Verify audit/delivery status, tenant/sibling identity, guardian revocation and existing-token denial. Do not treat a queued outbox row as delivered.

## 18. Final Answer

**“Can this existing system safely and reliably operate a real nursery and primary school in Uganda today, based on the functionality that has actually been verified?”**

**No.** The verified enrollment, attendance, guardian pickup, fee collection, approval, close and selected recovery cases show that the system is substantial and improving. Current direct-API privacy failures, shared backup administration and deployment/security gates still prevent a safe production decision. Complete academic, family, receipt/print and production-recovery workflows also remain NOT VERIFIED. Fix the identified blockers and pass the objective acceptance tests above before changing the decision.
