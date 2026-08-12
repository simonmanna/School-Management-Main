# ADR-001: Modular Monolith vs Microservices

- **Status:** Accepted
- **Date:** 2026-06-14

## Context
The platform is an ERP whose core operations are *financially atomic*: posting a
document may simultaneously write a balanced journal entry (ledger) and stock
moves (inventory). These writes must succeed or fail together. We also have a
small team and need to ship a reusable core before any vertical.

## Decision
Build a **modular monolith**: a single NestJS application, a single PostgreSQL
database, one ACID transaction boundary. Modules are compile-time NestJS modules
under `apps/api/src/modules/*` (kernel under `apps/api/src/kernel/*`). They are
**not** separate deployables or separate npm packages.

Module boundaries are enforced *in code*, not by network: a CI dependency rule
(`dependency-cruiser`) fails the build if a lower layer imports an upper one
(e.g. `kernel` importing a vertical).

## Consequences
**Positive**
- Posting stays in one DB transaction — no distributed-transaction machinery.
- One schema, one migration history, one deploy. Drastically simpler ops.
- Refactoring across modules is a normal code change, caught by the type checker.

**Negative / Trade-offs**
- Boundaries are a discipline, not a wall — must be enforced by tooling + review.
- Horizontal scaling is per-process, not per-module (acceptable; scale the
  monolith and the DB; extract a service later only if a real bottleneck proves
  it).

## Alternatives considered
- **Microservices:** rejected — turns one ACID posting into a saga/2PC nightmare
  for zero benefit at this stage.
- **Separate npm packages per module:** rejected for now — build friction and a
  fragmented Prisma client with no payoff inside a single deployable.
