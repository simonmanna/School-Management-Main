# SCHOOL MANAGEMENT SYSTEM FUNCTIONAL AUDIT

Date: 26 September 2026  
Scope: application → admission → student identity → enrollment → class/stream placement → course membership → attendance → assessment → marks → results → report cards → promotion.  
Repository: `C:/Dev/School-Management`, active `apps` workspaces. The nested `school-management-feature` checkout was not treated as the running implementation.

## 1. Executive Summary

**The system has a substantial working foundation, but its student-to-academic flow is not consistently safe or ready for unrestricted production. NO-GO until the issues below are resolved.**

The strongest parts are transactional admission, annual enrollment uniqueness, effective-dated placement history, frozen assessment rosters, a shared marks ledger, maker/checker approval, and versioned results. These are real implementations, with successful database-backed checks—not merely pages or interfaces.

The weakest parts are the connections between those foundations. Application attributes can disappear during conversion; a moved pupil can remain on an old course; historical rosters can use today's pupils; attendance can accept a pupil from another class; incomplete assessment coverage can pass result publication; and decimal grading can produce a plainly incorrect grade. Several read paths also expose more pupil data than the role is meant to see.

**Ease of use:** the admissions pipeline, assessment wizard, markbook, and result-readiness checklist offer useful guidance. However, staff still face competing entry points with different defaults, failed saves after partial persistence, lists that silently stop at 50 pupils, and term selectors that do not always control the underlying data. Smooth operation by ordinary school staff has NOT VERIFIED status because no authenticated browser walkthrough was completed in this audit.

Coverage: **25 core feature areas reviewed**: 13 PARTIALLY IMPLEMENTED, 10 INCONSISTENT, 2 BROKEN, and 0 fully IMPLEMENTED—VERIFIED under the brief's requirement for UI-to-database proof. This does not mean nothing works: many service/database workflows were verified. It means full user-facing feature certification is not established.

Findings: **1 P0, 15 P1, 5 P2, and 2 P3**. No numerical readiness score is assigned.

### Verification performed

- Five focused unit suites: **69 tests passed**. Academic FSM, admission services, marking recomputation, golden result arithmetic, and ECD result arithmetic.
- Ten PostgreSQL-backed integration suites: **114 tests passed**. Enrollment/placement, admission concurrency, Phase 4 assessment, result integrity, early years, academic foundation, gradebook, unified assessment, Phase 5 exams, and admission re-audit.
- Eleven controlled probes executed the actual TypeScript methods, using real arithmetic and controlled persistence adapters. Their output is in [student-flow-audit-probes.json](C:/Dev/School-Management/var/student-flow-audit-probes.json). These reproduce method-level defects; they are **not authenticated HTTP exploits or PostgreSQL concurrency proofs**.
- Database-writing checks ran against an isolated local clone, `school_flow_audit_20260926`, rather than the configured school database. Both application and system database URLs were redirected to that clone. The temporary clone was removed after testing; the configured school databases were not modified by these checks.
- Existing audits were read as context. Current source and newly executed checks support the findings here; older reported fixes were not accepted as proof.
- Application source was not changed. Audit scripts and this report are the artifacts.

### Not verified

Full browser journey; mobile/accessibility visual review; real Registrar/Teacher/Parent API sessions; all role/tenant combinations; production database privileges; full build/typecheck; clean migration deployment; backup/restore; load testing; financial ledger reconciliation; real SMS/email/mobile-money delivery. A local test warning confirmed that the cloned database connection uses a PostgreSQL superuser, so these checks cannot certify production RLS enforcement.

## 2. System Architecture Summary

| Layer | Actual implementation | Audit implication |
|---|---|---|
| Staff frontend | React/Vite, React Router, TanStack Query, shared school API hooks | UI handlers and cache invalidation must be checked separately from service correctness. |
| Family frontend | Separate `apps/portal` workspace | Staff permissions do not prove parent/child isolation. |
| Backend | NestJS modules under `apps/api/src/modules/school` | Admission, enrollment, assessment, exams, reporting and finance are distinct modules. |
| Database | PostgreSQL with Prisma; SQL migrations add constraints/triggers beyond the Prisma schema | Prisma schema alone does not describe every safety rule. |
| Authentication | JWT/session guards in the kernel | No live login walkthrough was executed here. |
| Authorization | Permission guard plus explicit domain/data-scope checks | Route permission and pupil/teacher ownership are different checks; several reads omit the latter. |
| Tenancy | Organization-scoped Prisma extension, database RLS infrastructure, tenant context | Tests cover selected tenancy cases, not complete production isolation. |
| Integrations | Partner/contact identity, documents, fee account transfer, event bus/outbox, LMS and portal | A successful module action does not guarantee its consumer sees the correct new state. |

The canonical chain implemented in the repository is:

```text
AdmissionApplication
  → Partner + StudentProfile + StudentGuardian
  → StudentEnrollment (one pupil/year)
  → EnrollmentPlacement (dated class/section history)
  → CourseEnrollment (membership of teaching offering)
  → AcademicRoster + members (frozen assessment audience)
  → Assessment + StudentAssessment
  → MarkEntry + adjustments + approval
  → ResultProcessingRun + ResultSet
  → StudentSubjectResult + StudentTermResult
  → ReportCard / ReportDocument
  → PromotionDecision → next year's enrollment and placement
```

