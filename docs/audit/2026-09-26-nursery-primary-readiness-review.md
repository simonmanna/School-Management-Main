# Nursery and Primary School Readiness Review

Date: 2026-09-26
Target: nursery and primary schools in Uganda
Scope: current working tree, including uncommitted school changes; student profiles, applications, admissions, enrollment, academics, assessments, examinations, fees, and related deployment controls.

## Verdict

**Not ready for an unrestricted production rollout.** There is a substantial, well-developed school system here, with much of the requested functionality implemented. However, the current code contains access-control defects, a reproduced financial concurrency defect, deployment problems, and gaps in stage-specific nursery/primary reporting. Passing the happy path is not sufficient for live children's records and school money.

A supervised primary-school pilot is a reasonable next milestone AFTER the launch blockers below are fixed and the release is verified on an isolated staging database. Nursery deployment additionally needs its assessment/reporting workflow validated with actual nursery teachers. This review does not authorize a live rollout.

"All functionality" and "best workflow" cannot be certified from a feature count. The system's breadth is strong; reliability, nursery fit, and everyday usability are less mature. The priority should be finishing those areas before adding more modules.

## Verification and Limits

- Reviewed actual controllers, services, permissions, UI handlers, deployment configuration, test configuration, and selected tests. Previous audit documents were used as context, not as proof that a defect remains or is fixed.
- Ran eight focused unit suites: **153 tests passed**. Suites: wave9-scenarios, wave8-reaudit, admissions-services, fees-accounting-integrity, grading.service, role-presets, web-api-contract, and result-computation.golden.
- The focused run used ts-jest's isolated-module transpilation to avoid the very expensive whole-program compilation on this machine. It verifies runtime tests, not TypeScript correctness.
- Parent portal typecheck: **passed**.
- Staff web typecheck: **did not complete successfully; Node ran out of memory**. This is not evidence of a TypeScript code error, but it is also not a pass.
- Full recursive typecheck and full unit run were stopped after prolonged execution/resource pressure. One school.module unit suite had passed before stopping; the full suite is unverified.
- Executed the real transpiled placement lookup method: `studentWhere({ classIds: [] })` returned `{}`. This reproduces the filter defect without changing a database.
- Executed the real transpiled adjustment approval method with a controlled mock transaction interleaving. A 10-unit adjustment on a 100-unit residual produced **120**, although both approvals referenced the same journal entry. This is a service-level reproduction, not a live PostgreSQL concurrency test.
- Root-workspace `require('@prisma/client')`: **MODULE_NOT_FOUND**, relevant to the Dockerfile assertions described below.
- Did not run database-writing integration tests against the configured `schooldb`. An isolated test database was not established during this review.
- No full authenticated browser walkthrough, mobile screenshot review, deployment-image build, provider sandbox payment, restore drill, or load test was completed. Usability findings are based on the UI implementation; smooth real-world operation is not certified.
- Application source was not edited. This report is the audit artifact.

## Findings, Highest Priority First

P1 means fix before the affected production workflow launches. P2 means an important functional or usability defect. References are repository-relative with one-based line numbers.

### F01 - P1: a teacher with no classes can receive the entire pupil list

Evidence: `apps/api/src/modules/school/people/student.service.ts:102` and `:114`; `apps/api/src/modules/school/enrollment/placement-lookup.service.ts:105` and `:161`.

The student service constructs `{ classIds: [] }` for a restricted teacher with no assignments. The lookup helper ignores empty arrays and returns `{}`. Consequently, the list query loses its class restriction instead of returning no pupils. This was reproduced by executing the actual helper.

Fix: explicitly return an empty page for an empty permitted class set, and make the shared filter distinguish an omitted constraint from an explicitly empty constraint. Add a regression through the list endpoint, not only through the permissions helper.

### F02 - P1: ordinary pupil responses bypass the separate medical permission

Evidence: `apps/api/src/modules/school/people/student.service.ts:49`, `:54`, `:125`, and `:437`; `apps/api/src/modules/school/people/student.controller.ts:22`; `apps/api/src/modules/school/people/medical-document.controller.ts:15`.

The dedicated medical endpoint requires `school:medical:read`, but the default student include returns `medicalRecord: true` through normal `school:read` routes. A caller does not need to open the protected medical endpoint to receive allergies, conditions, medications, and emergency notes. Several staff presets have ordinary school read without medical read.

