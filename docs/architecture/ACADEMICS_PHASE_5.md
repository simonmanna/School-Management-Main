# Phase 5 — examination and result integrity

Status: implemented in the working tree; local verification performed against a real Postgres.
**Not deployed, and not school UAT sign-off.** Phases 1–4 are retained and regression-tested.
Phase 6 (portals, Uganda workflows, role privacy) remains a separate phase.

Design decisions and their rationale: [ADR-028](../adr/ADR-028-examination-operations-integrity.md).

## The exam office's workflow

Open **Examinations → Run an Examination** (`/school/exam-operations`) and pick an examination.
One screen, ten steps, with the server's gate shown before every move.

1. **Create the examination** in Exam Scheduling, then move it to *Papers being configured*.
2. **Configure papers.** Each paper gets a date, a start time, a maximum mark and a room. Choose
   how it is marked: one marker, two markers, or two markers blind, with the mark difference the
   two may differ by before the script must be reconciled.
3. **Register candidates** (Venues, Seating & Papers), then **allocate seats**.
4. **Freeze the candidate list.** The frozen list — not the registration list — is what the
   examination is sat under. Re-freezing needs a reason and supersedes the previous version; the
   console shows when the two have drifted apart.
5. **Timetable the papers.** Venue, invigilator and candidate clashes are reported by the gate
   before the step is allowed, not discovered on the morning.
6. **Assign invigilators**, and decide any access arrangements. An arrangement is requested by one
   person and approved by another; an approved exemption marks the learner's paper `exempt` so the
   average leaves it out rather than scoring it zero.
7. **Log question-paper custody** — written, printed, sealed, dispatched, received, opened,
   distributed, collected, returned. Papers cannot move before they are sealed, sealing needs the
   seal number, and the order cannot run backwards. Entries can never be edited or deleted; a
   mistake is corrected by recording an incident and the correct movement after it.
8. **Record the register** for each paper as it is sat. An absence recorded here is an absence on
   the learner's canonical assessment — never a zero and never a blank.
9. **Record incidents.** Malpractice, illness, a disrupted sitting, a missing script. Closing one
   needs a written outcome; upholding a malpractice finding stops that candidate's paper counting
   as a score. Every incident must be closed before results can be finalised.
10. **Mark and moderate.** Allocate scripts, mark them, agree the marks, draw a moderation sample
    and record the moderator's re-marks. Then close the examination, which locks every paper.

## Results & Reports

**Teaching & Assessment → Results & Reports** (`/school/results`), tabbed:

- **Result runs** — work the results out from a frozen class list, see the readiness checklist,
  release to parents, mark final.
- **Explain a result** — why a pupil's subject percentage is what it is: the weighting that built
  it, and the work behind it, with each piece marked counted or left out.
- **Report cards** — issue documents from a released result set, release them to families, inspect
  the provenance of any one, reissue with a reason, or withdraw one.
- **Promotion** — draw up the list, decide, and apply.
- **Amendments** — approve a change (which recomputes into a new version) or refuse it with a
  reason.

## Integrity rules this phase adds

- **The candidate list is frozen.** `ExamCandidateSnapshot` carries a checksum over the ordered
  candidate tuples; the console reports a snapshot that no longer matches the registrations rather
  than adopting them silently.
- **Attendance is participation, not a mark.** An absence, exemption or upheld malpractice finding
  lands on `StudentAssessment.participation` through the one participation writer, so the result
  engine excludes the learner explicitly.
- **Custody is append-only and hash-chained.** A removed or reordered event breaks the chain and
  the screen says so. A database trigger refuses UPDATE and DELETE.
- **A second read is by a second marker.** A database trigger refuses to let one person hold two
  reads of the same script. Under blind marking the server withholds the candidate's identity from
  the marker's worklist — the UI is showing that decision, not making it.
- **Marks are agreed before they are canonical.** Marker scores stay on the allocation.
  Reconciliation posts every round through `MarkingService.postMark` and the agreed mark last;
  within tolerance the mean is agreed automatically, outside it a third read is required and
  nothing is posted until one exists.
