# Functional Audit — School Fees & Payments for Ugandan Primary Schools

> **⚠️ SUPERSEDED — this document is a point-in-time snapshot, not current state.**
>
> It records the module as it stood *before* Phases B–E were built, on the morning of
> 2026-08-25. Its status columns are therefore stale: overpayment capture, receipt reprint,
> the correction UI, bulk entry, fee clearance, SMS and the printable statement were all
> marked missing here and have since shipped.
>
> **For current state read [`FEES_PRODUCTION_SIGNOFF_2026-08-25.md`](./FEES_PRODUCTION_SIGNOFF_2026-08-25.md).**
> This file is kept because the gap analysis and the Uganda requirements matrix are still
> the reasoning behind what was built — but do not cite its 🔴/⬜ marks as fact.


**Can a bursar run one school, one full term, on this?**

| | |
|---|---|
| **Question** | Feature completeness and daily workflow — *not* financial correctness, which is audited separately |
| **Bar** | One real Ugandan primary school, one full live term. Not a demo; not multi-school SaaS |
| **Companion** | [`FEES_PRODUCTION_READINESS_2026-08-24.md`](./FEES_PRODUCTION_READINESS_2026-08-24.md) — the money-safety audit. This document does not repeat it |
| **Branch** | `school/assessment-canonical-ledger` |
| **Date** | 2026-08-25 |

---

## 1. Executive Summary

The correctness audit asked whether money can be created, destroyed or double-counted. This
one asks something a head teacher would recognise: **on the first Monday of term, can the
bursar actually use this?**

The answer is not yet — but the reasons are different from the correctness gaps, and mostly
shallower.

**What is genuinely strong.** The money engine is better than most school software: every
balance change is a typed economic event, billing is precedence-correct (opt-in →
per-student override → structure amount), optional fees only bill pupils who opted in,
partial payment is a first-class model rather than an afterthought, penalties run on a
cron, mobile-money and bank statements import with confidence-scored matching, and AR
reconciles to the general ledger per pupil. **Carry-forward works correctly** — an unpaid
Term 1 invoice stays open and Term 2's money settles it oldest-first, which is the thing
schools most fear getting wrong.

**What is missing is almost all at the edges the bursar touches every day.** An overpayment
cannot be recorded. Yesterday's receipt cannot be found or reprinted. A mis-keyed receipt
cannot be corrected from the UI (the API can do it; nothing calls it). There is no bulk
entry for reporting day, when two hundred parents arrive at once. There is no Discounts
page, so sibling and staff-child discounts — near-universal in Ugandan schools — cannot be
configured, even though the billing engine applies them and the React hooks were written
and left dead.

**Two Uganda essentials are absent with the infrastructure already sitting unused.** There
is no SMS fee reminder, though `NotificationsService` exists and the attendance module
already sends guardian SMS through it. And there is no printable termly statement — the
single artifact a Ugandan parent most expects to be handed.

**One gap is structural rather than cosmetic:** nothing implements fee clearance before
exams. The report card template already prints *"All fees must be cleared before the first
day of term"*, but no code decides whether a pupil is cleared.

### Three live defects, one of them self-inflicted

| | Defect | Severity |
|---|---|---|
| **D1** | Parent portal **and** bursar statement report waivers and credits as money paid | 🔴 P0 |
| **D2** | Fee structures cannot target a grade level — a "P1–P3" structure bills the whole school | 🟠 P1 |
| **D3** | Billing is unreachable from the UI — a regression from the correctness remediation | 🔴 P0 |

### Verdict

| Dimension | Score | Note |
|---|---:|---|
| **Ready for one school, one term** | **58** | 🔴 Not yet — bursar cannot complete a normal day |
| Fee catalog & setup | 70 | Strong, minus Discounts UI, publish UI and grade targeting |
| Billing engine | 85 | Correct and complete; blocked only by D3 |
| Collection workflow | 55 | Good wizard, but no overpayment, no reprint, no correction, no bulk |
| Reductions & corrections | 88 | Complete backend; correction UI missing |
| Controls & approvals | 80 | Strong; fee clearance absent |
| Reporting | 72 | Good on screen; nothing prints or exports |
| Parent-facing | 25 | Wrong figures, no statement, no SMS |
| Uganda fit | 60 | Core fits well; instalments, clearance, SMS, boarding pricing missing |

---

## 2. Live defects found in this pass

### D1 · Parents and bursars are shown waivers as money paid — P0

The defect corrected in `sponsorStatement` during the correctness remediation exists in two
further places, both of them the primary artifacts a family actually sees:

```ts
// portals.service.ts:325 — the parent portal
return { total, paid: total - balance, balance, invoiceCount };

// people/student.service.ts:347 — the bursar statement,
// and the data source behind the payment wizard
const totalPaid = totalBilled - balance;
```

