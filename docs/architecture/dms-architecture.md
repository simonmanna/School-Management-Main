# Generic Document Management System — Architecture (Phase 0.1)

Status: **Approved for Phase 1** (Rev 4 plan, 2026-08-10). Supersedes the Rev 1/2 architecture sections of the DMS plan.

## 0. Binding principle (ownership)

> **The DMS owns document behavior and representation; domain modules own business truth and business rules.**

If a choice lets a domain table's business rule leak into the DMS — or lets the DMS dictate a domain's truth — that choice is wrong.

### Operational boundary

```
DMS DOES OWN:                          DMS DOES NOT OWN:
  document identity                      accounting truth        payment truth
  numbering                              inventory truth         fulfillment truth
  document lifecycle                     rental truth            domain eligibility rules
  approval orchestration                 student academic truth  domain calculations
  representation · templates · snapshots
  attachments · relations · permissions  (any single source of business truth —
  audit · printing                        the DMS never stores or decides it)
```

## 1. Goals & non-goals

Goals: one generic engine that numbers, lifecycles, posts, renders, attaches, relates, snapshots, searches and archives documents across POS, Rental, Retail, School — **no core-engine code change to add a new document type** (seed rows + templates only). Commands are idempotent; writes are optimistically concurrent.

Non-goals: a second ERP master (no pseudo-EAV), a second numbering system, a second file store, per-type `switch` sprawl, registry-stored business logic (declarative guards only), per-print snapshots by default.

## 2. Registry-as-source-of-truth

`DocumentTypeDef` (global table, seeded at boot) is the source of truth. The Prisma enum `DocumentType` is retained as a **deprecated legacy mirror** of the 5 system codes (see ADR-014 below) until all consumers migrate (target: Phase 6/8); it is NOT the registry.

Each type binds: Identity → Numbering → Lifecycle → Policies (approval/posting/payment/cancellation) → Rendering → Business Effects → Security.

### 2.1 Registry field classification (rev 4 review)

Every JSON policy field is exactly one of:

- **(C) Configuration** — numberingPrefix, numberingPadding, maxCopies, snapshotOnPrint, keepRenderedFile.
- **(P) Policy** — requiresApproval, requiresReason, requiresPaid, requiresSnapshot, visibility, editPolicy, postingPolicy.behavior, cancellationPolicy.reversable.
- **(R) Reference** — permissionKey, workflowId, defaultTemplateId.

**Never Business Logic.** No expressions, no if/then, no code in registry data. A new guard *kind* is a core-engine change (reviewed, rare).

## 3. Model inventory (Phase 1 scope)

| Model | Scope | Purpose |
|---|---|---|
| `DocumentTypeDef` | global | Registry root: code, name, category, numbering, lifecycleId, policies, editPolicy, snapshotPolicy, printProfile, businessEffects, security, flags |
| `DocumentLifecycle` | global | Code, states (String[] subset of `DocumentStatus` superset), initialState |
| `DocumentTransition` | global | lifecycleId, fromState, toState, action, guardJson; unique(lifecycleId, fromState, action) |
| `DocumentRelationType` | global | Relation semantics: direction, allowed categories, cardinality, inverseImplicit, duplicatesAllowed |
| `OrganizationDocumentType` | org | Per-org activation/config override (ADR O2: global registry + per-org override) |
| `DocumentAction` | org | Command idempotency log: unique(org, documentId, action, idempotencyKey) |

Phase 3–5 models (designed, not yet built): `TemplateDefinition`, `DocumentSource`, `DocumentRelation`, `DocumentVersion`, `DocumentSnapshot`, `DocumentAttachment` (+ `DocumentAttachment.role`).

### 3.1 Superset status enum (ADR-013, deliberate deviation)

`DocumentStatus` grows from 6 → 15 values: draft, submitted, approved, rejected, confirmed, posted, paid, issued, active, expired, terminated, revoked, cancelled, closed, archived. The registry constrains per-type subsets + transitions. A new *state* = one rare enum migration; a new *type* = zero core-engine code.

### 3.2 Guard vocabulary (fixed whitelist, G4)

