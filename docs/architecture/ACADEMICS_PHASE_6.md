# Phase 6 — portals, Uganda workflows and role privacy

Status: implemented in the working tree; typecheck and the unit/contract suites verified locally.
**Not deployed, and no school has run a national submission through it.** Phases 1–5 are retained
and regression-tested. Phase 7 (hardening) and Phase 8 (pilot) follow.

Phase 6 is the phase where the academic core stops being an internal record and starts being
something the school shows to families and sends to a board. Two audiences, two failure modes:

- A **family** cannot see a mark before the school released it, and cannot see another family's
  anything. That was already true; what was missing was a durable record of what the school had
  *told* them.
- A **board** refuses a submission wholesale for one bad row, and the deadline does not move. What
  a school needs before the deadline is not a file — it is the list of which candidates and which
  subjects are not ready, in time to act.

## 1. The national-submission desk

**Examinations → National Submissions** (`/school/statutory`). Three tabs.

### Readiness

Choose the examination (PLE / UCE / UACE), the term and the sitting year. The board computes, per
candidate and per subject:

| Check | Why it blocks |
| --- | --- |
| Candidate reference exists | A submission with no candidate number cannot be filed at all. |
| Candidate number is unique | Two learners on one number means one set of results goes to the wrong child. |
| Centre number recorded | The board keys the file on the centre. |
| An approved classroom score per subject | An unapproved mark is a working figure, not a result. |
| An Activity of Integration, where the programme requires one | Required for S3/S4 under the UNEB CA process. |
| Project work, where the programme requires it | Reported as a warning, not a block — schools stagger project deadlines. |
| No mark entered-but-unapproved | The commonest real cause of a short submission. |
| No approved row with neither a mark nor a terminal participation | Blank is not zero; the board would read it as one. |
| No mark above its maximum | A data-entry slip that survives to a board file is a scandal. |
| Every subject has a code | The file is keyed on subject code, not subject name. |

Everything on this screen is **derived**. It reads `StudentAssessment` and the candidate registry,
computes and writes nothing: a readiness board that could adjust a mark to make itself green would
be worse than no board.

Which components make up a CA score is read from the programme's versioned `config`
(`activitiesOfIntegration`, `projectWork`), not from a class name. A circular that adds a component
is a configuration change.

### Candidate numbers

The registry is `StudentExamReference` — one row per learner per board, level and sitting year.

It is deliberately not a column on `StudentProfile`: a learner sits PLE in one year and UCE four
years later, under different centre numbers, and each is a separate registration with its own
confirmation state. Flattening them onto the profile keeps only the last, which is exactly the
record a results enquiry needs years afterwards.

Three operations:

- **Assign numbers** across a class or the whole school, in admission-number order from a chosen
  start. A learner who already holds a number keeps it — re-running fills gaps rather than
  renumbering a registered class.
- **Record index numbers** returned by the board, pasted as two columns. Rows match on
  **candidate number, never on name**: two learners called "Nakato Sarah" in one S4 is ordinary, and
  a name match would file one candidate's national results against the other. Unmatched rows come
  back as a visible exception list rather than being dropped.
- **Reconcile against a frozen exam snapshot** (`GET /school/statutory/candidates/reconcile/:examId`).
  The snapshot is what the paper was actually sat under and is never rewritten to agree with a
  number someone edited afterwards; the differences are reported and the office decides.

