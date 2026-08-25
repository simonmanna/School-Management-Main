# Production Readiness Audit — School Fees & Payments

**Fee catalog → billing → invoice → GL → payment → allocation → receipt · complete money-flow review**

| | |
|---|---|
| **Scope** | The Fees module as one economic chain: fee catalog → structure version → term schedule → billing run → invoice + GL → payment → allocation → waiver/credit/adjustment/refund → statement → reconciliation |
| **Branch** | `school/assessment-canonical-ledger` (Fees code as of `8e64938`) |
| **Method** | Static code review against `docs/architecture/FINANCIAL_INVARIANTS.md` and ADR-013, tracing every write path that changes a student balance |
| **Date** | 2026-08-24 |
| **Prior work** | ADR-013 economic-event model + Phase 0–A6 hardening shipped in `8e64938`; this audit reviews what that left open |

---

## 1. Executive Summary

The Fees module received a substantial economic-event remediation in `8e64938`, and **that
work holds**. Balances are computed from immutable events rather than cached columns, waivers
post GL on every path and never pollute `amountPaid`, fee credits require an explicit funding
origin, refunds are capped at a canonical entitlement, and waivers/adjustments/term-reopen all
carry maker-checker. A single canonical query service means the portal, the bursar statement
and the ledger cannot disagree.

An external review of the module rated it "financial transaction core ~80–85% mature" and
listed ten gaps — but it was reading a stale implementation map, and **six of its ten findings
describe work that already shipped**. Its remaining four are real. More importantly, it did not
find the defects that actually make the module unsafe today.

**The module is not production-ready, for reasons the previous review did not identify.**

Three defects allow real money to be created, destroyed, or double-counted:

- ❌ **Billing has no database-level idempotency.** The code documents a `@@unique` on
  `Document(organizationId, partnerId, sourceType, sourceId, reference)`. That index does not exist — not
  in `schema.prisma`, not in any migration. The intended backstop on `SchoolFeeInvoice` is
  **inert**, because its business key includes `feeStructureVersionId`, which is never written,
  and Postgres treats NULLs as distinct. Two bursars clicking *Generate* concurrently
  double-bill the school. (P0-A)
- ❌ **The mobile-money replay guard has no database constraint, and no column it could safely
  constrain.** `reference` is free text carrying two incompatible meanings at once: a provider's
  idempotency key and a bursar's narration. Concurrent MoMo callback retries both pass the
  application check and collect twice. (P0-B)
- ❌ **A refundable fee credit is never drawn down when refunded.** `remaining` is not
  decremented, status is not transitioned, and the Fee-Credit Liability is never debited — so
  the same credit can be paid out repeatedly *and* still applied to invoices. (P0-C)

A fourth reintroduces, in one unreviewed method, the exact defect the rest of the module fixed:
`sponsorStatement` derives "paid" as `billed − residual`, counting waivers and credit drawdowns
as sponsor cash. (P0-D)

Beneath those sit eleven P1 defects, of which the structural one is **pricing provenance**:
billing reads the *mutable* `FeeStructure.components` JSON. `FeeStructureVersion` and `FeeItem`
are written on publish and then never read by anything. Editing a published structure silently
changes what the next billing run charges, with no version bump and no provenance — despite a
docstring claiming otherwise.

None of this is an architectural dead end. The event model, the posting engine, the query
service and the approval machinery are all sound; the defects are concentrated at the seams
where that model was not carried through — concurrency constraints, pricing immutability,
period-control coverage, and reversal.

### Scorecard (0–100)

| Dimension | Score | Notes |
|---|---:|---|
| **Overall Production Readiness** | **62** | 🔴 Not ready — three money-safety P0s |
| Economic-event model | 90 | ADR-013 design is sound and mostly carried through |
| Billing engine | 72 | Precedence, pro-rata, optional-fee gate all correct; **no DB idempotency**, mutable pricing |
| Payment collection | 68 | Delegates to the single payment writer correctly; **replay guard unenforced** |
| Allocation | 70 | Explicit + oldest-first + unallocated is a good model; **no reversal at all** |
| GL integration | 88 | Every event posts; balanced entries; partner-scoped AR legs |
| Waivers | 90 | GL on every path, `amountWaived` separated, maker-checker |
| Credits | 55 | Origin enforcement is excellent; **refund double-spend**, float math, expiry ignored |
| Refunds | 60 | Entitlement cap is real and correct; **allocated payments cannot be refunded** |
| Adjustments | 88 | Typed, approved, moves residual + GL together |
| Period control | 45 | Term-close exists and works; **guards only 2 of ~9 write paths** |
| Pricing immutability | 30 | Versions created, never read; published structures freely editable |
| Reconciliation | 65 | AR⇄GL + credit liability solid; no cash custody, no cached-projection gate |
| Auditability | 80 | Ledger is typed and traceable; missing opening balance, refunds, reversals |
| Concurrency safety | 35 | Application checks where the invariants demand database constraints |
| UI / bursar workflow | 62 | Wizard is well-built; **overpayment cannot be recorded**, no receipt reprint |

