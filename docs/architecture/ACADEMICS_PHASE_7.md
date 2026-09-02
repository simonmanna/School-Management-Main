# Phase 7 — performance, security and operational hardening

Status: implemented in the working tree. Load testing against production-shaped hardware has **not**
been run; the targets below are stated so a pilot can be measured against them, not claimed as
observed.

Phase 7 is the phase with no new screens. Everything here is about what happens when the system is
under load, under attack, or being read by whoever is supporting it at 22:00.

## 1. Authorization gaps closed

`PermissionsGuard` **fails open**: an undecorated handler is allowed. That is the legacy state
across ~1800 handlers, and `route-permission-coverage.spec.ts` makes each remaining gap explicit in
a ledger rather than silently allowed.

The ledger had 15 live entries. All 15 are now closed, and the suite is green for the first time:

| Route | Was | Now |
| --- | --- | --- |
| `GET/POST/PATCH/DELETE /income-heads` (5 handlers) | Undecorated — **any authenticated account could rename or delete a revenue category** | `income:read` / `income:create` / `income:update` / `income:cancel` |
| `/income` (9 handlers, including `create`, `cancel`, `delete`) | Undecorated — **any authenticated account could post to or reverse the ledger** | `income:read` / `income:create` / `income:update` / `income:cancel` |
| `POST /push/subscribe` | Undecorated | `@NoPermissionRequired` with a reason — the handler already requires a portal claim or `notifications:write`, and binds the subscription to the caller |

The grants already existed in the catalogue; only the decorators were missing. Because the guard
ANDs its requirements, gating a route that people were using through the gap reads to them as an
outage — so the Phase 6 migration backfills `income:*` onto the roles that hold the equivalent
`journal:*` / `expense:*` / `school:fees:write` authority.

Three further defects were found by writing `role-presets.spec.ts`; they are described in
[Phase 6 §4](ACADEMICS_PHASE_6.md) (Exams Officer could not run an examination, Exams Officer could
approve its own results, Bursar held a permission that does not exist).

### The class-ownership fail-open

`school-teacher-ownership.spec.ts` had two red cases. They were not flaky — they were describing a
live hole in `DataScopeService`, and three separate paths made it possible to take the register for
a class you do not teach:

1. `assertMayTouchClass` returned early for `scope === 'own'`, alongside `school`. But `own` is the
   **narrowest** scope in `SCOPE_RANK`, and the shipped **Subject Teacher** preset uses it — so that
   preset could act on any class in the building.
2. `effective()` returns `school` for an account with no roles at all, so a session holding only
   `school:attendance:own` and nothing else was treated as school-wide.
3. `classIds()` widened an empty result to `'all'` — a teacher with no assignments and no timetable
   got every class.

The fix separates the two questions that were being answered by one method:

- `assertMayTouchClass` still asks what a role's data scope permits, but `own` now falls through to
  the same check as `class`, and a caller with no staff record is refused.
- A new `assertTeachesClass` asks the narrower question an `:own` grant actually makes — the caller
  has *claimed* the class is theirs, so ownership is **proved**, never assumed. Attendance marking
  calls this one.
- `taughtClassIds()` returns a definite list: empty means "teaches nothing", never "teaches
  everything". `classIds()` keeps its widening, because it feeds report filtering, where a head of
  department with no personal timetable would otherwise see a blank dashboard — but authorization no
  longer makes that trade.

### A required stage that could not be required

Two integration specs asserted that an `accepted` application cannot be enrolled, and both were
failing. The specs were right.

`AdmissionsWorkflowService.validateProgress` carried an unconditional exemption:

```ts
if ((cfg.stage === 'OFFER' || cfg.stage === 'APPLICANT_ACCEPTANCE') && app.status === 'accepted') continue;
```

`AdmissionsService.checkEligibility` carried the matching pair. Together they meant a school that
had configured its OFFER stage as **required** could still enroll a learner with no offer ever
issued — a hard-coded status check overriding versioned configuration, which is the exact shape
ADR-015 and the plan's §4 exist to remove.

The exemption was never needed. A school that runs no offer round says so in configuration: the
`simple` preset sets OFFER and APPLICANT_ACCEPTANCE to `skip`, and skipped stages never reach the
check. `standard` and `selective` declare both **required**, and now get them enforced.

Both exemptions removed. Note that completeness is judged on **evidence**, not on `status`:
`isOfferComplete` returns true for an offer letter marked accepted whatever the application's status
says, so an application whose status merely lags its evidence still enrolls.

## 2. Personal data in logs