- **Moderation adjusts, it does not overwrite.** An out-of-tolerance re-mark becomes a `moderation`
  `MarkAdjustment`; the original marker's score is preserved.
- **The publish gate checks more.** In addition to the Phase 4 checks: every contributing row has
  a mark or a recorded absence; the weighting totals 100% under a published policy; and no exam
  paper behind a contributing mark is still open for entry.
- **A report card knows where it came from.** `ReportDocument` pins the result set, its revision,
  the template version and a payload checksum. Publication freezes it at the database boundary; a
  correction issues a new revision and supersedes the old one.
- **Promotion is proposed, decided, then applied.** Applying writes the next placement through the
  Phase 1 spine, appending to history. A recommendation alone never moves a child.

## Authorization

Reads stay on `school:read`. Every act that changes the run of an examination is a named grant:

| Grant | What it permits |
| --- | --- |
| `school:exams:operate` | Move the lifecycle, freeze candidates, record the register, raise incidents, request arrangements |
| `school:exams:custody` | Record question-paper movements |
| `school:exams:allocate` | Hand scripts to markers, void an allocation |
| `school:exams:mark` | Mark the scripts allocated to you |
| `school:marks:moderate` | Reconcile agreed marks, draw and settle moderation samples |
| `school:exams:consideration` | Approve or refuse an access arrangement |
| `school:exams:write` | Configure how a paper is marked, close an incident |
| `school:reports:documents:write` | Issue report documents |
| `school:reports:documents:publish` | Release or withdraw them |
| `school:promotion:decide` | Record a promotion decision |
| `school:promotion:apply` | Move the learners |

Separating allocation from marking is deliberate: a marker who could allocate could hand themselves
the second read of a script they already marked. Separating issue from release, and decide from
apply, puts the irreversible half of each pair behind its own grant.

## Migration

`20260907000000_phase5_exam_result_integrity`. Additive only — eleven new tables plus columns on
`Exam`, `ExamSchedule` and `AmendmentRequest`. No legacy exam or grade table is dropped.

Every new column carries the behaviour already in force as its default: papers default to single
marking with no moderation required, and existing examinations adopt the lifecycle state their
legacy `status` already implies (`closed → closed`, `published`/`scheduled → scheduled`, else
`draft`). Nothing changes meaning on migration.

Three database guards ship with it:

- `QuestionPaperCustodyEvent_append_only` — refuses UPDATE and DELETE on the custody log.
- `ScriptAllocation_independent_markers` — refuses the same marker on two roles of one script.
- `ReportDocument_immutable` — refuses a payload change on a published document and refuses to
  delete a published or superseded one.

RLS follows the established shape: FORCE plus a `tenant_isolation` policy, deliberately **not**
`ENABLE` — isolation is enforced by the Prisma tenancy extension, and the policy lies dormant until
an operator turns RLS on via `pnpm rls:setup-role`. The matching `ORG_SCOPED` registration is
asserted by `tenancy-registration.spec.ts`.

## Verification

Backend typecheck, production frontend build and the architecture dependency check were run.

| Suite | Result |
| --- | ---: |
| `school-exam-phase5.spec.ts` (integration, real Postgres) | 17 / 17 |
| `exam-phase5-contracts.spec.ts` (unit) | 15 / 15 |
| Touched-suite regression (8 suites) | 93 / 93 |

The Phase 5 integration spec walks the exit gate end to end: a gate that names what is missing; the
lifecycle to `scheduled`; a checksummed candidate freeze and the stale-snapshot refusal; a verified
custody chain plus the database's refusal to edit or delete it; a register whose absence becomes a
recorded absence; an access arrangement refused to its own requester and an approved exemption; a
blind double-marking allocation with identity withheld and the same-marker refusal; agreement
within tolerance, a demanded third read outside it, and only the agreed mark posted; a reproducible
moderation draw and an out-of-tolerance re-mark applied as an adjustment; a publish blocked while a
paper is open and released once the examination closes; an explanation read from the frozen
breakdown; report documents that pin their result set and reproduce by checksum; **a correction
producing revision 2 without changing revision 1**; promotion proposed, decided and applied through
three acts onto the canonical placement spine; tenant isolation across every new table; and an
optimistic-concurrency refusal on the lifecycle.

