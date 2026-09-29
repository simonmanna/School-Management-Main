# SCHOOL MANAGEMENT SYSTEM FUNCTIONAL AUDIT

Independent current-state review, 29 September 2026. Repository `C:\Dev\School-Management`, HEAD `7b9bcc1`. Scope: existing nursery and primary functionality, including Uganda-specific operation, staff usability and production acceptance. This review makes no application repairs.

## 1. Executive Summary

**Decision: NO-GO for unrestricted production use today.** The system has substantial nursery/primary functionality. It is not just a collection of empty screens. Enrollment history, nursery care and collection, assessment moderation, accounting-backed fees, portals, reports and school administration have real implementations. However, current source contains operational defects, and complete school workflows have not been freshly verified through the user interfaces.

**Does it have all the functionality?** It covers most major module categories. Complete, safe operational coverage has not been established. Required custom fields behave differently between admission routes; period attendance reads the wrong register; offline work is not bound to the school and user who entered it. These affect everyday operation even where the backend has substantial functionality.

**Is it easy to use?** There are good workflow improvements: quick registration and placement, class-specific stream selection, duplicate warnings, teacher assessment lists, approval stages, mark drafts and family statement cards. These are source-backed strengths. Ease of use by a secretary, class teacher, bursar or parent is **NOT VERIFIED** by this review: the live browser session did not complete, and the isolated database became unavailable before fresh authenticated journeys could run. Do not equate these usability limitations with proof that every screen is unusable.

The bounded coverage inventory below contains **60 features/workflows**: **0 IMPLEMENTED — VERIFIED complete user workflows**, **46 PARTIALLY IMPLEMENTED**, **3 BACKEND ONLY**, **2 BROKEN**, **3 INCONSISTENT**, **5 OPTIONAL**, and **1 NOT APPLICABLE**. No feature is marked MISSING or UI ONLY merely because it was not exercised. These classifications describe this review's evidence boundary; PARTIALLY IMPLEMENTED includes substantial implementations whose complete workflow is unverified. They do not mean that only zero parts of the system work.

Fresh positive evidence:

- All current migrations deployed successfully into a new fictional database, `school_audit_review_20260929`.
- Executable constraint preflight passed: 622 org-scoped tables have enabled/forced RLS and policies; tenant foreign keys have same-school triggers; enrollment, attendance, fee invoice and hostel uniqueness checks passed.
- Unit project: **140 suites passed, 1 failed; 2,460 tests passed, 1 failed, 2,461 total**. It exited naturally. The failed test is detailed in R06.
- Two real-database integration suites completed before PostgreSQL became unavailable: mobile-money callback accounting and school documents. Together they contain ten assertions/tests covering callback allocation/replay/failure/signatures and leaving certificates/receipt PDF variants. They verify bounded backend behavior, not the entire bursar or registrar UI.
- A new isolated service failure probe reproduced R04: failed email delivery leaves a scheduled report run recorded as `succeeded`.

Fresh limitations:

- During concurrent checks, PostgreSQL began returning `the database system is in recovery mode`. The remaining integration run was stopped; its failures are **environment-blocked**, not evidence that those modules have business defects. Root cause is **NOT VERIFIED**. No cluster restart or database repair was attempted.
- The first typecheck was interrupted to reduce resource pressure; the sequential rerun **passed for shared, API, portal and web**. Type correctness does not establish business-workflow correctness.
- Fresh browser/API school-year simulation, deployment image boot, real provider delivery, full permissions matrix, offsite database-plus-files restore, historical account reconciliation and user acceptance remain **NOT VERIFIED**.
- Previous audit and Wave 15/16 records are background evidence only. Their reported green runs are not counted as fresh passes here.

No confirmed new P0 is asserted. R01 and R02 are P1 operational defects in the affected scope. R07 and R08 are P1 production acceptance requirements, not claims of missing application code. R03–R06 and R09–R10 are P2 findings.

## 2. System Architecture Summary

The active pnpm workspace is `apps/api` (NestJS), `apps/web` (React/Vite staff application), `apps/portal` (React/Vite family and teacher portal), and `packages/shared` (contracts and permissions). The older nested `school-management-feature/school-management-main` is a reference/older tree and was not treated as the active application. Root package metadata still calls the product POS-CAFE; that alone is not a school-functionality failure.

Prisma and PostgreSQL hold academic and financial data. Current migrations, raw SQL constraints, triggers and partial indexes are important: the Prisma schema alone does not describe every invariant. Enrollment uses StudentEnrollment plus effective-dated EnrollmentPlacement; promotion/repeating create next-year enrollment and close the prior placement rather than overwriting historical class identity.

Authentication uses JWT, account-state controls, refresh/session infrastructure and permission resolution. Authorization is layered: controller grants, teacher/family scope checks, tenant context, Prisma tenant extension and PostgreSQL RLS. Production design separates the application and privileged system database roles. RLS protects school boundaries; it does not automatically provide within-school pupil confidentiality or bind browser offline work to its original author.

SchoolModule registers foundation, people, admissions, enrollment, course offerings, teaching, academics, attendance, assessments, examinations, statutory exports, certification, analytics, fees, portals, nursery/early years, library, transport, hostel, meals, reporting, school documents and front desk. Shared accounting, invoicing, HR, notifications and document/file infrastructure support the vertical. Advanced LMS is gated; live payment-provider use requires separate acceptance.

Finance uses Decimal persistence, document posting, payment allocation, journal/period controls, receipt generation and approval services. Communications have provider adapters/outbox infrastructure. Deployment includes Compose, production overlays, CI gates, TLS proxy configuration and an operator backup runbook. Presence of these components is architecture evidence, not deployment certification.