Annual enrollment and current placement are intentionally separate from the pupil's biography. This is the correct foundation for historical records. The findings mostly concern incorrect selection, missing synchronization, and inconsistent policies around this chain.

Important sources: [student-admission.service.ts](C:/Dev/School-Management/apps/api/src/modules/school/people/student-admission.service.ts:141), [schema.prisma](C:/Dev/School-Management/apps/api/prisma/schema.prisma:12456), [placement.service.ts](C:/Dev/School-Management/apps/api/src/modules/school/enrollment/placement.service.ts:398), [result-run.service.ts](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-run.service.ts:53).

## 3. Feature Coverage Matrix

These classifications apply to the complete feature, including its UI. “DB passed” means the named service/database scenarios passed, not every user scenario.

| Module | Feature | Status | Evidence | Severity / limitation |
|---|---|---|---|---|
| Admissions | Application creation | PARTIALLY IMPLEMENTED | Application form → shared API → admissions service; admission re-audit DB passed | Full browser submission unverified |
| Admissions | Configurable review/offer pipeline | PARTIALLY IMPLEMENTED | Server workflow snapshots and enrollment gate; admission DB passed | Real role journey unverified |
| Admissions | Conversion to student | INCONSISTENT | Atomic service; concurrency DB passed; F13 | P1 attribute loss |
| People | Guardian promotion / sibling contact reuse | PARTIALLY IMPLEMENTED | `promoteGuardians`, transactional guardian creation | Parent portal access unverified |
| Documents | Application documents become pupil documents | PARTIALLY IMPLEMENTED | `copyApplicationDocuments` with type/file deduplication | Full upload/download flow unverified |
| People | Profile editing | INCONSISTENT | Student-domain endpoint is atomic; UI also calls Partner API; F15 | P1 partial save |
| People | Pupil list | BROKEN | No-class teacher probe; fixed 50-row UI; F07/F17 | P1 scope; P2 visibility |
| Enrollment | Annual membership | PARTIALLY IMPLEMENTED | Uniqueness and duplicate rejection DB passed | Complete UI role journey unverified |
| Placement | Move class/stream and preserve history | PARTIALLY IMPLEMENTED | Midterm movement and one-open-seat DB passed | Course consumers remain inconsistent |
| Enrollment | Withdrawal / re-entry | INCONSISTENT | Status FSM and seat release DB passed; F11 | P1 stale teaching memberships |
| Teaching | Course roster synchronization | INCONSISTENT | Automatic compulsory reconciliation exists; F11 | P1 old membership and partial roster drift |
| Academics | Years/terms/current calendar | PARTIALLY IMPLEMENTED | Overlap/current-year DB scenarios passed | Production migration and all concurrent cases unverified |
| Academics | Curriculum / timetable | PARTIALLY IMPLEMENTED | Curriculum immutability and timetable conflict DB passed | All assignment/room/year cases unverified |
| Authorization | Teacher data scope | INCONSISTENT | Marking ownership exists; student/result reads diverge; F07/F09 | P1 |
| Attendance | Class register and corrections | INCONSISTENT | Closed-year and class ownership checks exist; F10 | P1 submitted pupils not validated against class/date |
| Assessment | Unified CAT/homework/project/exam creation | PARTIALLY IMPLEMENTED | Four kinds and frozen roster DB passed | Full wizard journey unverified |
| Assessment | Marks ledger / batch save | PARTIALLY IMPLEMENTED | Invalid batch rollback, idempotency, stale versions DB passed | Browser offline recovery unverified |
| Assessment | Submit / reject / resubmit / approve | PARTIALLY IMPLEMENTED | Maker/checker and return loop DB passed | Result publication adds separate defects |
| Assessment | Rubric/evidence/observation | PARTIALLY IMPLEMENTED | Attempts/rubric/evidence/non-subject observation DB passed | Complete nursery reporting link unverified |
| Grading | Decimal grade boundaries | BROKEN | 89.5 → F9 method probe; F01 | P0 incorrect grade |
| Results | Compute and publish term totals | INCONSISTENT | Standard path DB passed; F02–F06 | P1 coverage, scope and revision issues |
| Results | Amendment and locking | INCONSISTENT | Amendment DB passed; F04/F16 | P1 bypass and disappearing locked results |
| Reporting | Published report provenance | PARTIALLY IMPLEMENTED | Report spine and pinned document version DB passed | Historical/live fallback and browser printing unverified |
| Promotion | Recommend / decide / apply / rollover | INCONSISTENT | Promotion DB passed; F16/F19 | P1 locked evidence; P2 wrong UI population |
| Nursery | ECD reporting + care workflows | INCONSISTENT | ECD arithmetic unit and care DB passed; F14 | P1 default scale can override descriptors |

No reviewed core module is accurately described as “UI ONLY” or wholly “MISSING.” The main problem is incomplete correctness across otherwise implemented modules.

## 4. Workflow Audit

### A. Application → admitted pupil

**Status: INCONSISTENT.**

The frontend sends application identity and target term/class/section to `/school/admissions/enroll`. The controller's permission leads to `AdmissionsService.enroll`. Its transaction checks workflow, term/year, eligibility, identity matches and capacity; creates/reuses identity; creates annual enrollment and placement; promotes guardians; copies documents; moves admission fees; and changes application status.

Passed database scenarios: last-seat concurrency, sequential seat claims, rollback after failure, duplicate conversion prevention, offer-token behavior, and wrong-year rejection. The conversion chain is real and unusually well protected in these areas.

