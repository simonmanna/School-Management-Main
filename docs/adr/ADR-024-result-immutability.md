# ADR-024: Immutable ResultSet Revisions

- **Status:** Proposed
- **Date:** 2026-09-02

## Context

Marks are working facts; published results are controlled calculations consumed by reports,
portals and promotion. Recomputing in place would change the historical record.

## Decision

`ResultSet` is the published truth. Each revision snapshots roster, assessment policy, grading,
ranking, promotion, calculation version and input/output checksums. It follows
`COMPUTED_DRAFT → REVIEWED → APPROVED → PUBLISHED → LOCKED → ARCHIVED`. Published and later
states are immutable at the database layer.

A correction requires evidence, approval, an append-only mark adjustment, recomputation and a
new revision. The prior revision is archived, remains queryable and is never updated. Consumers
must identify the exact revision they used.

## Consequences

Published output is reproducible and disputes have an evidence chain. Storage grows by revision,
which is accepted. Reads must deliberately select latest-published or an explicit revision.

## Alternatives considered

Updating a published row and relying on audit logs was rejected because audit cannot reproduce
all prior derived rows. Publishing raw marks was rejected because policy is part of the result.