## 3. Feature Coverage Matrix

Evidence codes: **S** current source traced; **U** fresh unit assertions; **D** fresh migration/catalog checks; **I** fresh real-DB integration assertion; **P** new isolated service failure probe; **H** historical repository evidence only. Full workflow statuses require UI → API → authorization → business rules → database → refresh/report proof. Optional modules become mandatory if promised to a school.

| Module | Feature | Status | Evidence | Severity | Notes |
| --- | --- | --- | --- | --- | --- |
| Access | Staff sign-in/session/logout | PARTIALLY IMPLEMENTED | S/U/H | — | Fresh browser/session journey NOT VERIFIED |
| Setup | New school bootstrap and initial roles | PARTIALLY IMPLEMENTED | S/H | — | Operator flow exists; new full UI setup NOT VERIFIED |
| Setup | Academic year and term | PARTIALLY IMPLEMENTED | S/D/U | — | Date/current-state DB guards; full closed-year API matrix NOT VERIFIED |
| Setup | Baby/Middle/Top and P1–P7 | PARTIALLY IMPLEMENTED | S/H | — | Configurable grade/class architecture and Uganda seed data |
| Setup | Classes, streams and capacities | PARTIALLY IMPLEMENTED | S/D/U | — | Placement/capacity guards; complete setup acceptance outstanding |
| Setup | Subjects/curriculum/weighting | PARTIALLY IMPLEMENTED | S/U | — | Configurable; school-specific thematic curriculum acceptance needed |
| Setup | Teacher and class/subject assignments | PARTIALLY IMPLEMENTED | S/U | — | Role/scope infrastructure; complete staffing workflow NOT VERIFIED |
| Setup | Timetable and conflict prevention | PARTIALLY IMPLEMENTED | S/D/U | — | DB clash trigger and unit checks; whole timetable journey NOT VERIFIED |
| Students | Basic registration/profile persistence | PARTIALLY IMPLEMENTED | S/U/H | — | Shared transactional admission service; fresh UI/refresh NOT VERIFIED |
| Students | Quick register and placement | INCONSISTENT | S/U | P2 | R03 required school fields bypassed |
| Students | Duplicate identity/admission number | PARTIALLY IMPLEMENTED | S/D/U/H | — | Duplicate warnings and uniqueness exist; all import paths NOT VERIFIED |
| Students | Profile editing/custom fields | PARTIALLY IMPLEMENTED | S/U | — | Validation in StudentService and pupil record; full edit journey outstanding |
| Students | Multiple guardians and siblings | PARTIALLY IMPLEMENTED | S/U/H | — | Linked contacts and deduplication; complete family workflow outstanding |
| Students | Emergency/primary/pickup contacts | PARTIALLY IMPLEMENTED | S/U/H | — | Relationship and collection controls; custody acceptance outstanding |
| Admissions | Application/review/decision/offer | PARTIALLY IMPLEMENTED | S/U/H | P2 | Route parity/custom-field acceptance incomplete |
| Admissions | Public application and upload/tracking | PARTIALLY IMPLEMENTED | S/H | — | Real backend/UI; fresh DB run blocked |
| Admissions | Conversion and duplicate prevention | PARTIALLY IMPLEMENTED | S/U/D/H | — | Shared admission/transaction path; full portal-to-placement NOT VERIFIED |
| Enrollment | Enrollment and opening placement | PARTIALLY IMPLEMENTED | S/D/U/H | — | Active/open placement constraints passed |
| Enrollment | Class/stream transfer and history | PARTIALLY IMPLEMENTED | S/D/U | — | Effective-dated records; reports after transfer NOT VERIFIED |
| Enrollment | Withdrawal and re-admission | PARTIALLY IMPLEMENTED | S/U | — | Lifecycle services exist; complete return workflow outstanding |
| Enrollment | Bulk placement/capacity override | PARTIALLY IMPLEMENTED | S/U | — | Authorization and capacity paths need multiuser API acceptance |
| Enrollment | Individual/bulk promotion | PARTIALLY IMPLEMENTED | S/U | — | Transactional next-year placement; complete year rollover outstanding |
| Enrollment | Repeating and graduation | PARTIALLY IMPLEMENTED | S/U | — | Explicit repeat/graduate logic; historical reports NOT VERIFIED |
| Nursery | Daily care, health and incidents | PARTIALLY IMPLEMENTED | S/U/H | — | Nursery-specific operations exist; safe sharing acceptance outstanding |
| Nursery | Authorized pickup and handover | PARTIALLY IMPLEMENTED | S/U/H | — | Current APIs and family approval path; full gate journey NOT VERIFIED |
| Nursery | Development observations/reporting | PARTIALLY IMPLEMENTED | S/U | — | Assess against school-selected ECD framework |
| Attendance | Daily register | PARTIALLY IMPLEMENTED | S/D/U/H | P2 | R09 draft loss/date defaults; whole teacher journey outstanding |
| Attendance | Period/lesson register | BROKEN | S | P1 | R01 period picker does not select period-specific read |
| Attendance | Configurable statuses in teacher portal | INCONSISTENT | S | P2 | R10 category contract mismatch can choose first instead of configured present |
| Attendance | Corrections/history/alerts | PARTIALLY IMPLEMENTED | S/U | — | Alerts improved; real delivery and full correction acceptance outstanding |
| Attendance | Offline entry/replay | BROKEN | S | P1 | R02 missing original school/user binding |
| Assessment | Assessment creation/frozen roster | PARTIALLY IMPLEMENTED | S/U/H | — | Real assessment services; cross-module browser proof outstanding |
| Assessment | Marks entry/bulk/absent/missing | PARTIALLY IMPLEMENTED | S/U | — | Markbook/drafts/validation exist; roster edge cases outstanding |
| Assessment | Moderation and separation of duties | PARTIALLY IMPLEMENTED | S/U/H | — | Fresh DB authorization suite blocked |
| Results | Grading, weighting and boundaries | PARTIALLY IMPLEMENTED | S/U | — | Fresh math assertions; independently computed full term NOT VERIFIED |
| Results | Approval/locking/publication | PARTIALLY IMPLEMENTED | S/U/H | — | Published result/version protection needs current full API journey |
| Results | Report card, PDF and parent visibility | PARTIALLY IMPLEMENTED | S/U/H | — | PDF unit assertion passed; full result-to-family journey outstanding |
| Fees | Structures/items/published versions | PARTIALLY IMPLEMENTED | S/U/D | — | Immutable pricing and invoice identity protection exist |
| Fees | Billing/invoices and revised-fee handling | PARTIALLY IMPLEMENTED | S/D/H | P2 | Protected against duplicate billing; controlled rebill unresolved |
| Fees | Cash/bank/manual mobile-money collection | PARTIALLY IMPLEMENTED | S/U/H | — | Collection/accounting paths; whole bursar UI NOT VERIFIED |
| Fees | Signed provider callback/allocation/replay | BACKEND ONLY | I | — | Four fresh real-DB tests passed; live provider/UI NOT VERIFIED |
| Fees | Receipts/reprints/A5/thermal/family copy | BACKEND ONLY | I | — | Three bounded PDF/backend tests passed; office print flow NOT VERIFIED |
| Fees | Partial/advance/overpayment/balances | PARTIALLY IMPLEMENTED | S/U/H | — | Allocation and credit paths; complete reconciliation outstanding |
| Fees | Waivers/discounts/scholarships | PARTIALLY IMPLEMENTED | S/U/D | — | Waiver-range constraint; full approval and report acceptance outstanding |
| Fees | Reversal/refund/adjustment | PARTIALLY IMPLEMENTED | S/U/H | — | Cannot sign off all concurrent financial effects from unit evidence |
| Fees | Drawer/day close/financial periods | PARTIALLY IMPLEMENTED | S/U/H | — | Prior direct probes exist; fresh operational chain outstanding |
| Fees | Ledger/AR/reconciliation reports | PARTIALLY IMPLEMENTED | S/U/H | — | Prior narrow reconciliation; current/historical books NOT VERIFIED |
| Portal | Parent own-child fees/results/attendance | PARTIALLY IMPLEMENTED | S/U/H | — | Scope implementation exists; full family acceptance outstanding |
| Portal | Teacher classes/register/marking/rubrics | PARTIALLY IMPLEMENTED | S/U/H | P2 | Register IDs fixed previously; R10 remains |
| Communication | Announcements/SMS/email/notifications | PARTIALLY IMPLEMENTED | S/U/H | — | Selection/outbox exist; actual delivery NOT VERIFIED |
| Reporting | Registers, financial and academic exports | PARTIALLY IMPLEMENTED | S/U/H | — | Totals/filters for every export NOT VERIFIED |
| Reporting | Scheduled report delivery/status | INCONSISTENT | S/P | P2 | R04 failure marked successful |
| Statutory | P7/candidate/statutory exports | PARTIALLY IMPLEMENTED | S/U/H | — | Accepted UNEB submission/schema NOT VERIFIED |
| Certification | Leaving certificate issuance and PDF | BACKEND ONLY | I | — | Three DB/PDF tests passed; complete registrar UI NOT VERIFIED |
| Library | Books/copies/loans/returns/fines | OPTIONAL | S/U/H | — | Scope-dependent; configurable fine implementation exists |
| Transport | Routes/trips/capacity/pickup/charges | OPTIONAL | S/U/H | — | Mandatory acceptance if school uses transport |
| Boarding | Beds/allocation/attendance/charges | OPTIONAL | S/D/H | — | Active-bed indexes verified; boarding operation NOT VERIFIED |
| Meals/HR | Feeding and Uganda payroll | OPTIONAL | S/U/H | — | Operational scope-dependent |
| Learning | Advanced LMS/CBT/student portal | OPTIONAL | S/U/H | — | Do not enable unfinished advanced capability by default |
| ERP | Retail/manufacturing/rental/repair | NOT APPLICABLE | S | — | Outside nursery/primary school launch scope |

