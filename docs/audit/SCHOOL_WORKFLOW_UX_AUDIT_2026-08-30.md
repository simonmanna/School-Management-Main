# School Management System — End-to-End Workflow & UX Audit

> **Status: findings addressed.** This document records the audit as it was
> written, before any code changed. What has since been fixed is listed in
> "Remediation" at the bottom, so the audit stays readable as the record of what
> was actually found rather than being rewritten into a changelog.
>
> Two claims in the original are corrected inline below, marked **CORRECTION**.

## Context

The system is a school vertical grafted onto a POS/ERP kernel (`ADR-011`). The
backend academic engine is genuinely strong — exact-decimal result computation,
a sealed one-writer mark store, a single publish gate, a canonical finance
service. The complaint being audited is that the system is *hard to operate*.

This audit's finding is that the difficulty is **not** in the engine. It is in
three places:

1. **The seam between UI and services is untested and, in one case, dead.**
   There are **zero HTTP-level tests in the entire API** (`apps/api/test`, `tests/`
   contain no `supertest` usage). Every test calls services directly, bypassing
   the `ValidationPipe`, the permission guards and serialization. Defects
   therefore concentrate exactly where no test looks.
2. **The workflow stops at "Results".** A proven 4-step workflow rail exists
   (`apps/web/src/pages/school/_components/exam-workflow.tsx:14-19`) and is used
   by 10 screens, but it ends before approval, publication, report cards and
   promotion — the half of the year an administrator actually struggles with.
3. **The domain model offers two words for one Ugandan concept** — `Section` and
   `Stream` are separate tables, and different subsystems bind to different ones.

---

# A. Executive summary

### What is strong

| Area | Evidence |
| --- | --- |
| Result kernel | `assessment/result-computation.ts` — exact `Decimal` throughout; rounding applied once, at the band boundary and the aggregate only (`:14-16`) |
| One-writer marking | `GradeEntry` is **structurally sealed** by a DB trigger — `prisma/migrations/20260824180000_gradeentry_readonly/up.sql:6` raises on every INSERT/UPDATE/DELETE. `GradeEntryService.bulkUpsert` now routes to `MarkingService.postMark` (`examinations/examinations.service.ts:212-228`) |
| Single publish authority | `runPublishGate` (`assessment/result-run.service.ts:276-320`) is the only gate; `publish()` (`:249`) and `readiness()` (`:405`) both call it — no duplicated rule |
| Segregation of duties, enforced at row level | `result-run.service.ts:309-311` — `approvedById === enteredById` → `SOD_VIOLATION` |
| Canonical money | `SchoolFinanceQueryService.studentBalance` (`fees/school-finance-query.service.ts:64`) is the single identity `billed − collected − waived − credited + adjusted` (`:124`); `billing`, `advanced`, `finance-controls`, `mobile-money`, `student.service` all inject it rather than recompute |
| Placement uniqueness | `Enrollment @@unique([organizationId, studentProfileId, termId])` (`schema.prisma:11918`) — a pupil **cannot** hold two placements in one term |
| Context preservation | `useStickyState` + `useDefaulted` (`_components/exam-workflow.tsx:95-115`) keep class/stream/subject across the exam screens |

### What is broken

| # | Defect | Severity |
| --- | --- | --- |
| 1 | **Every placement write route is rejected by the global ValidationPipe.** `EnrollStudentDto`, `RegisterStudentDto`, `EndEnrollmentDto` (`people/enrollment.service.ts:22-31, 33-36, 71-90`) carry **zero `class-validator` decorators** — the file never imports `class-validator`. The global pipe is `whitelist: true, forbidNonWhitelisted: true` (`main.ts:232-237`) and no controller overrides it (`people/enrollment.controller.ts` — no `@UsePipes`). | **P0** |
| 2 | **Report cards print `GPA 0.00 / Mean 0.0%` beside real marks.** | **P0** |
| 3 | **`Section` vs `Stream`** — two tables, one Ugandan word, bound inconsistently. | **P0** |
| 4 | **No PLE division logic.** Only UCE best-8 and UACE best-3 exist. | **P1** |
| 5 | **The dashboard shows wrong numbers and dead controls.** | **P1** |
| 6 | **The academic dashboard endpoints have no UI consumer.** | **P1** |
| 7 | **No batch/class report-card generation or printing.** | **P1** |

### Why the system *feels* difficult

The engine is a well-audited academic spine. The operator-facing layer was built
screen-by-screen against it, so a user meets **domain nouns instead of tasks**:
`streams.tsx`, `sections.tsx`, `assessments.tsx`, `results.tsx`, `exam-ops.tsx`.
Where a workflow was deliberately designed — the 4-step exam rail — the
experience is good. Everywhere else the user is asked to know the data model.

---

# B. P0 — Correctness / data loss

## P0-1 — Placement writes are rejected before reaching the service

**This is the highest-value finding in the audit.** The `Phase 0` commit
(`39cc8e4`, "placement integrity") added the missing UI client for placement —
`useEnrollStudent` (`apps/web/src/features/school/api.ts:1223-1233`) and
`useRegisterStudent` (`:1175-1184`), plus `PlacementDialog`
(`pages/school/student-360.tsx:1077+`) and quick-register
(`pages/school/students.tsx`). Those clients call routes whose DTOs the pipe rejects.

**Verified chain**

| Step | Evidence |
| --- | --- |
| Global pipe forbids non-whitelisted properties | `apps/api/src/main.ts:232-237` |
| `EnrollStudentDto` has no decorators | `people/enrollment.service.ts:22-31` |
| `RegisterStudentDto` has no decorators | `people/enrollment.service.ts:71-90` |
| `EndEnrollmentDto` has no decorators | `people/enrollment.service.ts:33-36` |
| File never imports `class-validator` | grep: no match in `enrollment.service.ts` |
| No controller/handler pipe override | `people/enrollment.controller.ts` (whole file) |
| Errors pass through unmodified | `GlobalExceptionFilter:20-22` returns `exception.getResponse()` verbatim |
| No HTTP test would catch it | no `supertest` anywhere in `apps/api/test` or `tests/` |

**The team already fixed this exact class of bug everywhere else** and documented
the convention: `people/dto.types.ts:4-6` — *"converted from bare interfaces to
class-validator classes so the global ValidationPipe (whitelist +
forbidNonWhitelisted + transform) actually enforces them."* The same note appears
in `fees/dto.types.ts:4`, `foundation/dto.types.ts:5`, `promotion.dto.ts:4`,
`assessment/dto.types.ts:3`. `enrollment.service.ts` was missed.

**Affected routes** (all of `@Controller('school/enrollments')`):
`POST /`, `POST /register`, `POST /:id/transfer-out`, `POST /:id/withdraw`,
`POST /:id/re-enroll`.

**The exact failure mode, verified in the installed dependency.**
`class-validator@0.14.4` (`node_modules/.pnpm/class-validator@0.14.4`),
`cjs/validation/ValidationExecutor.js`:

```js
// :48-49  — comment is the library's own
/** Forbid unknown values are turned on by default and any other value than false will enable it. */
const forbidUnknownValues = this.validatorOptions?.forbidUnknownValues === undefined
  || this.validatorOptions.forbidUnknownValues !== false;
// :50
const targetMetadatas = this.metadataStorage.getTargetValidationMetadatas(object.constructor, …);
// :52-63
if (forbidUnknownValues && !targetMetadatas.length) {
  …
  validationError.constraints = { unknownValue: 'an unknown value was passed to the validate function' };
```

`main.ts:232-237` does **not** set `forbidUnknownValues`, so it defaults to `true`.
A DTO class with zero validation metadata therefore **short-circuits at
`ValidationExecutor.js:52`** — before `whitelist` is even reached — and Nest
returns **400** with the single constraint
`an unknown value was passed to the validate function`.

**User-visible symptom.** `students.tsx:129` and `student-360.tsx:1135` render
`e?.response?.data?.message` into a toast, so a secretary pressing "Register and
place" sees a red toast reading roughly *"an unknown value was passed to the
validate function"*.

This is now verified from source end to end — configuration, missing decorators,
absent pipe override, library default, and the short-circuit branch. The only
step not executed is the HTTP request itself.

**Verification (30 seconds, before any code is written):**

```bash
curl -i -X POST http://localhost:3001/api/v1/school/enrollments -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"studentProfileId":"x","classId":"y","termId":"z","rollNumber":"1"}'
```

## P0-2 — Report cards print zeroed headline stats beside real marks

