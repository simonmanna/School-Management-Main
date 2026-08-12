# POS Discount System — Feature Specification

> **Status:** Draft  
> **Author:** Simon / Engineering  
> **Date:** 2026-07-23  
> **Target:** POS Terminal (`/pos/terminal`, `/pos/terminal-*`)

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Current State](#2-current-state)
3. [Discount Architecture Overview](#3-discount-architecture-overview)
4. [Feature A — Customer Discount](#4-feature-a--customer-discount)
   - 4.1 Per-Customer Fixed Discount
   - 4.2 Customer Group / Category Discount
   - 4.3 Membership-Level Discount
   - 4.4 Stacking & Priority Rules
   - 4.5 UI Behaviour
   - 4.6 Backend Changes
   - 4.7 Schema Changes
5. [Feature B — Global / Seasonal Discount](#5-feature-b--global--seasonal-discount)
   - 5.1 Discount Schedule Definition
   - 5.2 Scope (Products / Categories)
   - 5.3 Active / Inactive Toggle
   - 5.4 Stacking Rules
   - 5.5 UI Behaviour
   - 5.6 Backend Changes
   - 5.7 Schema Changes
6. [Pricing & Tax Interaction](#6-pricing--tax-interaction)
7. [Reporting & Audit](#7-reporting--audit)
8. [Implementation Phasing](#8-implementation-phasing)
9. [Open Questions](#9-open-questions)

---

## 1. Problem Statement

The current POS supports only **manual, per-transaction discounts** — a cashier must tap the Discount button and type a % or fixed amount every time. Two common business scenarios are unsupported:

1. **Customer-specific discounts** — "Preferred customers get 10% off", "Staff get 15% off", "Wholesale customers buy at cost + 5%". Today the cashier must remember who gets what and apply it manually.
2. **Global / seasonal discounts** — "15% off everything during New Year week", "Happy hour 20% off 5–7 PM daily". Today there is no scheduling engine — the manager cannot set a time-bound discount that applies automatically.

Both gaps are confirmed in `docs/audit/PRODUCTION_READINESS_AUDIT.md`:
- Line 294: *"Fixed-amount / coupon / promo discounts (only % today)"*
- Line 350: *"Coupons/fixed-amount discounts, gift cards, happy-hour, course firing, inventory valuation"*

---

## 2. Current State

### 2.1 Existing Discount Infrastructure

| Component | What it does |
|---|---|
| **Line-level discount** (`LineDiscountDialog`) | Per-item % or fixed UGX. ≥ 10% or UGX 50,000 → manager PIN override. |
| **Transaction-level discount** (`DiscountDialog`) | Applied to subtotal after line discounts. % or fixed UGX. Same override thresholds. |
| **Discount reason** (`DiscountReasonDialog`) | Standard reasons: Promotion, Loyalty, Employee, Senior, Student, Defective, Complaint, Clearance, Wholesale, Voucher + custom. Captured after every order-level discount. |
| **Manager override** (`OverrideDialog`) | PIN verification for high discounts. Configurable `tier1` threshold via org settings → `discountApproval.tier1` (default: 10%). |
| **Backend `pos.service.ts`** | `assertDiscountAuthority()` validates line + transaction discount against override tier. `CheckoutInput` passes `transactionDiscountPercent`, `transactionDiscountType`, `transactionDiscountAmount`, `discountReason`. |
| **Backend `pos-invoice.service.ts`** | Applies order-level discount proportionally across line items. Posts separate GL debit (`Dr sales_discount`) when `orderDiscountAmount > 0`. |
| **Schema `DiscountSource` enum** | `manual`, `promotion`, `loyalty`, `coupon` — values already exist but `promotion` and `coupon` are unused. |
| **Schema `DiscountType` enum** | `percentage`, `fixed_amount`. |
| **Org settings** | JSON blob on `Organization.settings` — `discountApproval.tier1` is the only discount-related key today. |

### 2.2 Existing Customer Features (no discount linkage)

| Feature | Trigger |
|---|---|
| Attach customer to sale | Manual from CustomerDialog |
| Loyalty points redemption | Manual from CustomerProfileDialog → Redeem tab |
| Store credit tender | Manual tender selection in PaymentDialog |
| Customer tab (postpaid) | Manual Open/Charge/Settle in CustomerProfileDialog |

None of these **automatically** apply a discount when a customer is attached.

### 2.3 Inventory / Price Model

- Menu items have a `basePrice` (in UGX).
- Variants override basePrice per option.
- Accompaniments and modifiers add/subtract `priceDelta`.
- **No concept** of customer-specific base price, group price list, or quantity-tier pricing exists today.

---

## 3. Discount Architecture Overview

### 3.1 Discount Layers (application order)

When a sale is priced, discounts are resolved in this exact order:

```
  1. Line-level manual discounts (cashier-applied, per-item)
  2. Line-level auto discounts (customer/group/global — NEW)
  3. Customer discount        (from partner or partner category — NEW)
  4. Global / seasonal discount (from active schedule — NEW)
  5. Transaction-level manual discount (cashier-applied, post-subtotal)
```

### 3.2 Stacking Principle

- **All discounts stack** unless the `exclusive` flag is set on a discount definition.
- Stacking is **multiplicative** on the remaining balance, not additive on the original price.
  - Example: line price = 10,000. Customer discount = 10% → 9,000. Global discount = 20% → 7,200. Total = 28% off effective.
- Manual transaction discount (step 5) always applies last and uses the post-auto-discount subtotal.

### 3.3 Discount Record

Each discount application at checkout is recorded:
- `discountSource` (`customer_discount`, `group_discount`, `membership_discount`, `global_promotion`, `manual`)
- `discountType` (`percentage` | `fixed_amount`)
- `discountValue` (the raw value before calculation)
- `discountAmount` (actual UGX amount deducted)
- `discountAppliedBy` (user/system)
- `discountApprovedBy` / `discountApprovedAt` (for overrides)

---

## 4. Feature A — Customer Discount

### 4.1 Per-Customer Fixed Discount

**Concept:** Each Partner record gains an optional `discountPercentOverride` field. When a customer is attached to a sale, this % is applied to every line automatically.

**Rules:**
- Applied at **line level** (reduces each line's effective unit price before transaction discount).
- Override threshold still applies — if the customer discount exceeds the tier1 threshold, a manager PIN is required at checkout (not at customer-select time).
- Value: percentage only (0–100). Fractional allowed (9.5%).
- Can be overridden by a **higher-value** manual line discount — if the cashier applies a per-line discount that is larger, the customer discount for that specific line is skipped (customer does not double-dip).

**Schema change:**
```prisma
model Partner {
  // ...existing fields...
  discountPercentOverride Decimal @default(0) @db.Decimal(9, 4)
  /// When set, this customer's discount auto-applies on POS sale attach.
  /// 0 = no automatic discount. Applied per-line before global/transaction discounts.
  /// Override-rules: if the cashier applies a higher manual line discount, this
  /// per-line auto-discount is skipped for that line.
}
```

**UI — Partner edit form:**
```
Partner Detail / Edit
┌──────────────────────────────┐
│ Discount & Pricing           │
│ ═══════════════════════════ │
│ Auto discount %     [  10  ] │  ← new field (0 = none)
│ Membership Level   [ Gold▼ ] │  ← already exists, now functional
│ Category           [ VIP ▼ ] │  ← already exists
└──────────────────────────────┘
```

### 4.2 Customer Group / Category Discount

**Concept:** Each `PartnerCategory` gains an optional `discountPercentOverride`. All partners belonging to that category inherit this discount automatically.

**Rules:**
- Per-customer `discountPercentOverride` **overrides** the category value if both are set (customer-specific > group).
- A partner can be in one category (enforced today by `categoryId` on Partner). No multi-category.
- Categories can be nested (parent/children via `PartnerCategory.parentId`). If a child category has no discount set, it inherits from the **nearest ancestor** that has one.
- Value: percentage (0–100).

**Schema change:**
```prisma
model PartnerCategory {
  // ...existing fields...
  discountPercentOverride Decimal @default(0) @db.Decimal(9, 4)
  /// Inherited by all partners in this category (unless the partner has their own
  /// override). If 0, cascade up to the nearest ancestor with a non-zero value.
}
```

**Partner discount resolution at checkout:**
```
if partner.discountPercentOverride > 0:
    effective = partner.discountPercentOverride
else if partner.category?.effectiveDiscountPercent > 0:
    effective = partner.category.effectiveDiscountPercent
    // effectiveDiscountPercent = nearest ancestor with non-zero (or 0)
else:
    no customer auto-discount
```

### 4.3 Membership-Level Discount

**Concept:** The existing `Partner.membershipLevel` string field becomes functional. A new **`MembershipTier`** model defines discount rates per tier at the organization level.

**Rules:**
- Organization defines tiers: name, discount %, minimum spend, colour.
- When `partner.membershipLevel` matches a tier name, the tier's discount % applies.
- This is **additive** with per-customer overrides? No — see stacking rules below. Customer-specific discountPercentOverride wins over membership tier if both are set. If only membership is set, use that.

**New model:**
```prisma
model MembershipTier {
  id              String   @id @default(uuid())
  organizationId  String
  name            String   // "Bronze", "Silver", "Gold", "Platinum"
  discountPercent Decimal  @default(0) @db.Decimal(9, 4)
  minLifetimeSpend Decimal  @default(0) @db.Decimal(20, 6)  // auto-promotion threshold
  color           String?  // hex colour for UI badge
  sortOrder       Int      @default(0)
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([organizationId, name])
  @@index([organizationId])
}
```

**Partner discount resolution (full cascade):**

```
1. If partner.discountPercentOverride > 0:
     customer_discount = partner.discountPercentOverride
2. Else if partner.category?.effectiveDiscountPercent > 0:
     customer_discount = partner.category.effectiveDiscountPercent
3. Else if partner.membershipLevel matches active MembershipTier:
     customer_discount = tier.discountPercent
4. Else:
     customer_discount = 0 (no auto-discount)
```

### 4.4 Stacking & Priority Rules

| Scenario | Behaviour |
|---|---|
| Customer discount + manual line discount | Both apply. If manual line discount % > customer discount %, the customer discount is **skipped for that line** (avoid double-discount when cashier intended override). |
| Customer discount + global discount | Both apply multiplicatively. Customer discount first, then global. |
| Customer discount + manual transaction discount | Both apply. Customer discount is folded into line effective price; manual transaction discount applies to the subtotal after all auto-discounts. |
| Fixed-amount customer discount | Percentage only in Phase 1. Fixed-amount per-order could be added in Phase 2. |

### 4.5 UI Behaviour

**When customer is attached to a sale:**

```
Attach customer "Jane (Gold)"
 → Cart shows: "Gold membership −10%" indicator
 → OrderPanel shows customer pill with discount badge: "Jane ⭐ -10%"
 → Discount line item in totals reads:
     Subtotal:           UGX 50,000
     Customer discount:  −UGX  5,000   ← new line
     Global promo:       −UGX  4,500   ← if active
     Discount:           −UGX  0       ← manual (cashier can still add)
     ─────────────────────────
     TOTAL:              UGX 40,500
```

**If customer discount > tier1 threshold (e.g. 25%):**
```
At CHECKOUT time, manager PIN is required.
The payment dialog shows:
  ⚠ Customer discount 25% exceeds 10% — verify manager PIN
  [  Enter manager PIN  ]
  [  Continue  ]
```

**UI components to modify:**
- `CustomerDialog` — show the customer's effective discount % when selected
- `OrderPanel` — show customer discount badge + amount in totals section  
- `CustomerProfileDialog` — add discount info to Overview tab
- Partner edit form (web admin, not in POS) — `discountPercentOverride` field

### 4.6 Backend Changes

**`pos.service.ts` — `checkout()`:**

1. After resolving partnerId, compute `customerDiscountPercent` using the cascade in §4.3.
2. Pass it through to `pos-invoice.service.ts` → `generateInvoice()` as a new parameter or fold it into per-line `discountPercent` before billing.

**`pos-invoice.service.ts` — `generateInvoice()`:**

1. Accept optional `customerDiscountPercent` parameter.
2. For each line where `customerDiscountPercent > 0` and `line.discountPercent < customerDiscountPercent` (i.e. manual discount doesn't supersede), set an effective combined discount.
3. Record `discountSource = 'loyalty'` or new `'customer_discount'` on the InvoiceItem.
4. Post the customer discount amount as a separate GL leg if needed, or fold it into the sales_discount line.

**New endpoint:**
```
GET  /pos/partner/:id/discount   → { discountPercent, source: "customer"|"category"|"membership" }
```
Used by the frontend right after customer attachment to display the badge.

### 4.7 Schema Changes

| Table | New field | Type | Notes |
|---|---|---|---|
| `Partner` | `discountPercentOverride` | `Decimal(9,4) @default(0)` | 0 = no auto-discount |
| `PartnerCategory` | `discountPercentOverride` | `Decimal(9,4) @default(0)` | 0 = inherit from parent |
| **NEW** `MembershipTier` | (see §4.3) | — | Organization-level tier definitions |
| `InvoiceItem` | add to `DiscountSource` enum | `customer_discount`, `group_discount`, `membership_discount` | New enum values |

---

## 5. Feature B — Global / Seasonal Discount

### 5.1 Discount Schedule Definition

A new **`PromotionSchedule`** model defines time-bound discounts.

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `organizationId` | String | Tenant scope |
| `name` | String | Human label, e.g. "New Year 2026", "Happy Hour" |
| `description` | String? | Internal note |
| `discountType` | `DiscountType` | `percentage` or `fixed_amount` |
| `discountValue` | `Decimal(20,6)` | e.g. 15 for 15%, or 5000 for UGX 5,000 off |
| `discountReason` | String? | Auto-populated on receipt (e.g. "New Year promo") |
| `scope` | `PromotionScope` | `all`, `category`, `specific_products` |
| `scopeCategoryId` | String? | If scope = category |
| `scopeProductIds` | String[] | If scope = specific_products |
| `minOrderTotal` | `Decimal(20,6) @default(0)` | Minimum subtotal to qualify (0 = no minimum) |
| `maxDiscountAmount` | `Decimal(20,6) @default(0)` | Cap the absolute discount (0 = unlimited) |
| `exclusive` | Boolean | If true, this discount does not stack with other promotions |
| `isActive` | Boolean | Master toggle |
| `startDate` | DateTime | Schedule start |
| `endDate` | DateTime? | Schedule end (null = indefinite once activated) |
| `startTime` | String? | Daily time window start, e.g. "17:00" |
| `endTime` | String? | Daily time window end, e.g. "19:00" |
| `daysOfWeek` | `Int[]` | 0=Sun..6=Sat. Empty = every day |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**New enums:**
```prisma
enum PromotionScope {
  all
  category
  specific_products
}
```

### 5.2 Scope

The discount can be limited to:

- **All items** (`scope = all`) — every line in the cart qualifies.
- **A category** (`scope = category`) — only items whose `categoryId` matches `scopeCategoryId`.
- **Specific products** (`scope = specific_products`) — only items whose `productId`/`menuItemId` is in `scopeProductIds`.

### 5.3 Active / Inactive Toggle

- `isActive = false` → ignored by checkout logic regardless of schedule.
- `isActive = true` → evaluated on every checkout if the current time falls within the schedule window.

**Schedule matching logic:**
```
is_schedule_active?(promo):
    if not promo.isActive: return false
    if promo.startDate > now: return false
    if promo.endDate && promo.endDate < now: return false
    if promo.daysOfWeek is not empty:
        if now.dayOfWeek not in promo.daysOfWeek: return false
    if promo.startTime && promo.endTime:
        if now.time < promo.startTime or now.time > promo.endTime: return false
    return true
```

### 5.4 Stacking Rules

| Scenario | Behaviour |
|---|---|
| Multiple active global promos | Only the **highest-value** global discount applies (first by: exclusive > percentage-value > created_at). If any active promo has `exclusive = true`, only that one applies (no stacking). |
| Global promo + customer discount | Both apply multiplicatively unless the promo is marked `exclusive`. |
| Global promo + manual line discount | Manual line discount overwrites the global promo for that line (cashier explicitly applied a higher override). |
| Global promo + manual transaction discount | Both apply. Promo is folded into line effective price first. |

### 5.5 UI Behaviour

**Management UI (new page in POS Settings or Admin panel):**

```
POS Settings > Promotions
┌──────────────────────────────────────────────┐
│ [+ New Promotion]                            │
├──────────────────────────────────────────────┤
│ Active  Name              Schedule       Disc │
│ ●      New Year 2026  1 Jan – 7 Jan   15%   │
│ ●      Happy Hour      Mon–Fri 5–7PM  20%   │
│ ○      Valentine      14 Feb only     10%   │
└──────────────────────────────────────────────┘
```

**During checkout, when a global promo is active:**

```
Topbar shows: 🎉 Happy Hour — 20% off! (Auto-applied)
```

```
OrderPanel totals:
  Subtotal:           UGX 50,000
  Happy Hour −20%:   −UGX 10,000   ← new line, only shown if > 0
  Customer disc −10%: −UGX  4,000   ← if customer also attached
  Discount:           −UGX  0       ← manual
  ─────────────────────────
  TOTAL:              UGX 36,000
```

**Receipt:**
```
  Item               Qty   Price   Total
  Latte               2   5,000   10,000
  Cappuccino          1   6,000    6,000
                              ─────────
  Subtotal                       16,000
  Happy Hour −20%               −3,200    ← line with reason
  Customer disc −10%             −1,280    ← if applicable
  Total                          11,520
  Why: Happy Hour, Gold Member
```

**UI components to build:**
- `PromotionListPage` — CRUD list of promotion schedules
- `PromotionEditDialog` — form for name, discount, scope, schedule, toggle
- `ActivePromoBanner` — topbar component during checkout
- `OrderPanel` — show promo deduction line in totals

### 5.6 Backend Changes

**`pos.service.ts` — `checkout()`:**

1. After resolving line discounts and before transaction discount:
   - Query `PromotionSchedule` where `isActive = true` and current time passes `is_schedule_active?()`.
   - Filter by scope (all / category match / product match).
   - Select the winning promo (highest non-exclusive, or the exclusive one).
   - Apply to each qualifying line: fold into line's effective unit price.
   - Record `discountReason` from promo name, `discountSource = 'promotion'`.

2. Pass the folded lines through to `generateInvoice()`.

**`pos-invoice.service.ts`:**

1. Accept pre-discounted lines from checkout (already folded with promo + customer discounts).
2. Record `discountSource = 'promotion'` on each affected InvoiceItem.
3. Continue existing GL posting with the adjusted values.

**New endpoints:**
```
GET    /pos/promotions                    → list all promo schedules
POST   /pos/promotions                    → create
PATCH  /pos/promotions/:id                → update
DELETE /pos/promotions/:id                → soft-delete
GET    /pos/promotions/active             → currently applicable promo (for banner)
```

### 5.7 Schema Changes

| Table | Fields |
|---|---|
| **NEW** `PromotionSchedule` | See §5.1 full schema |
| **NEW** enum `PromotionScope` | `all`, `category`, `specific_products` |
| `DiscountSource` enum | Add `customer_discount`, `group_discount`, `membership_discount` (new values for customer side) |

---

## 6. Pricing & Tax Interaction

### 6.1 Tax Base

Discounts **reduce the taxable base** — tax is calculated on the discounted line price, not the original price.

### 6.2 Minimum Price Floor

No line may be reduced below **zero** after all discounts are applied. If cumulated discounts would push a line negative, the line's effective price is clamped to 0.

### 6.3 Override Threshold

The existing `discountApproval.tier1` threshold applies to the **effective total discount %** across all sources (customer + global + manual). If the combined effect exceeds tier1, a manager PIN override is required at checkout.

Calculation:
```
total_discount_pct = (gross_subtotal - final_total) / gross_subtotal * 100
if total_discount_pct > tier1:
    require override
```

---

## 7. Reporting & Audit

### 7.1 Reports Impact

| Report | Change |
|---|---|
| **X/Z Report** | Break out discount total by source: manual, customer, global |
| **Sales by customer** | Show customer discount % and total discount amount per customer |
| **Promotion effectiveness** | New report: total revenue lost per promo, items sold under promo, customer count |
| **Receipt** | Itemise each discount source with reason label |

### 7.2 Audit Log

Every discount application writes an AuditLog row:
- `entity: 'DiscountApplication'`
- `action: 'apply'`
- `metadata`: `{ source, type, value, amount, reason, promoId?, partnerId? }`

---

## 8. Implementation Phasing

| Phase | Scope | Effort |
|---|---|---|
| **P1 — Customer discount** | `discountPercentOverride` on Partner + category. Backend cascade resolution. Frontend badge + totals line. GL posting. | ~2 weeks |
| **P2 — Global promo schedule** | `PromotionSchedule` model + CRUD endpoints + admin UI. Checkout evaluation engine. Banner component. | ~3 weeks |
| **P3 — Membership tiers** | `MembershipTier` model + auto-resolve on checkout. Admin UI for tier CRUD. | ~1 week |
| **P4 — Reports & audit** | Breakout by source in X/Z, new promo-effectiveness report. Audit log entries. | ~1 week |
| **P5 — Exclusive flag / complex rules** | Exclusive stacking, min-order thresholds, max-discount caps. | ~1 week |

---

## 9. Open Questions

1. **Should customer discounts require manager approval on attach or on checkout?**  
   Proposed: on checkout, same as existing manual discounts. The override threshold uses the **combined** effective discount %.

2. **Fixed-amount customer discount?**  
   Phase 1: percentage only. Could add fixed-amount-per-order in Phase 2 if customer feedback requests it.

3. **Global discount with multiple overlapping schedules?**  
   Proposed: highest-value wins. If any active promo is `exclusive`, it wins alone. Could add priority field in Phase 2.

4. **B2B wholesale (quantity-tier pricing)?**  
   Out of scope for this spec. Would need a separate `PriceList` / `PriceTier` system. This spec focuses on % discounts, not base price substitution.

5. **Coupon codes (manual entry of a promo code)?**  
   Out of scope. The `DiscountSource.coupon` enum value exists but is reserved for future use.

6. **Should global promos show a confirmation to the cashier?**  
   Proposed: no — they auto-apply silently. The topbar banner is sufficient notification. The cashier can always override with a higher manual line discount if the customer disputes.

---

## Appendix A: Example Flows

### Flow 1: Gold member during Happy Hour

```
1. Cashier attaches customer "Alice" (Gold → 10% membership discount)
   → Cart: "Gold membership -10%" badge appears

2. It's 5:30 PM on a weekday
   → "Happy Hour -20%" banner auto-appears in topbar

3. Alice orders 2x Latte (5,000 each) = 10,000 subtotal

4. Pricing resolution:
   Gross:               10,000
   Gold -10%:          −1,000     (membership, no manual override)
   Happy Hour -20%:    −1,800     (of remaining 9,000)
   Subtotal:            7,200
   Manual discount:    −0         (cashier didn't add one)
   TOTAL:               7,200

5. Effective discount: 28% → exceeds 10% tier1 → manager PIN at checkout
6. Receipt shows both discount lines with reasons
```

### Flow 2: Customer with manual override

```
1. Customer "Bob" has 15% customer discount (above 10% tier1)
2. Cashier charges UGX 20,000 subtotal
3. Customer discount folds in: −UGX 3,000
4. Manager PIN required at checkout
5. Cashier verifies → sale completes
```

### Flow 3: Global promo exclusive to category

```
1. Promo: "Beverage Happy Hour" — 20% off, scope = category "Beverages"
2. Customer orders: Latte (Beverage) + Croissant (Food)
3. Latte gets 20% off. Croissant is full price.
4. Totals:
   Latte 5,000 − 20% = 4,000
   Croissant 8,000        = 8,000
   TOTAL                  = 12,000
```