Security, recovery, administration, database and deployment are cross-cutting gates below, rather than counted again as school workflow features.

## 4. Workflow Audit

| Workflow | Chain inspected and positive evidence | Failed/missing proof, business/database/permission issue |
| --- | --- | --- |
| Setup → term → classes → assignments | Staff routes/API hooks → foundation/people/academic controllers → configurable models; fresh schema guards pass | Complete operator/admin UI setup, streams, capacities, teacher scope and timetable acceptance NOT VERIFIED |
| Application → enrollment → placement | Application pages → admissions services → StudentAdmissionService → enrollment and dated placement transaction | Student custom-field enforcement is outside shared admission path; R03. Full new public application through office decision NOT VERIFIED |
| Quick registration → guardian → class | `students.tsx` → register mutation → student controller → `register()` → `admit()` → transaction | Required custom fields absent from DTO/UI path; no full fresh browser/refresh/history proof |
| Transfer → withdrawal → return → promotion | Enrollment service has explicit transfer/state/repeat/promote/graduate methods; database forbids overlapping/open duplicate placements | Old class/term academic and finance reports after movement NOT VERIFIED; school-year simulation incomplete |
| Daily/period attendance → report | Page loads roster/register → mark API → scoped controller/service → row persistence and unique indexes | R01 daily read feeds period write; R02 offline account drift; R09 date/draft safety; R10 configurable portal defaults |
| Nursery pickup | Parent request/office approval → pickup service → handover/audit → family/office views | Fresh authorized, denied, custody-change and emergency browser journeys NOT VERIFIED |
| Assessment → marks → approve → release → report → parent | Pages/hooks → assessment/exam services → frozen roster, moderation, result versions, report publishing | Complete multi-role browser journey, independent term result, parent download and controlled correction NOT VERIFIED |
| Fee version → billing → payment → receipt → ledger | Fee services → invoicing/accounting → payment/allocation/receipt; four fresh callback DB tests and three receipt PDF tests pass | Provider initiation/settlement, cashier UI, reversal/refund, new fee rebill, full GL/AR reconciliation NOT VERIFIED |
| Scheduled report → export → email → status | SavedReportService → export/upload → notifications → run update | R04 catches delivery error and still reports `succeeded`; DB and SMTP substituted only in isolated failure probe |
| Disaster → recovery | Operator-only backup controller, dump/manifest/scratch-drill implementation and documented offsite requirement | Fresh restore blocked by DB availability; offsite DB plus uploaded files/roles/config/TLS/RTO drill NOT VERIFIED |