`balance` sums `amountResidual`, which waivers, credit applications and credit adjustments
all reduce. Every forgiven shilling is therefore reported as money the family paid.

Both methods carry a docstring stating *"The honest figure comes from PaymentAllocation …
this method then delegates to it."* **Neither delegates.** The comment describes an
intention that was never carried out.

The bursar statement is the worse of the two: it renders `totalPaid` directly beside a
`payments` array listing the actual receipts, so on any pupil who has ever received a
waiver the two figures on the same screen contradict each other.

> **Correction to the companion audit.** It lists "Portal, statement and ledger all
> delegate to the query service" under *what already holds*. That is wrong. Only the ledger
> delegates.

**Ugandan impact.** Waivers and bursaries are common — church sponsorship, staff children,
hardship cases. Telling a parent they have paid 400,000 when they paid nothing and were
forgiven 400,000 is the kind of error that ends in an argument at the bursar's window.

### D2 · Fee structures cannot target a grade level — P1

`FeeStructure.applicableTo` is documented in the schema as
`{gradeLevelIds:[...], classIds:[...]}`. `discountApplies` honours both. The
structure-level filter honours only one:

```ts
// billing.service.ts:607
private appliesTo(filter: any, classId: string): boolean {
  if (!filter || typeof filter !== 'object') return true;
  if (Array.isArray(filter.classIds) && filter.classIds.length > 0) {
    return filter.classIds.includes(classId);
  }
  return true;   // gradeLevelIds present but ignored → applies to EVERYONE
}
```

A structure scoped to grade levels P1–P3 bills the entire school, including P7. Silent
over-billing, in the direction that produces complaints rather than losses.

**Ugandan impact.** Fees in a primary school are conventionally set per *grade band* — a P7
pupil pays more than a P1 pupil, and P7 additionally carries PLE registration. Expressing
that by grade level is the natural configuration, and it silently does the wrong thing.

### D3 · Billing is unreachable from the UI — P0, regression

The correctness remediation made billing refuse any structure without a published
`FeeStructureVersion`. That rule is right — it is what stops an edit to a published fee
structure from silently changing what the next run charges.

But **no UI calls `POST /fee-structures/:id/publish`.** The hooks were written —
`usePublishFeeStructure` and `useFeeStructureVersions` both exist in the web API layer — and
then never wired to a page, so there is no publish button anywhere. A bursar can build a
structure and schedule it to a term, then the billing run skips every pupil with
`unpriceable_structure` and no obvious way forward.

(This is the third instance of the same pattern in the fees UI: hooks written, page never
built. `useDiscounts` and `useCreateDiscount` are dead the same way.)

This is a regression introduced by the hardening work, and it must ship fixed in the same
change as the migration and backfill — not after them.

---

## 3. Feature inventory

🟢 production-ready · 🟡 works with a named gap · 🟠 API only, no UI · 🔴 built but broken or
unusable · ⬜ not built

### A. Fee catalog & setup

| Capability | Status | Note |
|---|:---:|---|
| Fee Categories — mandatory/optional, payment order | 🟢 | CRUD + page |
| Fee Structures — component builder against the category catalog | 🟢 | Page works well |
| Publish / versioning | 🔴 | Endpoint exists, **no UI**, and billing now requires it (D3) |
| Fee Schedules — structure → term + due date | 🟢 | Page |
| Optional fees — per-pupil opt-in, roster, bulk assign | 🟢 | Billing gate verified by test |
| Per-pupil amount override | 🟠 | `StudentFeeAssignment` API only |
| Discounts | 🔴 | Engine applies them; API + hooks exist; **no page**, hooks are dead code |
| Scholarships / bursaries — percent & fixed, pro-rata | 🟢 | Pro-rata distribution verified |
| Instalment plans | 🔴 | Model, CRUD and hook exist; **never read by billing or collection** |
| Penalty rules | 🟢 | Tab |
| Targeting by class | 🟢 | |
| Targeting by grade level | 🔴 | Documented, ignored (D2) |
| Targeting by boarding / day | ⬜ | `residenceType` exists on the pupil, unusable for fees |

### B. Billing

| Capability | Status | Note |
|---|:---:|---|
| Term billing run — whole school or one class | 🟢 | |
| Resumable run with per-pupil failure capture | 🟢 | `BillingRun` / `BillingRunItem` + page |
| Single-pupil billing | 🟢 | |
| Precedence: opt-in → override → structure | 🟢 | Tested |
| Application-level idempotency | 🟢 | |
| Database-level idempotency | 🟡 | Migration written, **not yet applied** |
| Late-fee / penalty run + daily cron | 🟢 | |
| Carry-forward of unpaid prior-term balance | 🟢 | Correct — open invoices persist, oldest-first settles |
| Mid-term joiner proration | ⬜ | A pupil joining in week 6 is billed the full term |

