# ADR-020: CourseOffering as the Learning Offering

- **Status:** Proposed
- **Date:** 2026-09-02

## Context

Academic work currently reaches classes, subjects and LMS courses through multiple paths.
Subject-only `CourseOffering` cannot describe competencies, remedial groups or school-wide and
co-curricular learning without orphan assessments.

## Decision

Keep the physical `CourseOffering` model and broaden its meaning. Add types `SUBJECT`,
`LEARNING_AREA`, `COMPETENCY`, `SCHOOL_WIDE`, `CO_CURRICULAR`, `REMEDIAL` and
`CLUB_OR_HOUSE`. Every offering has organization, year, term, programme, audience/roster,
responsible staff, effective dates and lifecycle status.

Subject/learning-area offerings require a subject and published curriculum version; competency
offerings require a framework; co-curricular offerings require an activity definition. All
assessments, lesson timetable slots and lesson plans reference an offering before publication.

## Consequences

One context owns teaching, permissions and eligibility. Nullable type-specific references need
conditional database and service constraints. Existing subject offerings backfill as `SUBJECT`.

## Alternatives considered

A new `LearningOffering` table was rejected due to migration risk. Independent competency and
club assessment stores were rejected because they create parallel truths.
