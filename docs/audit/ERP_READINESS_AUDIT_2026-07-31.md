# ERP Readiness Audit — 2026-07-31

**Scope:** GL architecture, Odoo-style configurability, production readiness.
**Branch:** `feat/android-pos-parity` · **Supersedes:** `PRODUCTION_READINESS_AUDIT.md` (2026-07-04)

> The previous audit predates the migration squash, the catalog-driven RLS sweep,
> the GL financial-dimensions work and the multi-step approval engine. Its
> headline verdict — "84%, approaching production ready" — was also never
> substantiated: `scripts/validate-production.ts`, a 16-section runtime suite
> that ships in this repo, has never been executed. Treat that number as void.

---

## 1. Verdict

| Axis | Grade | Reading |
| --- | --- | --- |
| **GL architecture** | **A−** | Better than most commercial mid-market ERPs. The hard part is done, and done well. |
| **Odoo-like configurability** | **B** | Accounts and approvals are data-driven. Dimensions, journals and workflow *definitions* are not. |
| **Production readiness** | **C+** | One live privilege escalation (now fixed), known ledger-correctness defects, no error tracking, Redis provisioned but unused, zero frontend error boundaries. |

**The gap is not architectural.** It is (a) a security hole, (b) a handful of
places where the ledger is knowably wrong, and (c) ops/observability. That is a
far better position to be in than needing a redesign.

## 2. The core principle is already implemented

The prescription "build accounting as an independent engine that every module
posts to; accounting should not know what a school is" is the architecture in
place today, and it is **CI-enforced**, not merely intended:

- `modules/accounting/posting/posting.service.ts` is the single GL writer. The
  contract at `posting.types.ts:1-5` states that modules never create
  `JournalEntry` rows directly. Nine modules obey it — POS, inventory,
  invoicing, procurement, expenses, fixed assets, treasury, school, CRM.
- `.dependency-cruiser.cjs` enforces the layering
  `kernel ← core ← accounting ← invoicing ← inventory ← procurement ← verticals`.
  `accounting-must-not-import-{invoicing,inventory,procurement,vertical}` runs on
  every build via `pnpm lint:arch`: **464 modules, 1319 dependencies, 0 violations.**
- Account resolution is genuinely data-driven — the thing most ERPs get wrong.
  `AccountMapping` (`@@unique([organizationId, key])`) + a typed 40-key registry
  carrying `expectedCategories` + a 29-key global `AccountCategory` catalog, all
  funnelled through one `AccountResolverService`. Modules resolve accounts by
  *behaviour* (`isCashEquivalent`, `classification`), never by hardcoded code
  ranges. `ensureByCode` is the single sanctioned literal-code path and is used
  once, for the rounding account.
- `PostingService` enforces GL-layer idempotency (`postingKey`, unique) and a
  balance guard that refuses to persist an unbalanced entry.

Of the 30-point reference checklist, **~21 items exist in usable form.**

## 3. Checklist

**Solid:** chart of accounts (hierarchy, normal balance, control accounts, cash-flow
class, manual-posting and reconciliation flags) · account categories · journal
entries with branch/cost-centre/partner/FX and an open `dimensions` bag · trial
balance · balance sheet · P&L · cash flow (direct method, with tie-out) ·
reversals (status pair nets to zero) · audit trail (old/new values, IP, user
agent) · period close with retained-earnings carry-forward · cash management
(sessions, counts, over/short, denominations) · fixed-asset register with five
depreciation strategies · multi-currency with unrealized revaluation · AR/AP
aging · bank reconciliation · number sequences (Postgres `nextval`) · document
attachments (generic `File`) · **approval engine with multi-step chains and
per-step amount bands** · multi-branch.

**Partial:** general ledger report (no opening/running balance) · tax engine (no
partner-level override, no VAT return) · fiscal periods (no `FiscalYear`) ·
journal types (missing payroll/inventory/depreciation/loan; `sequencePrefix` is
dead code) · bank import (JSON only — no CSV/OFX/MT940 parser) · accruals
(accounts exist, no recognition schedule) · posting rules (data-driven for stock
moves only; `journalCode` is a TS literal at 32 call sites).

