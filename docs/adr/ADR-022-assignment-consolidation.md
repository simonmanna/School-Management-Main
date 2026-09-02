# ADR-022: Assignment Consolidation

- **Status:** Proposed
- **Date:** 2026-09-02

## Context

`HomeworkAssignment/HomeworkSubmission`, canonical `Assignment/AssignmentSubmission`, quizzes
and LMS activities can all carry marks. Independent delivery tables risk independent grade
stores.

## Decision

Every grade-bearing task owns exactly one canonical `Assessment`. `Assignment` is its one-to-one
delivery detail and `AssignmentSubmission` stores attempts and artefacts. Participation,
effective score, approval and rubric truth stay on `StudentAssessment` and its ledgers.

Migrate homework by existing `assessmentId`, preserving learner, attempt number, timestamps,
feedback, attachments, score and approval. Adapters may dual-read for one release but all legacy
writes become read-only before cutover. Unmapped records enter an exception queue.

## Consequences

Teachers get one assessment board and result calculations get one input. Migration must verify
file access and attempt numbering, not only row counts.

## Alternatives considered

Keeping homework as a separate gradebook was rejected. Deleting legacy tables immediately was
rejected because a successful production cycle is required first.
