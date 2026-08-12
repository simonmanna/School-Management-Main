# CRM

Deal pipeline + activity tracking on top of the existing `Partner` model.
Three layers: deals (kanban pipeline), activities (timeline), and Partner 360
(deals + timeline + POS spend stats on the partner page).

## Permissions

Dedicated `crm:*` keys (seeded into `Administrator` by default):

| Key | Guards |
| --- | --- |
| `crm:dashboard:read` | CRM dashboard (KPIs, forecast, top customers) |
| `crm:deal:read` | Deal list/detail, partner 360, timeline |
| `crm:deal:write` | Create/update/stage/archive/restore deals |
| `crm:activity:read` | Activity list |
| `crm:activity:write` | Create/complete activities |

Registered in `crm.module.ts` (module registry) and `ALL_PERMISSIONS`
(`packages/shared/src/permissions.ts`) — re-seed to upsert.

## Endpoints (`/api/v1/crm`)

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/deals` | Paginated `{ data, meta }`, filters `q`, `stage`, `ownerId`, `partnerId`, `mine` |
| POST | `/deals` | Org-scoped partner must exist; currency from body (IDR in the UI) |
| GET | `/deals/:id` | Owner/creator joined |
| PATCH | `/deals/:id` | Update fields |
| PATCH | `/deals/:id/stage` | Auto-logs `deal_stage_change` activity; `won` → partner becomes customer |
| DELETE | `/deals/:id` | Soft delete (`deletedAt`); **won deals are archived permanently** (400) |
| GET | `/deals/deleted` | Archived list |
| PATCH | `/deals/:id/restore` | Restore (won deals not listed) |
| GET | `/activities` | Paginated; filters `dealId`, `partnerId`, `mine` |
| POST | `/activities` | `call/email/meeting/note/task` |
| PATCH | `/activities/:id/complete` | Tasks: `completedAt` |
| GET | `/activities/deleted`, PATCH `/activities/:id/restore` | Soft delete lifecycle |
| GET | `/analytics/pipeline` | Value per stage |
| GET | `/analytics/win-rate` | Won vs lost 90d |
| GET | `/analytics/forecast` | Monthly buckets ≤ 12 months |
| GET | `/analytics/top-customers` | Top by open deal value |
| GET | `/analytics/partner/:partnerId` | **Partner 360 spend**: `totalSpent`, `orderCount`, `lastOrderAt`, `openReceivable` (from POS `Document`) |
| GET | `/analytics/upcoming-tasks` | Open tasks due ≤ 7 days |

## Integrations

- **POS spend stats (C1)** — `crm-analytics.service.ts#getPartner360` aggregates
  `Document` (`sales_invoice`/`proforma_invoice`, `status: posted/paid`) by
  `partnerId`: sum `totalAmount`, count, max `issueDate`; open receivable = sum
  `amountResidual` on posted, unpaid docs.
- **Deal ↔ invoice link (C2)** — `CrmService.onModuleInit` subscribes to
  `invoice.created` (outbox). Handler runs **without tenant ALS context**, so it
  uses `prisma.raw` with explicit `organizationId`, and is idempotent on
  `(subjectType: 'Invoice', subjectId)` so outbox replays cannot duplicate
  activities. When the invoice's partner has an open deal (lead→negotiation), a
  `note` activity is logged on that deal; the deal timeline renders a
  "View invoice" link for `subjectType === 'Invoice'`.
- **Convert-to-customer (F24)** — moving a deal to `won` flips
  `Partner.isCustomer = true` (skipped if already a customer).

## Frontend

- `apps/web/src/features/crm/api.ts` — typed React Query hooks; `STAGE_META`,
  `dealCurrency` (org currency, IDR).
- `apps/web/src/features/crm/kanban.tsx` — 6-stage `@dnd-kit` board; drop →
  `PATCH /deals/:id/stage`.
- `apps/web/src/features/crm/deal-form.tsx` — create/edit dialog, partner
  search-as-you-type + inline quick-create.
- `apps/web/src/features/crm/partner-tab.tsx` — Partner 360 tab (spend cards,
  deals, timeline) on `PartnerDetailPage`.
- `apps/web/src/pages/crm/` — `dashboard.tsx`, `deals.tsx`, `deal-detail.tsx`.
- Routes `/crm`, `/crm/deals`, `/crm/deals/:id`; sidebar section perm-gated.

## Domain rules

- Deals + activities are **soft-deleted** (`deletedAt`, tenancy `SOFT_DELETE`
  set). Archive = removed from the active pipeline; restore brings it back.
  Won deals: archive permanently (no restore, no delete).
- Stage change auto-creates a `deal_stage_change` activity (title
  `Stage: lead → qualified`).
- Currency: schema default is `USD`, but the org runs IDR — the UI always
  sends `currencyCode` (IDR default).
- Weighted pipeline value = 25% of `qualified` deals (analytics).

## Tests

- Unit: `apps/api/src/modules/crm/crm.service.spec.ts` (13 tests: partner
  guard, audit/event emission, stage-change activity, won→customer, soft
  delete/restore, pagination shape, invoice-handler idempotency).
- E2E: `pos-e2e/tests/crm.spec.js` (dashboard KPIs; deal lifecycle
  create → stage change → partner 360 → archive/restore; storageState login).