### Rating

🔴 **Not Production Ready (62%)** — do not expose to real fee collection until the four P0s in
§5 are closed and the concurrency and rollback gates in §7 pass. The remediation is bounded:
one migration, one backfill, and roughly six focused code phases. Roadmap in §8.

---

## 2. What already holds

Verified correct, each mapped to the invariant it satisfies. This is not padding — the previous
review listed most of these as *missing*, and building them again would be waste.

| Capability | Invariant satisfied | Evidence |
|---|---|---|
| Financial invariants are written down and frozen | — | `docs/architecture/FINANCIAL_INVARIANTS.md`, ADR-013 |
| Balance derived from events, not cached columns | §Outstanding AR | `SchoolFinanceQueryService.studentBalance` — `collected` is `SUM(PaymentAllocation)` |
| One canonical calculation layer | §Outstanding AR | ~~Portal, statement and ledger all delegate to the query service~~ — **corrected 2026-08-25:** only the ledger delegates. The parent portal (`portals.service.ts:325`) and the bursar statement (`people/student.service.ts:347`) still derive `paid` by subtraction and report waivers as money received, despite docstrings claiming otherwise. See D1 in [`FEES_FUNCTIONAL_AUDIT_UGANDA_2026-08-25.md`](./FEES_FUNCTIONAL_AUDIT_UGANDA_2026-08-25.md) |
| Typed chronological student ledger | §Terminology | `studentLedger` — INVOICE · PENALTY · PAYMENT · CREDIT_APPLIED · WAIVER · WRITE_OFF · ADJUSTMENT |
| Waiver posts GL on every path | §Economic-event integrity | `applyWaiver` — the partial-application path posts too (the P0-2 fix) |
| Waiver never touches `amountPaid` | §Terminology | `amountWaived` is a separate column |
| Credit requires an explicit funding origin | §Economic-entitlement uniqueness | `createCredit` rejects an unknown source; `overpayment` demands `sourcePaymentId` |
| Refund capped at a canonical entitlement | §Refund / Credit | `refundableAmount` subtracts overpayment already converted to credit |
| Maker-checker on forgiveness and correction | §Period control | `approveWaiver`, `approveAdjustment`, `reopenTerm` all require approver ≠ creator |
| Adjustment moves residual and GL together | §Economic-event integrity | `approveAdjustment` in one transaction |
| AR ⇄ GL reconciliation, aggregate and per-student | §AR ⇄ GL | `reconcileCurrentArToGl` via `JournalLine.partnerId` |
| Credit-liability reconciliation | §Refund / Credit | `reconcileCreditLiability` against account `FEE-CR` |
| Money precision in billing, waivers, payments | §Money precision | `dec()` / `round()` from `kernel/common/money` |
| Lifecycle vs settlement filtering | §Document | `POSTED_FEE_WHERE` / `OPEN_FEE_WHERE` / `ACTIVE_FEE_STATUSES` |
| Billing precedence and pro-rata fixed scholarships | — | `computeLines` — opt-in → assignment override → structure amount |
| Optional fees bill only opted-in students | — | `StudentOptionalFee` gate in `computeLines` |
| Tenant-scoped raw SQL | §Tenancy | `studentArRows` binds `organizationId` on `prisma.raw` |
| Payment import never auto-posts a fuzzy match | §Idempotency | `payment-reconciliation.service.ts` — admission-# = HIGH, fuzzy = manual only |

---

## 3. Mechanism semantics

Seven mechanisms reduce or move what a student owes. ADR-013 separates them correctly in prose;
this table is the enforceable version. Anything that reduces a balance and is not in this table
is a defect by definition.