`pino-http` does not serialise a request body by default, so the pre-existing `req.body.*` redaction
was a guard for a body serialiser nobody had added. The paths that mattered in practice were the
query strings: a school's logs are read by whoever supports the server, and `?search=Nakato%20Sarah`
puts a named child in a file that outlives the request.

Now redacted: `req.query.search`, `q`, `name`, `phone`; `res.headers["set-cookie"]`; and, for the
same belt-and-braces reason as before, the personal fields on the school and family records
(`phone`, `email`, `msisdn`, `dateOfBirth`, `nationalId`, `guardianPhone`, `indexNumber`,
`candidateNumber`) plus `currentPassword`, `token` and `pin`.

Ids are deliberately **not** redacted. A `studentProfileId` is meaningless without the database, and
without it no incident can be traced.

## 3. Rate limits

Global tiers stay at 100 req/min and 600 req/10 min per IP. Three routes are tightened, each for a
reason rather than uniformly:

| Route | Limit | Why |
| --- | --- | --- |
| `GET /school/portals/report-cards/:id/pdf` | 20/min | Renders a PDF per call and returns a named child's marks. A family downloads two or three a term; anything walking the id space is not a family. Ownership is enforced in the service — this bounds the cost, and the enumeration rate of ever getting that wrong. |
| `POST /school/portals/parent/:id/pay` | 10/min | Money leaves a phone here. A loop is either a client bug or somebody probing the mobile-money bridge. |
| `POST /school/statutory/exports/run` and `/download` | 12/min | A run recomputes readiness across a whole cohort and produces a file that leaves the building. |
| `GET /school/statutory/uneb-ca/readiness` | 30/min | The most expensive read in the module, and the one a dashboard would be tempted to poll. |

## 4. Query paths

Three indexes were added in the Phase 6 migration for the hot reads, all of which were index scans
over the whole table once a school had several terms of history:

```sql
StudentAssessment (assessmentId, deletedAt, studentProfileId)   -- opening a markbook
StudentAssessment (studentProfileId, approvalStatus, updatedAt) -- a portal dashboard
StudentAssessment (organizationId, termId, approvalStatus)      -- readiness and result runs
```

### Targets, not measurements

The plan's performance targets are restated here so a pilot can be measured against them. **None of
these has been observed on production-shaped hardware.**

| Target | Status |
| --- | --- |
| Markbook of 100 learners × 30 columns within ~2s | Not measured |
| p95 mark save under 1s | Not measured |
| Bulk paste stays responsive | Not measured |
| No mark lost on retry | Covered by the Phase 4 idempotency and optimistic-concurrency tests |
| Write APIs idempotent where users retry | Bulk mark saves carry an idempotency key (Phase 4); `ResultProcessingRun` carries `@@unique([organizationId, idempotencyKey])`, so a retried compute returns the same run rather than a duplicate |

Measuring the first three needs a seeded school of realistic size on hardware resembling the
target. That is Phase 8 work, listed in the pilot runbook.

## 5. Tenant isolation

Every Phase 6 table is registered in `ORG_SCOPED`, and the registration is machine-checked rather
than reviewed: `tenancy-registration.spec.ts` parses `schema.prisma` and fails if any model with a
non-null `organizationId` is missing from the set, with a shrink-only baseline for the known
exceptions. A new academic table cannot be added without either registering it or explicitly
widening a list that only ever narrows.

`StudentExamReference` and `StatutoryExportTemplate` are also in `SOFT_DELETE` — a withdrawn
candidate reference and a retired layout stay readable for enquiries. `StatutoryExportRun` is
evidence and never deletes at all.

## 6. Background work

`ResultProcessingRun` already carries `status` (`queued` → …), `startedAt`/`completedAt`,
`errorCount`, a `report` payload and an idempotency key, so a run is observable and retryable.

Computation itself is still synchronous inside the request transaction. For a class-scoped run
(30–60 learners, the shape every school actually uses) that is the right trade: the caller gets the
readiness conflicts back immediately. A whole-school run would want a worker, and the record shape
is already the one a worker would use. This is a known characteristic, not a hidden one.

## 7. What is still red

**`report-definition-canon.spec.ts` — 7 of 10 report definition files.**

The canon is that a report definition reads a canonical domain service and never touches the
database, because a definition with database access will eventually compute a figure instead of
asking for one — which is how a dashboard comes to print a different number from the pupil's own
statement. Seven files violate it, reaching through `as any` into another service's private Prisma
client:

| File | Sites |
| --- | --- |
| `timetable.reports.ts` | 9 |
| `finance.reports.ts` | 6 |
| `curriculum.reports.ts` | 4 |
| `academics.reports.ts` | 3 |
| `teacher.reports.ts` | 2 |
| `enrollment.reports.ts` | 1 |
| `attendance.reports.ts` | 1 |

