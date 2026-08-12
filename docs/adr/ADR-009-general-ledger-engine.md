# ADR-009: General Ledger Engine & Posting Service

- **Status:** Accepted
- **Date:** 2026-06-14

## Context
Phase 2 builds the financial engine that every future module (Invoicing, POS,
School, Restaurant, Hospital, Payroll, Inventory) reuses. It must enforce
double-entry accounting, be multi-currency-correct, and never let a module write
ledger rows directly.

## Decision
A **double-entry General Ledger** (`Account`, `Journal`, `JournalEntry`,
`JournalLine`) with a single writer — **`PostingService`**.

- **One writer.** Modules build a `PostingRequest` (via `AccountDetermination`)
  and call `PostingService.post(request, tx?)`. They never touch
  `JournalEntry`/`JournalLine`. The `tx?` parameter makes posting
  **transaction-composable**: a document's state change and its posting commit
  atomically.
- **Dual-currency lines.** Each line stores transaction-currency `debit/credit`
  + `exchangeRate` **and** functional-currency `baseDebit/baseCredit`. The
  **balanced check runs on base currency** (SAP/Dynamics dual-amount model).
- **Immutability.** Posted entries are never edited; corrections use `reverse()`
  which writes a mirror entry and flags the original `reversed`.
- **Account determination** is config-driven with a resolution hierarchy:
  line → partner → product category → tax → org-level `AccountMapping`. No
  module hardcodes an account.
- **Period control.** A posting date inside a defined `FiscalPeriod` must land in
  an `open` one; `closed`/`locked` periods reject posting.
- **Atomic numbering.** A `Sequence` table + `SequenceService` reserve numbers
  with an atomic increment inside the posting transaction.
- **Decimal money.** All amounts use `Prisma.Decimal` (never floats); `isGroup`
  accounts are summary nodes and cannot be posted to.

## Consequences
**Positive**
- Every vertical gets correct, auditable accounting "for free" by posting.
- Multi-currency, period locking, and reversals are handled once, centrally.
- Pure functions (`posting.math`, `tax`) are unit-tested without a database.

**Negative / Trade-offs**
- `PostingService` is a hot path; its transaction + validation overhead is the
  price of correctness.
- Numbering via row increment is serialized per sequence key (fine at this
  scale; shard keys by year already).

## Alternatives considered
- **Let modules write journal entries directly:** rejected — guarantees drift
  and inconsistent postings.
- **Single-amount lines (no base currency):** rejected — breaks consolidated
  reporting the moment a second currency appears.
- **Numbering via `max()+1`:** rejected — race conditions; the sequence row is
  the lock.