### C. Collection

| Capability | Status | Note |
|---|:---:|---|
| Payment wizard — find pupil → allocate → confirm → receipt | 🟢 | Genuinely well built |
| Cash / bank / mobile money / card | 🟢 | |
| Explicit per-invoice allocation | 🟢 | The right model for partial payment |
| Oldest-first auto-allocation | 🟢 | |
| Partial payment | 🟢 | The Ugandan norm, handled properly |
| Overpayment capture | 🔴 | Wizard requires `unallocated === 0` |
| Receipt print | 🟡 | Prints once from memory; lost on reset |
| Receipt search / reprint | ⬜ | Cannot reproduce yesterday's receipt |
| Bulk receipt entry | ⬜ | One pupil at a time — painful on reporting day |
| MoMo / bank statement CSV import + matching | 🟢 | Admission-# auto, fuzzy manual-only |
| Live MoMo / Airtel gateway | ⬜ | Deferred by decision |
| Cash session / Z-report integration | 🟢 | `CashMovement` written |

### D. Reductions & corrections

| Capability | Status | Note |
|---|:---:|---|
| Waivers, waiver categories, maker-checker | 🟢 | |
| Bad-debt write-off | 🟢 | |
| Fee credits, origin-gated | 🟢 | |
| Credit expiry | 🟢 | |
| Adjustments — typed, approved, GL-posted | 🟢 | |
| Refund of unallocated cash or credit | 🟢 | |
| Refund of an allocated payment | 🟢 | Needs the migration applied |
| Allocation reversal / re-allocation | 🟢 API · ⬜ UI | Bursar cannot fix a mis-allocation |
| Payment reversal | 🟢 API · ⬜ UI | |
| Sponsorship | 🔴 | Deliberately gated off — no sponsor-payment path |

### E. Controls

| Capability | Status | Note |
|---|:---:|---|
| Term financial close + reopen, maker-checker | 🟢 | |
| Period control on every write path | 🟢 | |
| Permission split — collect / waive / refund / write-off / close | 🟢 | |
| Audit trail | 🟢 | |
| Fee clearance / exam gating | ⬜ | Report cards already promise it; nothing implements it |

### F. Reporting

| Capability | Status | Note |
|---|:---:|---|
| Finance dashboard | 🟢 | Collected, outstanding, live reconciliation status |
| Outstanding by class | 🟢 | |
| Daily collections, 30 days | 🟢 | |
| AR aging buckets | 🟢 | |
| Fee defaulters by class, with minimum balance | 🟢 | |
| Bad debtors, 90+ days | 🟢 | |
| Pupil ledger with opening balance | 🟢 | |
| AR ⇄ GL reconciliation, aggregate and per pupil | 🟢 | |
| Cached-projection + operational-cash reconciliation | 🟢 | |
| Daily cash book / collections by method | 🟡 | On screen only — not a report the bursar signs |
| Income vs budget variance | 🟡 | `Budget` model and page exist; no variance view |
| Export or print of any fee report | ⬜ | Nothing produces PDF or CSV |

### G. Parent-facing

| Capability | Status | Note |
|---|:---:|---|
| Portal fee balance | 🔴 | Shows waivers as paid (D1) |
| Bursar statement | 🔴 | Same defect, contradicts the receipts beside it (D1) |
| Printable termly statement | ⬜ | The most-expected artifact in a Ugandan school |
| SMS fee reminder | ⬜ | `NotificationsService` exists; attendance uses it; fees has no subscriber |
| SMS payment confirmation | ⬜ | Expected after any MoMo payment |

---

## 4. Uganda primary-school requirements

Judged against one school, one term. A Ugandan primary school runs three terms a year,
collects mostly in cash and mobile money at the school gate, and expects partial payment as
the rule rather than the exception.

### Must have — the school cannot operate without it

| Requirement | Status | Gap |
|---|:---:|---|
| Termly fee structure per class, mandatory + optional components | 🟢 | |
| Bill a whole class or school for a term | 🟢 | Blocked by D3 until the publish UI exists |
| Accept partial payment and allocate it | 🟢 | |
| Cash, mobile money, bank deposit slip | 🟢 | |
| Print a receipt | 🟡 | No reprint |
| Outstanding balance per pupil and per class | 🟢 | |
| Defaulters list to send pupils home with | 🟢 | |
| A statement a parent can be handed | 🔴 | Wrong figures **and** not printable |
| Accept an overpayment | 🔴 | Wizard refuses it |
| Correct a wrongly-entered receipt | 🟢 API · ⬜ UI | |
| Carry an unpaid balance into next term | 🟢 | |
| Fee clearance before sitting exams | ⬜ | Not implemented at all |

