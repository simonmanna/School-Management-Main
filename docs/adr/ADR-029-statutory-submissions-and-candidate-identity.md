# ADR-029: Statutory Submissions and Candidate Identity

- **Status:** Proposed
- **Date:** 2026-09-03

## Context

Phases 1–5 made the school's own academic record trustworthy: enrollment owns membership, the
offering owns the teaching context, `StudentAssessment` owns the mark, and a published `ResultSet`
owns the result. Phase 6 is where that record has to leave the building — to a family, and to a
national board.

The board case is the harder one, and it fails in ways the internal record does not:

- **A submission is refused wholesale for one bad row, and the deadline does not move.** A school
  that discovers on the day that four candidates have no Activity of Integration recorded has no
  remedy. What it needed a fortnight earlier was not a file but a list.
- **A national result comes back keyed on an index number, not a name.** If the mapping from learner
  to index number lives in a book, a results enquiry three years later has nothing to check, and a
  mis-keyed digit is discovered by the family. Two learners named "Nakato Sarah" in one S4 is
  ordinary, so a name is not an identifier.
- **The layout changes between circulars.** A school that must wait for a software release to add a
  column will type the file by hand — and a hand-typed file is one where the marks no longer match
  the marks the system holds.
- **A file, once sent, is a fact about the school.** Six months later the question is not "what does
  the system say now" but "what did we send, and can we prove it".

There is a second, quieter requirement. Families are told things by SMS — fees are due, results are
out — and a phone deletes messages. The school's own record is the only durable copy of what it
told a family, and until now the portal did not show it.

## Decision

### 1. Candidate identity is a registry, not a profile column

`StudentExamReference` holds one row per learner per board, level and sitting year, carrying the
centre number, the school's candidate number, the board's index number and a status.

It is deliberately not a column on `StudentProfile`. A learner sits PLE in one year and UCE four
years later, under different centre numbers, and each is a separate registration with its own
confirmation state; flattening them onto the profile keeps only the last, which is exactly the
record an enquiry needs afterwards.

The status ladder is `provisional` → `registered` → `confirmed`, and it means something specific: a
CA submission keyed on a number the board has not confirmed is the commonest way a school's marks
land against the wrong learner. A `confirmed` index number cannot be edited — it is withdrawn and
re-registered, which leaves the change on the record.

Index numbers returned by a board are matched on **candidate number, never on name**. Unmatched rows
become a visible exception list; they are never dropped, and they are never resolved by a fuzzy
match.

### 2. The registry does not overwrite a frozen snapshot

`ExamCandidateEntry` (Phase 5) records what the examination was actually sat under and is frozen.
When it and the registry disagree, the disagreement is **reported** — `GET
/school/statutory/candidates/reconcile/:examId` — and the office decides. The snapshot is never
quietly rewritten to agree with a number somebody edited afterwards, because then the record of what
happened would follow the record of what we now believe.

### 3. Readiness is derived and writes nothing

The CA board reads `StudentAssessment` and the registry, computes per candidate and per subject, and
writes nothing at all. A readiness board that could adjust a mark to make itself green would be
worse than no board.

Which components make up a CA score is read from the programme's versioned `config`
(`activitiesOfIntegration`, `projectWork`), not from a class name. A circular that adds a component
is a configuration change, consistent with ADR-018's rule that Uganda requirements are configuration.

Findings are `blocking` or `warning`, and each names the learner and the subject. Blocking findings
are the ones that make a file un-submittable; project work is a warning because schools legitimately
stagger project deadlines.

### 4. Exports are configurable, but the vocabulary is not

A `StatutoryExportTemplate` chooses and renames columns from a **fixed per-scope registry**. It
carries no query. This is the whole safety argument: a school can rebuild the layout when a board
moves a column, and no template edit can reach a field the dataset builder did not put on the row,
cross a tenant boundary, or emit an unapproved mark — because the builder decided what a row
contains before the template saw it.

A published template is immutable. Editing one that has produced a file mints the next version and
deactivates the old; every run pins the version it used, so the file sent in March is still readable
under the layout it was written with after the layout changes in May.

### 5. A run is the record; the file is only bytes

`StatutoryExportRun` carries the template and version, the filters, the row count, a SHA-256 of the
exact bytes, the readiness findings that stood at the time, and — once the board acknowledges it —
the submission reference. Marking a run submitted supersedes any earlier submitted run for the same
template and term, so the record can never claim two files were both the one that was sent.

A run refuses to produce a file while blocking findings stand. The override exists, because a school
may agree a partial submission with a board, but it needs a reason, and the reason and the findings
travel on the run. **Blocked candidates are omitted from the file rather than exported with blank
scores** — a board reads a blank as a zero, and a zero recorded for a child who was never assessed
is worse than an absent row.

### 6. Notices are part of the record

The portal shows the school's own notification history for whoever is signed in, scoped to the
token's user id, without the internal `payload`. Acknowledging one uses `updateMany` with the user
id in the WHERE, because an `update` by id would let a caller confirm the existence of another
family's message.

### 7. Deadlines are chased by a ledger, not a timer

`AcademicReminderWorker` writes an `AcademicReminderLog` row **before** sending, and its unique index
on `(organizationId, kind, subjectId, milestone, userId)` is what makes concurrent instances safe.
Each rung re-reads current state, so nobody is chased for work that is done. In-app by default: SMS
costs money in Uganda and the school pays.

## Consequences

**Good**

- A school can see, a fortnight before a deadline, exactly which candidates and subjects are not
  ready, with a reason per row.
- A national result can be traced back to the learner it belongs to, years later, through a record
  that says how far the number got with the board.
- A board's layout change is a configuration change, and the file sent last term is still readable.
- Every file that left the building can be proved identical to the one produced, or shown to have
  been superseded.
- Families have a durable copy of what the school told them.

**Costs and risks**

- **The shipped UNEB layouts are a starting point, not a certified specification.** They are drawn
  from the published CA process. Before a real deadline a school must produce a file, compare it
  against the circular for that sitting, and adjust. The template being editable is the mitigation,
  not an excuse.
- **The readiness rules encode the common case.** A school with an unusual subject combination will
  meet findings it must override. That path exists and is recorded.
- Four new permissions (`school:statutory:read|write|export`, `school:candidates:write`) mean four
  more things to grant. `PermissionsGuard` ANDs its requirements, so the migration backfills them
  onto the roles that already hold the authority they split out of.
- The readiness board reads a whole cohort's mark ledger per call. It is rate-limited and indexed;
  on a very large school it will still be the most expensive read in the module.

## Alternatives considered

**Candidate numbers as columns on `StudentProfile`.** Simpler to query, and wrong the first time a
learner sits two examinations: one registration overwrites the other, and the earlier sitting becomes
unenquirable.

**A fixed, code-defined export format per board.** Safest against a malformed file, and guarantees
that the first circular change is a release blocker during the exact fortnight a school cannot wait.
The registry-plus-template split keeps the safety (a template cannot invent a field) without the
release dependency.

**Letting the export fill blanks for incomplete candidates.** Produces a complete-looking file and
records zeros for children who were never assessed. Rejected outright.

**Rewriting the exam snapshot from the registry.** Would make the two agree automatically and would
destroy the only record of what the examination was actually sat under.
