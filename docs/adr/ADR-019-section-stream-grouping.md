# ADR-019: Section and Stream Grouping Modes

- **Status:** Superseded by ADR-029
- **Date:** 2026-09-02

## Context

Schools use “section” and “stream” differently. The current schema ties both to a class but does
not state whether both are active or whether a stream belongs to a section.

## Decision

Configure each programme/cohort with `NONE`, `SECTION_ONLY`, `STREAM_ONLY` or
`SECTION_AND_STREAM`. Section and Stream always belong to the same annual class cohort. In the
combined mode Stream also belongs to the selected Section. Placement, timetable, offering,
attendance and roster snapshots carry the same validated grouping tuple.

Names such as “P5 A” are display labels, not grade levels. Changing grouping mode is versioned
by academic year and is blocked after dependent published rosters exist unless a reviewed
migration is supplied.

## Consequences

The system supports local terminology without merging distinct concepts. Existing streams need
a backfill to their section in combined-mode schools, with unmapped rows sent to an exception
queue.

## Alternatives considered

Merging both tables was rejected because it cannot represent nested grouping. Free-form group
labels were rejected because they cannot enforce cross-class integrity.