```jsonc
{ "permission": "document:sales_invoice:post", // or null
  "requiresApproval": false,
  "requiresReason": true,
  "requiresPaid": false,
  "requiresSnapshot": false,
  "allowsAnyState": false }
```
Unknown key → seed-time validation error. Evaluated by a typed validator, never executed.

### 3.3 Seeded lifecycles

- `receipt_doc` — draft → posted → paid
- `sales_doc` — draft → submitted → approved → posted → paid (+reject → draft, cancel from draft/submitted/approved, reverse → credit note)
- `purchase_doc` — draft → confirmed → posted → paid → closed (requiresPaid); cancel from draft
- `contract_doc` — draft → submitted → approved → active → expired | terminated; cancel from draft; terminate requiresReason
- `certificate_doc` — draft → approved → issued → revoked (requiresReason)
- `approval_doc` — sales_doc plus approval gate on transitions

### 3.4 Cancel vs reverse (rev 4 review)

| Action | Applies to | DMS behavior | Domain behavior |
|---|---|---|---|
| `cancel` | draft/approved/confirmed with **no posted effects** (engine verifies journalEntryId = null, no inventory/fulfillment effects) | mark cancelled; no counterpart, no snapshot | none |
| `reverse` | posted/issued **with effects**, only if `cancellationPolicy.reversable` | orchestrate: counterpart doc → CANCELS/REPLACES relation → snapshot → mark original → run domain reversal hooks | **accounting/inventory domains define actual reversal effects** (journal reversal, COGS/stock rollback, settlement unwind) |

### 3.5 Snapshot & version ownership (rev 4 review)

- `DocumentVersion.data` — document-owned editable content only. ✅ terms/clauses/notes · ❌ tenantBalance/propertyStatus/deposit.
- `DocumentSnapshot.data` — *what the document said at issuance*: party, lines, qty/prices/tax/totals, currency, terms. Historical representation, never authoritative business state.
- **Enforced by construction:** snapshot capture assembles data from `Document` + `DocumentLine` + template + partner-name snapshot only; never from domain tables.
- `snapshotPolicy` default `{ captureOn: ["post","amend","issue"], snapshotOnPrint: false, keepRenderedFile: false }` — **no per-print snapshot by default** (rev 2 review). Reprints render from latest snapshot (issued) or live (drafts). `snapshotOnPrint: true` is opt-in per type (legal docs with signature stamps).

### 3.6 Relation semantics (rev 4 review)

`DocumentRelationType` registry: direction ('out'/'both'), allowedSourceCategories, allowedTargetCategories, cardinality ('one'/'many'), inverseImplicit, duplicatesAllowed.

| code | source→target (seeded) | cardinality | inverse | dupes |
|---|---|---|---|---|
| CONVERTED_FROM / CONVERTED_TO | finance/pos/retail ↔ finance/pos/retail; **certificate→inventory adjustment rejected** | one | explicit pair | no |
| GENERATED_FROM | any → any | many | — | no |
| REFERENCES | any → any | many | — | yes |
| FULFILLS | delivery_note/GRN → order/invoice | one | — | no |
| CANCELS | financial posting-eligible | one | implicit | no |
| AMENDS | versioned types (contract/certificate/report card) | many | implicit | no |
| REPLACES | any → same category | one | implicit | no |

`Document.reversedDocumentId` (legacy) mirrors CANCELS.

## 4. Permissions (ADR-015 — granular, rev 4 review)

Format matches codebase convention **`resource:action`** (colon), not the plan's dot syntax.

- Generic key stack per (type, action): `document:<typeCode>:<action>` → `document:<category>:<action>` → `document:<action>`.
- Static keys in `PERMISSIONS` (packages/shared): `document:create/read/update/delete/print/archive/manage`.
- Dynamic per-type keys: generated + seeded by the DMS seeder (Permission table is global): `document:<typeCode>:{submit,approve,post,cancel,reverse,...}`.
- Enforcement points: CRUD controllers (Phase 2), lifecycle-engine guards (guard.permission, Phase 2), print endpoint (Phase 4), UI action bar (Phase 7). UI rendering is convenience; backend guards are security.
- Visibility: `security.visibility` ∈ doc | branch | org (branch scoping via existing branchId + branch-scope service; default 'org').
- Provisioning (O7, mechanics verified at 1.5): Permission rows global; system roles (Administrator) updated at boot by the seeder to append DMS keys — no ALL_PERMISSIONS churn for dynamic keys.
- Role defaults: finance → post/cancel/reverse; cashier → create/print on receipts+invoices; admin → manage + all.