`ReportCardService.generate` (`examinations/examinations.service.ts:546`):

- `:555` reads the published spine (`latestPublished`).
- `:556` **also** calls `this.grading.computeTermGpa(...)`.
- `:573-576` uses the legacy value whenever the spine is absent:
  `gpa = spine?.term.gpa != null ? … : legacy.gpa`.

`computeTermGpa` (`examinations/grading.service.ts:196-239`) reads **`GradeEntry`**
— the table sealed read-only by `migrations/20260824180000_gradeentry_readonly`.
For any term after the seal it finds zero rows and returns
`{ gpa: 0, totalMarks: 0, meanPercent: 0, rank: null }` (`:209`).

Meanwhile `buildLayout` (`report-card-template.service.ts:87-123`) is correct and
modern — published spine → **live spine** → empty (`:106-122`), with the legacy
fallback explicitly removed (`:119-122`).

**Net effect:** generating a card before results are published produces a payload
whose *subject table is populated from live marks* and whose *headline is zero*.
The PDF prints it: `report-card-pdf.service.ts:150-152` reads `stored.gpa`,
`stored.rank`, `stored.meanPercent` from the payload, and `:710-712` renders
`GPA 0.00`, `Mean Score 0.0%`, `Position —` — because `0 != null` passes the guard.

This directly violates the invariant the result kernel states at
`result-computation.ts:14-16` (the printed numbers can never disagree).

Mitigation already present: a published card cannot be regenerated
(`examinations.service.ts:586-590`).

**Fix shape:** delete the `legacy` fallback at `:556, :573-576`; derive the
headline from the same layout `buildLayout` already computed.

## P0-3 — `Section` and `Stream`: two tables, one Ugandan word

Both are subdivisions of a `SchoolClass` with identical shape
(`classId`, `name`, `capacity`) and identical uniqueness:

- `Section` — `schema.prisma:10738-10764`, `@@unique([organizationId, classId, name])` `:10760`. Has `classTeacherId` `:10744`.
- `Stream` — `schema.prisma:10768-10789`, `@@unique(...)` `:10786`. **No class teacher.**
- Schema doc `:10766-10767` defines `Stream` as a *third* level below `Section`
  ("S1 → Section A → Stream East") — a secondary-school idea.

**Where each one stops:**

| Consumer | Section | Stream |
| --- | --- | --- |
| `StudentAttendance` (`schema.prisma:12697`) | ✅ | ❌ no column |
| `AcademicRosterMember` (`schema.prisma:13719`) | ✅ | ❌ no column |
| Class teacher | ✅ `Section.classTeacherId` | ❌ |
| `CreateStudentDto` (`people/dto.types.ts:39-40`) | ✅ | ❌ absent |
| Gradebook / mark sheet filters | — | ✅ `currentStreamId` (`gradebook.service.ts:397`, `marks-workspace.service.ts:690`) |
| `TimetableSlot` | ✅ | ✅ |
| `Enrollment`, `StudentProfile` | ✅ | ✅ |

**Consequence for "P4 West".** Whichever the admin picks, something breaks:

- Create **Stream "West"** (the natural Ugandan word, and what
  `pages/school/streams.tsx:7` is titled): mark entry filters work, but there is
  **no attendance register**, **no class teacher**, and the roster loses the
  subdivision at capture.
- Create **Section "West"**: attendance, class teacher and rosters work, but the
  **mark-entry Stream picker cannot find it** (`enter-marks.tsx:229`,
  `exam-results.tsx:153`, `gradebook.tsx`).

**The UI has already picked a side, inconsistently.** `api.ts:201-206` documents
Section as *"what a primary school calls its streams (P4 West)"*, and
`student-360.tsx:1163-1165` labels the field **Stream** while binding
`useSectionsForClass` and submitting **`sectionId` only**. But
`students.tsx:463` uses the **real `Stream` model** and posts `streamId`.
**Two placement screens write two different tables for the same intent.**

Subtlety worth preserving: `PromotionService.resolveSubdivision`
(`people/promotion.service.ts:90-100`) already handles this correctly, keeping
separate section and stream indexes because a class may own a `Section "West"`
*and* a `Stream "West"` (`:72-76`).

## P0-4 — Placement snapshot is left stale on exit and graduation

| Path | Evidence | Divergence |
| --- | --- | --- |
| `endEnrollment` → `transferOut` / `withdraw` | `people/enrollment.service.ts:361-390` | Closes the `Enrollment` (`:372`), sets `StudentProfile.status` (`:379-382`), **leaves `currentClassId/SectionId/StreamId` pointing at the class just left** |
| Graduation branch of `promoteOne` | `people/promotion.service.ts:305-323` | `status → 'alumni'` (`:316`), no new enrollment, `current*` untouched |

Every snapshot-based class-list read filters `status: 'active'`, so these pupils
drop out of lists **via `status`, not via placement**. Any read that forgets the
status filter counts them in their old class.

There is **no reconciler**. A repo-wide search for a placement-integrity service
returns nothing; the only guard is a test assertion,
`apps/api/test/integration/school-promotion-lifecycle.spec.ts:244-256`
(`expectPlacementConsistent`), declared permanent at `:231-242`.

---

# C. Source-of-truth map

| Business fact | Authoritative record | Snapshot | Derived | What the UI actually reads |
| --- | --- | --- | --- | --- |
| Pupil identity | `Partner` + `StudentProfile` | — | — | ✅ correct |
| Guardian | `Contact` + `StudentGuardian` | — | — | ✅ correct |
| **Placement (class/stream/term)** | **`Enrollment`** | `StudentProfile.current*` | — | ⚠️ **snapshot**, almost everywhere |
| Class list | `Enrollment` | `current*` | `AcademicRoster` | ⚠️ snapshot (26+ call sites) |
| Attendance | `StudentAttendance` | — | — | ✅ correct |
| Mark | `StudentAssessment` (spine) | `GradeEntry` (**sealed**) | — | ✅ correct |
| Approval | `StudentAssessment.approvalStatus` | — | — | ✅ correct |
| Result | `ResultSet` + `StudentTermResult` | — | — | ✅ correct |
| Report card | `ReportCard.payload` | — | PDF | ⚠️ payload can hold zeros (P0-2) |
| Fee balance | `SchoolFinanceQueryService.studentBalance` | — | — | ✅ correct |
| Payment | `Payment` + `PaymentAllocation` | — | — | ✅ correct |

**Only one production read resolves a class list from `Enrollment`** —
`lms/moodle/enrolment/enrolment.service.ts:116-124`. Everything else
(assessment board, marks workspace, gradebook, portals, billing, meals,
reporting, LMS homework fan-out) reads `StudentProfile.currentClassId`.

`AcademicRoster` — the object the publish gate freezes and treats as the academic
cohort — is itself **captured from the snapshot**, never from `Enrollment`
(`assessment/roster.service.ts:62-79`), despite that file's own header (`:11-20`)
stating `currentClassId` "is only ever an input to capture — never academic truth".
`AcademicRosterMember` has **no `streamId`** (`schema.prisma:13712-13733`), so the
subdivision is lost at capture.

`enrollmentSummary` switches source mid-method: `Enrollment` when `termId` is
given, `currentClassId` when it is not (`admissions/admissions.service.ts:2205-2218`),
then falls back per student at `:2240`.

---

# D. The marking → approval → publish spine

## D.1 Mark writers — is there one writer?

**Yes, for scores.** `StudentAssessment.originalScore/effectiveScore/percentage`
has exactly one write site: `MarkingService.recompute` (`marking.service.ts:102-105`),
reached only through `postMark`. Twenty call sites across gradebook, assessment
board, marks workspace, exam bulk-upsert, assignments, CBT, LMS and the teacher
portal all funnel through it. This is a genuine architectural success.

`postMark` guards (`marking.service.ts:179-300`):

| Guard | Line | Behaviour |
| --- | --- | --- |
| Grade item locked | `:223-229` | 409 — `Assessment.lockedAt` |
| Already approved | `:230-232` | 400 unless `allowWhenApproved` |
| Optimistic concurrency | `:235-239` | 409 — **only if the caller passes `expectedVersion`** |
| Score range | `:244-251` | 400, or clamp |
| History row | `:266-277` | `StudentAssessmentHistory`, unless `writeHistory: false` |
| Audit row | `:292-297` | `action: 'post_mark'` |

## D.2 P1 — The concurrency guard never fires

`postMark`'s version check is real, but **no client ever sends `expectedVersion`.**