| Mechanism | Meaning | Reduces invoice? | Involves cash? | GL impact | Reversible via | Approval |
|---|---|---:|---:|---|---|---|
| **Discount** | Price concession at billing time | Yes — reduces the *billed* amount | No | Lower revenue credit; AR debited net | Re-bill (pre-post only) | Config-level |
| **Scholarship** | Financial aid at billing time | Yes — reduces the *billed* amount | No | Lower revenue credit; AR debited net | Re-bill (pre-post only) | Award record |
| **Waiver** | School forgives a receivable it will not collect | Yes — reduces residual, accrues `amountWaived` | No | Dr Waiver Expense / Cr AR | Reversal event | `school:fees:waiver:approve`, maker-checker |
| **Write-off** | Waiver with `badDebt = true` | Yes | No | Dr Waiver Expense / Cr AR | Reversal event | `school:fees:writeoff` |
| **Fee Credit** | Student-held stored value for *future* receivables | Not on creation | No | Dr AR / Cr Fee-Credit Liability | Reversal event | Origin-gated; `approved_adjustment` needs an approver |
| **Credit application** | Drawdown of stored value against an invoice | Yes — reduces residual, never `amountPaid` | No | Dr Fee-Credit Liability / Cr AR | Allocation reversal | — |
| **Payment** | Realized consideration, any tender | Yes — via allocation | Yes, in | Dr Cash/Bank / Cr AR | Payment reversal | `school:fees:collect` |
| **Refund** | Money returned to the payer | No — restores AR when the payment was allocated | Yes, out | Dr AR / Cr Cash, or Dr Fee-Credit Liability / Cr Cash | Reversal event | `school:fees:refund:approve` |
| **Adjustment** | Any balance change the above do not explain | Either direction | No | Dr AR / Cr Adj Income, or Dr Adj Expense / Cr AR | Reversal event | `school:fees:adjustment:approve`, maker-checker |
| **Sponsorship** | A third party pays on the student's behalf | No — settles via that party's payment | Yes, in | AR settlement on the student partner | Payment reversal | **Not production-ready — see §6** |

The distinction that matters operationally: **Discount and Scholarship change what is billed;
Waiver, Credit and Adjustment change what is owed after billing; Payment and Refund move cash.**
Only Payment ever touches `amountPaid`.

---

## 4. Financial Event State Matrix

The central design contract. Every row is a permitted economic event; anything not listed may
not change a balance.

| Operation | Creates event | Mutates projection | Reversible via | Allowed in closed term |
|---|---|---|---|---|
| Billing | Yes | `amountResidual` | Reversal event | No |
| Penalty assessment | Yes | `amountResidual` | Reversal event | No |
| Payment | Yes | `amountPaid`, `unallocatedAmount` | Payment reversal | No |
| Allocation | Yes | `amountPaid`, `amountResidual` | Allocation reversal | No |
| Waiver | Yes | `amountWaived`, `amountResidual` | Reversal event | No |
| Write-off | Yes | `amountWaived`, `amountResidual` | Reversal event | No |
| Credit creation | Yes | `FeeCredit.remaining` | Reversal event | No |
| Credit application | Yes | `remaining`, `amountResidual` | Allocation reversal | No |
| Credit refund | Yes | `remaining`, `FeeCredit.status` | Reversal event | No |
| Credit expiry | Yes | `remaining`, `FeeCredit.status` | Reversal event | No |
| Refund | Yes | `unallocatedAmount` | Reversal event | No |
| Adjustment | Yes | `amountResidual` | Reversal event | No |

**Read down the "Allowed in closed term" column:** it is `No` for every row. The system today
enforces that for two of them.

---

## 5. Findings

Severity reflects exposure to real money, not implementation effort. Each finding names the
invariant clause it violates and the test that will prove it fixed.

### P0 — unsafe against real money

#### P0-A · Billing has no database-level idempotency

**Violates** §Concurrency — *"Financial uniqueness is enforced by DATABASE business-key
constraints, never solely by application existence checks."*

`billing.service.ts:62` documents three layers of protection. The second — *"Database-level
unique constraint: `@@unique` on the same tuple"* — does not exist. The tuple in question is the
one the application guard at `:391` uses, `(organizationId, partnerId, sourceType, sourceId,
reference)`: one invoice per **student** per schedule per term. `model Document` carries
only `@@unique([organizationId, documentNumber])`; no migration in `apps/api/prisma/migrations`
creates the documented index. The `P2002` handler at `billing.service.ts:177` therefore never
fires, and the `findFirst` guard at `:390` runs under READ COMMITTED, where two concurrent
transactions both observe "no existing invoice" and both insert.

