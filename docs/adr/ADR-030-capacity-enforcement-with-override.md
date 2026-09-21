# ADR-030: Capacity is enforced, with an audited override

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

`PlacementService.capacityWarnings` reports capacity but never blocks. The
rationale is recorded in the code (`placement.service.ts:180-186`) and it is a
good one:

> Capacity is reported, not enforced. A Ugandan school that must seat a late
> admission in an over-subscribed P5 needs the placement to succeed and the
> over-subscription to be visible — a hard block would just be worked around by
> editing the capacity field.

That argument is right about the failure mode and wrong about the remedy. Under
warn-only, the over-subscription is visible in a response the caller can ignore,
and nothing records that anyone decided to exceed the limit. Under a naive hard
block, the registrar edits `capacity` from 40 to 41 and the school loses the
number it was trying to enforce. Both outcomes destroy the same information.

There is also a correctness bug independent of policy: `SELECT count(*)` followed
by an insert is not serialisable under `READ COMMITTED`, so two clerks can both
seat the 41st pupil even when capacity is checked.

## Decision

Capacity is **enforced by default**, and exceeding it requires an explicit,
audited override.

- Enforcement lives in exactly one place: `appendPlacement()` in
  `placement.service.ts`. Every command — create, move, bulk, term rollover,
  promote, repeat — funnels through it. Enforcing anywhere else means enforcing in
  six places and missing the seventh.
- `null` capacity means unlimited and stays that way. Capacity is never mandatory
  (brief §11).
- Class capacity resolves as `ClassCohort.capacity ?? SchoolClass.defaultCapacity`.
- A violation throws `409` unless the caller holds
  `school:enrollment:capacity:override` **and** supplies a non-empty reason. The
  override writes `EnrollmentPlacement.capacityOverriddenById`,
  `capacityOverrideReason` and an `AuditService.recordInTx` row in the same
  transaction as the placement.
- The race is closed with `pg_advisory_xact_lock(hashtext(cohortId))` taken before
  the count, inside the existing transaction. Transaction-scoped, auto-released,
  no new table.

Bulk paths preview before they commit. The preview runs the full validation set in
a rolled-back transaction and returns a per-target **aggregate** projection
(`openNow`, `incoming`, `capacity`, `overflow`) alongside per-row results — the
aggregate is load-bearing, because row-by-row checks let forty rows each pass
while the batch of forty-one overflows. Commit re-validates against a
`previewToken` and runs every row in one transaction; any violation aborts all of
it.

## Consequences

- The school keeps its configured number, and exceeding it becomes a recorded
  decision by a named person with a stated reason, rather than either an ignored
  warning or a quiet edit to the limit.
- Segregation holds: the grant is separate from `school:enrollment:write`, so
  seating over capacity can be delegated independently of ordinary enrollment.
- **The new grant must be backfilled onto every role already holding
  `school:enrollment:write` or `school:programmes:write` in the same migration.**
  `PermissionsGuard` ANDs its requirements, so shipping the grant without the
  backfill would 403 every registrar on day one.
- A `CAPACITY_ENFORCEMENT=false` environment flag reverts to warn-only without a
  deploy, so a pilot school is never blocked by this change at an inconvenient
  moment.
- Existing callers that relied on placements always succeeding will now see 409s.
  This is the intended behaviour change and is covered by updated specs.

## Alternatives considered

**Keep warn-only.** Rejected: the brief requires enforcement, and the original
rationale is satisfied by the override rather than by not enforcing.

**Enforce with no override.** Rejected for exactly the reason the original comment
gives — it converts a policy into a workaround, and the workaround destroys the
configured capacity.

**Enforce at each call site.** Rejected: six call sites today, and the seventh
added later would silently skip the check.