**Missing:** budgets and variance · projects · a dimension *definition* table ·
recurring journals · cost allocations (split % across centres) · customer and
supplier statements · statement of changes in equity · realized FX on settlement
· GL posting for asset disposal/revaluation/transfer/acquisition · multi-company
and consolidation · a generic rules engine · an AI platform.

## 4. Configurability — what "Odoo-like" actually means here

The platform layer is **built but under-wired**. This distinction matters
financially: several capabilities that look absent are in fact present and
merely unconnected.

| Capability | State |
| --- | --- |
| Approval engine | Exists **and is data-driven** — `ApprovalWorkflow` + `ApprovalStep`, amount bands, `enforceDistinctApprovers`. Not yet registered for journal entries. |
| Workflow engine | Exists (`kernel/workflow`), but definitions live in an in-memory `Map` populated by TypeScript at startup. The engine is configurable; **the definitions are not.** An admin cannot add a state without a deploy. |
| Notifications | Exists — in-app, SMTP, Twilio SMS, web push, per-user per-category preferences. WhatsApp is the only missing channel. |
| Audit log | Exists and is already generic, not POS-specific. |
| Module management | Exists — `OrganizationModule` per-tenant enable/disable with `config Json`, plus a manifest registry doing topological dependency sort with cycle detection, plus a UI. |
| Settings | Exists — typed registry with a `product → category → warehouse → org → default` cascade. |
| Reporting | `SavedReport` is a parameterized runner with cron and email delivery — **not** a query builder. |
| Rules engine | Missing. `TaskAutoRule` exists but is task-scoped. |

So the real configurability gaps are narrower than a feature-list comparison
suggests: **DB-backed workflow definitions, a dimension registry, and a rules
engine.** Everything else is wiring.

## 5. Production readiness

### Fixed in this pass

| ID | Issue |
| --- | --- |
| **P6** | **Privilege escalation.** POS cashier tokens were signed with the access secret and carried the cashier's full aggregated role permissions for 12h, and `verifyAccess` never checked the `type` claim — so a 4-digit PIN minted a 12-hour full-API bearer token. The token was also accepted from a query string on every route, putting it in proxy logs and browser history. Fixed: `type` claim enforced, optional dedicated `JWT_POS_SECRET`, query-string auth confined to the two SSE routes that genuinely cannot set headers. Locked by 7 regression tests. |
| **P7** | Raw exception messages returned to clients in production. Now `requestId` only, with `EXPOSE_ERROR_DETAIL` as a deliberate opt-in. |
| **P10** | Both JWT secrets defaulted to a shared 44-char placeholder that passed the length guard. Compose now refuses to start without real values; the literal is deny-listed and secrets must differ from each other. |
| **P11** | `.env.example` shipped working Postgres credentials. Blanked. |
| **P12** | `apps/api/backup/` — 14 MB of dumps and copied customer uploads — was one `git add -A` from being committed. Untracked and ignored. **Verified no dump was ever committed, so no history rewrite is needed.** |
| **P4** | Container healthcheck probed `/health/live`, which did not exist — the container never reported healthy. Alias added. |
| **P5** | `/health/ready` returned 200 even when degraded, so no load balancer ever shed traffic. Now splits critical (DB → 503) from advisory (backup → 200 + `degraded`), so a stale backup cannot drain every replica. |
| **P23** | Permission catalog and `/metrics` were unauthenticated. Catalog now requires a session (its "the login screen needs it" rationale was untrue — the only consumer is behind auth); metrics gated on `METRICS_TOKEN`, failing closed in production. |
| **P1** | **No ESLint config existed anywhere in the repo**, so `pnpm lint` could never succeed and CI never ran it. Flat configs added for both apps. First run surfaced 6 errors, including a real defect (below). |
| **P2** | CI ran `prisma migrate dev` — which authors migrations to paper over drift — so there was **no drift gate**. Now `migrate deploy` plus an explicit `migrate diff` gate. Job-wide `NODE_ENV=production` while seeding a throwaway DB was also removed. |
| **P3** | `pnpm lint`, web build and Dependabot added to CI. `apps/api` `test:e2e` pointed at a jest config that does not exist — removed. |

