# Academics and Assessment — Phase 1: Enrollment and grouping integrity

- **Status:** Implemented; school UAT sign-off pending
- **Date:** 2026-09-02
- **Implements:** ADR-018 (enrollment and placement history), ADR-019 (section/stream grouping modes)
- **Depends on:** Phase 0 / 0.5 baseline (`ACADEMICS_PHASE_0_0_5.md`)

> **Governance note.** ADR-018 and ADR-019 are still marked *Proposed*. Phase 0.5 says schema
> work is blocked until they carry named approvals from engineering, QA, a teacher or exam
> officer, and a school administrator or head teacher. This phase was built to the ADRs as
> written; the sign-off record still has to be attached to the release ticket before rollout.

## 1. What Phase 1 establishes

Four canonical rows replace "the class field on the pupil record":

| Row | Owns | Grain |
|---|---|---|
| `AcademicProgramme` | Which curriculum and assessment rules apply | Per school, versioned by effective dates |
| `ClassCohort` | One class in one academic year | Class × academic year |
| `StudentEnrollment` | Official school membership | Learner × academic year |
| `EnrollmentPlacement` | Where the learner sits, and since when | Append-only, effective-dated |

`StudentProfile.currentClassId / currentSectionId / currentStreamId` remain, but only as a
**projection** of the newest open placement. Nothing in Phase 1 reads them as truth; they exist so
the pre-Phase-1 consumers keep working during the compatibility window (Phase 0.5 register:
`DEPRECATE`).

The legacy per-term `Enrollment` model is untouched and still served at `/school/enrollments`.
It is `MIGRATE`, not `DELETE` — retirement waits for reconciliation plus one successful term.

## 2. Canonical rules and where they are enforced

| Rule | Service | Database |
|---|---|---|
| One membership per learner per academic year | `StudentEnrollmentService.createInTx` | `@@unique(organizationId, studentProfileId, academicYearId)` |
| Exactly one OPEN placement per enrollment | `PlacementService.appendPlacement` | partial unique index `EnrollmentPlacement_one_open_per_enrollment` |
| No two placements cover the same instant | `closeOpen` end-dates before insert | `EXCLUDE USING gist` on `(enrollmentId, tsrange(from, to))` |
| A placement never ends before it starts | `closeOpen` | `CHECK EnrollmentPlacement_period_ck` |
| An end reason only on a closed placement | `appendPlacement` | `CHECK EnrollmentPlacement_end_reason_ck` |
| Section/stream belong to the cohort's class | `validateGrouping` | trigger `school_placement_grouping_trg` |
| A stream sits under a section of its own class | `ClassCohortService.attachStreamToSection` | trigger `school_stream_section_class_trg` |
| Grouping mode decides what is required | `validateGrouping` (pure, unit-tested) | — |
| A learner's status governs whether they hold a seat | `enrollment-fsm.holdsPlacement` | — |

The exclusion constraint uses half-open ranges, so a movement that closes one placement at the
exact instant the next opens is accepted; anything that would leave a learner in two classes at
once is rejected by the database, not only by the service.

### Grouping modes (ADR-019)

`NONE`, `SECTION_ONLY`, `STREAM_ONLY`, `SECTION_AND_STREAM`. Resolution order is
**cohort override → programme default → `SECTION_ONLY`**. In combined mode a stream must belong
to the selected section (`Stream.sectionId`, added in this phase).

Changing a cohort's mode is refused while open placements would become invalid, and the error
names how many learners are affected.

Where a mode requires a section (or stream) and the caller omitted one, the service fills it in
**only when the class offers exactly one legal choice**. Two sections means the request is
ambiguous, and the API asks rather than seating the learner somewhere by accident.

### Enrollment lifecycle (ADR-018)

```
PENDING   → ACTIVE, CANCELLED
ACTIVE    → SUSPENDED, WITHDRAWN, TRANSFERRED, COMPLETED
SUSPENDED → ACTIVE, WITHDRAWN, TRANSFERRED, CANCELLED
WITHDRAWN → ACTIVE          (re-entry; needs a placement)
TRANSFERRED → ACTIVE        (return; needs a placement)
COMPLETED, CANCELLED        terminal
```

`PENDING`, `ACTIVE` and `SUSPENDED` hold a class seat — a suspended pupil stays on the class roll
and is excluded from marking by participation status, not by losing their placement. Losing
membership closes the open placement; regaining it requires an explicit new one, so the gap stays
visible in history.

