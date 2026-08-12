# ADR-003: Event Bus Design

- **Status:** Accepted
- **Date:** 2026-06-14

## Context
Modules must react to each other without depending upward (e.g. a future loyalty
module reacts to `sale.confirmed` without POS knowing it exists). The money path
must stay transaction-safe.

## Decision
A **typed, in-process event bus** wrapping `@nestjs/event-emitter`
(`EventEmitter2`). Event names and payload types live in `@erp/shared` so both
publishers and subscribers share one contract.

Two delivery modes:
- **Synchronous, money-critical path:** call a service interface directly inside
  the same DB transaction (NOT events) — atomicity is non-negotiable.
- **Side effects:** domain events are **collected during a transaction and
  dispatched after commit**, so subscribers never see events for rolled-back work.

## Consequences
**Positive**
- Decoupled side effects; verticals extend behaviour with zero upward coupling.
- Post-commit dispatch avoids "phantom" events from failed transactions.

**Negative / Trade-offs**
- In-process only — not durable across crashes or processes. When durability or
  cross-process delivery is needed, add a **transactional outbox** + broker
  (future ADR). Handlers should be written idempotently in anticipation.

## Alternatives considered
- **External broker (Kafka/RabbitMQ) now:** rejected — operational overhead before
  any scaling need.
- **`@nestjs/cqrs`:** heavier than required for current needs; revisit if/when we
  adopt full CQRS.
