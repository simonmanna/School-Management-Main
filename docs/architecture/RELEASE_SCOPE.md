# First-release scope

Baseline commit `6acb599`. Companion to the [production readiness plan](PRODUCTION_DELIVERY_PLAN_2026-09-03.md) and the [findings register](../audit/SYSTEM_PRODUCTION_REVIEW_2026-09-03.md).

This is REL-01: the definition of what the first school release contains. Anything not listed as **in scope** is disabled at the backend, not merely hidden from a menu.

## Deployment shape

| Decision | Value | Consequence |
|---|---|---|
| Tenancy | One school per instance, dedicated database | Tenant isolation is defence in depth, not the primary control. See [KNOWN_FAILURES #3](../audit/KNOWN_FAILURES.md). |
| Curriculum | Undecided at time of writing; possibly multiple schools | No hardcoded P1–P7 / S1–S6 ladder. Programme templates stay configuration under school sign-off. `ProgrammeService.seedUganda` is a starting template, not a fixed structure. |
| Payroll | **In scope** | Phase 8 certification is on the critical path and gates launch. |
| Live mobile money | **Out of scope** | Disabled at the module level. Cash and bank collection only. |

## Module state

Two mechanisms control scope, and both are used:

1. **Registration flags** — `enabled('ENABLE_*')` in `apps/api/src/app.module.ts`. Fail-closed: a module is registered only when its flag is exactly `"true"`. An unset flag means the module never loads.
2. **Per-tenant rows** — `@RequiresModule()` plus `ModuleEnabledGuard`. ⚠️ This guard **fails open** for a tenant with zero `OrganizationModule` rows. Run `apps/api/prisma/backfill-organization-modules.ts --apply` against the launch organization so the guard becomes strictly fail-closed for it.

### In scope

| Area | Control | Notes |
|---|---|---|
| School vertical | `ENABLE_SCHOOL=true` | Admissions, enrollment, teaching, attendance, assessment, examinations, results and reports, fees, portals, reporting. |
| HR and payroll | `ENABLE_HR=true`, `@RequiresModule('hr')` | Payroll cannot be enabled for real posting until Phase 8 exits. Until then it is a shadow cycle only. |
| Communication | `ENABLE_COMMUNICATION=true` | Needed for portal invitations and fee notices. |
| Accounting, invoicing, inventory, procurement, expenses, income, documents | always registered | The school domain depends on the shared posting and payment engines. Do not disable. |

### Out of scope — disabled

| Area | Control | Why |
|---|---|---|
| Advanced LMS / LTI / SCORM / badges | `ENABLE_ADVANCED_LMS=false`, `VITE_ENABLE_ADVANCED_LMS=false` | No established school need for the first term. Lesson planning and delivery stay in scope; the Moodle-shaped capability layer does not. |
| Manufacturing | `ENABLE_MANUFACTURING=false` | Not a school function. |
| Rental | `ENABLE_RENTAL=false` | Not a school function. |
| Repair | `ENABLE_REPAIR=false` | Not a school function. |
| Beverage | `ENABLE_BEVERAGE=false` | Café vertical. |
| Fixed assets | `ENABLE_ASSETS=false` | Defer until the school asks for it. |
| Tasks | `ENABLE_TASKS=false` | Defer. |
| Orders / POS surfaces | `ENABLE_ORDERS=false` | Café vertical. Shared accounting and inventory services stay — only the POS-facing modules are off. |

Disabling is enforced in `docker-compose.prod.yml`. Hiding a navigation entry is not disabling; every item above is off at the backend.

### Deferred within the school vertical

These load with `ENABLE_SCHOOL` but are not part of the certified launch surface, and their permissions should not be in launch role presets until a school asks for them: CBT/quizzes, certification, hostel, transport, cafeteria/meals, library fines beyond basic lending, front-desk visitor logging.

## Runtime and build matrix

| Component | Version | Note |
|---|---|---|
| Node (CI and runtime image) | 22 | The runtime image was on Node 20 (EOL) while CI ran 22. Aligned in Phase 0 (OPS-01). |
| pnpm | 10.14.0 | Pinned in CI via `pnpm/action-setup`. |
| PostgreSQL | 16 | `postgres:16-alpine` in Compose and CI. |
| Prisma | 6.19.3 | 631 models, ~19,700 schema lines. This is why `typecheck` needs `--max-old-space-size=8192` (REL-02) — it is compiler memory, not a runtime leak. |
| TypeScript | 5.6.x | |

## Database roles

Two roles, not one:

| Role | Variable | Used by |
|---|---|---|
| Migrator (owner) | `MIGRATOR_DATABASE_URL` → `DIRECT_URL` | `prisma migrate deploy` only. |
| Application | `APP_DATABASE_URL` → `DATABASE_URL` | The API. Must be `NOSUPERUSER NOBYPASSRLS` — create it with `scripts/setup-rls-role.ts`. |

`docker-compose.prod.yml` refuses to start if either is unset. The base Compose file connects as the `cafe-pos` superuser while setting `NODE_ENV=production`, which trips the startup guard in `PrismaService` — that is the guard working correctly, and the fix is to supply the application role. **Do not set `RLS_ALLOW_SUPERUSER`.**

Wiring `directUrl` into `schema.prisma` is DB-01, in Phase 1; until then `DIRECT_URL` is passed but unused by Prisma.

## Release gates

A build is releasable only when all of these pass. They are enforced by `.github/workflows/ci.yml`.

| Gate | Job / step |
|---|---|
| Architecture boundaries (ADR-011) | `verify` → Architecture boundaries |
| Typecheck, lint, shared contracts | `verify` |
| Web and portal **build** | `verify` → Build web and portal |
| Migrations apply from empty | `verify` → Apply migrations |
| Constraints that can silently not exist | `verify` → Schema preflight |
| Unit project | `verify` → Test (unit) |
| **Whole** integration project, no silent skips | `verify` → Test (integration) |
| Runtime image builds, contains a generated Prisma client, and boots | `image` |
| Rendered Compose publishes only Caddy 80/443 | `compose-ports` |

Open exceptions are listed in [KNOWN_FAILURES.md](../audit/KNOWN_FAILURES.md), each with an owner and a closing phase.

## Sign-off

Launch scope is not accepted until these are named and recorded:

| Area | Signs |
|---|---|
| Learner identity, enrollment, capacity | Registrar |
| Curriculum, grading, moderation, reports | Academic lead |
| Opening balances, receipts, GL, close | Accountant |
| Employment data and payroll inputs | HR owner |
| Coverage and evidence | QA |
| Isolation, runtime, backup/restore, alerts | Infrastructure / security |
| Operating procedures, support, rollout | School sponsor |