Promotion and repeating do **not** edit the current row: they complete this year's membership and
open next year's in the same transaction, which is what keeps a repeater's two P5 years
separately reportable.

## 3. Uganda configuration, not conditions

`ProgrammeService.UGANDA_PROGRAMME_TEMPLATES` installs four programmes and links them to grade
levels by normalised name (`Primary 1`, `P.1`, `p 1` and `P1` all match):

| Code | Grades | Authority | Configuration highlights |
|---|---|---|---|
| `PRIMARY_LOWER` | P1–P3 | NCDC | learning areas, continuous observation, competency checklists, **ranking off** |
| `PRIMARY_UPPER` | P4–P7 | NCDC | subject offerings, homework/CAT/project/practical/exam, ranking on |
| `LOWER_SECONDARY` | S1–S4 | UNEB | Activities of Integration, project work, UNEB CA readiness, candidate numbers from S3 |
| `ADVANCED_SECONDARY` | S5–S6 | UNEB | subject combinations, subsidiary subjects, rubric assessment |

Everything stage-specific lives in `AcademicProgramme.config` (JSON) and is read by later phases.
There is no `if (className === 'P2')` anywhere in the Phase 1 code, and there must not be one in
the phases that consume it.

Seeding is idempotent: a re-run updates the templates and relinks grades, and deliberately does
**not** overwrite a grouping mode the school has already chosen. Template grades with no matching
`GradeLevel` are reported back as `unmatchedGrades` rather than being invented.

## 4. API surface

| Route | Permission | Purpose |
|---|---|---|
| `GET/POST/PATCH /school/programmes` | `school:read` / `school:programmes:write` | Programme CRUD |
| `POST /school/programmes/seed-uganda` | `school:programmes:write` | Install the four templates |
| `GET/POST/PATCH /school/class-cohorts` | `school:read` / `school:programmes:write` | Annual class cohorts |
| `POST /school/class-cohorts/generate` | `school:programmes:write` | One cohort per class for a year |
| `GET /school/class-cohorts/:id/grouping-options` | `school:read` | Effective mode + legal sections/streams |
| `PATCH /school/streams/:id/section` | `school:programmes:write` | Attach a stream to a section |
| `GET /school/student-enrollments` | `school:read` | Filter by year, programme, status, cohort, search |
| `GET /school/student-enrollments/by-student/:id` | `school:read` | Every year the learner has held |
| `GET /school/student-enrollments/placement-at/:id?at=` | `school:read` | **Point-in-time placement** |
| `GET /school/student-enrollments/:id/placements` | `school:read` | Append-only history |
| `POST /school/student-enrollments` | `school:enrollment:write` | Create membership + opening placement |
| `POST /school/student-enrollments/late-admission` | `school:enrollment:write` | Dated from the day they joined |
| `POST /school/student-enrollments/:id/{status,withdraw,transfer-out,suspend,complete}` | `school:enrollment:write` | Guarded transitions |
| `POST /school/student-enrollments/:id/{repeat,promote}` | `school:enrollment:write` | Next-year membership |
| `GET /school/placements/roster/:cohortId?at=` | `school:read` | Class list as at a date |
| `POST /school/placements/:enrollmentId/preview` | `school:read` | Validate without writing |
| `POST /school/placements/:enrollmentId/move` | `school:enrollment:write` | Append a movement |
| `POST /school/placements/bulk` | `school:enrollment:write` | `dryRun` first; all-or-nothing commit |
| `POST /school/placements/term-rollover` | `school:enrollment:write` | Same year, next term |
| `POST /school/enrollment-migration/backfill` | `school:academics:migrate` | Dry run by default |
| `GET /school/enrollment-migration/reconcile` | `school:academics:migrate` | Reconciliation report |
| `GET/POST /school/enrollment-migration/exceptions…` | `school:academics:migrate` | Visible exception queue |
| `POST /school/enrollment-migration/rollback/:runId` | `school:academics:migrate` | Remove only that run's rows |

### New permissions

- `school:enrollment:write` — enrol, move, transfer, withdraw, repeat, promote. Deliberately not
  folded into `school:students:write`, which is the front-desk grant that edits a phone number.
- `school:programmes:write` — programmes, cohorts, grouping modes.
- `school:academics:migrate` — backfill, reconciliation, exception queue, rollback.