### Should have — expected of any competent school

| Requirement | Status | Gap |
|---|:---:|---|
| Instalment plan within a term | 🔴 | Model exists, unused |
| Sibling / staff-child discount | 🔴 | No Discounts page |
| Bursary / scholarship per pupil | 🟢 | |
| Waiver with approval | 🟢 | |
| Late-fee penalty | 🟢 | |
| SMS reminder to parents | ⬜ | Infrastructure exists, unused by fees |
| Boarding vs day pricing | ⬜ | |
| Daily cash book the bursar signs | 🟡 | |
| Bank / mobile-money reconciliation | 🟢 | |
| Term financial close | 🟢 | |

### Nice to have

| Requirement | Status | Note |
|---|:---:|---|
| Prompt-payment discount | 🔴 | Needs the Discounts page |
| Mid-term joiner proration | ⬜ | Needs a policy decision |
| Caution money / refundable deposit | ⬜ | |
| Scholastic requirements billing — reams, brooms, toilet paper | 🟡 | Expressible today as optional fee categories |
| PLE registration fee for P7 | 🟡 | Expressible as a grade-targeted component once D2 is fixed |
| Live MoMo gateway — parent pays from phone, auto-posts | ⬜ | |
| Parent self-service payment in the portal | ⬜ | |
| Third-party sponsor billing | 🔴 | Gated off by decision |

---

## 5. Phase status

Where each development phase actually stands. "Done" means the code exists, typechecks and
is covered by passing tests — not that it has run against production data.

| Phase | Scope | State |
|---|---|:---:|
| Original fees build (P1–P3) | Catalog, structures, schedules, billing, collection, optional fees | ✅ Done |
| Advanced finance (P1/P2) | Sponsorship, waivers, credits, aging | ✅ Done, sponsorship since gated off |
| ADR-013 economic-event model | Typed events, canonical query service, AR⇄GL reconciliation | ✅ Done |
| Correctness Phase 0 | Pre-migration data gate | ✅ Done, run against live data |
| Correctness Phase 1 | P0 fixes — idempotency keys, credit refund, sponsor statement | ✅ Code done · ⏸ **migration + backfill not applied** |
| Correctness Phase 2 | Pricing provenance, period control, Decimal credits, fail-closed close | ✅ Done — **caused D3** |
| Correctness Phase 3 | Allocation / payment reversal state machines | ✅ API done · ⬜ no UI |
| Correctness Phase 4 | Reconciliation + executable invariants | 🟡 Query layer done · ⬜ integration suite needs the migration |
| Correctness Phase 5 | Sponsorship containment | ✅ Done |
| Correctness Phase 6 | Bursar workflow | ⬜ Not started — this is the largest remaining functional gap |
| **Functional Phase A** | The three live defects above | ⬜ Not started |
| **Functional Phase B** | Overpayment, reprint, correction UI, bulk entry | ⬜ Not started |
| **Functional Phase C** | Fee clearance, SMS, printable statement | ⬜ Not started |
| **Functional Phase D** | Discounts UI, instalments, per-pupil overrides | ⬜ Not started |
| **Functional Phase E** | Printable reports and exports | ⬜ Not started |

---

## 6. What to do, in order

1. **Phase A — the three live defects.** D3 is a release blocker: without a publish UI,
   billing cannot run at all. Ship it with the migration and backfill.
2. **Phase B — the bursar's day.** Overpayment capture, receipt reprint, correction UI,
   bulk entry. Without these the module cannot survive a real reporting day.
3. **Phase C — Uganda essentials.** Fee clearance, SMS reminders, printable parent
   statement. These are what distinguishes software a Ugandan school will adopt from
   software it will abandon.
4. **Phase D — catalog completion.** Discounts page, instalment plans wired in, per-pupil
   override UI.
5. **Phase E — reporting.** Daily cash book, budget variance, exports.

The correctness work still owed — applying the migration and backfill, and the concurrency
and rollback invariant suite — is tracked in the companion audit and gates nothing in
Phases B–E.

---

## 7. Method and limits

Static review of the fees module, its controllers, the web pages and hooks that consume
them, the parent portal, the reporting service, and the notification infrastructure the
attendance module uses. Feature status was verified by tracing each capability from model →
service → controller → web hook → page, so "API only, no UI" and "hook exists but is dead
code" are observations, not inferences.

**Not covered:** runtime behaviour against a live school's data, print/PDF fidelity,
performance at a full school's volume, and the guardian mobile experience. Uganda-specific
requirements are drawn from common primary-school practice; a specific school's fee policy
may add or drop items and should be checked against §4 before it is treated as a checklist.