The browser academic-journey test in `apps/web/e2e/academic-journey.spec.ts` is useful but does not cover fees, pickup, next-year promotion, restore, or a complete parent journey. At line 50 it skips without credentials; at lines 166–167 it can use registrar credentials for the teacher leg. Running that fallback would not establish separation of duties.

## 5. Critical Findings

### R01 — P1 — Period attendance displays daily marks and writes them to a selected period

**Problem:** The staff attendance page offers a period selector but `useAttendanceRegister(classId, date)` has no period parameter. Its query key and HTTP request omit periodId. The backend defaults that missing value to `null`, meaning daily attendance. The UI seeds its marks from that daily response, then Save includes the selected periodId.

**Evidence:** [attendance.tsx:95](C:/Dev/School-Management/apps/web/src/pages/school/attendance.tsx:95), [api.ts:3305](C:/Dev/School-Management/apps/web/src/features/school/api.ts:3305), [student-attendance.controller.ts:69](C:/Dev/School-Management/apps/api/src/modules/school/attendance/student-attendance.controller.ts:69), [student-attendance.service.ts:194](C:/Dev/School-Management/apps/api/src/modules/school/attendance/student-attendance.service.ts:194). This is a current source-contract finding; live browser/DB reproduction is NOT VERIFIED.

**School impact:** A pupil present during morning roll call but absent from a later lesson can appear present when that period is reopened. Saving can replace the period marks with daily marks.

**Root cause:** Period selection is part of the mutation but not the read/cache contract.

**Fix:** Thread periodId through hook/request/query key; wait for that register before enabling entry; isolate drafts per school/class/date/period. **Launch dependency:** Required if period attendance is enabled. A daily-only school may defer period functionality by disabling the picker and documenting that scope, after daily workflow acceptance.

### R02 — P1 — Offline work can replay under a different user's session

**Problem:** The school IndexedDB queue has a shared name, `school-offline-queue`. Entries contain endpoint/payload/key but no original organizationId/userId. `replayAll()` posts through the currently authenticated API client. Logout clears authentication but does not isolate or quarantine this school queue.

**Evidence:** [offline-queue.ts:31](C:/Dev/School-Management/apps/web/src/features/school/offline-queue.ts:31), [offline-queue.ts:51](C:/Dev/School-Management/apps/web/src/features/school/offline-queue.ts:51), [offline-queue.ts:160](C:/Dev/School-Management/apps/web/src/features/school/offline-queue.ts:160), [auth.store.ts](C:/Dev/School-Management/apps/web/src/stores/auth.store.ts), [server-logout.ts](C:/Dev/School-Management/apps/web/src/lib/server-logout.ts). Source finding; multi-account browser reproduction NOT VERIFIED.

**School impact:** On a shared staff computer, A's offline register can submit as B, misattributing its author. If B is not permitted or is in another school, a 401/403 is treated like a permanent business rejection and removes the entry. This is not proof of a successful cross-school database write: server scope controls may correctly reject it. The defects are identity attribution, local isolation and recoverability.

**Root cause:** Queue persistence outlives sessions but replay has no original-owner check, and all 4xx errors are dropped.

**Fix:** Partition/identify queue by original school and actor, pause replay on mismatch, preserve recoverable auth failures, and provide explicit resume/discard controls under the correct account. Do not silently erase staff work at logout.

### R07 — P1 acceptance gate — Complete school operations are not freshly verified

**Evidence:** Database recovery blocked the fresh authenticated simulation and most integration reruns. Browser creation timed out. Historical Wave 16 notes also explicitly exclude clicked-through admin hostel/certificates/receipts/schedule workflows. Passing unit tests and static source cannot close those acceptance gaps.

**Impact:** Readiness for day-to-day administration, classroom use, financial close and parent access remains unknown. This is a verification blocker, not a claim that all these features are broken.

**Fix:** Run the school-year and permission scenarios in sections 13 and 17 on an isolated, stable stack using distinct real test roles. Record expected calculations, responses, DB rows, audit events and report outputs. No developer SQL should be needed to complete the UI workflow.

### R08 — P1 acceptance gate — Production deployment and complete recovery are not established

**Evidence:** CI source now includes production image boot/readiness and constraint gates; the earlier CI configuration finding is addressed in source. A current successful image/host run, TLS/volumes/restart/rollback, offsite restore and file recovery were not demonstrated here. Local PostgreSQL recovery errors reinforce the need for measured recovery acceptance, without proving the production host has the same failure.