Status ladder: `provisional` (the school's working number) → `registered` (submitted) →
`confirmed` (returned by the board). A confirmed index number cannot be edited — it is withdrawn
and re-registered, which leaves the change on the record.

### Files and submissions

Exports are **configurable**, because boards change their layout between circulars and a school
that must wait for a release will type the file by hand instead.

- A `StatutoryExportTemplate` chooses and renames columns from a **fixed per-scope registry**
  (`statutory.datasets.ts`). It carries no query, so no template edit can widen what leaves the
  building.
- A published template is **immutable**: editing one that has produced a file mints the next
  version, and every run pins the version it used.
- Three datasets ship: `uneb_ca` (one row per candidate per subject), `candidate_register` (the
  nominal roll) and `results_summary` (published results only — never a draft calculation).
- Three starting layouts ship as data: `UNEB_UCE_CA`, `UNEB_PLE_REGISTER`,
  `INTERNAL_RESULTS_SUMMARY`. Seeding is idempotent by code and never overwrites a school's edits.

A run refuses to produce a file while the readiness board has blocking findings. A school that has
agreed a partial submission can override, but never by accident: the override needs a reason, the
reason and every outstanding finding are recorded on the run, and **blocked candidates are left out
of the file rather than exported with blank scores** — a board reads a blank as a zero.

`StatutoryExportRun` is the record of what was sent: template + version, filters, row count, a
SHA-256 of the exact bytes, the findings that stood at the time, and — once the board acknowledges
it — the submission reference. Marking a run submitted supersedes any earlier submitted run for the
same template and term, so the record can never claim two files were both the one that was sent.

CSV details that cost schools submissions, and are now unit-tested
(`test/unit/statutory-export.spec.ts`, 26 cases): CRLF line endings, RFC 4180 quoting, dates
day-first, one-decimal scores, and a formula-injection guard so a value beginning `=`, `+`, `-` or
`@` cannot execute in the clerk's spreadsheet.

## 2. What families see

### Message history

`GET /school/portals/notifications` and **Messages** in the parent, learner and teacher portals.

A fee reminder or a results notice arrives by SMS, the phone is shared or the message is deleted,
and the family has no way to look it up again. The school's own record is the only durable copy.

Scoped to the token's user id and nothing else; `payload` is deliberately not returned, because it
carries the internal ids a notification was built from. Acknowledging a notice uses `updateMany`
with the user id in the WHERE — an `update` by id would let a caller confirm the existence of
another family's message.

### The release rules that were already in force, restated

- A mark reaches the portal only when it is `approved`, its assessment is not hidden, and
  `marksReleaseAt` has passed.
- Feedback releases independently of marks.
- Results come from published `ResultSet` revisions only.
- Every per-pupil route is `@ScopedToStudent` against the token's portal claim; the id in the URL
  is a request, not a permission.

## 3. Deadline reminders

`AcademicReminderWorker`, off unless `ACADEMIC_REMINDERS_ENABLED=true`.

The failure it prevents is mundane and expensive: a term ends with three teachers' marks unentered,
the results office finds out on publication day, and reports go out a week late or a subject short.
Nothing was going to say so beforehand — the readiness gate only speaks when asked.

Three ladders:

| Kind | Fires when |
| --- | --- |
| `assessment_due` | Work due in 3 days / today / 3 days overdue, with learners still unmarked. |
| `marks_entry_due` | Marking closed over a day ago and marks are still in draft. |
| `results_pending` | An approved result set has sat unpublished for more than two days. |

`AcademicReminderLog` is the idempotency key — one notice per (kind, subject, rung, person), ever.
The ledger row is written **before** the send and its unique index is what makes concurrent
instances safe. Each rung re-reads current state, so a teacher who entered the marks an hour ago is
not chased. In-app by default: SMS costs money in Uganda and the school pays.

## 4. Role privacy

The plan's exit gate is that users reach only their appropriate learners, courses and result states.
That splits in three, and each part now has a test:

| Claim | Enforced by | Tested by |
| --- | --- | --- |
| A route demands a grant | `PermissionsGuard` | `route-permission-coverage.spec.ts` |
| A holder owns the row | ownership guards in the handlers | `school-teacher-ownership.spec.ts` |
| A role carries the right grants | `SCHOOL_ROLE_PRESETS` | `role-presets.spec.ts` *(new)* |

`SCHOOL_ROLE_PRESETS` documented its segregation-of-duty invariants and said they were "enforced by
role-presets.spec.ts". That spec did not exist, so the invariants were a comment. Writing it found
three real defects:

1. **The Exams Officer could not run an examination.** Phase 5 shipped `school:exams:operate`,
   `:custody`, `:allocate` and `:consideration` and never added them to the preset, so a freshly
   provisioned school's exam office could not open the console that runs a sitting. Added.
2. **The Exams Officer could approve the results it computed.** The preset held both
   `school:grades:write` and `school:results:approve` — one person originating a mark and signing
   off the result it feeds, which is the self-approval the whole Phase 4/5 chain exists to prevent.
   `results:approve` removed; the Deputy Head gains it so a school with a deputy does not queue
   every mark sheet behind the head teacher.
3. **The Bursar held `invoice:write`, which is not a permission.** The catalogue has
   `create`/`update`/`post`. The grant did nothing, so a freshly provisioned Bursar could read an
   invoice and never raise one. Replaced with the three real grants.

New Phase 6 grants, and where they sit:

| Grant | Exams Officer | Head Teacher | Anyone else |
| --- | --- | --- | --- |
| `school:statutory:read` | ✓ | ✓ | — |
| `school:statutory:write` (design a layout) | ✓ | — | — |
| `school:statutory:export` (produce a file) | ✓ | ✓ | — |
| `school:candidates:write` | ✓ | — | — |

The accountant, the registrar and the front desk hold none of them: a candidate register is a list
of children with their dates of birth and national identifiers, which is a narrower audience than
the class list.

`PermissionsGuard` ANDs its requirements, so a new grant that nobody holds is a 403, not a no-op.
The Phase 6 migration therefore backfills each new grant onto the roles that already hold the
authority it splits out of.

## 5. What Phase 6 does not claim

- **No school has filed a submission through it.** The UNEB layouts here are a starting point taken
  from the published CA process, not a certified specification. Before a real deadline, a school
  must produce a file, compare it against the circular for that sitting, and adjust the template.
  The template being editable is the point.
- **The readiness rules encode the common case.** A school with an unusual subject combination or a
  board-agreed exception will find findings it must override. The override path exists and is
  recorded; it is not a bug report.
- **Deployment hold stands.** The Phase 4/5 note applies unchanged: establish the target database's
  migration baseline, back it up, rehearse this migration on a copy, and obtain UAT sign-off before
  `prisma migrate deploy`.
