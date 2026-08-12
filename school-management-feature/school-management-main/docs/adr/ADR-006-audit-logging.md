# ADR-006: Audit Logging Design

- **Status:** Accepted
- **Date:** 2026-06-14

## Context
ERP data is financially and legally sensitive. We must answer "who changed what,
when, and from what to what" for both data mutations and domain actions.

## Decision
**Centralized audit** with two complementary capture points:
1. **Data mutations** (`CREATE`/`UPDATE`/`DELETE`) captured generically via a
   Prisma Client Extension / interceptor, recording `oldValues` and `newValues`.
2. **Domain actions** (`LOGIN`/`APPROVE`/`POST`/`CANCEL`) recorded explicitly by
   services, because they carry meaning beyond a row diff.

The `AuditLog` entity stores: `organizationId`, `entity`, `entityId`, `action`,
`oldValues` (JSONB), `newValues` (JSONB), `actorId`, `ipAddress`, `userAgent`,
`createdAt`. Writes happen **after commit**.

## Consequences
**Positive**
- Uniform, queryable trail across every module for free.
- Storing JSON diffs keeps rows compact and searchable.

**Negative / Trade-offs**
- Write amplification on hot tables — mitigate with after-commit async writes and
  by storing diffs (not full snapshots) where practical.
- Sensitive fields (passwords, tokens) must be **masked** before persisting.

## Alternatives considered
- **Database triggers:** DB-coupled, invisible to app logic, hard to test.
- **Full event sourcing:** powerful but overkill for current needs and a large
  modeling cost.
