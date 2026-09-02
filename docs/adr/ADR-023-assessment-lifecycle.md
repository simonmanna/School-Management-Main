# ADR-023: Assessment Lifecycle and Learner Evidence

- **Status:** Proposed
- **Date:** 2026-09-02

## Context

Existing assessment and marking states do not fully express release, returned work or the
difference between missing, absent and zero.

## Decision

Assessment follows `DRAFT → PUBLISHED → OPEN → CLOSED → MARKING → SUBMITTED → APPROVED →
RELEASED → ARCHIVED`; returned work follows `SUBMITTED → RETURNED → MARKING`. Publication
requires an offering, immutable policy version and frozen roster.

`StudentAssessment` owns participation (`PRESENT`, `ABSENT`, `EXEMPT`, `MISSING`, `WITHDRAWN`,
`NOT_ENROLLED`, `SPECIAL_CONSIDERATION`), original/effective score, marker, submitter, approver,
evidence and version. Blank is never zero; aggregation semantics come from the snapshotted
policy. Score bounds and maker-checker separation are enforced server-side and in the database
where possible. Approved marks change only through adjustments.

## Consequences

The workflow becomes explicit and auditable. Existing lower-case enum values require a safe
mapping rather than in-place assumptions.

## Alternatives considered

One “graded” state was rejected because it hides approval and release. Encoding absence as zero
was rejected because it destroys evidence and changes policy into data entry behaviour.