The intended backstop compounds it. `SchoolFeeInvoice.@@unique([organizationId,
studentProfileId, termId, feeStructureVersionId])` would catch the duplicate — except
`feeStructureVersionId` is never written (`billStudentTransaction`, `:463`, omits it), and
Postgres treats NULL as distinct in a unique index. **The constraint the comment calls "the
database, not an app check, is the guarantee" constrains nothing.**

*Failure:* two bursars click *Generate* for Term 2 within the same second. Every active student
receives two posted invoices and two GL entries. AR doubles. Nothing detects it, because
`reconcileCurrentArToGl` compares the subledger against a GL that was doubled in the same
transaction.

*Proof of fix:* `should_prevent_duplicate_billing_under_concurrency` — two `generateForTerm`
calls in `Promise.allSettled`, asserting one invoice exists.

*Runtime confirmation (Phase 0, `schooldb-planet`):* zero violations of the correct key across
all 342 organizations, so the index can be created safely. Dropping `partnerId` from the key
produces 20 false positives on a single Term invoice run worth UGX 26,600,000 — one legitimate
invoice per student — and an index built on that reduced key would permit only one fee invoice
per schedule school-wide. The narrower key is not a tightening; it is a different, wrong rule.

#### P0-B · Payment replay guard is unenforced, and `reference` cannot safely be constrained

**Violates** §Idempotency and §Concurrency.

`model Payment` has no unique key on the replay tuple. The guard at `billing.service.ts:772` is
an application `findFirst` inside the collecting transaction — two concurrent MoMo callbacks
carrying the same provider transaction id both pass it.

The naive fix is unsafe. `reference` is `@IsOptional() @IsString()` on `CollectFeePaymentDto`
(`dto.types.ts:302`) with no semantics, surfaced in the collect wizard for *every* method
including cash — a bursar may legitimately type `CASH` on a hundred receipts. Meanwhile
`payment-reconciliation.service.ts:178` passes `reference: row.externalRef`, a genuine
machine-issued idempotency key. **One free-text column carries two incompatible meanings**, and
no `externalReference` field exists anywhere in the codebase. A unique index on `reference`
would reject legitimate cash receipts while still failing to express the actual rule.

*Failure:* an MTN callback retries after a timeout. Both requests reach `collect`. The student
is credited twice, the drawer is short, and the duplicate is discoverable only by manual
statement inspection.

*Proof of fix:* `should_prevent_duplicate_external_payment_reference` **and**
`should_allow_repeat_cash_narration_reference` — both must pass.

#### P0-C · A refunded fee credit is never drawn down

**Violates** §Economic-entitlement uniqueness — *"A monetary entitlement must NOT be
simultaneously represented as refundable/unallocated Payment value AND outstanding FeeCredit
value."*

`refundableAmount` (`school-finance-query.service.ts:449`) adds `SUM(FeeCredit.remaining)` for
refundable, active credits to the entitlement. `refundFee` (`billing.service.ts:963`) then pays
out via `createCustomerRefund` — and **touches the credit in no way at all**. `remaining` is
unchanged, `status` stays `active`, `isActive` stays true, and the Fee-Credit Liability is never
debited, so the refund's `Dr AR` leg lands against a liability that remains on the books.

*Failure:* a student holds a refundable 300,000 credit. The bursar refunds it. The credit is
still `active` with `remaining = 300,000`, so it can be refunded again — repeatedly — and
`applyCredits` will also spend it against the next invoice. One entitlement, unlimited payouts.

*Proof of fix:* refund a credit, then assert both a second refund and an application are
rejected; assert `SUM(FeeCredit outstanding) = GL FEE-CR balance` still holds.

#### P0-D · Sponsor statement counts forgiveness as cash

**Violates** §Terminology — *"`amountPaid` = REALIZED PAYMENT CONSIDERATION … EXCLUDES
non-payment reductions: waivers, credits, write-offs, adjustments."*

`sponsorStatement` (`advanced.service.ts:139`) computes:

```ts
totalPaid: totalBilled - totalBalance
```

`totalBalance` is the sum of `amountResidual`, which waivers, credit applications and credit
adjustments all reduce. Every forgiven shilling is therefore reported to the sponsor as money
they paid. This is the P0-3 defect the rest of the module was remediated to remove, surviving
in the one method the remediation did not reach.