Failed handoff: the normal screens send name/gender/DOB, while the backend builds the new profile mainly from `dto.student`. It does not carry forward the application's category and defaults missing boarding information to day. See F13. UI variants offer different term choices (F18), and the success action reads the wrong response fields (F22).

### B. Enrollment → placement → teaching audience

**Status: INCONSISTENT.**

Annual uniqueness, section/class compatibility, append-and-close movement, date history, repeating, promotion, graduation, previews and rollover passed selected DB scenarios. Capacity uses transaction advisory locks, and overrides require authority and a reason.

The new placement also reconciles compulsory offerings in that transaction. However, the reconciliation adds memberships and does not close outdated ones. Assessment capture trusts those memberships and can record a pupil's new class against an old course. Its self-repair only runs when the whole course roster is empty. See F11.

Historical class-roster capture remains a separate reader of today's placement rather than the requested term (F12). Thus preserved history in the database is not enough to guarantee correct historical reports.

### C. Academic setup → assessments → marks → approval

**Status: PARTIALLY IMPLEMENTED, with substantial DB verification.**

The unified wizard selects an offering, assessment kind, weighting/rubric, timing and frozen audience. The API validates offering context, allocation, roster compatibility, dates, policy and outcomes. Publication fans out exactly the frozen audience. Marks go through the canonical ledger; batch invalidity rolls back the whole write; idempotency and versions protect retry/overwrite; approval requires a different author/submitter; returned marks can be corrected and resubmitted.

These service/database paths passed. Non-subject observations are supported without manufacturing a subject/class. The full browser flow, accidental navigation, interrupted save and role visibility remain unverified. “Formative” labeling also contradicts result inclusion (F03).

### D. Approved marks → calculated results → publication

**Status: INCONSISTENT; not safe for live reports.**

The standard verified path builds result rows, publishes them, and produces a report from the result spine. Gate checks catch unapproved rows, self-approval, unresolved existing marks, invalid policy weights and open exam papers. Immutable published result data and amendment creation passed DB tests.

But the gate measures existing rows rather than the expected curriculum/component set, and missing components are normalized away. Decimal grade gaps are wrong. Compute accepts mismatched roster context and can archive published/locked results directly. Publish checks that checksums exist rather than proving the current approved inputs are those computed. See F01–F06.

### E. Results → reports → promotion

**Status: INCONSISTENT.**

Pinned document provenance, versioned amendments, and propose/decide/apply promotion passed DB scenarios. Published cards refuse casual regeneration. These are useful controls.

Locking changes result status to `locked`, but authoritative readers still search only for `published` (F16). The standalone promotion screen fetches today's pupils despite a selected historical term (F19). Live report fallback selects the newest enrollment's reporting programme rather than the requested term's enrollment; historical fallback equivalence is NOT VERIFIED.

## 5. Critical Findings — P0/P1

### F01 — P0: decimal percentages can become a failing grade

**Evidence:** [result-computation.ts:215](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-computation.ts:215), [grade-bands.ts](C:/Dev/School-Management/apps/api/src/modules/school/assessment/grade-bands.ts:10). Actual-method probe: **89.5% → F9**.

Bands use inclusive integer endpoints such as 80–89 and 90–100. A decimal between endpoints matches neither. `bandFor` returns the last band on no match. ECD gaps have the same structural problem. Valid weighted/decimal marks can therefore receive a failing or lowest-support descriptor, affecting divisions and promotion.

**Fix:** define continuous intervals and one explicit boundary/rounding policy; reject invalid scales rather than silently choosing the last band. **Done:** independently check every boundary at `boundary − 0.01`, boundary, and `boundary + 0.01`, including 89.5, zero and maximum, through result creation and printed report.

### F02 — P1: missing required components/subjects do not reliably block publication

**Evidence:** [result-computation.ts:240](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-computation.ts:240), [result-run.service.ts:287](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-run.service.ts:287), [buildInput:636](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-run.service.ts:636).

A 40% CAT / 60% exam policy with CAT=80 and no exam produces **80**, because the denominator becomes the weight present. Publication validates that policy weights total 100, not that each required component has evidence. It also derives subjects from existing assessment rows. Probe: a frozen learner with a term result but no subjects/assessments receives **zero publication conflicts**.

**Impact:** missing exams or an entirely absent subject can be treated as completed results. **Fix:** derive required subject/component coverage from curriculum and applicable policy, distinguish required/optional/exempt evidence, and never renormalize required missing work without an explicit approved policy. **Done:** absent exam row, absent subject, empty results, late admission and exemption each produce the school's documented outcome; incomplete cases cannot publish.

### F03 — P1: a “formative, not weighted” assessment can change results

**Evidence:** [assessment-form.tsx](C:/Dev/School-Management/apps/web/src/pages/school/_components/assessment-form.tsx:114), [result-computation.ts:242](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-computation.ts:242). Gradebook's existing test explicitly expects component-less columns to join their kind.

The UI describes a null component as formative/no term weighting. The kernel assigns null-component assessments to any component with the same kind. Probe: CAT=20 plus a null-component CAT=100 produces **60**, rather than leaving the weighted mark at 20. With multiple components of the same kind, the same evidence can match multiple components.

**Fix:** persist an explicit contribution policy; exclude formative evidence and bind summative work to one component. **Done:** adding/removing/changing formative work leaves term totals unchanged; one assessment contributes to exactly one intended component.