**Impact:** School data availability, restoration and operational support remain unverified.

**Fix:** Exercise the actual production image on the target PostgreSQL version and a representative host. Restore offsite database, uploaded documents and operational configuration to a different machine; verify users, historical pupils, report cards, payment/GL totals and downloads; measure recovery time and data-loss window.

## 6. Major Findings

| ID | Severity/module | Evidence and real-world impact | Required change |
| --- | --- | --- | --- |
| R03 | P2 — Admissions/custom fields | StudentService validates required custom fields at create (`student.service.ts:207`); quick register DTO/service (`student-admission.service.ts:99`, `:432`) has no customFields and calls admit directly. Admissions custom-field mapping also reconstructs a system-only bag (`admissions.service.ts:1021`). A school-required value can be enforced in one path but omitted in another. Source traced; fresh DB probe blocked. | Enforce configured student rules once in shared admission, carry appropriate application data, render fields in quick registration, validate applicable guardian fields, specify deliberate exemption/migration policy for existing records. |
| R04 | P2 — Reporting/communication | ScheduledReportService catches each email rejection at line 209, then sets run status succeeded/error null at line 213. New service probe deliberately rejected SMTP; result still succeeded. It can mislead staff into believing reports were delivered. | Separate generated-file status from recipient delivery; record failed/partial recipients; show clear status and permit safe retries with deduplication. |
| R05 | P2 — Fee revision workflow | Immutable pricing and Document unique identity prevent second invoices across fee versions. Wave 16 record explicitly leaves controlled void/rebill open. Protection against double billing is good; changing an already billed fee still needs a documented operational path. No new financial corruption reproduced. | Provide or validate authorized credit/void/rebill flow with settled invoice rules, allocations, approvals, accounting-period checks and full audit history. |
| R06 | P2 — Verification/CI | Full unit run fails `files-multipart-limits.spec.ts:37` because direct `require('multer/package.json')` cannot resolve under current pnpm dependencies. Resolving through platform-express finds runtime multer **2.4.0**. Other upload behavior checks pass. Current full green claim is not reproducible. | Resolve/assert the parser actually used by Nest or declare the intended direct test dependency; verify frozen-lockfile clean installation and the production dependency tree. Do not revert to a vulnerable parser merely to fix the test. |
| R09 | P2 — Attendance UX/date safety | `attendance.tsx:100` resets draft marks whenever register/class/date/period changes. No dirty draft guard appears in this page. Staff and teacher portal use UTC `toISOString().slice(0,10)` for the default date (`attendance.tsx:57`, `register.tsx:35`). At 01:00 Kampala it resolves to the previous local date. Live reproduction NOT VERIFIED. | Use school-local date defaults; retain keyed drafts; warn before discarding changes and prevent data refresh from overwriting dirty entries. |
| R10 | P2 — Configurable attendance/default status | Portal register chooses `category === 'present'`, otherwise first status (`register.tsx:48`). Actual status service/schema exposes `isDefault`, `isPresent`, `sortOrder`, not category. The standard seed happens to put Present first; a valid reordered school catalog may seed every pupil to another status, including when pressing All present. | Align portal contract to isDefault/isPresent, exclude inappropriate/inactive choices, and require an explicit sensible present state. Test with Absent first and Present second. |

Do not inflate these into ten confirmed production corruption incidents: source findings, an isolated failure reproduction and outstanding acceptance gates have different evidence strengths.

## 7. Minor Findings

P3: The shared `money()` formatter forces two decimal places and `useOrgCurrency()` falls back to IDR (`apps/web/src/lib/format.ts:3`). Uganda school configuration should always provide UGX; showing cents or a fallback foreign currency is avoidable confusion. This is display risk, not proof of stored-money inaccuracy. Respect Currency.decimalPlaces and fail clearly when school currency is not loaded.

P4: Validate role-focused shortcuts for secretary, teacher, bursar and head teacher during acceptance. Start with today's register, pupils needing placement, unpaid accounts and marks awaiting approval. Existing teacher home/quick registration already move in this direction; do not replace them wholesale.

No broad cosmetic redesign is proposed. Phone responsiveness, keyboard access, visible error summaries, touch targets and printable layouts remain user-acceptance checks rather than unsupported defects.

## 8. Missing Functionality

**Core required completion/proof:** Consistent required-field enforcement across every admission route; owner-bound offline work; correct selected-register loading; end-to-end staff/family authorization; full academic-year handoffs; controlled finance correction; target-host recovery acceptance.

**Important:** A supported fee-change procedure that school staff can complete, clear recipient-level scheduled-report failure handling, safe date/draft behavior and a tested onboarding/training checklist. These are specific workflow gaps, not evidence that all admissions, finance or reporting are missing.

**Optional:** Library, transport, boarding, meals, payroll, student self-service and advanced LMS/CBT depend on the school's operating scope. Their presence does not make them mandatory for every day nursery/primary launch. They require full acceptance if offered.

**School-dependent:** Boarding fees, transport capacity/safety, multiple campuses, scholarships, home languages, school grading policy and statutory exports. Parent–teacher conference functionality is not treated as a blocker: the recent repository record identifies an owner decision to defer it.

No blanket claim that nursery, school communication, library fines, hostel UI, transfer certificates or statutory xlsx export are missing is supported by this revision. Those implementations were added or already existed.

## 9. Security & Authorization Findings

