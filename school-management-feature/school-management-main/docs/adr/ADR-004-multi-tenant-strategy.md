# ADR-004: Multi-Tenant Strategy

- **Status:** Accepted
- **Date:** 2026-06-14

## Context
The platform is multi-tenant SaaS serving many small/medium organizations. We
must guarantee tenant isolation while keeping operations and migrations simple,
and we must never retrofit tenancy later.

## Decision
**Shared database, shared schema, `organizationId` discriminator** on every
tenant-owned table. Enforcement is centralized:
- A request-scoped **`TenantContext`** built on Node `AsyncLocalStorage` carries
  `organizationId` + `userId`, resolved from the JWT (and/or an
  `X-Organization-Id` header for system actors).
- A **Prisma Client Extension** auto-injects `organizationId` into `where`/`create`
  for tenant models and rejects queries with no tenant context, so application
  code cannot accidentally read across tenants.
- A small set of **global/system tables** (e.g. `Currency`, system `Permission`
  catalog) are explicitly exempt.

## Consequences
**Positive**
- Strong isolation by default; cheap, simple ops; one migration path.
- Adding tenancy to a new table is automatic if it carries `organizationId`.

**Negative / Trade-offs**
- `$queryRaw` bypasses the extension — raw SQL must include `organizationId`
  explicitly and is a review checkpoint.
- A single noisy tenant shares resources — mitigated by indexing on
  `(organizationId, ...)` and, later, connection limits.
- **Defense-in-depth (future):** enable PostgreSQL Row-Level Security so the DB
  enforces isolation even if app code is wrong.

## Alternatives considered
- **Schema-per-tenant:** painful migrations and connection management at scale.
- **Database-per-tenant:** strongest isolation but heavy ops; reserve for large
  enterprise tenants later.