## 5. Existing → DMS mapping

| Existing | Role now | DMS role |
|---|---|---|
| `Document` (schema:1550) | universal financial doc | core; gains documentTypeId FK + version |
| `Document.documentType` enum | typed column | **legacy mirror** (ADR-014) until consumers move |
| `DocumentLine` (1636) | lines | unchanged; snapshot source |
| `DocumentPrintLog` (1685) | print log + idempotencyKey | generalized per printProfile (Phase 3); idempotency pattern extended to `DocumentAction` |
| `SequenceService` (kernel/sequence) | race-free numbering | numbering for all types (Phase 2.3); legacy keys already in KNOWN_KEYS or warmed by builder |
| `WorkflowRegistry`/`initializers` | per-flow state machines ('invoice', 'credit_note'...) | **not DB documentType** — workflow keys are independent; no change; superseded incrementally by lifecycle engine (Phase 2) |
| `ApprovalWorkflow` (kernel/approvals) | approvals | approvalPolicy reference |
| accounting `posting` + `account-resolver` | posting side-effects | postingPolicy adapter (Phase 2.4) |
| `RecurringDocument` (3945) | second document-creation path | **aligned to registry in Phase 6D**: enum → FK, children through core create() |
| `File` (3746) | attachment vault | attachment roles (Phase 5.4) |
| `EventOutbox`, `AuditLog`, `LifecycleEvent` | audit/eventing | timeline/audit for actions |

## 6. Migration strategy (ADR O4 — one-shot, verified safe)

1. Seed 5 system `DocumentTypeDef` rows **inside the migration SQL** (INSERT … SELECT gen_random_uuid(), deterministic by code) so backfill has targets.
2. Add `DocumentTypeDef` FK column `documentTypeId` nullable → SQL backfill from enum via code join → `SET NOT NULL` → FK + index. One migration, one transaction, rollback = restore pre-migration state.
3. Retain `documentType` enum column as a **legacy mirror** (ADR-014): writers set both fields via `DmsTypeResolver`; readers keep working unchanged; column dropped at Phase 6/8 completion after the 3 remaining `documentType` write sites migrate. The alternative (dual-write drift) is worse; the alternative (sweeping 29 files' read filters now) risks live reporting before Phase 2 replaces the read paths.
4. RLS: run `scripts/setup-rls-role.ts` (idempotent) after the migration so the new org-scoped tables (`OrganizationDocumentType`, `DocumentAction`) get the FORCEd `tenant_isolation` policy. Verify via psql.

## 7. Decisions & open questions

**Resolved (ADRs):** O1 HTML/CSS → Chromium BrowserPool → PDF (Phase 4) · O2 global registry + per-org activation/config · O4 one-shot FK migration with migration-internal seeding · O5 School v1 = fee invoice, receipt, admission letter, certificate, report card · O6 RecurringDocument aligned to registry in Phase 6D (prerequisite for DMS-complete sign-off) · O13 superset status enum · O14 enum-column retention during transition · O15 colon-formatted permission keys + dynamic type-key seeding.

**Open:** O7 permission provisioning mechanics (verify at 1.5; current plan: seeder appends keys to system roles) · O8 Puppeteer packaging / BrowserPool memory policy (decide before Phase 4) · O9 per-org type-config UX (decide at 7.4).

## 8. Guardrails recap

G1 no pseudo-EAV · G2 no per-type switch (zero core-engine code per new type) · G3 no second storage/numbering · G4 declarative guards only · G5 snapshot discipline (no per-print default) · G6 idempotent commands · G7 optimistic writes (Document.version).