The profile UI also writes a NIN into general `customFields` (`apps/web/src/pages/school/student-360.tsx:178`), unlike the encrypted, separately audited application-NIN path. General profile serialization needs a deliberate policy for sensitive identifiers as well.

Fix: use permission-aware response projections. Keep general roster responses minimal, expose medical detail only through appropriately scoped medical routes, and protect sensitive identifiers consistently.

### F03 - P1: teacher scope still has bypasses and expands a stream assignment to the class

Evidence: `apps/api/src/modules/school/people/emergency-contact.controller.ts:12`; `apps/api/src/kernel/auth/data-scope.service.ts:76`, `:84`, `:122`, and `:138`; `apps/api/src/modules/school/reporting/filter-resolver.service.ts:153`.

Emergency-contact reads require ordinary school read but do not check that the caller teaches that pupil. The reporting scope helper still returns `all` for a restricted caller with no taught classes. A section teacher is reduced to a class ID, so the current implementation cannot express "North stream only." Timetable-derived access has no academic-year restriction.

Fix: apply the same fail-closed pupil scope to every child-specific read and export, implement the intended stream/class policy explicitly, and make teacher ownership effective-dated. Verify reads, downloads, exports, and writes with real role accounts.

### F04 - P1: adjustment approval can change a balance twice under concurrency

Evidence: `apps/api/src/modules/school/fees/finance-controls.service.ts:92`, `:95`, `:106`, `:128`, and `:161`.

Pending status is read before the posting transaction. Approval does not lock or conditionally claim the adjustment, and the invoice residual is read and rewritten without a matching row lock. Two requests can both retain the original pending state, then execute in sequence. The second changes the residual again even if journal posting returns the first entry. Controlled execution of the actual method reproduced residual 100 -> 120 for one adjustment of 10 and one journal ID. Different adjustments against the same invoice also need protection against lost updates.

Fix: lock and re-read the adjustment and invoice inside one transaction, conditionally transition pending -> posted, and make repeat approval return the committed outcome without touching the balance. Test concurrent approve/approve and approve/reject against PostgreSQL.

### F05 - P1: a resumable billing run can post after financial close

Evidence: `apps/api/src/modules/school/fees/billing-run.service.ts:40`; `apps/api/src/modules/school/fees/billing.service.ts:596` and `:716`.

The run checks financial close at start. Processing later calls `billSingleStudent`, which checks academic-year writability but does not check term financial close. Its posting transaction also lacks that check. A term can be financially closed while its academic year remains active, so pending run items can create new revenue after close.

Separately, run creation filters a selected class using the current placement (`billing-run.service.ts:44`), whereas synchronous billing filters placement in the requested term (`billing.service.ts:110`). Historical-term runs can omit pupils who moved classes.

Fix: validate and serialize academic/financial close inside every invoice posting transaction, and make both entry points select the same term-specific roster.

### F06 - P1: an adjustment is not checked against the named pupil's invoice

Evidence: `apps/api/src/modules/school/fees/finance-controls.service.ts:57` and `:106`.

Creation verifies only that the document exists in the organization. It does not verify that it is a qualifying school invoice belonging to `studentProfileId`; approval posts against that document's partner while events and adjustment records identify the supplied pupil. A mistaken selection can change one child's balance while attributing the correction to another.

Fix: validate the school-invoice relation and pupil/payer identity on creation and again when applying the correction. Refuse unrelated document types and inappropriate document states.

### F07 - P1: Docker's Prisma assertions use the wrong workspace resolution

Evidence: `infra/docker/Dockerfile.api:43` and `:58`; `.github/workflows/ci.yml:160`; root and API package manifests.

The image assertions run from `/app` and call `require('@prisma/client')`, but Prisma is declared in the API workspace, not in the root package. That same root resolution fails with MODULE_NOT_FOUND in the installed workspace. With the default pnpm layout copied by this Dockerfile, this is a build/release blocker independently of whether Prisma generation succeeded.

Fix: run the checks in `apps/api`, or resolve with the API package as the module base. Build and smoke-start the actual production image afterward. This review reproduced module resolution locally; it did not complete a container build.

### F08 - P1 for combined nursery/primary: grading and report layout are school-wide

