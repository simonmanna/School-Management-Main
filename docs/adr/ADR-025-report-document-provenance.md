# ADR-025: Report-Document Provenance

- **Status:** Proposed
- **Date:** 2026-09-02

## Context

The current `ReportCard` stores JSON and timestamps but does not bind output to a ResultSet
revision and template version, so a PDF cannot always be reproduced.

## Decision

Introduce `ReportDocument` keyed by learner, ResultSet revision, report type and template
version. Store payload checksum, generated actor/time, publication status/time, output file
reference/checksum and optional `supersededById`. The rendering payload is frozen; regeneration
with the same renderer version must match or create a diagnosed exception.

Only published results produce publishable reports. A new result revision produces new
documents and supersedes, rather than overwrites, prior documents. Portal downloads resolve an
explicit published document.

## Consequences

Every report answers which results/template produced it and whether it was superseded. Template
versions and renderer versions become retained records.

## Alternatives considered

Regenerating from current settings was rejected because it changes old reports. Storing only a
PDF was rejected because it cannot prove the calculation/input provenance.
