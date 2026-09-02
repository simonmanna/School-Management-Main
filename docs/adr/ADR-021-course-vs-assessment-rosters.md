# ADR-021: Course Membership and Frozen Assessment Rosters

- **Status:** Proposed
- **Date:** 2026-09-02

## Context

A learner’s current placement, course eligibility and the learners who actually sat an
assessment are related but different facts. The current `AcademicRoster` is sometimes captured
directly from mutable profile fields.

## Decision

Membership flows from official enrollment → effective placement → course eligibility →
`CourseEnrollment`. Compulsory enrollment is generated; electives, opt-outs, remedial groups,
start/end dates and withdrawal reasons are explicit.

Publishing an assessment creates a roster snapshot from eligible course membership. The
snapshot freezes learner and placement identifiers plus a checksum. Later admission, transfer
or withdrawal does not mutate it; reviewed add/remove exceptions create a new roster version
before marks approval. Result computation consumes only frozen rosters.

## Consequences

Historical assessment populations remain explainable. Late admissions require an explicit
decision instead of silently appearing in an open markbook.

## Alternatives considered

Using enrollment itself as the assessment roster was rejected because participation is
assessment-specific. Re-querying current placement on every view was rejected because results
would change after student movement.