Evidence: `apps/api/src/modules/school/assessment/result-run.service.ts:75`, `:88`, and `:585`; `apps/api/src/modules/school/examinations/report-card-template.service.ts:127`.

Both computation and report layout select `SchoolProfile.gradingSystem`, with a UCE fallback. Grade levels recognize nursery/lower-primary/upper-primary stages, and assessment kinds include observation, but these result paths do not choose the grading system by stage or grade. Selecting PLE school-wide does not provide nursery developmental reporting or automatically accommodate the lower-primary learning-area structure. Selecting generic school-wide does not solve all P7 requirements either.

Fix: stage/grade/programme-specific result and reporting policies; nursery observational reports; lower-primary learning-area reports; configurable school-term upper-primary grading, with a separately validated P7/PLE policy. Preserve the policy snapshot on each result version.

### F09 - P1 for registrar use: saving a pupil can partially succeed and then fail

Evidence: `apps/web/src/pages/school/student-360.tsx:137`, `:198`; `apps/api/src/modules/core/partner/partner.controller.ts:42`; `packages/shared/src/permissions.ts:1259`.

The profile Save handler updates the student and then calls the generic Partner update endpoint. The Registrar preset has student-write authority but lacks `partner:update`. The first operation can commit and the second return 403, leading to a generic "Update failed" even though some fields were saved. Photo changes also call the Partner endpoint. This prevents a normal registrar from completing the advertised workflow.

Fix: update permitted pupil/partner fields through one atomic student-domain endpoint. Gate controls by the signed-in role and display actionable errors. Verify the complete screen under Registrar, Teacher, and Bursar accounts, not just Administrator.

### F10 - P2: cancelled fee invoices still block replacement billing

Evidence: `apps/api/src/modules/school/fees/billing.service.ts:728` and `:730`.

The duplicate lookup considers any document with the billing business key, without filtering cancelled status. If an invoice was cancelled because it was wrong, rerunning billing skips it. Simply filtering cancelled rows may still conflict with the unique key, so the replacement policy must be designed end to end.

Fix: provide an explicit corrected/replacement invoice workflow with preserved audit history and a compatible uniqueness rule.

### F11 - P1 for cash-drawer reconciliation: collection screens omit the drawer

Evidence: `apps/web/src/pages/school/fees-subpages.tsx:175`; `apps/web/src/pages/school/fees-operations.tsx:374`; `apps/web/src/features/school/api.ts:2091`; `apps/api/src/modules/invoicing/payment/payment.service.ts:325`.

The API supports `cashSessionId`, but the single and bulk collection screens do not send it. The payment engine writes a drawer movement only when a cash session is supplied. The general ledger can therefore record cash while the cashier's drawer close/Z-report omits that receipt. Accounting integration exists, but the user workflow does not finish the link.

Fix: require/select the current cashier session for cash receipts and payouts; expose open/close/count/variance actions to the bursar. Test receipt totals against the drawer and GL.

### F12 - P1 if live mobile money is enabled: MTN completion is not established

Evidence: `apps/api/src/modules/school/fees/mobile-money.service.ts:101`, `:115`, `:137`, and `:467`.

MTN request-to-pay is asynchronous. The request does not send `X-Callback-Url`, and this service has no status-polling adapter to recover completion if a callback does not arrive. It also assumes an HMAC callback protocol that needs verification against the contracted provider or intermediary. Mock callback tests do not establish compatibility with a real merchant account. Airtel also needs provider-specific sandbox acceptance.

Fix: implement the contracted provider's actual callback/authentication contract, token lifecycle, status recovery, timeout/review handling, and settlement reconciliation. Demonstrate successful, failed, late, duplicate, and missing callbacks in the sandbox. A cash/bank-only first release can keep this feature disabled until accepted.

MTN documents callback configuration and polling recovery: https://momodeveloper.mtn.com/content/html_widgets/uv7jo.html

### F13 - P2: portal links remain visible for a disabled backend feature

Evidence: `apps/portal/src/lib/portal-api.ts:354` and `:374`; `apps/api/src/modules/school/school.module.ts:41`; `docker-compose.prod.yml:64`.

The portal Courses/Due requests call the advanced LMS learner routes. Production disables the module providing those routes. This can yield a 404 or a misleading "No courses yet" display rather than a coherent supported experience.