- Only two DTOs carry the field: `RecordMarkDto.expectedVersion`
  (`assessment/dto.types.ts:129`) and `GradeEntryInput.version`
  (`examinations/dto.types.ts:94`).
- `SaveMarkDto` (`marks-workspace.dto.ts:44-55`), `GradebookCellDto`
  (`gradebook.dto.ts:10-19`) and `SaveBoardMarkDto` (`assessment-board.dto.ts:60-68`)
  have no version field at all.
- Web clients never send one: `api.ts:3314` (`useBulkGrades` type omits `version`),
  `:5843`, `:6162`, `:6540`. Teacher portal: `portal-api.ts:522`.
  A grep for `expectedVersion` in `apps/web/src` returns only POS hits.

**Answer to "what happens if two teachers edit the same marks simultaneously?"
Last write wins, silently.** The guard the docstring promises is unreachable
from every screen a teacher can open.

## D.3 P1 — Three score-affecting paths skip the lock and approval guards

| Path | Evidence | Skips |
| --- | --- | --- |
| `MarkingService.appendAdjustment` | `marking.service.ts:364-408`; mutates `effectiveScore` via `recompute` `:393` | **lock check and approved check** — the only score-changing path that skips both |
| `MarkingService.setParticipation` | `:303-326`, direct write `:314-317` | lock + approved; writes no history row |
| `GradebookService.cell` / `AssessmentBoardService.saveMark` participation writes | `gradebook.service.ts:254-258`, `assessment-board.service.ts:470-473` | lock + approved; no version bump |

Marking a pupil "absent" on an approved, locked assessment therefore succeeds.

## D.4 P1 — Segregation of duties is enforced on one path and half-enforced on the other

The modern path checks **both** actor columns
(`marking.service.ts:455-457` on `enteredById`, `:460-462` on `submittedById`).

The exam path checks only one (`examinations.service.ts:358-363`), **and**
`GradeEntryService.submit` (`:322-325`) never writes `submittedById` — so on that
route the column stays `null` for the whole lifecycle. Both the second SoD check
and `runPublishGate`'s `SOD_VIOLATION` check are keyed on columns the exam path
leaves empty.

`GradeEntryService.submit` also **overwrites `enteredAt` with the submit time**
(`:322-325`), destroying the entry timestamp.

CBT auto-approval is a third hole: `cbt-result-bridge.service.ts:116/118` writes
`approvalStatus: 'approved'` with `approvedById` left null, so the row passes
both `MARKS_NOT_APPROVED` (status is approved) and `SOD_VIOLATION`
(`approvedById` is falsy → the `&&` short-circuits) with **no approver at all**.

## D.5 P1 — Role presets cannot use the modern marking route

`PermissionsGuard` is exact-match with no implication —
`kernel/auth/guards/permissions.guard.ts:62`:
`const ok = required.every((perm) => granted.includes(perm));`

`POST /school/marking/mark` requires `school:grades:own`
(`assessment.controller.ts:201-205`). The **Exams Officer** preset holds
`school:grades:write` but not `:own` (`packages/shared/src/permissions.ts:1123`),
so an exams officer is refused by the guard even though
`assertMayMarkAssessment` would wave them through.

Two permission sources also disagree: the guard reads the DB
(`permissions.guard.ts:56-57`) while `assertMayMarkAssessment` reads
`this.tenant.store?.permissions` (`marking.service.ts:53`).

## D.6 The publish gate — single authority, invisible output

`runPublishGate` (`result-run.service.ts:276-320`) is the sole authority, called
by both `publish()` (`:249`) and `readiness()` (`:405`). Six blocker codes:

| Code | Line | Raised when |
| --- | --- | --- |
| `NO_ROSTER` | `:284` | no roster — **early-returns, suppressing all other checks** (`:285`) |
| `ROSTER_NOT_FROZEN` | `:287` | `roster.frozenAt` null |
| `STUDENT_NOT_COVERED` | `:293` | roster member with no computed result |
| `MARKS_NOT_APPROVED` | `:307` | `approvalStatus !== 'approved'` and participation not terminal |
| `SOD_VIOLATION` | `:310` | `approvedById === enteredById` |
| `MISSING_CHECKSUM` | `:316` | input/output checksum absent |

### P1 — The blockers are computed and then thrown away

`useResultReadiness` (`api.ts:4252-4261`) is called by exactly one component,
`pages/school/results.tsx:26`. The `ReadinessChecklist` (`results.tsx:167-201`)
builds its rows **entirely from `readiness.summary`** (`:169-175`). The only use
of `conflicts` is a **count**:

```tsx
// results.tsx:194-198
{!readiness.ready && readiness.conflicts?.length > 0 && (
  <p …>{readiness.conflicts.length} item{…} need attention before results can be published.</p>
)}
```

A grep for `MARKS_NOT_APPROVED|ROSTER_NOT_FROZEN|SOD_VIOLATION|STUDENT_NOT_COVERED|MISSING_CHECKSUM|NO_ROSTER`
outside `apps/api` returns **zero matches**. So:

- The user is told *"3 items need attention"* and never *which* items.
- `NO_ROSTER` and `MISSING_CHECKSUM` have no summary row of their own — they are
  **completely invisible**.
- `studentProfileId` is carried in every conflict but never resolved to a name.
- The `publish` failure body (`result-run.service.ts:251`, which carries the full
  `conflicts` array) is swallowed by a fixed string at `results.tsx:46`.

**This is the single highest-leverage UX fix in the system.** The backend already
answers "what is blocking publication?" precisely, per student. The UI discards
the answer and shows a number.

## D.7 Result set lifecycle — two unreachable states

`ResultSetStatus` is `draft | computing | computed | approved | published | locked | archived`
(`schema.prisma:13038-13046`), and `publish()` accepts `['computed','approved']`
(`result-run.service.ts:245`). But **nothing in `apps/api/src` ever writes
`status: 'approved'` or `'computing'`**. The `school:results:approve` permission
exists and is granted to Head Teacher (`permissions.ts:1053`) and Exams Officer
(`:1125`) — with **no route that requires it**. The "approve results" step in the
state machine is declared, permissioned, and unimplemented.

Also note: re-running compute **hard-deletes** a `computed` (unpublished) set —
`result-run.service.ts:118` `deleteMany`. Published/locked sets are archived
instead (`:115-117`) and frozen by DB trigger
(`migrations/20260814160000_result_spine/migration.sql:160-213`).

`buildInput` (`:467-528`) has **no `approvalStatus` filter** (`:474`) — unapproved
marks are computed into the set; approval is enforced only at publish. Defensible,
but it means "computed" carries no approval meaning.

## D.8 Report cards bypass the publish gate

`buildLayout` path 2 (`report-card-template.service.ts:114-117`) computes from the
**live** spine when no published `ResultSet` exists, filtering
`approvalStatus: 'approved'` (`:200-207`). So a report card can be generated *and
published to parents* from approved marks with **no ResultSet, no roster freeze,
no SoD check, no checksum, no publish gate**. The file states this itself
(`:191-193`): *"nothing here is frozen … Publishing a ResultSet is still what
makes a card defensible."* Nothing gates on it, and the UI shows no warning.

Combined with **P0-2**, the practical outcome is a card whose subject table is
real and whose headline is zero.

### Other report-card findings

| Finding | Evidence | Severity |
| --- | --- | --- |
| **No batch/class generation or PDF.** Only routes are `generate` (one student), `:id/publish`, `:id/unpublish`, `comment`, `by-student/:id`, `:id/pdf` | `examinations.controller.ts:238-288`; UI generates one at a time (`report-cards.tsx:44-53, 66-73`) | **P1** |
| **`GET /school/report-cards/:id/pdf` has no student scoping** — `school:read` plus a card id belonging to anyone | `examinations.controller.ts:277-287`; the portal route by contrast checks ownership *and* publication (`portal-documents.service.ts:77-84`) | **P1 (privacy)** |
| Attendance is real, but recomputed per render, not frozen into the payload — a published card's attendance figures drift after publication | `report-card-pdf.service.ts:171-200`; block suppressed entirely when `total === 0` (`:793`) | P2 |

## D.9 Parent portal — correctly gated, with one deliberate exception

| Surface | Gate | Evidence |
| --- | --- | --- |
| Report-card list | `publishedAt: { not: null }` | `portal-documents.service.ts:37` |
| Report-card PDF | ownership **then** publication | `portal-documents.service.ts:77-84` |
| Term results | `resultSet: { status: 'published' }` | `portals.service.ts:520` |
| Recent marks | **`approvalStatus: 'approved'` only — not publish-gated** | `portals.service.ts:471-476`, rationale at `:449-468` |