Current source/test evidence supports retirement of legacy homework routes, compensation projection/omission, operator-only backups, patched runtime multipart parser, fail-closed permission controls, tenant registration and family role restrictions. These are meaningful improvements over the early 29 September audit. The previous A01–A05 findings must not be repeated as unchanged facts.

Fresh catalog preflight establishes schema protections on the scratch database, not exhaustive direct-API isolation. The dedicated real application-role suite, every export/download and all within-school teacher/guardian boundaries remain NOT VERIFIED freshly. R02 exposes a browser-session boundary issue independent of RLS.

Expected acceptance matrix below is a **test specification**, not a verified permissions inventory. C=create, R=read, U=update, D=delete, A=approve, P=publish, V=reverse, X=export. Every row remains NOT VERIFIED as a complete direct-API matrix in this review.

| Role/persona | Expected scope/actions | Direct API checks required |
| --- | --- | --- |
| Super Admin/operator | Explicit school provisioning and host recovery | Tenant impersonation policy, backup secret, no unintentional pupil-wide access |
| School Admin | School configuration/users and assigned management C/R/U/D/X | Other school IDs/files/search/exports denied; cannot grant beyond policy |
| Head Teacher | Academic oversight, moderation A/P/X and approved lifecycle decisions | Separation of duties; published mark correction; own approval restrictions |
| Teacher | Assigned class/subject R/U and permitted assessment C/submission | Other class pupils/marks/register denied; finance V/D/A denied |
| Accountant/Bursar | Fees C/R/U/X; controlled refund/reversal V when specifically granted | Receipt replay, closed periods, same-school allocation, approval limits |
| Registrar | Admission/enrollment/guardian C/R/U/X; controlled movements | Cannot silently bypass capacity/required school fields or alter published marks |
| Parent | Own linked children R; permitted application/pickup requests | Another family ID denied; pending pickup cannot self-approve |
| Student | Own age-appropriate information R and permitted learning submissions | Another student's data/financial/academic mutation denied |

Actual presets and configurable grants decide the roles; a title alone must not imply a permission. Include explicit allow and deny outcomes for C/R/U/D/A/P/V/X, with database and audit checks on denial.

## 10. Data Integrity Findings

Fresh database preflight passed placement overlap exclusion, one active enrollment per pupil, one open placement, current academic-year/term uniqueness, term/year containment, admission duplicate/capacity constraints, timetable clash triggers, attendance partial uniqueness, version-independent invoice identity, and active hostel bed/student uniqueness.

These are stronger than UI checks. They still do not prove all historical records or application transitions are correct. R01 permits semantically wrong period marks without breaking a foreign key; R03 permits missing school-required values while retaining valid database rows; R02 can replay under the wrong actor or discard valid pending work. Schema consistency and correct school meaning are separate requirements.

Deletion/cascades across historical results, fees, documents, guardians and staff must be exercised against a complete pupil lifecycle. Migration from an existing populated installation and preservation of historic placements/results are NOT VERIFIED here. Never reset or rerun demo seeds on live school data to satisfy this audit.

## 11. Financial Integrity Findings

The money chain is implemented across billing, invoicing, payment collection/allocation, receipts, accounting and reports. Fresh callback suite verifies a signed successful fictional callback creates one payment and allocation, replay creates no duplicate payment, failed callback produces no payment and forged signatures change nothing. Receipt PDF suite verifies original/reprint/family-copy and thermal output at backend level.

That is bounded, useful financial evidence. It is not actual MTN/Airtel settlement, a physical bursar shift, full reconciliation or financial sign-off. Keep live providers outside launch scope until provider sandbox/real settlement proof exists.

Required finance acceptance: UGX billing; two partial payments; overpayment held as credit; controlled refund and reversal; duplicate/concurrent collection; receipt reprint; cash drawer open/count/close; bank/manual mobile-money confirmation; closed-period refusals; independently computed student balance; posted journals and AR control account agreement; aged debt/report totals; audited fee revision under R05. Verify persisted Decimal and currency rounding rather than UI numbers.

Prior reports record a narrow 251,000 UGX AR/GL reconciliation and finance fixes. Those results are historical background; no current complete ledger reconciliation was run in this review. R04 applies to emailed financial reports too: generated output must not be confused with successful receipt by the bursar/head teacher.

## 12. Academic Integrity Findings

Canonical enrollment history, frozen assessment rosters, moderation/approval, grading rules, result-set versions, report provenance and next-year promotion are substantial architectural strengths. Fresh unit math/marking/permission assertions pass. The current fresh result-integrity and separation-of-duty database reruns did not complete because PostgreSQL became unavailable.

Required proof: exactly at each band boundary; zero/full/decimal marks; absent/missing/exempt; configured weighting; newly enrolled/transferred/withdrawn pupils; hand-calculated subject/overall result; result approval/publication and distinct user identities; teacher rejected on published mark write; authorized amendment snapshots; correct parent PDF; promotion/repeater/graduation with unchanged previous reports.