### F04 — P1: ordinary compute bypasses the published-result amendment workflow

**Evidence:** [result-run.service.ts:118](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-run.service.ts:118), [amendment path:431](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-run.service.ts:431).

Compute archives any published or locked live set and creates a new computed revision. It does not require an approved amendment. Actual-method probe archived a locked set via ordinary compute. The normal UI also exposes computation separately from the amendment workflow.

**Impact:** live authoritative results can disappear before a replacement is approved/published, and a compute-only role can change the release state. **Fix:** ordinary computation must not supersede released data; build a draft separately and atomically supersede only on authorized publication/amendment. **Done:** compute-only user cannot retire released results; old results remain authoritative until replacement publication succeeds; failed amendment changes nothing.

### F05 — P1: publish does not establish that its snapshot matches approved inputs

**Evidence:** [result-run.service.ts:249](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-run.service.ts:249), [checksum check:325](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-run.service.ts:325). `buildInput` also reads rows without filtering approval status before computation.

Computation can consume unapproved marks. After computation, those rows can be changed and approved. Publication checks today's approval status and that old checksums are nonempty; it never compares a freshly derived input checksum with the computed snapshot. Probe: stored result=20 with current approved mark=95 and an old checksum received **no conflicts**. Gates are evaluated before the publishing transaction, adding a concurrency window.

**Fix:** compute from approved versioned evidence, pin all relevant policy/input versions, and publish with an atomic freshness check. **Done:** mark/policy/roster change between compute and publish blocks release and requests recomputation; concurrent correction/publication cannot expose stale totals.

### F06 — P1: result roster term/scope is insufficiently validated

**Evidence:** [result-run.service.ts:65](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-run.service.ts:65), [results.tsx](C:/Dev/School-Management/apps/web/src/pages/school/results.tsx:120).

Compute checks that the roster exists and is frozen, but not that its term matches the supplied term or that its audience matches the result scope. Probe accepted an old-term roster for a different result term. The UI offers term rosters without restricting them to complete class audiences; compute defaults to class scope. A subject/stream roster can therefore become the class's result set for only a subset of pupils, superseding another class-scoped version.

**Fix:** validate term/year/class/section/scope together and use a complete result roster appropriate to the requested scope. **Done:** wrong-term, wrong-class, subject-as-class and incomplete class audience requests fail before any existing result changes.

### F07 — P1: a teacher with no assigned classes can receive the pupil list

**Evidence:** [student.service.ts:98](C:/Dev/School-Management/apps/api/src/modules/school/people/student.service.ts:98), [placement-lookup.service.ts:118](C:/Dev/School-Management/apps/api/src/modules/school/enrollment/placement-lookup.service.ts:118).

An explicit `classIds: []` becomes an unrestricted `{}` filter. Probe executed the actual student list with no readable classes and returned the supplied out-of-class pupil. This is a fail-open scope decision, not an absent button.

**Fix:** distinguish absent filter from empty permitted set; empty authority returns no rows. **Done:** unassigned Teacher/Class Teacher sees zero pupils by list, search, export and direct ID; no broad helper widens empty authority to all.

### F08 — P1: general pupil responses disclose medical records

**Evidence:** [student.service.ts:49](C:/Dev/School-Management/apps/api/src/modules/school/people/student.service.ts:49), [medical-document.controller.ts](C:/Dev/School-Management/apps/api/src/modules/school/people/medical-document.controller.ts:15).

Ordinary `school:read` responses include `medicalRecord: true`, despite a separate medical-read permission on the dedicated route. Probe confirmed medical data travels with the general list. The profile also stores NIN in ordinary `customFields`, unlike the protected application-NIN path.

**Fix:** use minimal permission-aware projections and one protected sensitive-data policy. **Done:** school-read without medical-read receives no medical payload from list/detail/export; authorized medical readers receive only permitted records; sensitive identifiers are absent from general responses/logs.

### F09 — P1: results and roster reads do not consistently enforce teacher ownership

**Evidence:** [assessment.controller.ts:374](C:/Dev/School-Management/apps/api/src/modules/school/assessment/assessment.controller.ts:374), [result-integrity.service.ts:23](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-integrity.service.ts:23), [roster.service.ts:173](C:/Dev/School-Management/apps/api/src/modules/school/assessment/roster.service.ts:173), [emergency-contact.controller.ts:12](C:/Dev/School-Management/apps/api/src/modules/school/people/emergency-contact.controller.ts:12).

Several result/roster/emergency-contact reads accept ordinary school-read and omit the class/student ownership checks used by pupil detail and marking. Result detail's `studentProfileId` filters subject rows but still returns the complete term-results student array. Tenant filtering cannot limit access within one school. Teacher scope also reduces section teaching to class IDs and includes timetable assignments without a year condition.

**Fix:** apply the intended class/stream/effective-date policy to every child-specific read, download and report. **Done:** direct HTTP tests as real role accounts cannot read another class/family's results, rosters or contacts. This audit established the missing source checks; the complete authenticated exploit matrix is NOT VERIFIED.

### F10 — P1: attendance accepts pupil IDs outside the chosen class

**Evidence:** [student-attendance.service.ts:46](C:/Dev/School-Management/apps/api/src/modules/school/attendance/student-attendance.service.ts:46).