Granted to the `Registrar` preset; `scripts/grant-enrollment-permissions.ts` tops up the
permission catalogue and existing roles by intent (new grants never reach a live tenant on their
own, because `Role.permissions` is stored data).

### Events

`school.student_enrollment.created`, `school.student_enrollment.status_changed` and
`school.placement.changed` all carry actor id and request id, and are published inside the same
transaction as the write.

## 5. UI

| Screen | Route | What it is for |
|---|---|---|
| Enrollment workspace | `/school/enrollment` | Active enrollments, move/transfer/withdraw/suspend/reinstate/repeat/promote, placement history, class list at a date, bulk placement with preview, term rollover |
| Programmes & classes | `/school/enrollment/programmes` | Uganda templates, grade-level mapping, cohorts per year, grouping mode, stream→section attachment |
| Enrollment migration | `/school/enrollment/migration` | Dry run, apply, reconciliation, exception queue, rollback |

Two UI rules follow from the domain and are worth keeping:

1. **No screen edits "current class".** Every action is a dated movement with a reason, and the
   move dialog re-validates on every change so "that stream belongs to another section" arrives
   while the form is open.
2. **Bulk actions preview before they commit**, and a batch with any invalid row is refused whole.

## 6. Migration and reconciliation

Legacy `Enrollment` is one row **per term**; canonical membership is one row **per year** with a
placement per term. The backfill groups legacy rows by (learner, academic year) and appends their
placements in effective-date order.

- `dryRun` is the default; nothing is written unless it is explicitly `false`.
- `EnrollmentPlacement.legacyEnrollmentId` is unique, so a re-run maps each legacy row exactly
  once — re-running is how a partially completed migration is finished.
- Every row carries `migrationRunId`, so a failed gate removes exactly those rows.
- A row that cannot be mapped (most often: a class whose grade level belongs to no programme)
  lands in `AcademicMigrationException`. Nothing is discarded.

`GET /school/enrollment-migration/reconcile` reports legacy rows, mapped, unmapped, per-field
differences (class, section, stream, term, roll number), canonical counts, duplicate open
placements and the open exception queue, plus a single `clean` flag. **A non-zero `unmappedRows`,
`differenceCount` or `duplicateOpenPlacements` blocks the cutover.**

Rollback refuses once a real user movement exists on the affected enrollments — at that point the
recovery is the pre-migration backup, not a delete.

## 7. Exit gate

> *Enrollment history, not current profile fields, can reconstruct every learner's placement for
> any effective date.*

Evidence: `apps/api/test/integration/school-enrollment-placement.spec.ts` (23 scenarios) and
`apps/api/test/unit/enrollment-grouping.spec.ts` (22 rules), both wired into `pnpm test:academics`
and therefore into CI.

| QA scenario | Covered by |
|---|---|
| Mid-term stream/section change | "a mid-term section change end-dates the old placement instead of rewriting it" — also asserts placement-at for February vs April, and `null` before admission |
| Transfer between classes | "transfers a learner between classes and keeps the old class in history" |
| Late admission after assessments begin | "records a late admission from the date the learner actually joined" — absent from the earlier roster, present in the later one |
| Repeating learner | "a repeater gets a new year's enrollment at the same grade, both years intact" |
| Withdrawn learner remaining in old results | "keeps a withdrawn learner in the roster that produced last term's results" |
| No duplicate active placement | "never leaves two open placements on one enrollment"; reconciliation's `duplicateOpenPlacements` |
| Grouping integrity | section from another class, stream in sections-only mode, section-and-stream nesting, stream re-parenting, ambiguous section |
| Migration | backfill → reconcile clean → idempotent re-run → rollback; unmappable row reaches the queue |

## 8. What Phase 1 deliberately does not do

- It does not delete or freeze the legacy `Enrollment` model, the legacy `/school/enrollments`
  routes, or `EnrollmentHistory`. That is the Phase 0.5 retirement condition, not this phase.
- It does not switch existing consumers (attendance, assessment rosters, report cards, timetable)
  off `currentClassId`. They read the projection, which the placement service keeps accurate. Each
  consumer moves to `placementAt` / `roster` in its own phase.
- It does not touch `CourseOffering`, course enrollment or teaching allocation — Phase 2.
- Capacity is **reported, not enforced**: a school that must seat a late admission in an
  over-subscribed P5 gets the placement plus a visible warning, because a hard block would just be
  worked around by editing the capacity field.
