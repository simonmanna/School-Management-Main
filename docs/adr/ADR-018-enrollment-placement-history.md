# ADR-018: Enrollment and Placement History

- **Status:** Proposed
- **Date:** 2026-09-02

## Context

`StudentProfile.currentClassId/currentSectionId/currentStreamId` describes where a learner is
now, while `Enrollment` mixes membership and a term placement. Overwriting either destroys the
history needed for transfers, repeaters, late admissions, withdrawals and old results.

## Decision

Introduce `StudentEnrollment` as official membership in an academic programme/year and
append-only effective-dated `EnrollmentPlacement` rows for term, annual cohort, section and
stream. A movement end-dates the prior placement and creates another in one transaction.
Exactly one placement may be effective for an enrollment at a timestamp. Current profile fields
remain temporary projections derived from the newest placement and are not academic truth.

Enrollment states are pending, active, suspended, withdrawn, transferred, completed and
cancelled. Transition commands require reason, actor and audit record. Frozen rosters retain
withdrawn learners historically.

## Consequences

Point-in-time membership becomes reconstructable. Existing class-based consumers require a
staged migration and projection compatibility window. Overlap prevention must exist in both
service validation and a database exclusion/constraint strategy.

## Alternatives considered

Keeping one mutable class field was rejected because it rewrites history. One enrollment per
term was rejected because it conflates continuing school membership with placement.
