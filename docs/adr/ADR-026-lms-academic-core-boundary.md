# ADR-026: LMS as a Consumer of the Academic Core

- **Status:** Proposed
- **Date:** 2026-09-02
- **Supersedes in part:** ADR-014 wherever that ADR permits LMS-owned enrolment truth

## Context

The Moodle-shaped layer has its own course enrolment and gradebook-shaped services. The revised
architecture makes official enrollment, CourseOffering and Assessment the sources of truth.

## Decision

LMS is an optional delivery adapter. It consumes identity, course membership and offering
ownership from the academic core. A grade-bearing LMS activity owns one Assessment and writes
through the canonical marking service; it never stores an authoritative grade. Completion,
navigation, discussion, SCORM and LTI state may remain LMS-owned but cannot publish results.

Advanced LMS is deployment-gated by `ENABLE_ADVANCED_LMS`, default false. Core offerings,
lesson plans and assignments are not disabled with it. Integration messages carry idempotency
keys and stable core identifiers. A nightly check reports orphan modules and membership drift.

## Consequences

Schools can run the academic core without Moodle-shaped features and enable them after a proven
term. Existing LMS enrolments become projections and must be reconciled.

## Alternatives considered

Letting the LMS remain a peer source of grades/enrolment was rejected. Removing the LMS entirely
was rejected because its delivery capabilities remain useful behind a controlled boundary.
