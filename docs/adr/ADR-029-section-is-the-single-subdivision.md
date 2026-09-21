# ADR-029: Section is the single subdivision

- **Status:** Accepted
- **Date:** 2026-09-20
- **Supersedes:** ADR-019 (Section vs Stream grouping)

## Context

ADR-019 made `Section` and `Stream` deliberately distinct, so a school could run
a two-level subdivision: `S1 → Section A → Stream East`. `GroupingMode`
(`NONE | SECTION_ONLY | STREAM_ONLY | SECTION_AND_STREAM`) told the system which
of the two a given cohort actually used.

In practice the distinction has not paid for itself, and it has cost a great deal:

- **The user-facing names are inverted.** `apps/web/src/pages/school/sections.tsx`
  is titled "Streams" and describes "P4 West, P4 East"; `streams.tsx` is titled
  "Streams (legacy)". The nav exposes both. Users pick the wrong one.
- **Two services conflate them anyway.** `assessment/gradebook.service.ts:398-411`
  and `examinations/marks-workspace.service.ts:691-727` both resolve a roster with
  `OR: [{ currentSectionId: x }, { currentStreamId: x }]`, because neither can tell
  which table "P4 West" was stored in. A mark-entry roster keyed on a guess is not
  a roster.
- **`useClassSubdivisions` exists purely to paper over it**, merging sections and
  streams client-side and de-duplicating by lowercased name.
- **The two levels are not carried consistently.** `sectionId` travels the whole
  pipeline; `streamId` stops at placement and the timetable.

Meanwhile the requirement the two levels were built for — an arbitrary,
school-configurable subdivision of a class, named North/South/East/West or A/B/C
or Red/Blue/Green — needs exactly one level, not two.

## Decision

`Section` becomes the single subdivision of a class. The legacy `Stream` table is
retired.

`GroupingMode` is deleted rather than narrowed. Its replacement is a boolean where
a boolean is what was always meant:

```
SchoolClass.allowsStreams   Boolean   // the school-wide default for this class
ClassCohort.allowsSubdivision Boolean? // per-year override
```

Mapping: `NONE → false`; `SECTION_ONLY`, `STREAM_ONLY`, `SECTION_AND_STREAM → true`.

The word "Stream" survives where it belongs — in the user interface — through
per-school terminology configuration (ADR-030 companion work). A school that calls
them Streams, Houses, Sections or Classes sees its own word, including in API
error messages, because the defaults live in `packages/shared/src/terminology.ts`
and feed both sides.

### Cohorts genuinely using both levels

`SECTION_AND_STREAM` cohorts use two levels, and collapsing to one loses
information. Those are **flattened with provenance, not refused**:

- One `Section` is synthesized per *used* (section × stream) pair — pairs carrying
  no placement are skipped, so the flatten cannot explode N×M.
- `StreamSectionMigrationMap`, `Section.legacyStreamId` and
  `Section.legacyParentSectionId` survive permanently, so a historical report can
  still reconstruct the old two-level roll-up.
- A name collision is queued as an `AcademicMigrationException` and **never
  auto-suffixed**. A silently renamed class list is worse than a visible refusal.

Refusing these cohorts outright was considered and rejected: it would leave those
schools with a broken roster and no path forward.

## Consequences

- One subdivision concept, one table, one picker, one word per school.
- The two roster-conflation hacks are deleted, which is a correctness fix, not
  just a simplification.
- The conversion is the highest-risk step in the programme. It ships alone, runs
  as dry-run-by-default application code (per ADR-027: run-id tagged, exception
  queue, reconciliation), and is gated on a per-`(classCohort, term)` headcount
  matching exactly before and after.
- It is the only step whose rollback is a script rather than a revert, which is
  why `StreamSectionMigrationMap` is permanent rather than temporary.
- `CourseOfferingAudienceScope.STREAM` is remapped to `SECTION` in data before the
  enum value is removed, because a Postgres enum value cannot be dropped without
  recreating the type.
- Reports keep accepting `streamId` as a deprecated alias for `sectionId`, so
  saved report configurations and the portal keep working across the change.

## Alternatives considered

**Rename `Section` to `Stream` in the database.** Honest naming, but it rewrites
`sectionId` across roughly 100 API files, both clients, the reports contract, the
RLS policies and the Phase-1 backfill — a very large diff that changes no
behaviour. Terminology configuration gets the same user-visible result for a
fraction of the risk.

**Keep both levels and fix only the labels.** Rejected: it leaves the two
conflation hacks in place, and those are producing wrong rosters today.