A family therefore sees an approved subject mark before any result is computed or
published. That is a documented product decision, not a bug — but it interacts
badly with D.8: parents can see marks, then receive a card showing GPA 0.00.

---

# E. Dead code and unreachable paths

| Item | Evidence |
| --- | --- |
| `GradeEntryService.syncApproval` | `examinations.service.ts:426-452` — no caller in `apps/api/src`; its `updateMany` (`:443-445`) has **no `approvalStatus` filter**, so wiring it up would move `approved` and `rejected` rows too |
| `school:results:approve` permission | granted (`permissions.ts:1053, 1125`), no route requires it |
| `ResultSet` statuses `approved`, `computing` | declared (`schema.prisma:13040, 13042`), never written |
| `GET /school/reports/academic` | `reporting.controller.ts:16` — **zero** web/portal consumers |
| `GET /school/reports/operational` | `reporting.controller.ts:28` — zero consumers |
| `GET /school/reports/attendance-today` | `reporting.controller.ts:40` — zero consumers |
| `GET /school/reports/top-performers` | `reporting.controller.ts:46` — zero consumers, **and** reads the sealed `GradeEntry` (`reporting.service.ts:147-150`), so it returns only pre-cutover history |
| `ReportingService.academicDashboard` | `reporting.service.ts:36-38` — counts `gradeEntry`; frozen since the seal, so the pass rate can never change again |

The four orphaned dashboard endpoints are precisely the academic content the
dashboard lacks. The backend already computes what a headteacher needs; no screen
asks for it.

---

# F. The dashboard — the first screen a headteacher sees

`apps/web/src/pages/school/dashboard.tsx` (174 lines) is finance-and-headcount only.
It contains **no academic content at all**: no marks pending, no approvals waiting,
no attendance-not-taken, no results readiness.

| # | Defect | Evidence | Severity |
| --- | --- | --- | --- |
| F-1 | **"New Students" renders the same value as "Total Students"** | `dashboard.tsx:42-44` — both are `admin?.students` | **P1 (wrong number)** |
| F-2 | **"Invoiced Amount" is computed in the UI** — `outstandingFees + collectionsThisMonth`. An all-time balance added to a one-month collection total. Not a canonical figure and not meaningful. **This violates the money rule (§25).** | `dashboard.tsx:33` | **P1** |
| F-3 | **"Deferred Revenue" is hardcoded `0`** | `dashboard.tsx:38` | P2 |
| F-4 | **"Previous Balances" is current outstanding**, mislabelled | `dashboard.tsx:37` | P2 |
| F-5 | **Chart titled "Outstanding by Category" plots by *class*** | title `:121`, data `:49-52` from `useSchoolOutstandingByClass` | P2 |
| F-6 | **"Teacher Student Ratio" divides by *all* staff**, not teachers | `dashboard.tsx:30` uses `admin.staff` | P2 |
| F-7 | **Six dead `<select>` controls** — single hardcoded `<option>`, no `value`, no `onChange`. They look like year/term filters and do nothing. `:69` even renders the literal string `'2025'`. | `:68-74`, `:123-125`, `:143-146` | **P1 (false affordance)** |
| F-8 | **The route `/school` has no nav entry at all.** The only "Dashboard" nav item is `/` | route `App.tsx:501`; nav `app-shell.tsx:188` | **P1** |

So the school dashboard is unreachable from the menu, and when reached shows a
duplicated headcount, a meaningless invoiced total, a hardcoded zero, and filters
that don't filter — while the four endpoints that would populate a real academic
dashboard sit unused (§E).

---

# G. Journey-by-journey audit

## Journey 1 — New pupil (application → class list)

| Step | Screen | Hook → Endpoint | Service | DB |
| --- | --- | --- | --- | --- |
| Apply | `applications.tsx`, `application-form.tsx` (`/school/applications`) | admissions hooks | `AdmissionsService` | `AdmissionApplication` |
| Review / decide | `admissions.tsx:84, :96` | `act.mutateAsync` | `applyReview` | status transition |
| Offer | `admissions.tsx:129` | — | — | offer fields |
| Enrol | `admissions.tsx:197-201` | `POST /school/admissions/enroll` | `AdmissionsService.enroll` (`:732-855`) → `EnrollmentService.enrollNewStudent` (`:108-222`) | `Partner`, `StudentProfile`, `Enrollment`, `StudentStatusHistory`, `StudentGuardian`, `EnrollmentHistory`, `Contact`, `StudentDocument` |

**Answers**

1. **Where does it start?** Two places, both labelled "Applications" in the nav
   (`app-shell.tsx:197` under Front Desk, `:229` under Admissions) — same route.
2. **What is authoritative?** `Enrollment` (`schema.prisma:11889`). One row per
   pupil per term (`@@unique` `:11918`).
3. **Is it transactional?** Yes — the whole enrol runs in one `$transaction`
   (`admissions.service.ts:734`), and the `tx` is threaded into `enrollNewStudent`
   (`:832`), so the student and the application status commit together. **Good.**
4. **What gets copied?** Guardians are promoted to `Contact` + `StudentGuardian`
   (`:663-685`); application documents are copied with their verification state
   intact (`:627-657`).
5. **What gets lost?** Demographics come from the **request body**, not the
   application row (`:810-818`). These application fields are never mapped:
   `applicantFirstName/LastName/Dob/Gender`, `studentCategoryId`, `nationality`,
   `residenceType`, `entryStatus`, `address`, `sourceOfEnquiry`,
   `siblingOfStudentId`, `ninCiphertext/Iv/Tag`, `applyingForClassId`,
   `parentContactId`, `academicYearId`, `customFields`. The client must re-send
   what the applicant already typed, or it is dropped. **`transferIn` (`:1276`)
   *does* pass `studentCategoryId`** — the two paths disagree. **P2.**
6. **Does the UI take you to the next step?** **Yes — and this is the only place
   in the whole admin app that does.** `admissions.tsx:197-201` fires a toast
   naming the class and term *with an action button "Open pupil"* →
   `/school/students/:id`.
7. **Is it idempotent?** Yes — replay returns the prior enrollment
   (`enrollment.service.ts:120-128`), though `partner` comes back `null` on replay.

**Gap:** an *accepted* application does not lead to the enrol dialog
(`admissions.tsx:84`) — the user must find the enrol action themselves.

## Journey 2 — Placement (§4 of the brief)

**Placement source-of-truth map**

```
AUTHORITATIVE                 SNAPSHOT                        DERIVED
Enrollment                    StudentProfile.currentClassId    AcademicRoster
  classId                       currentSectionId                 (captured FROM the
  sectionId?                    currentStreamId                   snapshot, not from
  streamId?                                                       Enrollment —
  termId                      ← written together by W1,W2,        roster.service.ts:62-79)
  status                        W4,W8; left stale by W3,W9
  @@unique(org,student,term)
```

| Question (from the brief) | Answer |
| --- | --- |
| What is authoritative? | `Enrollment` |
| Is `StudentProfile` merely a snapshot? | Yes — and **26+ read sites treat it as truth** (§C) |
| Can the UI change placement incorrectly? | **No longer directly** — `UpdateStudentDto` omits the placement keys (`people/dto.types.ts:63-76`) and `student.service.ts:240-252` allow-lists them out. But see **P0-1**: the correct route is unreachable. |
| Does every placement change create an Enrollment? | Yes for all four write paths. **No** for exit/graduation (P0-4) |
| Does placement survive promotion? | Yes — class, section, stream and term all carried (`promotion.service.ts:282-284, 294-301`) |
| Does it survive rollover? | Yes — rollover calls the **same** `promoteOne` (`:206`) |
| Conflicting placements possible? | Not within a term (DB unique). Across terms, only `promoteOne` closes prior rows (`:270-273`); `enrollExistingStudent` does not |
| Does the UI consistently show class + stream? | **No** — see P0-3 and §J |

## Journey 3 — Teacher: "take today's attendance and enter P4 West Maths marks"