Fix: use one feature-capability contract across server, staff UI, and portal. Hide unsupported views or connect them to the enabled school assessment/homework routes.

### F14 - P2: rubric setup requires staff to edit JSON

Evidence: `apps/web/src/pages/school/assessment-ops.tsx:116`, `:120`, and `:141`.

Rubric creation uses a raw JSON textarea. This is a substantial usability barrier for the very nursery assessment feature teachers need.

Fix: a form-based criterion/level editor, reusable stage-specific templates, previews, validation, and a teacher-friendly observation entry grid. Keep the advanced data format out of routine staff work.

### F15 - P2: name ordering is inconsistent with statutory exports

Evidence: `apps/web/src/pages/school/applications.tsx:123`; `apps/web/src/pages/school/student-360.tsx:103`; `apps/api/src/modules/school/statutory/uneb-ca.service.ts:474`.

Admission conversion constructs `otherNames + surname`, the profile editor treats the final token as the last name, while statutory `splitName` assumes surname first. "James Paul Okello" can export surname "James" and other names "Paul Okello". Multiword surnames cannot be safely inferred this way.

Fix: preserve surname and other names as structured fields from application through pupil record and export. Make the displayed order configurable without re-parsing a full-name string. Require explicit candidate-name confirmation before submission.

### F16 - P2, significant for nursery: admission conversion authorizes pickup by default

Evidence: `apps/api/src/modules/school/admissions/admissions.service.ts:731`.

Every promoted application guardian is created with `canPickup: true`. Being a recorded parent/contact is not necessarily the school's approval to collect a child. The pupil screen has a pickup checkbox and emergency contacts have an authorized-pickup field, but this conversion does not collect that decision.

Fix: carry an explicit pickup authorization from admission, make exceptions/custody restrictions visible to relevant staff, and validate the actual arrival/handover procedure with each nursery. Transport safety features do not automatically provide classroom dismissal control.

## What Is Done Well and What Remains

### 1. Student Profiles

Implemented well:

- One persistent pupil identity with Partner + StudentProfile.
- Class/stream derived from effective-dated placement history rather than an independently edited current-class field.
- Profile, guardian, academic, attendance, finance, wellbeing, and engagement views.
- Guardian reuse across siblings, Uganda phone normalization, pickup flags, and emergency contacts.
- Medical records, document verification, status history, and safeguards against deleting pupils with enrollment/financial history.
- Duplicate detection and a direct register-and-place path.

Remaining:

- F01-F03 privacy/scope fixes and F09 registrar save fixes.
- Consistent sensitive-ID protection and structured names.
- Permission-aware tabs and controls: the profile currently initiates several protected queries irrespective of which tab is open.
- Stronger DOB/age validation for the school's entry policy; date fields currently include string-only validation in the pupil DTO.
- Decide and validate nursery health records: immunizations, medication administration/consent, incident recording, and additional support needs. The basic medical record exists; a complete nursery care workflow was not established by this audit.

Assessment: strong record foundation; privacy and everyday editing are not finished.

### 2. Applications and Admissions

Implemented well:

- Configurable simple versus selective admission stages, rather than forcing every child through an exam.
- Applications, screening/review, interviews/exams where configured, offers, decisions, waitlisting, and timelines.
- Server-side eligibility checks for workflow progress, documents, fees, target year/term, identity matches, and capacity.
- Transactional conversion into enrollment/placement and reuse of a confirmed returning pupil.
- Atomic admission capacity claim protects the last available seat.
- Recent work connects admission-fee history to the converted pupil's financial account.

Remaining:

- A consistently short nursery workflow and an explicit guardian/pickup decision.
- F15 structured names and verified candidate-name export.
- Confirm fee and document requirements under each actual school configuration; make blocking requirements clear before the final Enroll action.
- Enrollment dialogs should default/filter to the application's year, not initially select the current term of another year and rely on the API error.
- Verify guardians, sibling matching, returning pupils, full classes, fee waivers, expired offers, and partial batch failures in staging.

Assessment: one of the strongest areas. The breadth should be tailored to the school's actual admission process.

### 3. Enrollment and Academics

Implemented well:

- Separate pupil identity, academic-year membership, and effective-dated class/stream placement.
- New, continuing, repeat, transfer-in, and re-entry types, with controlled status transitions.
- Year/term lifecycle, grade ladders including nursery-to-primary progression, class cohorts, streams, teacher assignment, timetable, subjects, and teaching/course offerings.
- Promotion, repetition, graduation, withdrawal, suspension, and returning-pupil histories.
- Dry-run rollover and per-pupil outcomes; completed-year pupils are now eligible to progress.
- Year write guard uses a row lock when used within the caller's transaction.

Remaining:

- F03 effective teacher/stream ownership and F08 stage policies.
- Rollover preview can recommend a target with no matching stream; execution can then fail if the target requires a stream selection. Preview should resolve capacity/stream requirements and let staff correct the plan before committing.
- Define how suspension carries across year rollover and how pupils are displayed/billed in holiday intervals before the new placement starts.
- Ensure year activation/current-year controls enforce the intended lifecycle permission consistently.
- Offer ready-to-use lower-primary learning-area/local-language setup, with P4 transition and P5-P7 subject setup, rather than making staff infer these from generic course structures.

Assessment: sound domain model; edge cases and configuration burden still need work.

### 4. Assessments and Examinations

Implemented well:

- Unified kinds include exams, CATs, homework, assignments, practicals, oral work, projects, and observation.
- Rubrics, learning outcomes, participation statuses, frozen rosters, approval states, and assessment policies.
- Markbook has local draft recovery, explicit saves, retry keys, version conflicts, keyboard/paste support, and protected submission.
- Distinguishes absence/exemption/missing evidence from a numeric zero.
- Versioned computed results, publication gates, amendment flows, report documents, and promotion decisions.
- PLE aggregation exists; exam operations also include attendance, script allocation, moderation, question-paper custody, and access arrangements.
- Result golden tests and grading tests passed in this review.

Remaining:

- F08 separate nursery/lower-primary/upper-primary result and report policies, plus F14 usable rubric setup.
- Verify roster term and result scope agree before computing; the visible compute entry checks existence/frozen state but does not establish all context matches.
- F15 names and externally accepted candidate/export layouts. Configurable export templates are not proof of direct UNEB or EMIS interoperability.
- Validate a real nursery report and a real primary term report, including comments, signatures, attendance, missing marks, amendments, and bulk printing.
- Simplify daily teacher navigation across Assessments, Gradebook, Exam Mark Entry, Assessment Structure, and Cohorts & Rubrics. Keep advanced exam administration available to the relevant role.

Assessment: advanced assessment foundation; nursery reporting and configuration usability are the largest product-fit gaps.

### 5. Fees

Implemented well:

- Published fee versions, schedules, component pricing, targeting, optional fees, discounts, scholarships, installment arrangements, and opt-in late-entry proration.
- Real invoices, receivable accounting, partial payments, oldest-first allocation, receipt history, and statements.
- Credit, refund, write-off, reversal, reallocation, reconciliation, penalties, and approval workflows.
- Shared financial query service reduces differences between staff balances and parent balances.
- Resumable billing, uniqueness/idempotency controls, payment locks, and batch retry keys.
- Recent fixes cover bounced-payment funded credits, refund payer checks, closed-term arrears collection, and batch resubmission safety. Relevant focused regression suites passed.

Remaining:

- F04-F06 adjustment and close integrity; F10 replacement billing; F11 drawer integration.
- F12 actual provider acceptance before offering live mobile-money prompts.
- Explicit whole-UGX rounding throughout pricing, discounts, tax, credits, and display. Decimal money utilities exist, but this is not yet one consistently enforced zero-decimal policy.
- Agree withdrawal/transfer charging rules, including whether issued invoices remain payable or require approved credit/proration. Do not silently change already posted revenue.
- Test a family's siblings: which child an invoice belongs to, which balance a payer sees, and how one family tender is allocated. Guardian reuse alone does not establish pooled family billing.
- Verify opening balances and migration from paper/Excel against the GL and pupil statements before live collection.

Assessment: broad, substantial finance implementation; correction and cashier edge cases block sign-off.

## Uganda and Nursery/Primary Fit

NCDC describes pre-primary development through play and holistic learning, P1-P3 thematic learning, P4 transition, and P5-P7 subject-based learning. This supports stage-specific configuration and reporting rather than one examination policy for every class. The system recognizes stages and observations, but F08 shows that its principal result/report paths still use one school-wide grading selection.

Source: https://ncdc.go.ug/directorates/