The service authorizes the submitted class, then writes every submitted pupil ID against it without validating placement at the attendance date. Probe saved an other-class pupil under an authorized class. Since identity/date/period is the register key, a later submission can also relabel an existing record's class.

**Fix:** validate every entry against effective-dated enrollment/placement and authorized stream, inside the same transaction. **Done:** out-of-class, pre-admission, post-withdrawal, transferred and foreign-tenant entries fail appropriately; one invalid entry rolls back the batch; ordinary retries do not silently reassign history.

### F11 — P1: movement and withdrawal leave stale course memberships

**Evidence:** [course-roster-reconcile.ts](C:/Dev/School-Management/apps/api/src/modules/school/course-offerings/course-roster-reconcile.ts:95), [placement.service.ts:498](C:/Dev/School-Management/apps/api/src/modules/school/enrollment/placement.service.ts:498), [assessment-workflow.service.ts:41](C:/Dev/School-Management/apps/api/src/modules/school/assessment/assessment-workflow.service.ts:41), enrollment status-transition source.

Reconciliation adds new compulsory memberships, skips existing membership rows and does not end old course memberships. Withdrawal closes placement but does not close course membership here. Capture trusts live course rows even if the pupil has no compatible placement, falling back to the offering's class. Probe included a moved pupil in the old course and captured the new class as member metadata. Self-healing runs only when zero members exist, so a partly stale/missing roster is not fully repaired despite the wizard's drift message.

**Fix:** effective-date membership exits/entries with movement; validate every capture against its audience; reconcile partial compulsory drift without undoing explicit electives/opt-outs. **Done:** move North→South, transfer class, withdraw and return; new captures have exactly the correct pupils and all old frozen assessments remain unchanged.

### F12 — P1: historical class-roster capture uses current placement

**Evidence:** [roster.service.ts:43](C:/Dev/School-Management/apps/api/src/modules/school/assessment/roster.service.ts:43).

`capture` persists the requested term but obtains pupils through `studentWhere` and `attach` without passing that term/as-of date. It filters today's `status: active`, omitting pupils who later withdrew. Thus a past-term roster may contain today's class rather than the class that attended then.

**Fix:** require an explicit roster reference date and use term/year/date consistently for membership and metadata. **Done:** move and withdraw pupils after Term 1; rebuild Term 1 and show exactly its historical members/placements, including pupils present then.

### F13 — P1: admission conversion loses operational application attributes

**Evidence:** [admissions.tsx:184](C:/Dev/School-Management/apps/web/src/pages/school/admissions.tsx:184), [applications.tsx:111](C:/Dev/School-Management/apps/web/src/pages/school/applications.tsx:111), [admissions.service.ts:916](C:/Dev/School-Management/apps/api/src/modules/school/admissions/admissions.service.ts:916).

Normal enrollment screens send name, gender and DOB. The service reads nationality/residence from the DTO rather than defaulting to stored application values, defaults residence to day, and does not include the application's `studentCategoryId` in its admission input. Guardian/document transfer exists; a complete application→pupil field mapping does not.

**Impact:** a boarding/category-based applicant can become a day/unclassified pupil, affecting billing and reporting. **Fix:** server-side mapping from the accepted application, explicit validated overrides, and a conversion summary. **Done:** boarder, nationality, student category, guardian, document and identifier cases retain every agreed field without re-entry; conflicting overrides require a deliberate choice.

### F14 — P1: nursery descriptor reporting can inherit the primary scale

**Evidence:** [result-run.service.ts:581](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-run.service.ts:581), [grade-bands.ts:65](C:/Dev/School-Management/apps/api/src/modules/school/assessment/grade-bands.ts:65).

The recent code correctly selects ECD/no-ranking for a pre-primary programme and includes an ECD report layout. The earlier school-wide-only conclusion is therefore outdated. However, `resolveBands('ECD')` falls back to any default school scale before built-in ECD descriptors. Probe with default PLE scale returned **D1** as the ECD band. Mixed-programme rosters fall back to school-wide reporting; membership-based programme resolution does not filter annual enrollment to the requested year.

**Fix:** use explicit scale-to-stage/programme relations, compatible fallback and requested-year membership; reject mixed incompatible result scopes. **Done:** a combined nursery/primary school produces descriptors with no grade points/rank for Baby/Middle/Top and its chosen primary policy for P1–P7; historical promotion does not change past nursery reports.

### F15 — P1: Registrar's profile save can partly commit then report failure

**Evidence:** [student-360.tsx:182](C:/Dev/School-Management/apps/web/src/pages/school/student-360.tsx:182), [student.service.ts:210](C:/Dev/School-Management/apps/api/src/modules/school/people/student.service.ts:210), [Registrar preset](C:/Dev/School-Management/packages/shared/src/permissions.ts:1283).

The UI updates the student and then calls generic Partner update. Registrar has student-write but not Partner-update. First save can commit; second can fail with 403 and the UI says “Update failed.” The student service already supports transactional name/email/phone updates, so the second route is avoidable. Photo saves also use the generic route.

**Fix:** send all permitted biography/contact fields through one student-domain transaction and provide a domain photo action. **Done:** real Registrar can save name/contact/biography/photo; a forced failure leaves either all old or all new values; refresh matches the success/failure message.

### F16 — P1: locking a published result removes it from authoritative readers