| Question | Answer | Evidence |
| --- | --- | --- |
| Can they discover the class? | Partly. "My Teaching" (`/school/teaching`) exists in the nav (`app-shell.tsx:266`) | |
| Can they identify the correct stream? | **Ambiguous** — the mark screens filter by `Stream`, attendance by `Section` (P0-3) | |
| Correct term? | **No screen shows the academic year in a heading**; term appears only as a dropdown | §4 of the nav audit |
| Today's work? | No — there is no "today" view; no work queue exists | §E |
| Multiple competing mark-entry screens? | **Four** (§I) | |
| Same writer? | **Yes** — all funnel to `MarkingService.postMark`. Business behaviour is *nearly* identical; the exam path suppresses history (`examinations.service.ts:229`) and half-enforces SoD (D.4) | |
| Connectivity drops? | **No offline support.** The only offline queue is POS (`features/pos/offline-queue.ts`); `apps/web/src/sw.ts` does not cover school routes; `apps/portal` has no service worker. `retry: 1`, `refetchOnWindowFocus: false` (`lib/query-client.ts:21-23`) | **P1 for Uganda** |
| Two teachers edit at once? | **Last write wins, silently** (D.2) | |
| After Submit? | Toast `'N mark(s) sent for approval.'`, stays on the grid (`assessment-mark.tsx:39`) | |
| Does the teacher know what's next? | **No** | |

**Shared-device hazard.** `useStickyState` persists class/stream/subject in
`localStorage` under a global key (`_components/exam-workflow.tsx:96`), not
per-user. On a shared staffroom computer, teacher B inherits teacher A's
selection and can enter marks against the wrong class. **P2.**

## Journey 4 — Results: "publish P4 Term 2 results"

| Stage | Verdict |
| --- | --- |
| Discoverability | **Poor.** The screen is called **"Result Spine"** (`results.tsx:37`) with the subtitle *"A3: compute from approved marks, pin to a revision, publish immutably, amend → new revision."* (`:38`). The nav calls it "Result Runs" (`app-shell.tsx:276`). Neither says "end-of-term results". |
| Dependencies | Roster captured → **frozen** → compute → publish. The freeze requirement is enforced (`result-run.service.ts:62-67`) but the roster is created on a *different* page (`assessment-ops.tsx`, nav "Cohorts & Rubrics") with no link between them. |
| Blockers visible? | **No.** The gate computes six precise, per-student blockers; the UI renders **a count** (D.6). |
| Vocabulary | Database terminology throughout: `Cohort (roster)…`, options rendered as `class a1b2c3` (`results.tsx:45`), `rev 3`, `weights100 ✓`, a raw 12-char checksum in monospace (`:99`). |
| State visible? | Partially — `ResultSetStatus` is shown, but two of its states are unreachable (D.7). |
| Recovery | **Publish failure is swallowed** — `results.tsx:46` replaces the structured `conflicts` body with a fixed string. **Publish and Lock fire no toast at all** (`results.tsx:78, :72`); success is silent. |

## Journey 5 — Report cards

| Question | Answer |
| --- | --- |
| Whole class? | **No** — generate is per-student (`examinations.controller.ts:245`, DTO `dto.types.ts:145-148`); the UI generates one at a time (`report-cards.tsx:44-53`) |
| One pupil? | Yes |
| Print a whole class? | **No batch PDF endpoint exists.** One PDF per request (`:277-287`) |
| Attendance real? | Yes (`report-card-pdf.service.ts:171-200`) — but recomputed per render, not frozen |
| Based on published results? | **Not necessarily** (D.8) |
| Can unpublished leak? | Unpublished *results* no; unpublished-but-approved *marks* **yes** |
| On failure? | Generic toast |
| Next step? | None — `'Published to portals'` (`report-cards.tsx:59`) with no link to the portal and no class-wide action |

## Journey 6 — Promotion

Correct and well-built. `promoteOne` (`promotion.service.ts:241-344`) closes prior
enrollments (`:270-273`), creates the new one with class/section/stream/term
(`:277-288`), and syncs all three snapshot fields (`:294-301`). Batch rollover
uses the identical path (`:206`). `resolveSubdivision` (`:90-100`) resolves the
subdivision **by name inside the target class**, with separate section and stream
indexes, because ids are not portable between classes (`:72-76`) — a genuinely
subtle correctness win. Unresolvable subdivisions are reported in the plan rather
than silently dropped (`:171-186`).

Two gaps: rollover *planning* reads the snapshot (`:102-105`), and graduation
leaves `current*` stale (P0-4).

## Journey 7 — Parent on a phone

**This is the best part of the system.** `apps/portal` is genuinely mobile-first:

- Bottom tab bar, not a sidebar (`components/portal-shell.tsx:67-70`), with an
  explicit rationale comment (`:40-46`).
- iOS safe-area insets (`:69`, `:54`), `min-h-dvh` (`:51`).
- Every signed-in screen is `React.lazy` (`App.tsx:45-58`), explicitly contrasted
  in a comment with the admin app's eager 6 MB chunk (`:24-30`).
- **Child switcher in the header on every parent screen** (`portal-shell.tsx:117`),
  auto-hidden for single-child families (`:146`), state persisted
  (`stores/auth.store.ts:62, 98-101, 132`).
- Four nav items per audience (`:20-37`) versus ~230 in the admin rail.
- Published-only enforcement is correct and layered (§D.9).
- The portal computes no money of its own — documented at
  `routes/parent/fees.tsx:17-21`; it reads the canonical explainer.

Gaps: no service worker/offline; the report card is buried inside Results with no
route or nav entry of its own (`routes/shared/results-panel.tsx:113, 151`); the
teacher portal's `useRecordMark` sends no `expectedVersion` (`portal-api.ts:522`).

## Journey 8 — Finance

**Passes the money rule at the service layer.** `SchoolFinanceQueryService` is
canonical and universally injected (§A). The identity appears in exactly two
places — `school-finance-query.service.ts:124` and `finance-controls.service.ts:325`
— the second being a deliberate org-wide term-close snapshot that mirrors it
(documented `:265-273`, fail-closed `:335-337`). Worth consolidating, not a
source-of-truth break.

**The one violation is in the UI**, at `dashboard.tsx:33` (F-2).

---

# H. State-machine map

| Object | States | Where | Gaps |
| --- | --- | --- | --- |
| **Application** | draft → submitted → under_review → approved/rejected → offered → accepted → enrolled | `AdmissionsService`, `admission-workflow.schema.ts` | Accepted → enrol has no UI arrow |
| **Assessment marks** | `draft → submitted → approved / rejected` (`GradeEntryStatus`, `schema.prisma:12900-12905`) | `MarkingService.markingApproval:429-476`; exam path `examinations.service.ts:322-401` | Exam path never writes `submittedById`; CBT auto-approves with no approver |
| **Assessment lock** | `Assessment.lockedAt` (`schema.prisma:13562`) | `POST /school/marks/lock` writes both it and the legacy `ExamSchedule.marksLockedAt` (`marks-workspace.service.ts:634-645`) | `appendAdjustment` and `setParticipation` bypass it |
| **ResultSet** | `draft → computing → computed → approved → published → locked → archived` (`schema.prisma:13038-13046`) | `ResultRunService`; DB trigger enforces legal transitions (`migrations/20260814160000_result_spine/migration.sql:160-213`) | **`computing` and `approved` are never written**; `school:results:approve` has no route |
| **ReportCard** | not_generated → generated → published | `examinations.service.ts:546, 511-544` | No batch transition |
| **Promotion** | planned (dry run) → ready → executed | `promotion.service.ts:41` (`dryRun` defaults true), `:203-220` | Sound |
| **Enrollment** | `enrolled → completed / transferred / withdrawn` | `enrollment.service.ts:16-19` transition map | Exit leaves the snapshot stale |

---

# I. Duplicate workflow map

**Four endpoints write a mark.** All reach `postMark`, but through different keys,
different DTOs, and different guard coverage.

| Endpoint | Screen | Route | Primary key in body | Version guard | History |
| --- | --- | --- | --- | --- | --- |
| `POST /school/marks/entry` | `enter-marks.tsx` | `/school/enter-marks` | `{examId, classId, subjectId, studentProfileId}` (`api.ts:5840`) | ✗ | **✗** (`writeHistory:false`) |
| `POST /school/assessment-board/:id/mark` | `assessment-mark.tsx` | `/school/assessments/:id/mark` **and** `/school/marksheet/:id` | `{studentProfileId, marks, participation}` (`api.ts:6539`) | ✗ | ✓ |
| `POST /school/gradebook/cell` | `gradebook.tsx` | `/school/gradebook` | `{studentProfileId, assessmentId}` (`api.ts:6161`) | ✗ | ✓ |
| `POST /school/marking/mark` | `assessment.tsx` | `/school/assessment` | `{studentAssessmentId, score}` (`api.ts:4035`) — **a different primary key** | ✓ (only route that accepts it) | ✓ |

