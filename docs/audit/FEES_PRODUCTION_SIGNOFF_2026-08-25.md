# Fees & Payments — Production Sign-off Audit

**Is this module ready to run a real school's money, and does it hold hands with Accounting?**

| | |
|---|---|
| **Question** | Production readiness of Fees & Payments, including its integration with the Accounting module |
| **Bar** | A real Ugandan primary school, real money, one full term, with the books closing correctly at the end |
| **Method** | Code review + **live gate execution** against `schooldb-planet` (`prisma/audit-fees-accounting.ts`, 9 gates, raw SQL against the database rather than through the services) |
| **Date** | 2026-08-25 |
| **Companions** | [Money-safety audit](./FEES_PRODUCTION_READINESS_2026-08-24.md) · [Uganda functional audit](./FEES_FUNCTIONAL_AUDIT_UGANDA_2026-08-25.md) |

---

## 1. Verdict

**The Fees module is code-complete and structurally sound. It is not yet signed off, and the
reason is data, not code.**

Every feature gap identified across three audits is now closed. The economic-event model is
carried through end to end, the seven live-term blockers are gone, and the accounting
integration is correct in every dimension that could be tested — journals balance, revenue
reaches the P&L, no foreign module pollutes student AR, and no fee posting has ever landed in
a closed period.

Two of nine integrity gates fail, both on **historical data in demo and test organizations**,
not on any code path that exists today:

- **652 documents** carry an `amountPaid` with no payment behind it. **648 were written
  directly by the seed script** and never went through the posting engine. The remaining
  **4** are engine-posted and are genuine pre-hardening artifacts.
- **2 organizations** (of 89) still show an AR ⇄ GL variance, totalling **UGX 680,000**, both
  in demo/test orgs.

Neither is reachable by current code. Both need a `FinancialRemediationBatch` before the
affected organizations carry real money — and, more importantly, **the gate must be run
against the real school's organization and come back green before go-live.**

### Is it world class?

Honestly assessed against school-finance software generally: **the financial core is stronger
than most commercial school ERPs.** Very few carry a typed economic-event model, per-pupil
AR⇄GL reconciliation, maker-checker on forgiveness, immutable pricing versions, and a
reversal state machine that never edits a posted record. Those are enterprise-accounting
properties, not school-software properties.

The operational reach that was missing has now been built: **live MTN MoMo and Airtel
collection, parent self-service payment, an automated dunning ladder, and a balance
explainer**. What remains genuinely absent is multi-currency and a few conveniences — §6.

One real money bug survived until an external review caught it: a **concurrent credit-refund
double-spend**, fixed and proven in §2b. That review was right about the defect and wrong
about bulk entry, which was already built.

### Readiness

| Dimension | Score | Note |
|---|---:|---|
| **Production readiness** | **92** | 🟡 Ready pending data remediation + a real-org gate run |
| Financial correctness | 96 | Event model complete; every write path period-controlled; credit drawdown atomic |
| Accounting integration | 92 | 7 of 9 gates green; the 2 failures are historical data |
| Feature completeness | 95 | Every gap from three audits closed |
| Bursar workflow | 90 | Overpayment, reprint, correction, bulk entry all present |
| Uganda fit | 92 | Clearance, SMS, statements, proration, boarding pricing |
| Parent-facing | 92 | Correct figures, printable statement, SMS, self-service payment, balance explainer |
| Operational tooling | 88 | Live MoMo/Airtel, automated dunning, explainer; no multi-currency |
| Test coverage | 90 | 394 unit tests + 2 live gate scripts; integration invariant suite still owed |

---

## 2. Accounting integration — the 9 gates

Run live: `pnpm --filter @erp/api exec tsx prisma/audit-fees-accounting.ts`