Uganda fit must be validated at school level. NCDC distinguishes early childhood learning frameworks, thematic lower-primary P1–P3, transition in P4 and subject-based upper primary. Nursery developmental records should not be judged only by PLE-style numeric aggregates. The software has early-years and configurable academic structures, but an agreed school curriculum/report mapping is NOT VERIFIED. Sources: [NCDC directorates](https://ncdc.go.ug/directoratesn/), [NCDC early childhood Learning Framework](https://ncdc.go.ug/books/learning-framework/).

P7/UNEB export is a separate operational acceptance item. The 2026 UNEB notice covers PLE registration, while the continuous-assessment submission condition it describes applies to UCE/S3. Do not assume secondary CA rules apply to primary because a generic statutory module supports both. Export templates need acceptance against the school's applicable current UNEB requirements. Sources: [UNEB 2026 registration notice](https://uneb.ac.ug/2026/06/01/uneb-normal-registration-extended-to-30th-june-2026/), [UNEB eRegistration](https://ereg.uneb.ac.ug/index.php).

## 13. Real-World Uganda School Simulation

**Fresh simulation status: INCOMPLETE / NOT VERIFIED.** A new isolated database was created and migrated; it was not populated through a complete browser-operated Green Valley school-year journey before PostgreSQL became unavailable. The two passing DB suites seed fictional Green Valley/P5 and mobile-money school/accounting records directly. Those fixtures must not be described as the requested whole-school UI simulation.

Acceptance scenario to complete:

1. Provision Green Valley Nursery and Primary, UGX, Africa/Kampala. Establish 2026 year, three configured terms, nursery Baby/Middle/Top and P1–P7.
2. Create North/South/East/West streams as the school requires, capacity rules, class teachers, subject teachers, thematic/nursery policies, timetable and school-specific grading.
3. Admit siblings sharing one guardian, a pupil with multiple guardians, a repeater, a transferred-in pupil and one applicant with required custom fields. Try duplicates, full class and justified capacity override.
4. Enroll/place through UI; verify effective-dated DB history and class lists after reload. Transfer stream, withdraw and re-admit without new duplicate identity.
5. Publish fee structure; bill; collect cash/bank/manual MoMo; handle partial and advance payment, waiver/refund/reversal and approved fee adjustment. Reconcile invoice/payment/receipt/allocation/AR/GL and a counted drawer.
6. Teacher marks daily attendance, late/excused and period attendance if enabled. Correct a record; test offline A → logout → B; check alerts and monthly register. Include pupil movement at date boundaries.
7. Create CAT/exam, enter marks with absent/missing/zero/full cases, independently calculate, submit, moderate with another user, publish and print/download report card; parent sees only their children.
8. Approve nursery pickup; gate refuses pending/unauthorized collector and duplicate handover. Exercise incident/care sharing with assigned and unassigned staff.
9. Promote to 2027, repeat one pupil and graduate P7; prior 2026 results/attendance/fee history remain unchanged. Print promotion/leaving records.
10. Schedule/email reports; simulate failed delivery; export registers/statutory data; run production restart/rollback and restore offsite DB plus uploaded files to another machine.

At every stage record role, screen/action, expected API response, database rows, audit trail, refreshed UI and expected report totals. Today's proven failure points are source defects R01/R02/R03/R09/R10 and isolated service failure R04; all later full-school steps remain unverified, not automatically failed.

## 14. PRODUCTION READINESS SCORECARD

| Area | Status | Blocking issues/proof still required |
| --- | --- | --- |
| Student Management — Gate A | NOT READY | Admission path parity R03; complete registration/movement/return/history acceptance R07 |
| Enrollment | NOT READY | Whole school-year placement/capacity/promotion acceptance R07 |
| Attendance | NOT READY | R01 if periods enabled; R02 offline/session boundary; R09/R10 acceptance |
| Academics — Gate B | NOT READY | Full assigned teacher/curriculum/timetable chain R07 |
| Assessments | NOT READY | Multi-role roster/marks/moderation/locked correction acceptance R07 |
| Results | NOT READY | Independently calculated term → PDF → family → amendment → rollover R07 |
| Finance — Gate C | NOT READY | Complete cashier/correction/reconciliation acceptance; R05 supported fee change |
| Administration — Gate D | NOT READY | Role/configuration setup and lifecycle matrix R07 |
| Parent/Teacher portals — Gate E | NOT READY | Complete onboarding/own-child/scoped teacher journeys; R10 |
| Security — Gate F | NOT READY | R02; full direct API/file/export and role boundary acceptance |
| Data Integrity — Gate G | NOT READY | Catalog passed; semantic workflow and historical migration acceptance outstanding |
| Reporting — Gate H | NOT READY | R04 delivery status; correct totals/history/filter/export acceptance |
| Recovery — Gate I | NOT READY | Actual offsite full-system recovery, target-host deployment R08 |
| Real-World Operation — Gate J | NOT READY | Complete staff-led school simulation without SQL/developer intervention R07 |

NOT READY means the required production gate is unresolved; it is not a claim that every component in the area is broken. No overall percentage, score or ranking is assigned.

## 15. FINAL GO / NO-GO DECISION

**NO-GO for a general production launch.** Exact blockers: R01 if lesson/period attendance is part of scope; R02 where offline attendance/marks and shared sessions are possible; incomplete critical workflow/security acceptance R07; and unproven production/recovery acceptance R08. Required custom-field and fee-revision policies must also be settled for schools relying on them.

A narrow supervised pilot with fictional/test data can establish the missing evidence. A production CONDITIONAL GO would require demonstrated safe core workflows, resolved applicable P1 issues, explicit daily-only/optional-module scope where appropriate, documented residual P2 issues, backups/restoration proof and a school owner accepting the defined scope. This review does not grant that acceptance.

## 16. FIX PRIORITY ROADMAP

| Phase/item | Why/module | Required change/dependencies | Validation and definition of done |
| --- | --- | --- | --- |
| 1 — R01 period read/write parity | Accurate registers | Thread period through reads/cache/drafts; existing backend period support | D01 in section 17 passes; daily and both lesson rows stay distinct |
| 1 — R02 offline identity | Shared staff devices and audit attribution | Owner-bound queue and session-aware replay; logout/auth error policy | D02 passes; never submit A's work as B or erase on recoverable auth failure |
| 1 — R07 operational acceptance | All core modules | Stable isolated stack, real distinct roles, scenario/expected figures | D07 passes; staff complete defined workflows without SQL fixes |
| 1 — R08 deploy/recover | School availability/data survival | Actual production image/PG version, offsite DB/files/config, target host | D08 passes; measured RPO/RTO and verified documents/financial records |
| 2 — R03 required-field parity | Registrar/data quality | Shared admission validation, carried application fields, guardian policy | D03 passes for every registration/import/conversion route |
| 2 — R04 truthful scheduled delivery | Reports/communications | Generation vs recipient status, deduped safe retry, visible failure | D04 passes with failed/partial/successful recipients |
| 2 — R05 controlled fee revision | Bursar/accounting | Supported approval/correction/rebill, allocation and closed-period policy | D05 passes; exactly reconciled old/new documents and audit history |
| 2 — R06 executable upload gate | CI/security verification | Assert actual runtime parser/frozen dependency tree | D06 passes on clean install; malformed requests safely rejected |
| 2 — R09 date and draft retention | Daily teacher work | School-local date and dirty guard/keyed drafts | Test Kampala early morning, date/class switches and refetch with unsaved changes |
| 2 — R10 portal status contract | Configurable attendance | Align real API flags; sane present/default selection | Absent-first catalog still defaults/All present to actual Present |
| 3 — Currency/UX acceptance | Staff clarity | UGX decimal metadata, loading/errors, shortcuts, mobile/keyboard paths | Secretary/teacher/bursar/parent scripted tasks and receipt/report review |
| 4 — Optional capabilities | Contract-specific scope | Library/boarding/transport/LMS/conferences when required | Entire chosen operational workflow accepted; keep others out of launch promise |

## 17. DEFINITION OF DONE

**D01 — Register identity.** Record daily Present, period 1 Absent, period 2 Late for the same pupil/date. Reopen each selector and refresh the page. Correct period 1 through the normal UI. API request includes selected period; cache keys differ; only period 1 DB row changes; daily/monthly/lesson reports show correct separate values; unauthorized teacher cannot alter any row.

**D02 — Offline original actor.** A queues register/marks, logs out offline, B logs in on the same device (same school and then another school). Reconnect and force replay. No entry submits as B; B cannot view A's pupil payload; queue stays recoverable. A resumes and submits exactly once with A recorded as actor. Expired-token/401/403 does not silently delete recoverable work; published/locked data produces visible, controlled rejection.

**D03 — School-required values.** Configure required text/select/number fields and any applicable guardian policy. Try omission/invalid values through standard student create, quick register, CSV import, application conversion and re-admission. API enforces documented policy before committing pupil/guardian/enrollment rows. Valid values survive refresh, conversion, edit/export. Existing pupils have a deliberate migration/exemption procedure; there is no undocumented bypass.

**D04 — Scheduled report truth.** Generate for two recipients; fail both, fail one, then succeed. Persist recipient failures and partial/failed delivery states, with generated file distinguishable from sent email. Retry failed recipients without duplicate successful sends. UI accurately reports outcomes. Revoke creator permission and deactivate creator; future scheduled runs refuse unauthorized export. Real transport acceptance is separate from substituted failure tests.

**D05 — Fee revision.** Bill a term, receive partial/full payment, publish a fee change. Authorized separate approval performs documented credit/void/rebill or adjustment. Student balance, payment allocations, receipts, journals, AR control and financial reports agree exactly. Repeating/concurrent requests do not create duplicate debt/postings. Closed financial periods are respected; old invoice and approval/audit history remain accessible.

**D06 — Upload gate.** Clean frozen-lockfile install, resolve the actual Nest runtime parser version, run the full unit suite successfully and exercise oversized/deep/excess multipart requests. Reject safely with 4xx and keep ordinary upload available. Build production tree without reinstating a vulnerable parser.

**D07 — School staff acceptance.** Complete section 13 with secretary/registrar, distinct teacher, head teacher, bursar and parent identities. Each permitted action works after reload and each forbidden direct API call is rejected without DB mutation. Hand-calculated results and money match DB and exports. Include all specified edge cases, concurrent updates and recoverable failures. Teacher credentials must not silently fall back to admin. No undocumented database edits are needed.

**D08 — Deployment/recovery.** Start exact production image with constrained database roles on target host/PG version; verify readiness, TLS, private ports, volumes, restart and rollback. Restore a real offsite test backup and files to a different clean host; authenticate, load pupils/history/results, download restored files, reconcile money and prove expected audit rows. Reject corrupt backup; record measured recovery time/data-loss window and responsible operator.

## 18. Evidence, limitations and exact final answer

Fresh commands/artifacts are documented in [verification-summary.md](C:/Dev/School-Management/docs/audit/evidence-current-review-20260929/verification-summary.md). Application code and real school data were not intentionally changed. Temporary runners/probes used a new scratch database and substituted service dependencies for the explicit email-failure test. No SMS/email was sent and no provider payment initiated.

Previous early-day audit findings were checked against recent remediation and current source rather than copied forward. Fresh interrupted tests are not counted as passes. Source findings are distinguished from live reproduction. The new report is additive and preserves existing audit history.

**“Can this existing system safely and reliably operate a real nursery and primary school in Uganda today, based on the functionality that has actually been verified?”**

**No—not enough has been verified to recommend that today.** The architecture and core coverage are substantial, fresh schema checks and 2,460 unit tests provide useful confidence, and ten bounded real-DB document/payment tests passed. But selected-period attendance reads the wrong register, offline work lacks original-school/user isolation, several workflow inconsistencies remain, and complete school operations plus production recovery have not passed fresh acceptance. Resolve the applicable defects and finish the concrete acceptance tests before committing real school operations to it.