**Evidence:** [result-run.service.ts:231](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-run.service.ts:231), [latestPublished:554](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-run.service.ts:554), [promotion-run.service.ts:328](C:/Dev/School-Management/apps/api/src/modules/school/enrollment/promotion-run.service.ts:328).

Lock changes status from published to locked. `latestPublished` and rollover's `latestRecommendation` only match published. Report generation calls `latestPublished`, so it can fall back to live marks after the supposedly final lock; promotion loses the locked recommendation. Full parent-screen behavior was not exercised, but the authoritative source omission is explicit.

**Fix:** share one released-result predicate including published and locked, and use it everywhere. **Done:** publish→lock leaves parent-visible result, report provenance, aggregate, rank and promotion recommendation unchanged; only amendment creates a replacement.

## 6. Major Findings — P2

| ID | Problem / evidence | Required change and acceptance test |
|---|---|---|
| F17 | Pupil page calls `useStudents({pageSize:50})` without page navigation. [students.tsx:50](C:/Dev/School-Management/apps/web/src/pages/school/students.tsx:50). Many reference selectors also use finite first pages, including rosters at 200. | Server-backed pagination/search with visible counts; exercise 350 pupils and >200 rosters, accessing records beyond page one without developer intervention. |
| F18 | Applications-page enrollment offers all terms/current term, while Admissions page correctly filters applicant year. [applications.tsx:98](C:/Dev/School-Management/apps/web/src/pages/school/applications.tsx:98). API rejects the wrong year, so this is a preventable staff dead end rather than a demonstrated wrong-year write. | Reuse one enrollment component; changing class clears incompatible section; every entry point offers only eligible terms. |
| F19 | Standalone promotion selects a term but requests `useStudents({classId,...})` without term. [promotion.tsx:97](C:/Dev/School-Management/apps/web/src/pages/school/promotion.tsx:97). Its pupil population is current, not the selected historical cohort. Rollover may fall back to ladder-only without published evidence. | Populate from enrollment/result scope; distinguish result-based and administrative rollover; test closed-year pupils and a later move before running promotion. |
| F20 | Several pages destructure data/loading without errors and display “no students”/empty lists after request failure. Enrollment preview suppresses failure into a null preview. Enrollment mutation invalidates admissions/students but not all enrollment/course-roster consumers. | Explicit error/retry state and complete mutation cache invalidation; simulate 403/500/disconnect and verify no false empty-school state and no required refresh after enrollment. |
| F21 | Result `buildInput` assigns `order: i` from a `findMany` without chronological `orderBy`; `last` aggregation therefore follows unspecified retrieval order. [result-run.service.ts:636](C:/Dev/School-Management/apps/api/src/modules/school/assessment/result-run.service.ts:636). | Define assessment chronology with deterministic tie-breakers; insert assessments in a different order from assessment dates and verify recomputation still selects the intended latest evidence. |

## 7. Minor Findings — P3/P4

- **F22, P3:** admission success tries `res.profile.id` / `res.studentProfileId`, but the server returns `res.studentProfile.id` and the hook does not normalize it. “Open pupil” is therefore absent. Source: [admissions.tsx:208](C:/Dev/School-Management/apps/web/src/pages/school/admissions.tsx:208), [API hook:1249](C:/Dev/School-Management/apps/web/src/features/school/api.ts:1249). Done: successful enrollment always offers a working link to the created/reused pupil.
- **F23, P3:** assessment wizard filters compatible frozen rosters by term/class/subject but omits section in its selector. The backend rejects a mismatching stream, so invalid choices can waste staff effort. Source: [assessment-form.tsx:62](C:/Dev/School-Management/apps/web/src/pages/school/_components/assessment-form.tsx:62). Done: North offering never offers South-only snapshots.

P4 opportunities can wait: one role-specific “next task” landing page, saved school-term context, bulk completion guidance, and a clearer distinction between teaching assessment release and end-of-term result release. They do not replace the integrity fixes.

## 8. Missing Functionality

Missing **controls in existing flows**, not wholesale missing modules:

- Core required: required curriculum/component coverage gate; valid continuous grading boundaries; consistent released-result reads; atomic publication freshness; complete applicant field mapping; movement-driven membership reconciliation; effective-date attendance validation; consistent read authorization.
- Important: unified enrollment dialog, term-aware promotion population, usable large lists, explicit error states, one auditable student profile save.
- School-dependent: agreed lower-primary learning-area weighting/report policy, nursery teacher acceptance of descriptors/rubrics, boarding rules and category-based fees. Configurability exists, but those actual school policies were not certified here.
- Optional: library, transport and boarding modules were inventoried but not functionally audited. Their existence is not evidence they work. They are not automatic blockers for a day school that does not use them.

## 9. Security & Authorization Findings

| Role | Intended operational path visible in source | Audit outcome |
|---|---|---|
| Administrator | School configuration and broad operations | Real account/override behavior NOT VERIFIED |
| Head Teacher | Grade approval and result release; separation from entry | Maker/checker DB tests passed; publication defects remain |
| Registrar | Applications, student records, enrollment/movement | Profile save conflicts with Partner permission; cannot assume Exams Officer authority |
| Exams Officer | Marks/result processing and release; amendment request | Ordinary compute can retire published data; approval should remain separate |
| Class/Subject Teacher | Allocated courses/classes and own mark entry | Mark allocation checks passed; pupil/result/roster read scope remains inconsistent |
| Bursar | Fees without grade-entry/approval authority | Ordinary school-read can traverse broadly gated result reads; full finance access matrix unverified |
| Parent | Own children and released records | Portal token cases passed; complete parent APIs NOT VERIFIED |
| Student | Own course/assessment and released records | Selected learner identity tests passed; complete portal NOT VERIFIED |
| Super Admin | Explicit cross-school/platform authority | Not exercised |

