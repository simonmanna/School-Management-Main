# Financial Invariants

**Authority: every finance-touching module** — Fees, POS, Inventory, HR Payroll,
Accounting, Cafeteria, Transport, Admissions. These are hard rules, not
aspirations. Each has an automated test; the production certification gates
(see the Fees & Finance hardening plan) verify them.

Frozen by ADR-013. Do not weaken a rule here without a superseding ADR.

---

## Economic-event integrity — the master rule

```
Every financial change originates as a TYPED ECONOMIC EVENT that persists
atomically with BOTH its subledger effect AND its accounting effect.

Forbidden anywhere in school finance:
    document.amountResidual -= amount
    document.amountPaid    += amount
with no corresponding typed event.

Event types: INVOICE · PENALTY · PAYMENT · WAIVER · CREDIT_APPLIED
             REFUND · WRITE_OFF · ADJUSTMENT · REVERSAL
```

## Document — two independent dimensions

```
Document.status         draft | posted | paid | cancelled          ← lifecycle
Document.paymentStatus  not_paid | partial | paid | overpaid        ← settlement

Financially active  ⟺  status IN (posted, paid)

paymentStatus NEVER substitutes for lifecycle filtering.
```

`draft` and `cancelled` documents never appear in a balance and can never be
settled by a payment. `paid` is a lifecycle terminal (residual zero) and still
counts as billed.

## Receivable classification

```
Which sourceTypes are student receivables is declared once, per source, in
FINANCIAL_DOCUMENT_PROFILES (school/fees/fee-document.constants.ts):
  school_fee · school_penalty · library_fine · school_meal · school_transport ·
  school_admission_fee                              → receivable, in balance
  meal_wallet                                       → stored value, NOT in balance

Every balance / aging / clearance / portal / statement / collection query
derives its filter from the profiles. A new billable source is one profile.
```

Enforced by `fees-accounting-integrity.spec.ts`: every school `sales_invoice`
source must be classified.

## Invoice posting

```
Dr Receivable = Document.totalAmount = Σ revenue credits + Σ output-tax credits
```

Built only by `DocumentBuilderService.salesPostingLines`, which refuses a
document whose header and lines disagree by more than 0.01. No caller assembles
invoice journal lines itself.

## Outstanding AR — expressed as economic events, not allocation rows

```
Outstanding AR =
      posted charges
    + valid debit adjustments
    + refunded allocated payments        ← re-enters AR
    − valid payment allocations
    − valid waivers
    − valid credit applications
    − valid write-offs
```

**Refund rule.** A refund of an *allocated* payment increases outstanding AR. A
refund of *unallocated* cash does not create AR. The former is represented by
reversing the original allocation, producing a `REVERSAL` event.

`Document.amountResidual` is the cached projection of this identity, never an
independent input.

## Economic-entitlement uniqueness

```
A monetary entitlement must NOT be simultaneously represented as
refundable/unallocated Payment value AND outstanding FeeCredit value.
```

## Payment disposition

```
Payment.amount = allocated + unallocated + refunded + other valid disposition
allocatedAmount ≤ tenderAmount
```

## Cash custody — method-aware

```
Direct cash/bank:   Payment = CashMovement = GL cash/bank
Provider-settled:   Dr Clearing / Cr AR ; Dr Fees + Dr Bank / Cr Clearing
                    Payment gross ≠ bank settlement — reconcile through clearing.
```

Settlement account by payment method (`AccountDeterminationService.settlementAccount`):
cash → `default_cash`; bank/cheque → `default_bank`; mobile_money →
`mobile_money_clearing` (or the gateway's own clearing account); card →
`card_clearing`. Digital money is never booked as cash in hand. A provider
payout is `MobileMoneySettlement`; the clearing GL balance equals succeeded,
unsettled collections.

## Refund / Credit

```
refundedAmount           ≤ refundableAmount
SUM(FeeCreditAllocation) ≤ FeeCredit.amount
SUM(FeeCredit outstanding) = GL Fee-Credit Liability balance
```

## Journal

```
SUM(debits) = SUM(credits)               for every posted entry
```

## AR ⇄ GL — two modes, never mixed

```
CURRENT-STATE   current AR subledger        = current GL AR balance
AS-OF (T)       AR transactions through T   = GL AR transactions through T
FORBIDDEN       current Document residual   = historical GL balance at T
```

Per-student works via `JournalLine.partnerId`; aggregate sums the subledger.

## Money precision

```
Storage      Decimal(20,6) — never float, never a JS number column
Arithmetic   dec() / round() from kernel/common/money — never JS float math
Internal     full Decimal precision retained through tax and allocation math
Display      rounded to currency precision at the presentation edge only (UGX → 0 dp)
```

## Pricing provenance

```
No financial transaction may derive its price from MUTABLE configuration.

    FeeStructure → published FeeStructureVersion → FeeItem → billing → DocumentLine

Once invoiced, DocumentLine is the final immutable economic record. Editing a
published pricing record is forbidden; a change is a new version.
```

Changing a fee structure must never alter what an already-issued invoice says, nor
what a re-run of a completed billing period would produce.

## Terminology

```
amountPaid = REALIZED PAYMENT CONSIDERATION allocated to the document —
any tender method (cash, bank, mobile money, card, cheque, transfer).
EXCLUDES non-payment reductions: waivers, credits, write-offs, adjustments.
```

## Immutability

```
Posted financial records are immutable. Corrections are performed only through
compensating/reversal transactions — never by editing the amount, account, date,
partner, or journal lines of a posted record.

A posted PaymentAllocation is never edited. Reallocation =
    reverse original allocation → create replacement allocation.
```

## Atomicity

```
No partial financial transaction survives a failed transaction. A failure at any
point leaves NO document, NO journal entry, NO cash movement, NO allocation,
NO subledger row.

Forbidden: returning early from inside a transaction callback after a write —
a return COMMITS. Use an explicit throw to abort.
```

The forbidden pattern above is not hypothetical: it is the root cause of P0-2,
where a partial waiver committed a subledger change with no GL entry.

## Concurrency

```
Financial uniqueness is enforced by DATABASE business-key constraints,
never solely by application existence checks. Applies to: billing,
payment imports, credits, waivers, penalty runs.
```

## Period control

```
No financial transaction posts into a closed or locked accounting period.
Reopening requires maker-checker authorization and is itself audited.
School-term financial close is a SEPARATE school-domain control.

A mutation validates the period of EVERY document it touches — never only the
period named in the request. A payment taken in Term 2 may not be allocated to
a Term 1 document once Term 1 is closed.
```

A document's term: tuition via its SchoolFeeInvoice; a penalty via its source
invoice; meal / transport via their `MEALS-<term>` / `TRANSPORT-<term>`
reference. Admission fees are not term-bound. The term-close snapshot sums only
that term's documents and only valid rows (posted allocations, posted credit
applications, per-document `amountWaived`, posted adjustments), and reports
`residualVariance` = stored residuals − transaction-derived balance.

## Tenancy

```
Every financial query is tenant-scoped, including raw SQL.
```

A public callback resolves its tenant from its own row (MoMo request →
gateway account) and verifies the signature with that tenant's secret BEFORE
entering the tenant context and touching money. Outbox event handlers run in
the publishing tenant's context.

## Idempotency

```
Same external/reference key → same financial transaction → never a duplicate.
```
