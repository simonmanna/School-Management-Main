# ADR-015 — Configurable Admission Workflow

**Status:** Accepted
**Date:** 2026-08-27
**Supersedes:** the auto-advance proposal in `docs/school-admissions-revised-plan-v3.md` §4
**Related:** ADR-007 (workflow engine), ADR-011 (vertical extension contract), ADR-006 (audit logging)

## Context

The admission pipeline was a fixed 18-state FSM. Every school had to walk
`Application → Evaluation → Decision → Offer → Applicant Acceptance → Enrollment`, because
`ADMISSION_TRANSITIONS` allows `enroll` only from `offer_accepted`.

Schools differ. A village primary admits on the spot; a selective secondary runs screening,
interview and an entrance exam. Neither is served by one hardcoded path.

## Decision

### 1. Two concepts, kept apart

```
Workflow config  →  "Which business stages does this school require?"   CONFIGURABLE
Eligibility      →  "What must be true before the operation can run?"   NEVER
```

Configuring `Application → Enrollment` removes *stages*. It never removes verified
documents, the application fee, capacity, FSM legality, atomicity, audit or permissions.

### 2. Nothing is synthesized

The rejected alternative walked the FSM writing intermediate rows
(`submitted → under_review → accepted → offer_issued → offer_accepted → enrolled`), flagging
them `auto`. It looked clever and is wrong: `status = offer_issued` has a business meaning.
Reports, exports, filters, notifications and future modules read `status === 'offer_issued'`
without checking a companion flag, so the funnel would claim offers that were never made,
and `AdmissionOffer` would be absent for an application whose status says it has one.

**A skipped stage leaves no trace of having happened.** Skipping is expressed as
authorization for one REAL transition, with `AdmissionStatusHistory.skippedStages` recording
what it bypassed. Under the Simple workflow an enrolment writes exactly one row,
`submitted → enrolled`, and creates no `OfferLetter`, `AdmissionDecision` or `AdmissionFee`.

### 3. Workflow config may ADD an edge, never redefine the FSM

`ADMISSION_TRANSITIONS` remains the canonical domain state machine and is not rewritten.
`assertTransition(current, action, workflowAllowed)` takes a narrowly-scoped extension from
`AdmissionsWorkflowService.shortcutAllowed()`, which:

- returns only actions belonging to the application's `nextRequiredStage`;
- fires only when at least one intervening stage is configured `skip` — never merely
  because prior stages are complete;
- never returns a terminal or branch action (`withdraw`, `decline_offer`, `expire_offer`,
  `request_documents`);
- never fires from `draft`, so **ENROLLMENT can never be entered from an unsubmitted
  application, whatever the configuration says**.

### 4. Three stage modes

| Mode | Blocks progression? | In the UI? | FSM action still legal? |
|------|--------------------|------------|-------------------------|
| `required` | yes | yes | yes |
| `optional` | no | yes, labelled Optional | yes |
| `skip` | no | hidden | **yes** |

`skip` means "not required", never "forbidden": the workflow only ever adds an authorized
shortcut and hides UI affordances. A Simple-workflow school can still walk `review → reject`.

A **stage's** mode decides whether completing it is mandatory. A **step's** mode applies only
if the parent stage is entered, and says which activity evidences completion. `sanitizeStages`
rejects a `required` EVALUATION with no `required` activity — a gate nothing could satisfy.

### 5. Completion is artifact-based and monotonic, not a status rank

Admission statuses branch, so a numeric rank hides real structure. Each stage has an explicit
predicate reading the artifact that proves it happened, and terminal state is checked first:

```
isTerminal(status)  →  nextRequiredStage: null, no actions
an OfferLetter row  ⇒  a decision was taken
offerAcceptedAt     ⇒  an offer existed to accept
enrolled            ⇒  every stage happened
```