Global route permission enforcement exists and defaults to current DB grants; production undecorated-route policy is fail-closed unless configured otherwise. These are strengths. They cannot fix missing per-pupil ownership or excessive response projections. A full create/read/update/delete/approve/publish/export direct-API matrix is still required after fixing F07–F10.

Tenancy extension and selected Phase 5 isolation scenarios passed. The superuser test connection bypasses database RLS. **Cross-school production isolation is NOT VERIFIED.**

## 10. Data Integrity Findings

| Data boundary | Existing protection | Remaining inconsistency |
|---|---|---|
| Application → pupil | Transaction, seat claim, unique application/enrollment link | Missing operational fields, F13 |
| Pupil → annual enrollment | Unique pupil/year, explicit lifecycle | Consumer status/time policy differs |
| Enrollment → placement | Close/append transaction, one-open-row constraint, class/section checks, capacity locks | Course exits not synchronized, F11 |
| Placement → historical audience | Preserved effective dates and name snapshots | Historical capture uses now, F12 |
| Offering → frozen roster | DB immutability and audience validation | Stale memberships/partial drift, F11 |
| Assessment → marks | Versioning, canonical ledger, approved-write guards | Existing successful controls need full API role validation |
| Marks → result | Decimal arithmetic, checksums, component breakdown | F01–F06; checksum presence is not freshness |
| Released result → reports/promotion | Provenance and version relations | `locked` exclusion, F16; current-term UI mismatch, F19 |

Do not restore mutable `currentClassId` columns to solve these issues. Repair the consumers of authoritative placement and membership data. Database constraints cannot encode all the requested business policies; service and response checks remain essential.

## 11. Financial Integrity Findings

The requested emphasis here is student/academics/assessment flow. Admission fee migration to the pupil account was traced, and a web-shaped application fee scenario passed its database test. Category/residence loss at admission is a finance-relevant upstream defect.

Invoice→payment→receipt→balance→ledger→reports, cash drawers, reversals, concurrency, refunds, gateways and financial-close behavior were **NOT VERIFIED in this audit**. No financial readiness or accounting sign-off is implied by passing academic tests or by prior audit documents.

## 12. Academic Integrity Findings

The central distinction is between **preserving a row** and **using the right row**. Placement history is preserved, but the historical roster path reads current placement. Result snapshots are immutable, but ordinary recompute can archive the authoritative version. Marks use Decimal, but boundary lookup turns a valid decimal into F9. Policies total 100%, but a missing exam is normalized out. Nursery has an ECD mode, but its scale resolver may select primary bands.

Correctness must be verified at four separate levels: pupil membership for the relevant date; assessment inclusion/exclusion and approved evidence; calculation under the exact applicable policy; and stable release/report/promotion state. All four must agree for a report card to be trustworthy.

## 13. Real-World Uganda School Simulation

**Executed:** the integration fixtures exercised dated Ugandan-school scenarios including P5/P6 programme templates, class/stream movement, late arrival, withdrawal, repeat, next-year promotion, top-grade completion, last-seat admissions, CAT/homework/project/exam marking, absence/exemption, two-person approval, exam closure, published report provenance, amendment and promotion decisions. Early-years fixtures exercised care logs, pickup authorization/override, incidents, immunization and age/staff-ratio warnings.

**Not executed:** one unified Green Valley school browser run from Baby through P7, with actual Registrar/Teacher/Head Teacher/Parent accounts and finance/recovery included. The existing browser journey requires external credentials/running servers and was inspected but not run. It also assumes UI behavior that needs maintenance: it begins with a dialog although application creation navigates to a form, and skips explicit assessment publication before marking; its no-second-account mode cannot prove maker/checker.

For the proposed Green Valley acceptance scenario:

| School event | Evidence-backed expected result today |
|---|---|
| Enroll applicant into correct year and available seat | Selected DB checks pass |
| Enroll a boarder/category applicant via normal screen | Category/residence handoff is inconsistent, F13 |
| Move P4 North → South | Placement history remains; old course membership may remain, F11 |
| Take North attendance using an other-class pupil ID | Current method accepts it, F10 |
| Mark CAT=80, omit required exam | Kernel yields 80; gate lacks expected-component coverage, F02 |
| Produce 89.5% weighted mark | Current default lookup yields F9, F01 |
| Recreate last term's class list after withdrawal | Current capture can use today's cohort, F12 |
| Compute after publication | Old released set can be archived before replacement release, F04 |
| Lock final results | Authoritative readers may no longer find them, F16 |
| Nursery alongside primary default scale | ECD mode can still inherit PLE bands, F14 |

This table is a combination of executed DB scenarios, reproduced method behavior and inspected source. It is not represented as a completed school-wide end-to-end simulation.

## 14. Production Readiness Scorecard

