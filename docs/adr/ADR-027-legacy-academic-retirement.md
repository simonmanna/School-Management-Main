# ADR-027: Legacy Academic Retirement Strategy

- **Status:** Proposed
- **Date:** 2026-09-02

## Context

Legacy mark, homework, report and placement structures cannot be removed safely in the same
release that introduces replacements. Permanent dual-write is equally unsafe.

## Decision

Retire each legacy path through: inventory → mapped backfill → reconciliation → legacy
read-only enforcement → new UI activation → adoption telemetry → one successful production
cycle → deletion proposal. Dual-read is allowed for one compatibility release. Dual-write is
allowed only inside one transactional adapter with parity telemetry and a dated removal ticket.

Each migration is tenant-scoped, idempotent, dry-run by default, run-id tagged and produces old,
mapped, unmapped, duplicate, score, roster, approval and published-result differences. Unknown
records enter an exception queue. Rollback restores the pre-migration snapshot after disabling
new writers; published facts are never down-migrated destructively.

## Consequences

Cutovers take longer but are observable and reversible. DELETE remains unavailable in the
Phase 0.5 classification register.

## Alternatives considered

A flag-day rewrite was rejected due to academic-record risk. Indefinite compatibility was
rejected because it preserves multiple truths.
