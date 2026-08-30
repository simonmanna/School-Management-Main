# Prisma migrations — layout

## `migrations/` — the live set

The only directory Prisma reads. 109 folders, from
`20260727120000_squashed_baseline` (the whole schema as of the 2026-07-27
consolidation, plus `..._rls_and_triggers` holding the RLS policies and triggers
preserved verbatim through the squash) to
`20260830120000_reconcile_manual_ddl`.

**Invariant:** this folder must reproduce `schema.prisma` exactly.

### The invariant was broken, and how

Between 2026-08-25 and 2026-08-30 several schema changes were applied to the
working database with hand-run psql scripts instead of migrations —
`EmergencyContact`, `StudentCategory` + `StudentProfile.studentCategoryId`,
`Nationality`, the front-desk `Complaint`/`PhoneCall` tables, five HR phases and
two messaging phases. `schema.prisma` was updated to match, so the code and the
working database agreed and everything looked healthy. `prisma migrate deploy`
into an empty database, however, produced a schema the code could not run
against: 12 missing tables, 5 missing enums and 53 missing columns.

That failure mode is invisible until a second environment is provisioned, which
is the worst moment to find it. `20260830120000_reconcile_manual_ddl` folds the
whole difference back in; the superseded scripts are kept under
`superseded-ddl/` for provenance and must not be re-run.

**Never apply schema changes with psql.** If a migration is awkward to author,
that is a reason to work out the migration, not a reason to route around it.

### Verifying

Prove it from empty, which is the property that actually matters:

```bash
psql -d postgres -c "DROP DATABASE IF EXISTS schooldb_deploy_probe;" -c "CREATE DATABASE schooldb_deploy_probe;"
DATABASE_URL="postgresql://USER:PASS@localhost:5432/schooldb_deploy_probe" npx prisma migrate deploy
npx prisma migrate diff --from-url "postgresql://USER:PASS@localhost:5432/schooldb_deploy_probe" --to-schema-datamodel prisma/schema.prisma --exit-code
```

`No difference detected.` is the pass condition. Verified green on 2026-08-30
against all 109 migrations.

On a database that already received the hand-run DDL, record the reconciliation
as applied rather than running it — the objects are already present:

```bash
npx prisma migrate resolve --applied 20260830120000_reconcile_manual_ddl
```

Use `db:deploy` (`prisma migrate deploy`) anywhere shared. `db:migrate`
(`migrate dev`) authors new migrations and will happily paper over drift — keep
it for local authoring only.

## The two archives

These are **two different vintages, not a duplicate**. The names differ only by
a separator, which is confusing but historical — neither is a typo of the other,
and there is zero filename overlap between them. Do not delete either without
reading this first.

| Directory | Span | Count | Git |
| --- | --- | --- | --- |
| `migrations-archive/` (hyphen) | 2026-06-13 → 2026-07-04 | 46 | tracked |
| `migrations_archive/2026-07-27_pre-consolidation/` (underscore) | 2026-07-04 → 2026-07-27 | 20 | untracked |

Read them as chronological layers: the hyphen directory holds everything retired
by the first squash, the underscore directory everything retired by the second.
They are history only — Prisma never reads them, and replaying them will not
build the current schema. `migrations/` is the sole source of truth.