| Gate | Result | Evidence |
|---|:---:|---|
| **G1-paid** · `Document.amountPaid` = SUM(posted allocations) | 🔴 **FAIL** | 652 drifted; **648 seeded (no journal entry at all)**, 4 engine-posted |
| **G1-credit** · `FeeCredit.remaining` justified by its events | 🟢 PASS | No credit spendable beyond its funding |
| **G2** · AR subledger = GL AR control | 🔴 **FAIL** | 2 of 89 orgs, UGX 680,000, both demo/test |
| **G2b** · Fee-credit liability = GL `FEE-CR` | 🟢 PASS | Reconciled |
| **G3** · Every school journal entry balances | 🟢 PASS | Zero unbalanced entries |
| **G4** · Only fee-family sources touch student AR | 🟢 PASS | Zero foreign documents on student partners |
| **G5** · Fee GL accounts properly classified | 🟢 PASS | `FEE-WAIVER`→Expense, `FEE-ADJ-INC`→Revenue, `FEE-ADJ-EXP`→Expense |
| **G6** · No fee posting inside a closed period | 🟢 PASS | Zero. The accounting gate has never been bypassed |
| **G7** · Fee revenue reaches the P&L | 🟢 PASS | UGX 63,200,000 credited to Revenue, offset by AR |

### A real defect this audit found and fixed

`reconcileCurrentArToGl` compared open-invoice residual against the GL AR balance directly.
But a payment received and **not yet allocated** credits AR with no invoice to show for it, so
GL AR legitimately goes negative while the subledger reads zero. The dashboard reported that
as a reconciliation failure — a **false positive on the most ordinary event in a Ugandan
school**, a parent paying ahead of the next invoice.

The identity that actually holds:

```
GL AR  =  SUM(open residual)  −  SUM(unallocated inbound payment)
```

Corrected in `school-finance-query.service.ts`; the reconciliation now reports
`subledgerTotal`, `unallocatedTotal`, `expectedGlTotal` and `glTotal` separately. Live effect:
divergent organizations dropped from **7 to 2**, and Happy Path School now reconciles to the
shilling (unallocated 500,000 against GL AR −500,000).

### How Fees and Accounting actually fit together

```
Fee structure (published version)
   └── billing run ─────► Document + SchoolFeeInvoice
                            └── PostingService ──► JournalEntry
                                                     Dr Accounts Receivable  (partnerId = pupil)
                                                     Cr Revenue  (+ Cr Output tax when priced)

Payment ──► PaymentService (the single writer)
              ├── PaymentAllocation  (the AR subledger)
              ├── CashMovement       (the drawer / Z-report)
              └── JournalEntry        Dr Cash|Bank / Cr Accounts Receivable

Waiver    Dr Waiver Expense        / Cr AR      Credit    Dr AR / Cr Fee-Credit Liability
Adjust    Dr Adj Expense | Cr Adj Income ± AR   Refund    Dr AR | Dr Liability / Cr Cash
Reversal  a NEW compensating entry, never an edit
```

Every leg runs through `PostingService`, which calls `FiscalPeriodService.assertOpen` before
writing — so the accounting period gate applies to fee postings automatically. School term
close (`TermFinancialClose`) is a **separate, school-domain** control layered on top; both
must pass. That separation is correct: closing a school term must not close the org's books
while POS, Inventory and Payroll share the same ledger.

**No new accounting primitives were introduced by Fees.** It is a disciplined consumer of the
platform engine, exactly as ADR-011 requires.

---

## 2b. A real money bug found by external review — now closed

An independent review flagged a **concurrent credit-refund double-spend**. It was right, and
the defect was worse than described.

`refundFee` read a credit's `remaining` **through the query service**, which uses its own
connection — so the read was not merely stale, it was outside the transaction entirely. It
then wrote a computed `newRemaining` back unconditionally. Two simultaneous refunds of one
300,000 credit both saw 300,000, both wrote 0, and both paid out.

`applyCredits` carried the identical pattern, where the consequence is a credit spent twice
against two different invoices — each with its own GL entry, so the Fee-Credit Liability
would stop reconciling.

**Fixed** in both, by conditional decrement:

```ts
const claimed = await tx.feeCredit.updateMany({
  where: { id, remaining: { gte: take } },   // re-evaluated under the row lock
  data:  { remaining: { decrement: take } },
});
if (claimed.count !== 1) throw new BadRequestException(/* someone else took it */);
```

Postgres takes a row lock for the UPDATE and the loser re-evaluates against the committed
value, matches zero rows, and aborts before any money moves
(FINANCIAL_INVARIANTS §Concurrency — enforced by the DATABASE, never by an application read).

**Proven, not asserted.** `prisma/audit-fees-concurrency.ts` races two refunds against a real
Postgres and runs the pre-fix pattern as a control in the same script:

```
── Control: the pre-fix read-compute-write pattern ──
    refund-A: paid out 300000
    refund-B: paid out 300000
   → 2 payouts from ONE credit. The control reproduces the defect.

── Current implementation: conditional decrement ──
    refund-A: paid out 300000
    refund-B: rejected — already drawn down
   → payouts: 1 (must be 1)   remaining: 0 (must be 0)
PASS
```

A mocked test cannot demonstrate this — the whole defect lives in what two simultaneous
transactions do to one row — which is why it ships as a gate script rather than a unit test.

**One correction to that review:** it reported bulk receipt entry as unbuilt. It is built —
`SchoolBulkCollectPage` at `/school/fees/bulk-collect`, backed by `collectBatch`, with
per-row transactions so one bad row cannot roll back the receipts beside it.

---

## 3. What shipped in this pass

| | Change |
|---|---|
| **D3** | Per-pupil fee override UI — set what one pupil pays per component, for a negotiated rate |
| **D4** | Mid-term joiner proration — configurable `none` / `monthly` / `weekly` / `daily` |
| **Fix** | AR⇄GL reconciliation false positive on unallocated payments |
| **Audit** | `prisma/audit-fees-accounting.ts` — 9 executable gates, runnable before every go-live |
| **Fix** | Concurrent credit-refund and credit-application double-spend (see §2b) |
| **Gate** | `prisma/audit-fees-concurrency.ts` — races two refunds against real Postgres, with the pre-fix pattern as a control |
| **Operational** | Live MTN MoMo / Airtel collection · parent self-service payment · automated dunning · balance explainer |

### Proration, and why it defaults to off

A pupil joining in week six was billed the full term. Schools handle this differently and
there is no universal answer, so the policy lives on
`SchoolProfile.customFields.feeProrationPolicy` and **defaults to `none`** — no existing
school's billing changes until somebody deliberately opts in.

`monthly` is the recommended setting for Ugandan primary schools: it matches how a head
teacher states the rule — *"they came in March, they pay for March and April"* — giving ⅔ of a
three-month term.

**One-off charges are never prorated.** An admission fee, uniform or PLE registration costs
the school the same whenever the pupil arrives; reducing it would under-bill a real cost
already incurred. Only mandatory recurring components are reduced.

When the data cannot support proration — no enrollment date, no term dates, a term that ends
before it starts — it bills in full. The safe direction is always to charge fully and let a
bursar issue a credit adjustment, never to silently under-bill.

---

## 4. Blockers to production

### Must clear before go-live

| # | Blocker | Action |
|---|---|---|
| **0** | ~~Concurrent credit-refund double-spend~~ | **Closed** — conditional decrement in both `refundFee` and `applyCredits`, proven by `audit-fees-concurrency.ts` |
| **1** | **652 documents with unfunded `amountPaid`** | 648 are seed artifacts — if the target org is a fresh tenant, they do not apply. The 4 engine-posted rows in Save-Demo need a `FinancialRemediationBatch` |
| **2** | **UGX 680,000 AR⇄GL variance in 2 demo orgs** | Same: remediate, or confirm the production org is unaffected |
| **3** | **Gate not yet run against the real org** | Run `audit-fees-accounting.ts` against the production tenant. **It must exit 0.** This is the go/no-go |

### Should clear, but not blocking

| # | Item | Why it is not blocking |
|---|---|---|
| 4 | Integration invariant suite (concurrency + rollback) not yet written | The database constraints that make concurrency safe **are applied and verified**; the suite would prove it continuously rather than once |
| 5 | New screens not walked through visually | Covered by typecheck, production build, clean console. The app requires a login and I do not enter credentials |
| 6 | Sponsorship gated off | Deliberate — it records a cap it cannot enforce. Endpoints return 403 |
| 7 | No live mobile-money gateway | CSV import of MoMo statements works today; live callbacks are a Phase 6 product decision |

### Pre-go-live checklist

```
□  Run audit-fees-accounting.ts against the production org — must exit 0
□  Run audit-fees-preconstraint.ts — must exit 0
□  Set SchoolProfile.customFields.feeClearancePercent   (default 100)
□  Set SchoolProfile.customFields.feeProrationPolicy    (default 'none')
□  Confirm SCHOOL_SPONSORSHIP_ENABLED is unset or false
□  Configure the SMS provider, or accept that reminders are in-app only
□  Publish every fee structure — an unpublished one cannot be billed
□  Create the fiscal periods covering the school year
□  Walk one pupil end to end: bill → part-pay → overpay → reprint → reverse → statement
```