Also duplicated: **three** submit-for-approval endpoints
(`assessment-board/:id/submit` `api.ts:6478`, `marking/submit` `:4059`,
`marks/lock` `:5860`), **two** approval endpoints
(`assessment-board/:id/approval` `:6487`, `marking/approval` `:4068`), and **two**
result grids — `GET /school/marks/grid` (`api.ts:5852`, computes live from raw
entries) versus `POST /school/results/compute` (`:4213`, computes only from
approved marks). `exam-results.tsx:22-23` states in a comment that it needs "no
separate compute results step" — so the exam flow and the result spine give two
different answers to "what are this class's results".

**Recommendation (do not delete anything yet):** keep `enter-marks` (step 3 of the
proven rail) and `gradebook` (continuous assessment). Retire `assessment.tsx`
("Assessment Structure → Marks (SoD)") as an operator screen — it is the only one
that renders raw UUIDs as student identity (`assessment.tsx:207, :228`) — but keep
its endpoint, since it is the **only** path that carries `expectedVersion`. The
right move is to add `expectedVersion` to the other three DTOs, not to remove the
one that has it.

---

# J. Vocabulary audit

| Technical term shown to users | Where | School vocabulary |
| --- | --- | --- |
| `Result Spine` | `results.tsx:37` (page `<h1>`) | **Term results** |
| `A3: compute from approved marks, pin to a revision, publish immutably, amend → new revision.` | `results.tsx:38` | *"Work out this term's results, then release them to parents."* |
| `A2: enrollment-independent cohorts (capture → freeze)…` | `assessment-ops.tsx:23` | *"Fix the class list used for this term's results."* |
| `A0→A1: policies, components, assessment instances, and segregation-of-duties marking.` | `assessment.tsx:24` | — |
| `A4:` / `A5:` / `A6:` subtitles | `exam-ops.tsx:36`, `cbt.tsx:23`, `certification.tsx:27` | plain descriptions |
| `Cohort (roster)…`, option `class a1b2c3` | `results.tsx:45`, `assessment-ops.tsx:63`, `analytics.tsx:34` | **Class list** — and show the class *name* |
| `rev 3`, `Computed revision 3` | `results.tsx:58, :95, :46` | **Version 3** |
| `weights100 ✓` / `allApproved ✓` | `results.tsx:97-98` | "Marks add to 100%" / "All marks approved" |
| raw checksum `a1b2c3d4e5f6…` in monospace | `results.tsx:99` | remove from the operator view |
| `Amendment reason (new revision)` | `results.tsx:120` | "Why are these results being changed?" |
| `No segregation-of-duties violations` | `results.tsx:175` | "Nobody approved their own marks" |
| `Student ID` column showing `{m.id.slice(0,8)}` — a **StudentAssessment row id**, not a pupil | `assessment.tsx:203, :207` | pupil name |
| `<option>{m.id.slice(0,8)} · {m.participation}` under label "Student…" | `assessment.tsx:228` | pupil name |
| `term {p.termId.slice(0,6)}` | `assessment.tsx:66` | term name |
| `{f.studentProfileId.slice(0,6)}` / `{f.subjectId.slice(0,6)}` as the student and subject columns | `analytics.tsx:124, :137` | names |
| `Attempt {attemptId.slice(0,8)}` | `cbt.tsx:176` | — |
| `Payment already recorded (idempotent replay)` | `fees-subpages.tsx:195`, `fees.tsx:334` | "This payment was already recorded." |
| `Immutable snapshots captured on every edit.` | `documents.tsx:374` | "Every edit is kept in the history." |
| `Portals & Promotion` (nav) | `app-shell.tsx:210` | two unrelated things in one label |
| `Streams` vs `Sections` (two nav items, two tables) | `app-shell.tsx:247-248` | **one concept: Stream** (P0-3) |

UUID fragments also surface as fallbacks in `attendance.tsx:221`,
`class-teacher.tsx:117, :154`, `exam-ops.tsx:98, :141, :144, :186, :229`,
`complaints.tsx:188`, `fees-operations.tsx:264, :1056`.

---

# K. Uganda primary-school fit

### Already correct

| Item | Evidence |
| --- | --- |
| UGX + `en-UG` formatting | `dashboard.tsx:16-18`; `SchoolProfile.currencyCode` |
| Three terms | `Term.kind @default("term")` (`schema.prisma:10618`), `@@unique(org, year, name)` |
| D1–F9 grade bands (the scale Ugandan primary schools actually use) | `assessment/grade-bands.ts:32-42` |
| Mobile money | `fees/mobile-money.service.ts`; `/school/fees/mobile-money` (`App.tsx:522`); parent pay form (`routes/parent/fees.tsx:46-60`) |
| SMS / broadcasts | `communication/` module, ADR-016 |
| Parent mobile usage | the portal (Journey 7) |
| Late-joiner fee fairness — one-off charges are **not** prorated | `fees/billing.service.ts:318`, `dto.types.ts:78` |
| Guard against billing the whole school including P7 | `fees/billing.service.ts:743-745` |
| Fee clearance threshold is percentage-based, explicitly so a P7 pupil's larger fee isn't punished by a flat shilling threshold | `fees/school-finance-query.service.ts:1161` |
| Class-wide fee clearance | `school-finance-query.service.ts:1310` |

### Needs domain-model change

| Gap | Evidence | Severity |
| --- | --- | --- |
| **No PLE division.** `computeTerm` branches only on `'UCE'` (best-8) and `'UACE'` (best-3); anything else leaves `aggregate` and `division` **null** | `result-computation.ts:351-360`; `computeUCEAggregate:294`, `computeUACEAggregate:307`, `divisionUCE:316`. No `PLE`, `best4` or `bestFour` anywhere in `apps/api/src/modules/school` | **P1** |
| PLE needs: best **4** core subjects (English, Maths, Science, SST), aggregate 4–36, Div I 4–12, II 13–23, III 24–29, IV 30–34, U 35–36. `Subject.isCore` already exists (`schema.prisma:10798`) — the input is there, the function is not | | |
| `gradingSystem` defaults to **`"UCE"`** — a secondary-school system — and is a free-form `String`, not an enum | `schema.prisma:10576` | P1 |
| **`Section` vs `Stream`** (P0-3) | | **P0** |
| **No day/boarding residency on `StudentProfile`.** `residenceType` is carried through admissions (`enrollment.service.ts:83`) but the schema search for a boarding field returns only *transport* boarding events | `schema.prisma:10950, 15316` | P2 |

### Needs backend change

| Gap | Evidence |
| --- | --- |
| **No class-wide report-card generation or printing.** A P4 class of 60 needs 60 requests and 60 PDF downloads, three times a year | `examinations.controller.ts:238-288` |
| **No offline support for attendance or marks.** The only offline queue is POS | `features/pos/offline-queue.ts`; `sw.ts` has no school routes |
| Report-card PDF route is not student-scoped | `examinations.controller.ts:277-287` |

### Needs UI change

Everything in §F, §J, §L.

### Not verified

Whether any Ugandan school has run a full term through this system end-to-end —
there are no HTTP-level or end-to-end tests to demonstrate it.

---

# L. The "arrows" — next-action map

**The mechanism already exists and is used once.** `apps/web/src/lib/notify.ts:11`
defines `NotifyAction = { label; onClick }`, plumbed through `opts()` (`:20-23`).
Its own comment (`:4-10`) says it exists because *"the toast is a full stop and the
user has to find the next screen through the nav"*.

**Exactly one call site in all of `pages/school/` uses it: `admissions.tsx:200`.**

