# ADR-008: Master-Data & Partner Modeling

- **Status:** Accepted
- **Date:** 2026-06-14

## Context
The brief listed `Partner` "types" including `Student`, `Patient`, `Donor`,
`Member`. But a core platform rule (ADR-001/005) is that **the kernel/core must
never know industry concepts**. A kernel enum containing `Student` would violate
that rule and couple the platform to verticals forever.

## Decision
Model a **universal `Partner`** (Odoo `res.partner` style):
- **Role flags:** `isCustomer`, `isSupplier`, `isEmployee` (a partner can be
  several at once).
- **`PartnerCategory`** — hierarchical, free tags for classification.
- **`customFields` (JSONB)** for runtime, per-tenant attributes with no migration.
- `Contact` and `Address` are child records (many per partner).

Industry party types are **NOT** kernel enums. A future School module defines its
own `Student` entity that references `partnerId`; Hospital defines `Patient`, etc.
`Product` likewise uses only generic kinds — `stockable | consumable | service |
fee | subscription | asset` — plus `ProductCategory` and `customFields`.

Runtime extension follows `TRANSFER.md`: a **new entity** → a real table in the
owning module; a **new attribute** → a `customFields` JSONB key (GIN-indexed when
queried hot). No dynamic/metadata ORM.

## Consequences
**Positive**
- Kernel stays 100% industry-agnostic; verticals extend via FK + JSONB.
- One unified party gets one address book, one contact list, one ledger position.

**Negative / Trade-offs**
- Querying hot `customFields` keys needs explicit GIN/expression indexes.
- App-layer validation must mirror custom-field definitions (bounded cost).

## Alternatives considered
- **Hard `PartnerType` enum incl. Student/Patient:** rejected — couples kernel to
  industries, breaks the platform rule.
- **A table per party type:** rejected — fragments contacts/addresses/ledger and
  duplicates CRUD.
