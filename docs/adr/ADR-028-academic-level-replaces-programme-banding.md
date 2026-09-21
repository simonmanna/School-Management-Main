# ADR-028: Academic Level replaces programme banding

- **Status:** Accepted
- **Date:** 2026-09-20
- **Supersedes:** the grade-banding half of ADR-019

## Context

A school's academic structure has a band above the grade — Pre-Primary, Primary,
Secondary, Vocational. The system has no entity for it. The closest thing is
`AcademicProgramme`, which carries three different jobs at once:

1. which grade levels belong together (`ProgrammeGradeLevel`),
2. which curriculum authority and stage apply (`stage`, `curriculumAuthority`),
3. the versioned assessment/ranking/report configuration (`config`).

Job 1 is banding. Jobs 2 and 3 are rules. Conflating them means a school that
wants to rename its band, reorder it, or deactivate it is editing the same row
that decides how marks are computed. It also means there is no entity to hang
`displayOrder`, `isActive` or a description on, which the Academic Structure
screen needs.

`ProgrammeGradeLevel` additionally carries `@@unique([organizationId, gradeLevelId])`,
which is load-bearing: it is what makes `gradeLevel → programme` resolution
deterministic for `StudentEnrollment.programmeId`. Any change has to preserve
that determinism or enrollment breaks.

## Decision

Introduce `AcademicLevel` as the banding entity:

```
AcademicLevel(id, organizationId, name, code, description, displayOrder,
              isActive, stage, defaultProgrammeId)
GradeLevel.academicLevelId → AcademicLevel
```

`AcademicProgramme` keeps only jobs 2 and 3 — curriculum authority and versioned
assessment configuration. `AcademicLevel.stage` takes over the band's stage.

Programme resolution becomes a one-hop equivalent of the old two-hop path:

```
before:  gradeLevel → ProgrammeGradeLevel → programme
after:   gradeLevel → academicLevel → defaultProgrammeId
```

Determinism is preserved by construction: a grade level has exactly one level,
and a level has exactly one default programme.

`ProgrammeGradeLevel` is **dropped**, not repointed at `AcademicLevel`.
Repointing would duplicate `AcademicLevel.defaultProgrammeId` and reintroduce two
places that answer "which programme is this learner under" — the precise failure
this change exists to remove.

## Consequences

- The Academic Structure screen gets a real band to group and order classes under,
  configurable per school, with no grade names in code.
- Nursery, primary, secondary, A-level and vocational are all the same shape, so
  the model extends without schema change (brief §47).
- Migration must run in a specific order and cannot be done in one step. The
  backfill creates one `AcademicLevel` per `AcademicProgramme` that actually bands
  grade levels, so no school silently loses a distinction it already made. Grade
  levels with no programme band raise an `AcademicMigrationException` rather than
  being assigned an invented level.
- `GradeLevel.academicLevelId` stays nullable until the exception queue is drained;
  only then does it become `NOT NULL`.
- The resolver keeps `ProgrammeGradeLevel` as a warning-logged fallback for several
  releases. A parity spec requires zero divergence between the two paths before the
  table is dropped.
- `ProgrammeStage` gains `PRE_PRIMARY` and `PRIMARY`. Because Postgres cannot add
  an enum value and use it in the same transaction, that addition ships in its own
  migration file.

## Alternatives considered

**Reuse `AcademicProgramme` as the level.** Cheapest option, and it was considered
seriously: the fields nearly line up. Rejected because the brief requires a band
that an administrator can rename, reorder and deactivate freely, and doing that to
a row that also holds assessment configuration couples two unrelated decisions.

**Add `AcademicLevel` but keep `ProgrammeGradeLevel` as the banding table.**
Rejected: two sources of truth for the same question, which is the state this
redesign is unwinding.
