# Prisma migrations — layout

## `migrations/` — the live set

The only directory Prisma reads. Currently a 5-folder baseline:

| Folder | What |
| --- | --- |
| `20260727120000_squashed_baseline` | The whole schema as of the 2026-07-27 consolidation |
| `20260727120001_rls_and_triggers` | RLS policies + triggers, preserved verbatim through the squash |
| `20260731090000_approval_workflow_multistep` | Multi-step approval chains |
| `20260731093000_rls_all_org_scoped_tables` | Catalog-driven RLS sweep over every `organizationId` table |
| `20260731094500_cogs_correction_movement_type` | COGS correction movement type |

**Invariant:** this folder must reproduce `schema.prisma` exactly. CI enforces it
("Schema drift check"). Verify locally against a scratch database:

```bash
pnpm --filter @erp/api exec prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url "postgresql://postgres:postgres@localhost:5432/pos_cafe_drift_shadow?schema=public" --exit-code
```

`No difference detected.` is the pass condition. Verified green on 2026-07-31.

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