| Area | Status | Blocking issues / evidence limit |
|---|---|---|
| Student Management | NOT READY | F07/F08/F13/F15; complete browser lifecycle unverified |
| Enrollment | NOT READY | DB foundation strong; course/history consumers F11/F12 |
| Attendance | NOT READY | F10 membership/date validation |
| Academics | NOT READY | Historical audience and scope inconsistencies |
| Assessments | NOT READY | F03/F11; complete staff journey unverified |
| Results | NOT READY | F01–F06/F14/F16 |
| Finance | NOT READY — NOT VERIFIED | Ledger/payment workflow outside verified scope |
| Administration | NOT READY — NOT VERIFIED | Full production role/configuration matrix absent |
| Security | NOT READY | F07–F10; production RLS/portal matrix unverified |
| Reporting | NOT READY | Historical/locked sources can disagree |
| Data Integrity | NOT READY | Cross-module invariants unresolved |
| Recovery | NOT READY — NOT VERIFIED | No backup/restore acceptance drill |

“NOT READY — NOT VERIFIED” is an evidence gap, not a claim that the module is necessarily broken.

## 15. Final Go / No-Go Decision

**NO-GO for unrestricted nursery/primary production use.**

The exact blockers in the focused scope are incorrect decimal grading; missing component/subject publication coverage; formative/summative contradiction; released-result replacement/freshness/scope controls; fail-open or excessive pupil/result access; attendance membership validation; stale course audiences; wrong historical capture; incomplete admission mapping; incompatible nursery scale fallback; Registrar partial saves; and released-result lookup after lock.

A supervised pilot becomes a decision to assess after those issues are fixed and the real role/browser acceptance matrix passes. It is not approved by this report. Optional modules can be disabled/deferred, but integrity defects in the core pupil/academic chain cannot be solved by staff training alone.

## 16. Fix Priority Roadmap

| Phase | Issues | Required change | Dependencies | Validation / definition of done |
|---|---|---|---|---|
| 1 — academic blockers | F01–F06 | Continuous boundaries, explicit contribution rules, expected coverage, context validation, immutable released authority, atomic fresh publication | Agreed school grading/absence/required-component policies | All acceptance tests in findings pass against DB and API; independently calculate sample report totals |
| 1 — privacy/access | F07–F10 | Fail-closed scopes, minimal projections, ownership on reads, dated attendance validation | Agreed class-vs-stream access policy; real role fixtures | Direct API attempts fail with no write/disclosure; school/tenant/family matrix complete |
| 1 — handoffs | F11–F13 | Dated course reconciliation, historical capture and accepted-application mapping | Offering audience/elective rules; field ownership contract | Move/withdraw/late-admit/return cases preserve old evidence and populate correct new audiences/biography |
| 1 — nursery/save/release | F14–F16 | Stage-compatible scale, one domain profile save, shared released-result selector | School stage policy; domain contact/photo payload | Combined nursery/primary cards correct; real Registrar save atomic; locking changes no visible academic result |
| 2 — core functional gaps | F17–F21 | Pagination, shared enrollment controls, term-aware promotion, error/retry/cache behavior, deterministic chronology | Phase 1 API contracts | Large school dataset; historical promotion; network/403/500 tests; shuffled assessment creation order |
| 3 — reliability / UX | F22–F23; browser acceptance | Correct enrollment link, compatible roster choices, maintained browser journey and mobile layouts | Stable workflows and real role fixtures | Ordinary staff finish the journey without manual database fixes or unexplained refreshes |
| 4 — enhancements | Saved context and role-specific next-task guidance; optional modules | Add after core acceptance | Production school priorities | Improvements do not alter canonical academic data or add competing grade stores |

## 17. Definition of Done

Each P0/P1 finding above includes a specific objective acceptance test. Release also requires the combined chain to pass in one isolated school:

1. Configure Baby/Middle/Top and P1–P7, two streams, year/terms, curricula, offerings and assigned teachers.
2. As Registrar, submit/review/admit a boarding/category applicant with multiple guardians and verified documents; confirm all fields persist and the pupil opens immediately.
3. Admit another pupil late; move one across streams; withdraw and readmit one. Verify current and historical placement, course audience and attendance.
4. As assigned Teacher, create formative and summative assessments; verify wrong course/pupil access fails; enter 0/max/decimal/absent/exempt/missing cases; retry a batch and force a stale-version conflict.
5. As different Head Teacher, approve/return/resubmit; confirm self-approval fails and changes after approval follow controlled correction.
6. Compute independently checked totals. Required gaps and mismatched scope must block publication. Change input after computation and verify release fails until recomputed.
7. Publish then lock. Parent/Student see only permitted released records; marks, report provenance, grades/ranks and promotion recommendations stay identical after lock.
8. Amend with a second approver; keep previous authority until new release; failed processing must not archive the live result or leave a half-applied amendment.
9. Generate/print nursery and primary reports using the correct policy; promote/repeat/graduate into next year without rewriting history or duplicating membership.
10. Reconcile UI/API/database/audit records after refresh and concurrent actions. Run finance and restore acceptance separately before a whole-school production claim.

## 18. Answer to the Requested Question

**“Can this existing system safely and reliably operate a real nursery and primary school in Uganda today, based on the functionality that has actually been verified?”**

**No—not yet for unrestricted real-school operation.** The verified enrollment, marking, approval, exam and report foundations are substantial: 183 targeted tests passed. Nevertheless, the reproduced grade, scope, coverage and data-handoff defects are material, and the full staff/family browser journey, financial integrity and recovery remain NOT VERIFIED. Fix the named blockers and prove the combined lifecycle before deployment sign-off.