`offer_expired` is **not** terminal: `offer_expired → issue_offer` is legal, so an expired
offer leaves OFFER incomplete and the next required stage is OFFER — a reissue. An offer the
applicant already accepted stays complete regardless of `expiresAt`.

### 6. The snapshot is the authority

`AdmissionCycle.workflowId` governs applications created **from now on**.
`AdmissionApplication.workflowSnapshot` — `{ version, presetKey, workflowName, stages[] }` —
is written once at creation and never updated. `AdmissionApplication.workflowId` is
provenance only; progression logic must never resolve a workflow through it, or an in-flight
application would be re-exposed to later edits of that row.

`version` is the JSON schema version, not a workflow revision. A null snapshot resolves to
`BUILTIN_STANDARD`, a frozen constant in the registry rather than the organisation's
"Standard" database row — so editing that row cannot retroactively change historical
applications.

### 7. The API answers; the UI renders

`GET /school/admissions/:id/workflow` returns stage state, `nextRequiredStage`,
`requiredActions`, `optionalActions`, `alwaysAvailable` and `eligibility`. The client picks
which buttons exist from the action lists and whether they are enabled from `eligibility`.
It never recomputes skip logic from raw stage modes.

`requiredActions` may legitimately be empty while the application is not stuck: under
Standard at `submitted`, Decision is next but the operator gets there through the optional
`review`. That is why `optional` means *available but non-blocking*, not *ignored*.

These lists are guidance, never authorization. Every mutating endpoint independently re-runs
permissions → FSM legality → workflow → eligibility.

## Capacity state contract

Fixed alongside this work, because the ledger became load-bearing.

| Field | Meaning | Changes when |
|-------|---------|--------------|
| `capacity` | declared seats for (cycle, class, section, stream) | admin sets it |
| `reservedCapacity` | seats held back from admissions | admin sets it |
| `claimedSeats` | **the seat ledger** — every seat held by a committed or in-flight enrolment | `+1` in the enrol transaction; `−1` when the enrolment ends; re-claimed on re-enrolment |
| `occupied` | derived `Enrollment.count` | **reporting and reconciliation only** |
| `available` | `capacity − reservedCapacity − claimedSeats` | derived |

Seats are consumed **only at enrolment** — acceptance, offer issue and offer acceptance
consume nothing, so an over-issued offer round is possible by design and is caught at the
enrol gate.

Two defects this replaced:

- The guard was `claimedSeats < capacity − reserved − occupied`. A committed seat lands in
  *both* counters, so a capacity-2 class admitted one student sequentially. The original
  verification only ran parallel requests, where every racer read `occupied = 0` before any
  committed, so it never showed.
- The release hung off `applyReview('withdraw')` from status `enrolled` — a **terminal**
  admission status, so it could never fire, and it filtered on `sectionId`/`streamId`
  columns that do not exist on `AdmissionApplication`. Seats were never returned, and a
  class shrank permanently every time a student left. The release now lives in
  `EnrollmentService.endEnrollment`, keyed by the enrolment's own class/section/stream.

## Consequences

- Analytics must report **required · completed · pending · skipped** per stage. Reading
  `offered: 0` under a Simple workflow as "nobody received an offer" is wrong; it means the
  stage is not part of that process. `funnel().stageCoverage` carries this.
- The pipeline list resolves each row's actions server-side, costing one extra query per
  page rather than an N+1 of per-application requests.
- Workflow mutation is gated on the existing `school:admissions:write`. A finer-grained
  `school:admissions:workflow` is registered but **not enforced**: `PermissionsGuard` ANDs
  its requirements and the admissions sub-grants are dormant pending a role backfill, so
  enforcing a new grant would lock out every current administrator.
- Workflows are archived (`active = false`), never hard-deleted, and archiving is refused
  while any cycle or application references one. Configuration is history.
- Migrating an existing application to a different workflow is deliberately **not**
  supported. If it is ever needed it must be an explicit, audited operation recording the
  old snapshot, the new one, a reason and an actor — never a silent mutation.