Run it with `pnpm test:academics:phase5` against an explicitly selected test database. CI runs it
after the existing Phase 4 gate.

### Existing specs updated for the canonical contracts

- `school-result-integrity.spec.ts` — seeds a published weighting policy and locks the paper once
  its marks are approved, because Phase 5's gate now checks both.
- `school-gradebook.spec.ts` — builds roster membership before freezing, which is the guarantee
  Phase 4's frozen-roster trigger exists to give.
- `school-grade-sod.spec.ts` — asserts the refusal and the untouched mark rather than which of two
  status codes Phase 4 chose for it.
- `school-lms-grade-bridge.spec.ts` — gives the LMS activity the course and frozen roster the
  bridge now requires, and asserts that an out-of-range plugin score is refused rather than clamped.

### Defects found and fixed on the way

These were pre-existing, in code Phase 5 did not otherwise touch, and were surfaced by running the
suites:

- `LmsGradeBridgeService.setScore` documented clamping while the code refused out-of-range scores.
  The refusal is right — a plugin reporting 999 out of 50 is a plugin bug, and recording 50 would
  hide it behind a mark that looks deliberate. The comment now says what the code does.
- `teacher.reports.ts` passed `classId: { in: undefined }` when no class filter narrowed the scope,
  which Prisma rejects rather than reading as "all classes", and read `teacher.name`,
  `teacher.staffNumber` and `slot.class` — none of which exist on those models, so the teacher
  workload report printed blank names even where it did not throw.
- `timetable.reports.ts` and `curriculum.reports.ts` asked for relations that do not exist
  (`class` instead of `schoolClass`; `room`, and `subject`/`teacher`/`period` on
  `TimetableOverride`, which declares no relations at all).
- `timetable-advanced.service.ts` included the same non-existent override relations, and omitted
  `period` from its grid query while its callers rendered a period column.

## Pre-existing failures left standing

These were red before Phase 5 and are outside its scope. They are listed so the suite's state is
not mistaken for something this work introduced, and none of them is waived or weakened.

| Suite | Why it is red |
| --- | --- |
| `school-reporting.spec.ts` | A `journalLine.groupBy` call in `apps/api/src/modules/accounting/reporting/balance-sheet-report.service.ts` — a defect in the accounting vertical, untouched here. The school-side report defects this test surfaced are fixed above. |
| `report-definition-canon.spec.ts` | 7 of 10 report definition files query Prisma directly, which the canon forbids. Systemic, from the report-catalogue commit. Two of those files gained a further direct query here while their existing defects were repaired; restructuring the reporting module onto canonical services is its own remediation. |
| `report-registry-catalog.spec.ts` | An admissions report declares `defaultSort.key: 'stageOrder'`, which is not one of its columns. |
| `admission-fsm.spec.ts` | The admissions enrollment eligibility gate accepts an application it should refuse. Unrelated module. |
| `route-permission-coverage.spec.ts` | The known 15 gaps in notification/income routes. Every Phase 5 route is covered. |
| `rls.spec.ts` | RLS is not enabled on the local development database, as on the untouched tree. |

Everything else passes: **110 suites, 2,042 tests** in the unit and module run, plus the
integration suites listed above.

## What this phase does not claim

- **No school has run a term through it.** Staff must exercise the exam-office workflow with their
  actual role assignments, real question-paper handling, real class sizes and a real disputed mark
  before this is a rollout.
- **Deployment hold stands.** The Phase 4 note applies unchanged: the inspected local database did
  not have the repository's migration chain recorded as applied. Establish and review its baseline,
  back up the real target, rehearse the exact migration on a copy, and obtain UAT approval before
  any `prisma migrate deploy` against it.
