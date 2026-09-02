# ADR-028: Examination Operations and Result Integrity

- **Status:** Proposed
- **Date:** 2026-09-02

## Context

An examination is an operation before it is a set of marks. Papers are written, sealed and moved;
candidates are registered, seated and sit or fail to sit; scripts are handed to markers and come
back; some of those marks are re-read. Phase 4 made `Assessment` / `StudentAssessment` the only
grade store, but the examination around it had no record of who held the papers, who actually sat,
what went wrong in the hall, or how a mark was agreed.

The gap has a specific cost. Without a frozen candidate list, a learner registered after the
sitting joins it retroactively. Without an attendance record, an absence and an unmarked script
look identical to the result engine. Without independent marker rounds, "double marking" is one
person entering a number twice. Without a custody log, a leaked paper has no chain to examine.

## Decision

### The examination is a state machine

`Exam.lifecycleState` runs `draft → setup → scheduled → candidates_locked → in_progress →
marking → moderation → results_ready → closed → archived`. Every edge is a deliberate act with a
precondition; nothing advances because a date passed. Each transition is guarded by a gate that
returns **structured conflicts**, not a bare rejection, so the office is told which paper has no
invigilator rather than that the step "failed". Stepping backwards is a correction and requires a
reason on the record. `Exam.status` remains as the coarse legacy flag the older screens read and is
projected from the lifecycle, so the two can never disagree.

### The candidate list is frozen, not live

`ExamCandidateSnapshot` + `ExamCandidateEntry` freeze the registration list under a checksum, in
the same shape as `AcademicRoster`. The snapshot — not `ExamRegistration` — is what the exam was
sat under. Re-freezing creates revision *n+1* and supersedes; the gate reports a snapshot that no
longer matches the registrations rather than silently adopting them.

### Attendance is participation, not a mark

`ExamAttendance` records who sat which paper. An absence, exemption or malpractice finding is
projected onto the learner's canonical `StudentAssessment.participation` through
`MarkingService.setParticipationInTx` — the one participation writer — so the result engine
excludes them explicitly. Blank is not zero, and absent is only zero where the published policy
says so.

### Question-paper custody is append-only and hash-chained

`QuestionPaperCustodyEvent` links each event to the previous one through `chainHash`. A removed or
reordered event breaks the chain and `verify` reports where. A mistake is corrected by recording a
new event, never by editing an old one; a database trigger refuses UPDATE and DELETE outright, so
neither a service bug nor a direct connection can rewrite the log.

### Marker scores live on the allocation until the mark is agreed

`ScriptAllocation` holds one marker's read of one candidate's script under an anonymous code.
Double and blind marking produce two rows by two different markers — enforced by a database
trigger, because a second read by the same person is not a second read. Scores stay on the
allocation until reconciliation: under blind marking the first read must not become the visible
mark, and the canonical ledger should record an agreed mark rather than a work in progress.

Reconciliation posts every round into `MarkEntry` through `MarkingService.postMark` — still the
only writer of a score. Within tolerance the mean is agreed automatically; outside it a third read
is required and **nothing is posted** until one exists. `reconcileOriginal` already prefers the
reconciliation round, so the canonical score is the agreed one and both independent reads remain on
the record.

### Moderation adjusts the ledger, it does not overwrite the marker

`ModerationSample` records the draw (method + seed), so "why these scripts?" has an answer other
than "the computer chose". An out-of-tolerance re-mark is applied as a `moderation`
`MarkAdjustment` on the immutable ledger. The original marker's score is never overwritten.

### The publish gate learned what Phase 4 could not check

`runPublishGate` additionally refuses to release results when a contributing learner row has
neither a mark nor a terminal participation (`PARTICIPATION_UNRESOLVED`); when a subject's
weighting components do not total 100%, resolve to no policy, or resolve to an unpublished draft;
and when an exam paper behind a contributing mark is still open for entry (`EXAM_PAPER_UNLOCKED`).
Closing an examination locks every one of its papers, which is what makes the last check passable.

### A report card gains provenance

`ReportDocument` pins the result set, its revision, the template version and a payload checksum,
and carries a supersession chain. Publication freezes the payload at the database boundary; a
correction issues revision *n+1* and marks the previous one superseded. The copy a family already
holds can still be shown exactly as it was given.

### Promotion is three acts, not one

Proposing draws the list from a **published** result set and freezes the numbers the decision rests
on. Deciding is a human judgement that may depart from the recommendation, with a reason.
Applying is a third act that writes the next placement through the Phase 1 spine
(`PlacementService.appendPlacement`), appending to history rather than rewriting it. A
recommendation alone never moves a child, and the three acts are three separate grants.

## Consequences

- Eleven new tables, all append-only or supersede-in-place; none carries `deletedAt`, because a
  candidate list, an attendance record, an incident, a custody event, a marked script, a moderation
  sample, a published document and a promotion decision are all evidence.
- Existing examinations adopt the lifecycle state their legacy `status` already implies; every new
  column carries the behaviour that was already in force (single marking, no moderation) as its
  default, so nothing changes meaning on migration.
- Marking an exam paper now requires its canonical assessment to be published to a frozen roster.
  The gate reports this as `PAPER_ASSESSMENT_NOT_PUBLISHED` before scripts are allocated, rather
  than failing later inside the mark writer.
- Result sets computed under no policy, or a draft one, can no longer be published. Schools with
  incomplete assessment configuration must complete it — which is the point.

## Alternatives considered

**Advancing the lifecycle from dates.** Rejected: an examination is not "being marked" because a
date passed, and an automatic transition has nobody to hold responsible for the precondition.

**Storing marker rounds directly in `MarkEntry` as they arrive.** Rejected: it leaks the first
read into the visible mark under blind marking, and leaves the canonical store holding a
work-in-progress score between the two reads.

**Clamping an out-of-range mark instead of refusing it.** Rejected for the same reason the LMS
bridge refuses one: recording the maximum hides the fault behind a mark that looks deliberate.

**Letting the promotion recommendation write the placement.** Rejected: the calculation says what
the numbers imply; only a person decides, and only an explicit third act moves a child.