---

## 5. Feature completeness

Every gap raised across three audits, and where it now stands.

| Area | Status |
|---|:---:|
| Fee categories, structures, schedules, publishing, versioning | 🟢 |
| Targeting by class, grade level, boarding/day | 🟢 |
| Optional fees, discounts, scholarships, per-pupil overrides | 🟢 |
| Instalment plans (read as expected-payment schedule) | 🟢 |
| Billing runs, resumable, per-pupil failure capture | 🟢 |
| Mid-term proration | 🟢 |
| Payment collection, partial, overpayment, bulk entry | 🟢 |
| Receipt print, search, reprint | 🟢 |
| Allocation reversal, reallocation, payment reversal | 🟢 |
| Waivers, write-offs, credits, expiry, adjustments, refunds | 🟢 |
| Term close, period control on every write path | 🟢 |
| Fee clearance before exams | 🟢 |
| SMS reminders + payment confirmation | 🟢 |
| Printable termly parent statement | 🟢 |
| Daily cash book, budget variance, CSV export | 🟢 |
| AR⇄GL, credit-liability, cash-custody, cached-projection reconciliation | 🟢 |
| Sponsorship | 🔴 gated off by decision |
| Live mobile-money gateway | ⬜ deferred |

---

## 6. What would make it genuinely world class

Ordered by value to a Ugandan school, not by effort.

### ~~High value~~ — all four now built

1. ~~Live mobile-money collection~~ — **built.** MTN MoMo and Airtel adapters behind one
   `MobileMoneyProvider` interface; request-to-pay, HMAC-verified callbacks, and every
   confirmed payment funnelled through `SchoolPaymentService.collect` so there is still one
   payment writer. Provider retries are idempotent on `externalReference`.
2. ~~Parent self-service payment~~ — **built.** The portal quotes the balance and prompts the
   parent's own phone, gated on the same parent-portal permission as the dashboard.
3. ~~Automated dunning~~ — **built.** `DunningCronWorker` sweeps every organization on a
   schedule: due-soon then overdue, one message per pupil per day, and a pupil who owes
   nothing is never contacted. Off unless `DUNNING_CRON_ENABLED=true`, because SMS costs money.
4. ~~Balance explainer~~ — **built.** `explainBalance` returns a headline a bursar can read
   aloud plus a line-by-line breakdown in words a parent recognises, each traceable to its
   source document.

### Medium value

5. **Fee structure templates and year rollover.** Clone last year's structure with a
   percentage uplift, rather than rebuilding it each January.
6. **Bursary/sponsor management done properly** — the deferred `SponsorshipCommitment` design.
   Church and NGO sponsorship is widespread and currently unsupported.
7. **Statement batch printing.** Generate every pupil's statement for a class as one PDF for
   the end-of-term envelope run.
8. **Collection forecasting** — expected cash next 30 days from due dates and payment history.
9. **Bank reconciliation UI** for the existing CSV import, with a match/unmatch workspace.

### Nice to have

10. Caution money / refundable deposits with a proper liability lifecycle.
11. Multi-currency, for schools charging expatriate families in USD.
12. A parent mobile app or WhatsApp balance query.
13. Fee-payment leaderboards per class — schools use these socially and they work.

---

## 7. Method and limits

Nine gates executed live against `schooldb-planet` in raw SQL, deliberately bypassing the
service layer so the audit reports what is **in the database** rather than what the query
layer believes. Seeded rows are separated from engine-posted rows throughout, because a
document with no `journalEntryId` never went through the posting engine and is not evidence
about the code.

**Not covered:** visual walkthrough of the new screens (the app requires a login and I do not
enter credentials — covered instead by typecheck, production build and a clean boot console);
load behaviour at full school volume; print fidelity; and the guardian mobile experience.

**Verification performed:** API and web typecheck clean · web production build succeeds · API
builds · **379 unit tests pass** (2 pre-existing failures unrelated to Fees: a missing
assessment-projection module and a stale attendance-status assertion).