| Completed action | Current result | Next logical task | CTA? | Should go to |
| --- | --- | --- | --- | --- |
| Enrol applicant | Toast + **"Open pupil"** | Open pupil / view class list | **✓** | (add "View class list") |
| Create exam | Navigates to step 2 | Choose classes | **✓** | — |
| Quick register & place | Toast, dialog closes (`students.tsx:125-127`) | Open the new pupil | ✗ | `/school/students/:id` |
| Admit student | Toast, dialog closes (`students.tsx:95-97`) | Add guardian | ✗ | guardian dialog |
| Application accepted | Toast (`admissions.tsx:84`) | Issue offer / enrol | ✗ | enrol dialog |
| Issue offer | Toast, dialog closes (`admissions.tsx:129-130`) | Await / record acceptance | ✗ | application |
| Create assessment | Toast, modal closes (`_components/assessment-form.tsx:98-103`) | **Enter its marks** | ✗ | `/school/assessments/:id/mark` |
| Add gradebook column | Toast, dialog closes (`gradebook.tsx:336-337`) | Enter marks in it | ✗ | focus the column |
| Save attendance | `Saved · N student(s)` (`attendance.tsx:116`) | Next class, or today's remaining registers | ✗ | attendance work queue |
| Lock mark entry | Toast (`enter-marks.tsx:196`) | View results | ✗ | `/school/exam-results` (button exists at `:279`, not offered) |
| Submit marks | `'N mark(s) sent for approval.'` (`assessment-mark.tsx:39`) | Nothing — teacher waits | ✗ | back to My Teaching |
| **Approve marks** | `'N mark(s) approved.'` (`approvals.tsx:55`) | **Compute results** — the page's own subtitle (`:71-72`) says approving "locks them into the term result" | ✗ | `/school/results` |
| Compute result set | Selects it in-page (`results.tsx:46`) | Review readiness → publish | ✗ | scroll/focus checklist |
| **Publish result set** | **No toast at all** (`results.tsx:78`) | Generate report cards | ✗ | `/school/report-cards` |
| **Lock result set** | **No toast at all** (`results.tsx:72`) | — | ✗ | — |
| Generate report card | Toast (`report-cards.tsx:48`) | Publish it / do the rest of the class | ✗ | — |
| Publish report card | `'Published to portals'` (`report-cards.tsx:59`) | Print the class set | ✗ | — |
| Apply promotions | Toast (`promotion.tsx:165`) | View new class lists | ✗ | `/school/students?class=…` |
| Commit rollover | Toast (`promotion.tsx:190`) | Open the new term | ✗ | — |
| Record fee payment | Receipt rendered inline (`fees-subpages.tsx:195-203`) | Print receipt / next pupil | ✗ | — |
| Billing run | Toast (`fees.tsx:92`) | Review invoices | ✗ | `/school/fees/invoices` |
| Assign class teacher | Toast (`class-teacher.tsx:55`) | — | ✗ | — |
| Capture roster | `'Roster captured'` (`assessment-ops.tsx:70`) | **Freeze it, then compute** | ✗ | `/school/results` |
| Invite guardian | Toast (`portals.tsx:72`) | — | ✗ | — |

**Silent successes** (no feedback at all): publish result set, lock result set
(`results.tsx:78, :72`).

---

# M. Orphaned features

| Category | Count | Notable |
| --- | --- | --- |
| **Hooks with zero consumers** | **61 of 523 (11.7%)** | `useApplicationWorkflow` (`api.ts:594`) — the workflow route `/school/admissions/workflow` renders without it; `useApproveWaiver`/`useRejectWaiver` (`:5497`) — the waivers page can never approve; `useUpdateGradebookColumn` (`:6176`) — **a gradebook column's title or max score cannot be edited from the UI at all**; `useSetParticipation` (`:4040`); `useFeeClearance`; `useSchoolOverview`; `useTeacherDashboard`; `useCreateCurriculum`/`useUpdateCurriculum` |
| **Routes with no nav entry** | 8 non-param | `/school` (the module dashboard!), `/school/curricula`, `/school/management/policies`, `/school/management/custom-fields`, `/school/lms/my`, `/school/lms/calendar` |
| **Endpoints with no UI consumer** | 4 dashboards | §E |
| **Permissions with no route** | 1 | `school:results:approve` |
| **Dead service code** | 1 | `GradeEntryService.syncApproval` (`examinations.service.ts:426-452`) |
| **Nav entries → missing routes** | **0** | All ~230 nav targets resolve — a genuine strength |

**Nav collisions:** two items labelled `Applications` (`app-shell.tsx:197, :229`)
→ same route; `Promotion & Rollover` (`:209`) and `Portals & Promotion` (`:210`)
are different pages both named "Promotion"; two `Receipts` in the Fees section
(`:420, :434`) → different routes; `/school/library` plus six sub-items
(`:392-398`) all render the **same component** (`App.tsx:571-577`).

---

# N. Scores

| Dimension | /10 | Evidence |
| --- | --- | --- |
| Discoverability | **3** | Module dashboard has no nav link (F-8); "Result Spine" is the results screen (`results.tsx:37`); roster capture lives on a different page from the results that require it |
| Workflow continuity | **3** | 1 of ~28 major actions offers a next step (`admissions.tsx:200`); the CTA mechanism exists and is unused (`notify.ts:11`) |
| Navigation | **6** | ~230 nav items, all resolving (0 broken links — good), but 8 orphan routes and 5 duplicate labels |
| Vocabulary | **2** | Phase codes `A0`–`A6` in page subtitles; raw UUIDs under a column headed "Student" (`assessment.tsx:203-207`); checksums on screen |
| Context preservation | **6** | `useStickyState` across 10 screens is real and good; no screen shows the academic year; `WorkflowSteps` covers only 4 of ~15 workflow pages |
| Error recovery | **3** | Publish conflicts computed then discarded (D.6); publish/lock succeed silently; P0-1 would surface as a raw validation array |
| Teacher usability | **4** | Four mark screens, no offline, no concurrency protection, no "today" view |
| Administrator usability | **4** | Dashboard shows wrong numbers and dead filters (§F) |
| Academic-admin usability | **3** | The publish journey is the weakest — blockers invisible, vocabulary internal |
| Parent usability | **8** | Genuinely mobile-first, correct child switcher, correctly gated (Journey 7). −2 for no offline and the report card having no route of its own |
| Placement integrity | **5** | Model and services are right (unique constraint, 4 correct writers); −5 because the routes are unreachable (P0-1) and exit/graduation leave stale snapshots |
| Data consistency | **6** | One mark writer, sealed `GradeEntry`, canonical finance, DB-enforced result immutability; −4 for snapshot-vs-Enrollment reads and report-card headline zeros |
| State management | **6** | Result state machine is DB-enforced; two states unreachable; approval half-tracked on the exam path |
| Uganda primary fit | **4** | UGX, three terms, momo, D1–F9, fee fairness all correct; no PLE division, `Section`/`Stream` fracture, no class printing, no offline |
| **Overall ease of use** | **4** | A strong engine behind an operator layer that stops one step short at almost every point |

---

# O. Recommended workflow layer

Build **on** what exists. Two components already prove the pattern:

1. `WorkflowSteps` (`_components/exam-workflow.tsx:14-22`) — a numbered rail that
   preserves query-string context across steps (`:31`). Used by 4 pages.
2. `notify` with a `NotifyAction` CTA (`lib/notify.ts:11`). Used by 1 page.

**Extend the rail from 4 steps to the term:**

```
Create exam → Choose classes → Enter marks → Approve → Results → Report cards → Promote
```

**Rules for the workflow layer (per §24 and §25 of the brief):**

- It **composes**; it never re-derives. `runPublishGate` stays the single
  authority for "can these be published?" The layer only *translates*:
  `MARKS_NOT_APPROVED × 2` → *"2 pupils' marks are waiting for approval"* +
  `[Review approvals]`.
- Every money figure comes from `SchoolFinanceQueryService`. Delete the UI
  arithmetic at `dashboard.tsx:33`.
- A work queue is a **read model over existing services** — `readiness()`,
  the approvals queue (`GET /school/assessment-board/approvals`), `attendanceToday()`,
  `academicDashboard()`. Three of those four endpoints already exist and are unused.

---

# P. Minimal implementation plan

## Phase 0 — Correctness (nothing else matters until these land)

| # | Fix | Files |
| --- | --- | --- |
| 0.1 | **Decorate the placement DTOs.** Add `class-validator` decorators to `EnrollStudentDto`, `RegisterStudentDto`, `EndEnrollmentDto`, following the convention already used in `people/dto.types.ts` | `people/enrollment.service.ts:22-90` |
| 0.2 | **Add HTTP-level tests.** Introduce `supertest` and cover the placement, marking, publish and report-card routes. This defect class is currently invisible to the whole suite | `apps/api/test/` |
| 0.3 | **Remove the legacy report-card fallback.** Derive `gpa`/`rank`/`meanPercent`/`totalMarks` from the layout `buildLayout` already returns; drop the `computeTermGpa` call | `examinations/examinations.service.ts:556, 573-576` |
| 0.4 | **Clear the placement snapshot on exit and graduation** | `enrollment.service.ts:379-382`; `promotion.service.ts:305-323` |
| 0.5 | **Close the guard bypasses** — lock + approval checks in `appendAdjustment` and all three `setParticipation` writes | `marking.service.ts:303-326, 364-408`; `gradebook.service.ts:254-258`; `assessment-board.service.ts:470-473` |
| 0.6 | **Write `submittedById` on the exam submit path**, stop overwriting `enteredAt`, add the second SoD check | `examinations.service.ts:322-325, 358-363` |
| 0.7 | **Set an approver (or a system actor) on CBT auto-approval** | `cbt-result-bridge.service.ts:116-118` |
| 0.8 | **Scope the report-card PDF route to the caller's students** | `examinations.controller.ts:277-287` |
| 0.9 | **Delete the UI balance arithmetic**; source "Invoiced" from the canonical service or remove the tile | `dashboard.tsx:33` |