This is systemic, dates from the report-catalogue commit, and predates this work. Fixing it means
adding query methods to the owning canonical services (timetable, curriculum, analytics, attendance,
enrollment) and is its own remediation — not something to fold into an academics phase, where a
half-done conversion would leave two ways to read the same figure, which is the exact failure the
canon exists to prevent. **It remains open, and the table above is its worklist.**

### Report queries that could never have run

`school-reporting.spec.ts` asserts that every registered report runs without throwing. It was red on
one report, and behind it were three more of the same kind — a query written against the wrong
model, or reading a relation the schema does not declare:

| Report | Defect |
| --- | --- |
| `finance.balance-sheet` | `asOf` was passed through undefined, reaching Prisma as `new Date(undefined)` — an Invalid Date — and surfacing as a validation error inside a `groupBy`, which reads as a database fault rather than a missing parameter. The sibling reports in the same file already defaulted it to today. |
| `finance.audit-trail` | The `where` wrapped `status` and `postingDate` in `entry: { … }` — the shape a `JournalLine` query takes — against `JournalEntry`, where both are plain columns. `journal` was read for the Journal column but never included, and `createdBy` was treated as a relation when it is a user-id string. |
| `finance.reversals` | `createdBy` and `reversedBy` were included as relations; neither is one. `reversalEntryNumber`, `reversedById` and `reversalReason` were read off the original entry, where none of them exists — so all three columns printed blank even in the runs that did not throw. The reversal is a separate entry reached by `reversedEntryId`; the report now resolves it and shows its number, who posted it, and its description. |

These are query fixes, not a canon conversion: the definitions still reach through `as any` into
another service's Prisma client, which is the systemic issue below. A broken query and a
misplaced query are different problems, and only one of them is a remediation.

Two adjacent suites that were red for unrelated reasons are now green:

- `report-registry-catalog.spec.ts` — four reports declared a `defaultSort` on a key that was not one
  of their columns (`stageOrder`, `dayOfWeek` ×3, `sortOrder`), so a balance sheet, three timetables
  and the admission funnel sorted by nothing at all. Each now declares the ordering column, hidden
  from the reader.
- `admission-fsm.spec.ts` — one case still asserted the pre-workflow rule that an `accepted`
  application must be refused enrollment. The configurable workflow deliberately allows it, since
  many Uganda primary schools run no offer round; the case now asserts that contract and three new
  cases cover the refusals that must still happen.

`rls.spec.ts`, `audit.service.spec.ts` and `sequence.service.spec.ts` need a live database and pass
only when `DATABASE_URL` points at one. `school-lms-grade-bridge.spec.ts` needs
`ENABLE_ADVANCED_LMS=true`, because the Moodle-shaped delivery layer is fail-closed behind that
flag; CI sets it, a bare local run does not.

Two suites that were red for real reasons are now green:

- `school-reporting.spec.ts` — the four report queries described above.
- `school-teacher-ownership.spec.ts` — the class-ownership fail-open described in §1.
- `school-admissions-attendance.spec.ts` and `admission-fsm.spec.ts` — the required-stage exemption
  described in §1.
- `report-registry-catalog.spec.ts` — described above.

### An end-to-end spec that predated two phases

`school-lms-e2e.spec.ts` was red on the untouched tree — 11 of 13 cases — and every failure was the
spec describing the system as it was before Phases 2 and 4. The production code was right each time:

| The spec assumed | What is actually true |
| --- | --- |
| The LMS's own `CourseEnrolment` is enough to add a graded activity | Phase 4's grade bridge freezes its roster from the canonical `CourseEnrollment`, hung off the official `StudentEnrollment`. Two models, one letter apart; the fixture only had the first. |
| An offering can be `DRAFT` with nobody responsible for it | Phase 2 requires a PUBLISHED or ACTIVE offering with a responsible teacher before an assessment may hang off it. |
| An offering needs no name | Phase 2 gave it an operator-facing name, so the course page was falling back to the literal default "Course offering". |
| Adding a gradable activity fans learners out | Since Phase 4 it mints a DRAFT and freezes a roster; **publication** is the act that creates learner rows, and it belongs to the Assessment Board. |
| A hidden grade item returns an unreleased grade block | The envelope omits the block entirely — the learner is not told a hidden item exists. A stronger guarantee than the case asserted. |
| Approving a mark releases it | Approval and release are two acts. `release_marks` unhides the item and stamps `marksReleaseAt`; that is what every reader keys off. |

Fixture and expectations updated to the current contracts; 13 of 13 now pass. No production code was
changed to make them.