UNEB's 2026 registration guidance specifically calls for head teacher/parent agreement on spelling and order of PLE candidate names using supporting identity records. That makes F15 operationally significant. The system's configurable candidate/export tooling should be checked against the receiving portal's current accepted layout; it should not be advertised as automatic official submission solely because a CSV is generated.

Source: https://uneb.ac.ug/2026/06/01/uneb-normal-registration-extended-to-30th-june-2026/

Schools and the hosting/service operator should establish their applicable data-controller/processor obligations, registration, notices, retention, access rights, and cross-border hosting arrangements with the PDPO. This audit reviewed code access controls; it did not verify organizational legal compliance or processing agreements.

Source: https://pdpo.go.ug/media/2022/01/20102021105143-Registration_Classification_and_Guidance_Notes.pdf

For nursery, useful capabilities to validate with the school include controlled collection/handover, health/medication records, incidents, developmental observations, classroom attendance, meals, and guardian communication. Some underlying fields and transport features already exist. A complete daily care/handover workflow was not proven here, and each item should be mapped to the school's operating practice before calling the nursery offering complete.

For primary, validate local-language/lower-primary learning areas, upper-primary subjects, term report cards, promotion/repetition, P7 candidate identity, fee collection, attendance alerts, and teacher responsibility by class/stream. Choose private-school versus UPE operating/reporting requirements explicitly.

## Workflow Assessment

The overall business sequence is sensible:

1. Set up school, roles, academic year/terms, grades/classes/streams, teachers, learning areas/subjects, and fees.
2. Register directly or take an application, resolve identity/guardians/documents, and admit.
3. Create the year's enrollment and correct class/stream placement.
4. Bill, collect, issue receipts, and reconcile cash/bank balances.
5. Take attendance and teach; enter observations/marks; review and publish results.
6. Issue reports, approve progression, place pupils in the new year, and close the old year with history preserved.

The domain services largely support that sequence. The setup checklist and role guide are positive additions. The remaining friction comes from role failures, repeated context selection, multiple overlapping academic screens, technical setup fields, generic errors, and previews that do not resolve all execution constraints.

Recommended daily workspaces:

- Registrar: Find pupil -> profile/guardians -> application or direct admission -> class placement -> invite guardian.
- Teacher: My class/stream -> today's register -> observations/marks -> submit -> view returned items.
- Head teacher: setup exceptions -> decisions/approvals -> report publication -> progression review.
- Bursar: open drawer -> find pupil -> collect/print -> corrections requiring approval -> reconcile/close drawer.
- Guardian: choose child -> attendance/messages -> published report -> fee balance/receipts.

Keep complex policy, raw mappings, custody, and reconciliation settings behind the relevant administrative role. The existing engine can support much of this simplification.

## Conditions for Launch

1. Fix the P1 privacy, finance, deployment, and registrar workflow defects. Fix or disable features whose affected workflow will not ship, including unaccepted live mobile money.
2. For a combined nursery/primary release, deliver and validate stage-specific assessment/reporting before claiming coverage of both.
3. Commit a reviewed release containing the intended current changes and migrations. Working-tree audit results do not establish what is deployed from a different commit.
4. On an isolated staging database, apply migrations and verify production RLS roles and required constraints. Run full typecheck, required unit/integration tests, image build, and startup/health checks.
5. Run role-based browser journeys for Administrator, Registrar, Bursar, Teacher, and Guardian, including mobile use and denied access to another class/family. Test guardian identity and contact-reuse cases carefully.
6. Exercise full-class admission, returning pupil, missing/absent marks, returned approval, report amendment, missing target stream, suspension, withdrawal, duplicate payment, lost response, refund/reversal, and financial/year close races.
7. Demonstrate that invoices, receipts, credits, adjustments, refunds, pupil statements, parent balances, drawer counts, and GL reconciliation agree.
8. Restore a backup into a separate database and verify uploads/report files too; prove monitoring and recovery before schools depend on the deployment.
9. Have one nursery and one primary school complete their normal tasks with realistic records. Record failures, training needs, and time to complete each task; resolve launch-critical friction.

This is a finish-and-verify phase, not a rebuild. The strongest foundations are admissions/enrollment history, the assessment approval model, and the shared accounting engine. The most urgent remaining work is privacy, financial correction integrity, deployment verification, and nursery-specific reporting/usability.