## Phase 1 — Workflow continuity

| # | Fix |
| --- | --- |
| 1.1 | **Render `readiness.conflicts`** — group by code, resolve `studentProfileId` to names, give each group a CTA. Highest leverage change in the system (`results.tsx:167-201`) |
| 1.2 | **Surface the publish-failure body** instead of a fixed string (`results.tsx:46`); add toasts to publish and lock (`:72, :78`) |
| 1.3 | **Add `NotifyAction` CTAs** to the ~20 actions in §L, using the existing mechanism |
| 1.4 | **Extend `WorkflowSteps`** to Approve → Results → Report cards → Promote |
| 1.5 | **Fix the dashboard** (F-1 … F-8) and give `/school` a nav entry |
| 1.6 | **Wire the four orphaned dashboard endpoints** into an academic panel; repoint `academicDashboard`/`topPerformers` off the sealed `GradeEntry` onto the spine (`reporting.service.ts:36-38, 147-150`) |
| 1.7 | **Add `expectedVersion`** to `SaveMarkDto`, `GradebookCellDto`, `SaveBoardMarkDto` and have every client send it |
| 1.8 | **Add context headers** — academic year, term, class, stream, subject — to the workflow screens |

## Phase 2 — Uganda primary fit

| # | Fix |
| --- | --- |
| 2.1 | **Add `computePLEAggregate`** (best 4 core subjects, using the existing `Subject.isCore`) and `divisionPLE` alongside `divisionUCE`; add `'PLE'` to the `computeTerm` branch (`result-computation.ts:351-360`) and to `defaultBands` |
| 2.2 | **Resolve `Section` vs `Stream`.** Recommended: make **Section** the single subdivision, relabel it "Stream" everywhere in the UI (it already carries attendance, class teacher, rosters and homework), and repoint the three mark screens' filters from `currentStreamId` onto it. Retain the `Stream` table read-only pending a migration decision. |
| 2.3 | **Batch report-card generation and a class PDF** (one merged document per class) |
| 2.4 | **Offline queue for attendance and mark entry**, reusing the POS pattern (`features/pos/offline-queue.ts`) |
| 2.5 | Add day/boarding residency to `StudentProfile` |

## Phase 3 — Polish

Vocabulary pass (§J); retire duplicate mark screens; per-user `useStickyState`
key; consolidate the two balance-identity implementations; nav de-duplication.

---

# Q. Six first-time-user tests

| # | Task | Pass criteria |
| --- | --- | --- |
| 1 | **Enrol a pupil into P4 West** | Finds the entry point from the dashboard without help; completes it; an `Enrollment` row exists with `classId`=P4, the subdivision=West, correct `termId`; `StudentProfile.current*` matches; the success message names the pupil, class, stream and term and offers "Open pupil" and "View class list". *Currently blocked by P0-1.* |
| 2 | **Enter P4 Mathematics marks** | Reaches a mark grid from "My Teaching" without using the URL bar; the page header states year, term, class, stream and subject; marks save; a second teacher editing concurrently is refused, not silently overwritten; on submit the teacher is told what happens next. |
| 3 | **Publish P4 Term 2 results** | Discovers the screen from a school-language nav label; when blocked, sees *which pupils* and *why* in school language with a working CTA to each fix; on success gets confirmation and a link to report cards. |
| 4 | **Print P4 report cards** | Generates and prints the **whole class in one action**; every card shows a consistent headline and subject table (never GPA 0.00 beside real marks); attendance is real. *Currently impossible — no batch route.* |
| 5 | **Promote P4 West → P5 West** | Dry-run plan shown first; unresolvable streams listed, not silently dropped; after commit, `classId`, `sectionId`/`streamId` and `termId` all correct on the new `Enrollment` and the snapshot; a CTA opens the new class list. |
| 6 | **Find a pupil's academic performance** | From a pupil search, reaches results and report cards in ≤3 clicks; sees only published results; no UUIDs, no `rev`, no checksums on screen. |

---

# R. What I did not verify

- **The HTTP request in P0-1.** Every link in the chain is verified from source,
  including the `class-validator@0.14.4` short-circuit branch. I did not execute
  the request itself (plan mode is read-only, and a *succeeding* POST would create
  a real enrollment). The `curl` in §B confirms it in one call.
- Whether the app connects as a `rolbypassrls` role in this environment
  (`kernel/prisma/prisma.service.ts:103-113` warns it may), which affects the
  org-scoping of `promotion.service.ts:261-273`.
- Any claim about how the system behaves with real school data — there is no
  end-to-end test to read.

---

# S. Remediation — what changed

Commit `d4ae6ba` and its follow-up address the audit. Verification notes:

**P0-1 is confirmed, not merely inferred.** The audit could not execute the
request. The HTTP contract spec now added (`apps/api/test/integration/http-validation-contract.spec.ts`)
was run against the pre-fix DTOs and against the fix: all five placement routes
fail on the former and pass on the latter. The bug was real and is closed.

| Finding | Status |
| --- | --- |
| P0-1 placement routes 400 | Fixed — DTOs decorated; HTTP contract spec added, plus a static scan that fails the build if any `@Body()` DTO ever ships without validation metadata |
| P0-2 report card headline zeros | Fixed — headline derives from `ReportCardTemplateService.termStats`, the same rows the body prints; `computeTermGpa` deleted |
| P0-3 Section vs Stream | Addressed without a migration — the server matches either column, the UI creates and filters on `Section` (the one that reaches attendance, class teachers and rosters) under the word "Stream", and the legacy screen is labelled as legacy |
| P0-4 stale placement snapshot | Fixed on both exit and graduation |
| P0-5 unguarded mark paths | Fixed — `appendAdjustment` and `setParticipation` now share `postMark`'s lock and approval gates |
| P0-6 exam-path SoD | Fixed — `submittedById`/`submittedAt` written, `enteredAt` preserved, both SoD arms enforced |
| P0-7 CBT auto-approval | Fixed — approver of record recorded |
| P0-8 draft report-card PDF | Fixed — drafts require `publishResults` |
| P1 concurrency guard never fires | Fixed — `expectedVersion` added to the three DTOs that lacked it and sent by the mark screens; a 409 reloads the sheet |
| P1 publish blockers invisible | Fixed — grouped, named and given CTAs; `runPublishGate` remains the only authority |
| P1 dashboard defects | Fixed — real counts, canonical money only, dead selects removed, nav entry added |
| P1 orphaned academic endpoints | Wired, and moved off the sealed `GradeEntry` |
| P1 no batch report cards | Added — build, release and print a class in one action each; one merged PDF |
| P1 no offline support | Added for attendance and mark entry |
| P1 no PLE division | Added — best four core papers, aggregate 4–36, divisions I–IV |
| P1 workflow stops at Results | Rail extended through approve → results → report cards → promote |
| P2 vocabulary | Phase codes, raw ids and permission strings replaced across the workflow screens |

**Also found and fixed during remediation, not in the original audit:** the
tenancy ratchet (`tenancy-registration.spec.ts`) was already failing on `main`.
60 models carrying a non-null `organizationId` were absent from `ORG_SCOPED`, so
nothing injected the org on write or filtered it on read — the whole LMS
vertical, income, complaints, phone calls, and `PortalIdentity`, the signed-in
subject for every parent and pupil. Five models with `deletedAt` were likewise
unfiltered. Both sets are now registered.

**Still open:**

- `rls.spec.ts` fails in this environment with `permission denied for schema
  public` — the app connects as a restricted role. Pre-existing and unrelated to
  these changes, but it means RLS itself is unverified here.
- The `ORG_SCOPED` additions make many queries org-filtered that previously were
  not. That is the correct behaviour, but it is a behavioural change across the
  LMS vertical and wants a run against a real database before release.
- Duplicate mark-entry screens still exist. The audit recommends retiring
  Assessment Structure as an operator surface; nothing has been deleted, because
  its endpoint is the one that carries `expectedVersion`.