**Bug found by the first lint run** (`kernel/auth/auth.service.ts:385`):

```ts
await this.audit.recordInTx ? A : B   // A and B byte-identical
```

`await` bound to the method *reference* — always truthy — so the ternary was
dead code and **neither branch's promise was awaited**. A password change could
complete with its audit row silently dropped, and a failure would surface as an
unhandled rejection. Collapsed to a single awaited call.

### Still open

**Ledger correctness (highest priority):** menu-item sales post no COGS without a
recipe, overstating gross profit · AR sub-ledger vs GL variance of −360 · asset
disposal/revaluation/transfer/acquisition never post to GL, so
`asset_gain_loss` and `asset_revaluation_surplus` are declared and never
consumed · realized FX on settlement is missing · checkout is five sequential
transactions with a compensating refund · unauthenticated tenant creation via
`@Public() POST /organizations/bootstrap` · manager override needs only a userId,
no PIN · `store_credit` tender accepted with no partner and no balance check.

**Ops:** no error tracking · metrics endpoint is hand-rolled while
`prom-client` and `@willsoto/nestjs-prometheus` sit installed and unimported ·
`ioredis` is a dependency and Redis runs in compose with **zero usages**, so the
rate limiter is per-replica while deployment guidance recommends ≥2 replicas ·
no tracing.

**Frontend:** zero error boundaries — any render throw white-screens a terminal
mid-shift · `protected-route.tsx` is 9 lines and checks only token presence, no
permission gating · all ~194 pages eagerly imported, no code splitting.

**Testing:** 38 suites / 277 tests, all green. No frontend tests, no Android
tests. `kernel/auth` was entirely uncovered before this pass. No coverage
threshold. E2E exists but has never run in CI.

## 6. Recommendation on multi-company

**Do not add `companyId`.** Three reasons specific to this codebase: the RLS
migration is a catalog-driven loop over every `organizationId` table and a second
scope column doubles that predicate surface; all 371 indexes and every config
unique are org-keyed; and `Organization` already *is* the accounting entity with
a coherent isolation story enforced at boot.

Instead add `ConsolidationGroup` + `ConsolidationMember` +
`IntercompanyPartnerLink`, aggregate per-org trial balances, and book
eliminations as ordinary journal entries through `PostingService`. That delivers
group P&L, group balance sheet and intercompany elimination — ~90% of the
realized value — for roughly 5% of the cost and **zero columns added to existing
models**. Build it when a customer actually has a second legal entity.

## 7. Sequencing

Ledger truth precedes ledger features: budgets and dashboards built on a ledger
that omits disposal gains render the error at higher resolution.

| Phase | Weeks | Required for "enterprise ready"? |
| --- | --- | --- |
| 0a git/migration state | 0.5–1 | ✅ **done** |
| 0 security + CI hygiene | 1–1.5 | ✅ **done** |
| 1 ledger truth | 3–4 | ✅ |
| 2 platform activation | 3–4 | Partly — approvals on JEs |
| 3 rules engine | 3–4 | No |
| 4 dimensional core (dimensions, projects, budgets) | 4–6 | No — *sellability* |
| 5 statements, compliance, report builder | 5–6 | Partly |
| 6 AI platform | TBD | No |
| 7 production hardening | 5–7 | ✅ |

~30–40 dev-weeks excluding AI. Enterprise-ready subset (0a, 0, 1, 7): **10–14 weeks.**

Phase 2 is the bargain — 3–4 weeks to activate a platform layer already built
and paid for.
