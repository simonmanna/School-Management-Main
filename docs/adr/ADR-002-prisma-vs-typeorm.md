# ADR-002: Prisma vs TypeORM

- **Status:** Accepted
- **Date:** 2026-06-14

## Context
We need a type-safe data layer with first-class migrations and a clean way to
implement cross-cutting concerns (tenancy, soft-delete, audit) once, centrally.

## Decision
Use **Prisma 6** with PostgreSQL. Cross-cutting behaviour is implemented with
**Prisma Client Extensions** (`$extends`) — not the deprecated `$use` middleware.
Heavy reporting queries use `$queryRaw` / SQL views.

## Consequences
**Positive**
- Best-in-class generated types; the compiler is our main safety net for a small
  team.
- `prisma migrate` gives explicit, reviewable schema history.
- Client extensions let us enforce `organizationId` filtering, soft-delete, and
  audit stamping in *one* place so application code can't forget them.

**Negative / Trade-offs**
- One central `schema.prisma` is in slight tension with per-module ownership — we
  mitigate with clear ownership sections/comments (and may adopt Prisma's
  multi-file schema later).
- Some complex SQL must drop to `$queryRaw`; raw queries bypass the tenancy
  extension, so they require explicit `organizationId` predicates + review.

## Alternatives considered
- **TypeORM:** richer raw/QueryBuilder and Active Record, but weaker type-safety,
  more runtime footguns, and a less ergonomic migration story.
- **Drizzle / Knex:** lighter, but less batteries-included for migrations and
  relations at ERP scale.