*Failure:* a sponsored student receives a 500,000 waiver. The sponsor's statement claims they
paid 500,000 more than they did — a figure a third party may reconcile against their own books
or dispute.

*Proof of fix:* a sponsor statement for a waived student reports the waiver under `waived`,
not `paidBySponsor`.

### P1 — correctness at the edges

| # | Finding | Invariant | Evidence |
|---|---|---|---|
| **P1-A** | Billing prices from the **mutable** `FeeStructure.components` JSON. `FeeStructureVersion`/`FeeItem` are written by `publish()` and read by nothing. `catalog.update` edits a published structure with no version bump and no status reset, contradicting its own docstring | §Pricing provenance *(new)* | `billing.service.ts:138`, `:331`; `catalog.service.ts:129`, `:161` |
| **P1-B** | `assertTermOpen` guards billing only. Payments, refunds, waiver apply, credit create/apply, adjustment approve, penalty cron and import posting all write into closed terms. Nothing validates the period of the *documents an operation touches* — only a DTO field | §Period control | Sole callers: `billing.service.ts:77`, `billing-run.service.ts:34` |
| **P1-C** | No allocation reversal exists. `PaymentAllocation` has no reversal representation, so refunding an *allocated* payment and correcting a mis-allocation are both structurally impossible | §Immutability | `model PaymentAllocation` |
| **P1-D** | `applyCredits` does money math in JS floats (`Number`, `Math.min`), with a comment self-exempting it — while `applyWaiver`, twenty lines away, uses `Prisma.Decimal` correctly | §Money precision | `advanced.service.ts:486` |
| **P1-E** | `FeeCredit.expiresAt` is never read; expired credits still apply. Schema statuses `expired` and `reversed` have no code path | §Refund / Credit | `advanced.service.ts:470` |
| **P1-F** | `FeeCreditAllocation` has no unique constraint; concurrent `applyCredits` can double-draw one credit | §Concurrency | `model FeeCreditAllocation` |
| **P1-G** | Billing does not require `feeStructure.status === 'published'` — a draft structure bills | §Pricing provenance *(new)* | `billing.service.ts:132` |
| **P1-H** | The collect wizard requires `unallocated === 0`, so **an overpayment cannot be recorded at all** — the single most common real bursar exception | — | `fees-subpages.tsx:193` |
| **P1-I** | `Sponsorship.capAmount` is written and read by nothing | — | `advanced.service.ts:71` |
| **P1-J** | `closeTerm`'s snapshot is wrapped in `catch {}`; a term closes with a placeholder marker when the snapshot fails. A financial close must be **fail-closed** | §Period control | `finance-controls.service.ts:232` |
| **P1-K** | The ledger has no opening-balance row and omits REFUND/REVERSAL, so no correct date-range statement can be produced — a September statement cannot explain the balance carried into September | §Outstanding AR | `school-finance-query.service.ts:143` |

### P2 — completeness and operability

| # | Finding | Invariant | Evidence |
|---|---|---|---|
| **P2-A** | No cash-custody reconciliation: `Payment` ↔ `CashMovement` ↔ bank/MoMo settlement is defined by the invariants and implemented nowhere | §Cash custody | `school-finance-query.service.ts:275` |
| **P2-B** | ADR-013 promises a CI test asserting cached columns equal their subledger (Gate 1/4). No such test exists | §Outstanding AR | `test/integration/school-fees-integrity.spec.ts` — 8 tests, none cover it |
| **P2-D** | `aging`, `feeDefaulters` and `studentArRows` read cached `amountResidual` rather than the event identity, so divergence is invisible to the reports most likely to expose it | §Outstanding AR | `advanced.service.ts:577`, `:794` |
| **P2-E** | `closeTerm`'s snapshot is an N+1 loop over up to 5000 students | — | `finance-controls.service.ts:218` |
| **P2-F** | `refundableAmount` subtracts **all** outbound payments for the partner, including non-fee refunds | §Refund / Credit | `school-finance-query.service.ts:439` |
| **P2-G** | No receipt search or reprint. `FeeReceipt` renders only from the in-memory result of the payment just taken; `reset()` discards it | — | `fees-subpages.tsx:37`, `:186` |

---

## 6. Deferred by decision — sponsorship

Sponsorship records a sponsor, a student and a `capAmount`, and produces a statement. It has no
sponsor-payment path: nothing collects money *from* a sponsor, nothing tracks consumption
against the cap, and the cap is never enforced. A sponsor capped at 500,000 can have 800,000
attributed to them.

**Decision:** fix P0-D, enforce the cap at allocation, then **disable sponsorship at the
controller** behind `SCHOOL_SPONSORSHIP_ENABLED` (default off) until the sponsor-payment path
exists. Hiding the UI is not the control — the endpoints return 403. The UI states plainly that
sponsorship is not production-ready rather than presenting a form that appears to work.

The deferred design, for whenever it is picked up:

```
Sponsorship
    └── SponsorshipCommitment   (term, capAmount, consumed)
            └── Sponsor invoice  (Document, partnerId = sponsor)
                    └── Sponsor payment
                            └── Allocation settling the STUDENT's AR
                                    └── Consumption recorded against the cap
```

The sponsor becomes a real payer with their own receivable, rather than an annotation on the
student's. Cap enforcement then falls out of the commitment, and the sponsor statement is
derived from events like every other statement.

---

## 7. Certification gates

The module is production-ready when every gate below is green in CI. Each is an executable
test, not a review judgement.

| Gate | Assertion |
|---|---|
| **G1 — Projection integrity** | `Document.amountPaid` = `SUM(posted PaymentAllocation)`; `amountWaived` = `SUM(applied Waiver)`; `amountResidual` = the full event identity; `FeeCredit.remaining` = `amount − SUM(FeeCreditAllocation)` |
| **G2 — Subledger ⇄ GL** | Current AR subledger = GL AR control, aggregate and per-student; outstanding credits = GL `FEE-CR` |
| **G3 — Cash custody** | `Payment` ↔ `CashMovement` ↔ GL cash/bank/clearing at zero variance (operational); settlement lag reported separately and aged |
| **G4 — Concurrency** | Parallel duplicate billing yields one invoice; parallel duplicate external payment reference yields one payment; repeated cash narration is never blocked |
| **G5 — Atomicity** | An injected failure at any point in billing, payment or waiver leaves no document, no journal entry, no cash movement, no allocation |
| **G6 — Period control** | Every write path rejects a closed term, including allocation to a closed-term document from an open-term request |
| **G7 — Pricing provenance** | Every invoice line traces to an immutable `FeeItem`; editing a published structure is refused; a mid-term edit cannot alter a re-run's total |
| **G8 — Entitlement uniqueness** | A refunded credit can be neither refunded nor applied again; an overpayment and the credit it funded are never two pots |
| **G9 — Statement completeness** | `Opening + Charges + Penalties − Payments − Credits − Waivers − Refunds ± Adjustments = Closing` for any date range |

---

## 8. Roadmap

| Phase | Content | Gates cleared |
|---|---|---|
| **0** | Pre-migration data audit — six checks, hard gate, exits non-zero on any failure | — |
| **1** | P0 blockers: reference semantics split, integrity migration, `feeStructureVersionId` backfill, credit-refund drawdown, sponsor statement | G4, G8 |
| **2** | Immutability and period control: version-priced billing, published-only billing, period check on every affected document, Decimal credit math, credit expiry, fail-closed term close | G6, G7 |
| **3** | Three reversal state machines: credit refund, allocation reversal, payment reversal | G1 |
| **4** | Reconciliation and executable invariants: cash custody split operational/settlement, cached-projection gate, opening-balance ledger, concurrency and rollback suites | G1, G2, G3, G5, G9 |
| **5** | Sponsorship containment: cap enforcement, controller-level disable | — |
| **6** | Bursar workflow: overpayment capture, receipt search and reprint, allocation correction in the UI | — |

**Sequencing constraints:** Phase 0 gates Phase 1; the `feeStructureVersionId` backfill in
Phase 1c gates the defense-in-depth constraint it enables; Phase 3's reversal service is a
prerequisite for the allocated-payment refund path and for G1.

---

## 9. Method and limits

Static review of every write path in `apps/api/src/modules/school/fees/` plus its callers in the
payment, posting and document engines, read against `FINANCIAL_INVARIANTS.md` clause by clause.
Schema claims were verified against `schema.prisma` **and** the migration history — which is how
P0-A was found: the constraint is documented in a comment, and exists nowhere else.

**Not covered by this pass:** runtime verification against `schooldb-planet` (Phase 0 performs
it), load and volume behaviour, the guardian-facing portal, and the Fees module's interaction
with Transport, Hostel and Cafeteria charges beyond confirming they share
`SCHOOL_FEE_SOURCE_TYPES`.
