# POS Selling Terminal — Combo Food Management & Delivery Fees

> **Status:** Draft  
> **Author:** Simon / Engineering  
> **Date:** 2026-07-23  
> **Target:** POS Terminal (`/pos/terminal`, `/pos/terminal-*`)

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Feature A — Combo Food Management](#2-feature-a--combo-food-management)
   - 2.1 Combo Admin UI
   - 2.2 POS Terminal Display
   - 2.3 Checkout & Expansion
   - 2.4 Receipt & KOT
   - 2.5 Schema Changes
   - 2.6 API Changes
3. [Feature B — Delivery Fees](#3-feature-b--delivery-fees)
   - 3.1 Delivery Fee Configuration
   - 3.2 Delivery Address Capture
   - 3.3 Fee Application at Checkout
   - 3.4 Receipt & GL Posting
   - 3.5 Schema Changes
   - 3.6 API Changes
4. [Implementation Phasing](#4-implementation-phasing)
5. [Open Questions](#5-open-questions)

---

## 1. Current State

### 1.1 Combo Infrastructure (Already Built)

| Component | What exists | Status |
|---|---|---|
| **Schema `Combo`** | `id`, `organizationId`, `name`, `price`, `description`, `isActive`, `imageUrl`, `sortOrder` | ✅ Live |
| **Schema `ComboItem`** | `comboId`, `productId`, `quantity` (how many units of this product the combo includes) | ✅ Live |
| **Backend CRUD** | `PosModifiersService` — `createCombo`, `updateCombo`, `deleteCombo`, `listCombos`, `getCombo` | ✅ Live |
| **Backend expansion** | `expandCombosForCheckout()` expands combo into component lines; first component carries combo price, rest are zero-priced | ✅ In `pos-modifiers.service.ts` |
| **Order expansion** | `pos-orders.service.ts` line 612 — expands combos during `resolveLines()` | ✅ Live |
| **Frontend (Digital Menu)** | Combo cards shown in `DigitalMenuPage.tsx` with `ComboFE` type, add-to-cart with `comboId` | ✅ Live |
| **Frontend (POS Terminal)** | SKU prefix hack `combo:xxx` in `Terminal.tsx` line 731 — detects combo by SKU pattern | 🟡 Partial |
| **Frontend admin UI** | **No dedicated combo management page** — combos are managed via API directly | ❌ Missing |

### 1.2 Delivery Fee Infrastructure

| Component | What exists | Status |
|---|---|---|
| **Order type** | `delivery` enum value in `OrderType`, selectable in `OrderPanel.tsx` dropdown | ✅ Live |
| **Backend order type** | `delivery` accepted in `OrderLineDto.orderType`, `pos.controller.ts`, `pos.service.ts` | ✅ Live |
| **Receipt label** | `orderTypeLabels` maps `delivery` → `'Delivery'` on receipts | ✅ Live |
| **Delivery fee** | **No field, no model, no calculation** | ❌ Missing |
| **Delivery address** | **No capture in POS UI** | ❌ Missing |
| **Delivery zone/rules** | **No configuration** | ❌ Missing |
| **GL account for delivery** | **No separate revenue account** | ❌ Missing |

---

## 2. Feature A — Combo Food Management

### 2.1 Combo Admin UI

**New page:** `/menu/combos` (accessible from the Menu management section)

```
Menu > Combos
┌──────────────────────────────────────────────────┐
│  [+ New Combo]                                   │
├──────────────────────────────────────────────────┤
│  Active  Name              Price    Items      │
│  ●      Breakfast Deal    UGX 18k  Croissant+Latte │
│  ●      Lunch Combo       UGX 25k  Rice+Chicken+Drink │
│  ○      Family Bucket     UGX 55k  8 pcs Chicken+Fries │
└──────────────────────────────────────────────────┘
```

**Create/Edit Combo Dialog:**

```
┌──────────────────────────────────────────────┐
│  New Combo                                    │
├──────────────────────────────────────────────┤
│  Name           [ Breakfast Deal          ]  │
│  Price (UGX)    [ 18000                   ]  │
│  Description    [ Croissant + Latte + Juice] │
│  Image          [ Choose file...          ]  │
│  Active         [✓]                         │
│                                               │
│  Items:                                       │
│  ┌────────────────────────────────────────┐  │
│  │ Product                    Qty  Remove  │  │
│  │ Croissant                   1    [✕]   │  │
│  │ Latte                       1    [✕]   │  │
│  │ Orange Juice                1    [✕]   │  │
│  │ [+ Add Item]                          │  │
│  └────────────────────────────────────────┘  │
│                                               │
│  [Cancel]  [Save]                             │
└──────────────────────────────────────────────┘
```

**Add Item flow:** Opens a product picker (searchable, categorized). Selecting a product adds it to the items table with a quantity spinner. A product can appear only once per combo (enforced by `@@unique([comboId, productId])` in schema).

### 2.2 POS Terminal Display

**Menu Grid — Combo Cards:**

Combos appear in the POS terminal's `MenuGrid` alongside regular menu items, but with visual distinction:

```
┌──────────────────┐
│ 🍱 COMBO         │  ← "COMBO" badge/ribbon
│ Breakfast Deal   │
│ UGX 18,000       │
│ Chroissant+Latte │
│ +Orange Juice    │
└──────────────────┘
```

**Behaviour:**

- Tap a combo card → directly adds to cart with `comboId` (no variant/accompaniment/addon steps — combos are fixed-price bundles)
- Cart line shows the combo name and the combo price
- The `MenuGrid` receives a separate `combos` prop OR combos are merged into the `products` array with `isCombo: true` flag
- Use `getFoodEmoji` mapping: `'combo' → '🍱'` (already exists in `food-images.ts`)

**Data flow:**

```
GET /pos/menu?available=true
 → returns { categories, items, combos }  ← combos already in response
 → Frontend renders combo cards separately or interleaved
```

**Cart line expansion visual:**

```
Before checkout (in OrderPanel):
  🍱 Breakfast Deal × 1     UGX 18,000

After checkout (receipt / invoice detail):
  Breakfast Deal Combo:
    Croissant × 1           UGX 10,000
    Latte × 1               UGX 8,000
    Orange Juice × 1        UGX 0
    ─────────────────
    Combo total             UGX 18,000
```

The cart itself keeps `comboId` on the line. The expansion only happens at checkout (backend `resolveLines` expands into component `OrderItem` rows). This is how it works today — the spec makes it visible everywhere.

### 2.3 Checkout & Expansion

**Current expansion logic (already built):**

In `pos-orders.service.ts`:

```typescript
// Expand combos into component lines
if (!src.comboId) { expanded.push(ln); continue; }
const comps = await this.modifiers.expandCombosForCheckout(
  [{ comboId: src.comboId, quantity: ln.quantity }]
);
// First component carries the combo price; rest are zero-priced
unitPrice: j === 0 ? Number(c.comboPrice ?? ln.unitPrice) : 0,
```

**Changes needed:**

1. **KOT display** — when printing KOT, show the combo as a **grouped line** with component items indented below, not as individual component rows. The kitchen needs to see "1× Breakfast Deal" with sub-items, not three separate items.
2. **Stock deduction** — each component's stock is deducted individually (already works since expansion produces product-level lines).
3. **Refunds/voids** — voiding a combo voids all component items in one action.
4. **Modifiers on combo items** — allow individual component items to carry modifiers (e.g. "Latte with oat milk"). This is a Phase 2 enhancement.

### 2.4 Receipt & KOT

**Receipt (thermal/EscPos):**

```
  Breakfast Deal                   
    Croissant                1  10,000
    Latte                    1   8,000
    Orange Juice             1       0
                                ──────────
                                UGX 18,000
```

**KOT (kitchen print):**

```
  ┌─────────────────────────────┐
  │  Table 5 · Dine In          │
  │  2026-07-23 12:30           │
  │                             │
  │  🍱 BREAKFAST DEAL (COMBO)  │
  │    × 1                      │
  │    • Croissant              │
  │    • Latte                  │
  │    • Orange Juice           │
  │                             │
  │  ──── End ────              │
  └─────────────────────────────┘
```

**Changes needed:**

- `PosReceiptsService` — when printing lines that belong to a combo, group them visually
- Add a `comboName` display field to `OrderItem` or derive from the expansion context

### 2.5 Schema Changes

| Table | Change | Notes |
|---|---|---|
| `OrderItem` | Add `comboName String?` | Denormalised so receipt/KOT can show the combo grouping without a join |
| `InvoiceItem` | Add `comboName String?` | Same — receipt display |

No structural schema changes — the `Combo` and `ComboItem` models already exist.

### 2.6 API Changes

| Endpoint | Change | Notes |
|---|---|---|
| `GET /pos/menu?available=true` | Already returns `combos` array | No change |
| `GET /pos/modifiers/combos` | Already exists | No change |
| `POST /pos/modifiers/combos` | Already exists | No change |
| `PATCH /pos/modifiers/combos/:id` | Already exists | No change |
| `DELETE /pos/modifiers/combos/:id` | Already exists | No change |
| `GET /pos/modifiers/combos/:id` | Already exists | No change |
| `POST /pos/checkout` | Already expands combo lines | No change |
| `GET /pos/reports/:id` | Combo items already broken out | No change |

**Frontend-only changes required:**

| Component | Change |
|---|---|
| `MenuGrid.tsx` | Accept `combos` prop; render combo cards with badge |
| `Terminal.tsx` | Fetch combos; pass to MenuGrid; remove SKU hack in `onPickProduct` |
| `OrderPanel.tsx` | Show combo badge/icon on combo lines |
| `RetailTerminal.tsx` | Same treatment for product-based terminal |
| **NEW** `ComboListPage.tsx` | Admin CRUD page for combos |
| **NEW** `ComboEditDialog.tsx` | Create/edit combo form with item picker |

---

## 3. Feature B — Delivery Fees

### 3.1 Delivery Fee Configuration

A new **`DeliveryFeeRule`** model at the organization level defines how delivery fees are calculated.

| Field | Type | Description |
|---|---|---|
| `id` | UUID | |
| `organizationId` | String | Tenant |
| `name` | String | e.g. "Standard", "Express" |
| `feeType` | `DeliveryFeeType` | `flat`, `zone_based`, `distance_based`, `percentage_of_order` |
| `flatFee` | `Decimal(20,6)` | Fixed fee when `feeType = flat` |
| `freeDeliveryMinimum` | `Decimal(20,6) @default(0)` | Order subtotal above which delivery is free (0 = always charge) |
| `isActive` | Boolean | |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Zone-based model (Phase 2):**

```prisma
model DeliveryZone {
  id              String   @id @default(uuid())
  organizationId  String
  name            String   // "Central", "Suburbs 5km", "Outskirts"
  fee             Decimal  @db.Decimal(20, 6)
  freeAbove       Decimal  @default(0) @db.Decimal(20, 6)
  polygon         Json?    // GeoJSON polygon for zone matching
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([organizationId])
}
```

**New enums:**

```prisma
enum DeliveryFeeType {
  flat
  zone_based
  distance_based
  percentage_of_order
}
```

**Configuration UI (POS Settings page):**

```
POS Settings > Delivery
┌──────────────────────────────────────────────┐
│  Delivery Fee                                 │
│  ══════════════════════════════════════════  │
│  Fee type     [Flat rate ▼]                  │
│  Flat fee     [ 5,000 ] UGX                  │
│  Free delivery for orders over               │
│  [ 50,000 ] UGX  (0 = always charge)         │
│  [✓] Active                                  │
│                                               │
│  Delivery GL Account                          │
│  [ Revenue: Delivery Fees ▼ ]                 │
└──────────────────────────────────────────────┘
```

### 3.2 Delivery Address Capture

**UI — When order type is changed to "Delivery":**

An address form appears in the OrderPanel or as a dialog:

```
Order type: [Dine In | Takeaway | Delivery ▼]

When Delivery selected:
┌─────────────────────────────────┐
│ 📍 Delivery Address             │
│ Customer name  [ John Doe    ] │
│ Phone          [ +256 7XX... ] │
│ Address        [ 123 Main St ] │
│ Area/Zone      [ Central     ] │
│ Notes          [ Gate code 123]│
└─────────────────────────────────┘
```

Address fields go into the **cart store** (`deliveryAddress`, `deliveryPhone`, `deliveryZone`) and are passed to checkout → order.

**Checkout payload addition:**

```typescript
interface CheckoutInput {
  // ...existing fields...
  deliveryAddress?: string;
  deliveryPhone?: string;
  deliveryZone?: string;
  deliveryNotes?: string;
  deliveryFee?: number;           // computed by the backend
}
```

### 3.3 Fee Application at Checkout

**Backend logic (`pos.service.ts` → `checkout()`):**

1. Detect `orderType === 'delivery'`
2. If `subtotal >= org.deliveryRule.freeDeliveryMinimum` → fee = 0
3. Else compute fee based on `feeType`:
   - `flat` → use `flatFee`
   - `zone_based` → find matching `DeliveryZone` by address/zone, use zone's fee
   - `percentage_of_order` → `subtotal * feePercent / 100`
   - `distance_based` → use distance from branch to delivery address (Phase 2)
4. Cap fee at `maxDeliveryFee` if configured
5. Pass fee through to `generateInvoice()` as a separate parameter

**`pos-invoice.service.ts`:**

1. Accept `deliveryFee` parameter
2. Create a synthetic `InvoiceItem` for the delivery fee:
   - `description: 'Delivery fee'`
   - `unitPrice: deliveryFee`
   - `quantity: 1`
   - `discountPercent: 0`
   - No tax (or configurable: some jurisdictions tax delivery)
3. Post delivery fee to a **separate GL account** (`delivery_revenue` account, separate from sales_revenue)
4. Include in invoice total

**Discount stacking:**

- Customer discounts and global promos apply to **product lines only**, not to the delivery fee
- The delivery fee is added **after** all discounts and is **not discounted**
- Exception: "Free delivery over UGX 50,000" is a threshold, not a discount

### 3.4 Receipt & GL Posting

**Receipt (thermal):**

```
  Latte                   2   5,000   10,000
  Croissant               1   6,000    6,000
                              ─────────
  Subtotal                      16,000
  Delivery fee                   5,000
  ─────────────────────────────────────
  TOTAL                          21,000
```

**GL Posting:**

```typescript
// Existing revenue lines (per product)
{ accountId: sales_revenue, credit: subtotal }

// Delivery fee line (separate account)
{ accountId: delivery_revenue, credit: deliveryFee }

// Output tax (on products + delivery if taxable)
{ accountId: output_tax, credit: taxAmount }

// Cash/AR debit
{ accountId: cash_or_ar, debit: totalAmount }
```

If `delivery_revenue` account mapping is missing, fall back to `sales_revenue` (same as current sales_discount fallback pattern).

### 3.5 Schema Changes

| Table | New field | Type | Notes |
|---|---|---|---|
| **NEW** `DeliveryFeeRule` | (see §3.1) | — | Org-level config, singleton per org (one active rule) |
| **NEW** `DeliveryZone` | (see §3.1) | — | Zone-based pricing (Phase 2) |
| `Order` | `deliveryAddress` | `String?` | |
| `Order` | `deliveryPhone` | `String?` | |
| `Order` | `deliveryZone` | `String?` | |
| `Order` | `deliveryFee` | `Decimal @default(0) @db.Decimal(20,6)` | |
| `Invoice` | `deliveryAddress` | `String?` | Denormalised for receipt/audit |
| `Invoice` | `deliveryPhone` | `String?` | |
| `Invoice` | `deliveryFee` | `Decimal @default(0) @db.Decimal(20,6)` | |
| **NEW** enum `DeliveryFeeType` | | | `flat`, `zone_based`, `distance_based`, `percentage_of_order` |

### 3.6 API Changes

| Endpoint | Change |
|---|---|
| `GET /pos/settings` | Returns `deliveryFeeRule` in settings payload |
| `PATCH /pos/settings` | Accept `deliveryFeeRule` fields to update |
| **NEW** `GET /pos/settings/delivery` | Returns active delivery fee rule |
| **NEW** `PATCH /pos/settings/delivery` | Update delivery fee rule |
| **NEW** `GET /delivery-zones` | List zones (Phase 2) |
| **NEW** `POST /delivery-zones` | Create zone (Phase 2) |
| `POST /pos/checkout` | Accept `deliveryAddress`, `deliveryPhone`, `deliveryZone`; return fee in response |

**Checkout response addition:**

```typescript
interface CheckoutResult {
  // ...existing...
  deliveryFee: number;  // 0 if dine-in/takeaway or free threshold met
}
```

### 3.7 Frontend Components

| Component | Change |
|---|---|
| `OrderPanel.tsx` | When `orderType === 'delivery'`, show delivery address form below order-type dropdown |
| `Terminal.tsx` | Pass delivery address data from OrderPanel to checkout payload |
| `RetailTerminal.tsx` | Same |
| `PaymentDialog.tsx` | Show delivery fee line in the payment breakdown |
| `SettingsPage.tsx` | Add Delivery tab with fee rule config form |
| **NEW** `DeliveryAddressForm.tsx` | Reusable address capture component |
| `ReceiptPreview.tsx` | Show delivery fee line |
| `ReportsPage.tsx` | Show delivery fee in sales breakdown (total delivery revenue) |

---

## 4. Implementation Phasing

| Phase | Scope | Effort |
|---|---|---|
| **P1 — Combo POS display** | Fetch combos in Terminal, render cards in MenuGrid, remove SKU hack, show combo badge in OrderPanel | ~1 week |
| **P2 — Combo admin UI** | ComboListPage + ComboEditDialog with product picker | ~1 week |
| **P3 — Combo KOT & receipt** | Grouped KOT print, combo-named receipt lines | ~1 week |
| **P4 — Delivery fee config** | DeliveryFeeRule model + settings UI + GL mapping | ~1 week |
| **P5 — Delivery address + checkout** | Address capture UI, backend storage, fee calculation in checkout flow | ~1 week |
| **P6 — Delivery receipt & reporting** | Fee line on receipt, revenue breakout in X/Z reports, audit log | ~1 week |
| **P7 — Delivery zones** | Zone model, zone-based fee, admin CRUD (Phase 2 if needed) | ~1 week |

---

## 5. Open Questions

1. **Should combo prices be allowed to differ from the sum of components?**  
   Yes — that's the whole point of a combo (e.g. components cost UGX 20,000 individually but combo is UGX 18,000). The `comboPrice` is the **sale price**; total value of component stock is tracked separately for COGS.

2. **Can combo items have modifiers (e.g. "Latte with oat milk")?**  
   Phase 2. In Phase 1, combo items are fixed. If a customer wants customisation, the cashier should sell items individually.

3. **Delivery fee taxable?**  
   Depends on jurisdiction. Configurable: `deliveryFeeTaxable: Boolean` on DeliveryFeeRule. Default `false`.

4. **Free delivery minimum — before or after discounts?**  
   Before discounts (on gross subtotal). This matches customer expectation: "Free delivery over UGX 50,000" means the pre-discount order value.

5. **Cash on delivery payment method?**  
   Out of scope for this spec. The existing `store_credit` tender pattern could be extended, but delivery payment collection is an operational concern handled outside the POS (cash collected by driver, payment processed separately).

6. **What about combo stock tracking?**  
   Already handled — combo expansion produces per-product `OrderItem` rows, each of which goes through normal stock deduction in `pos-invoice.service.ts`. The first item carries the combo price for revenue; the rest are zero-priced lines that still decrement inventory correctly.

7. **Multiple delivery fee rules (express vs standard)?**  
   Phase 2. Initial implementation: one active rule at a time. Customer selects delivery → the rule applies. Multiple rules would need a delivery method picker in the UI.

---

## Appendix A: Example Flows

### Flow 1: Combo sale with delivery

```
1. Customer orders Breakfast Deal (UGX 18,000) via delivery
2. Cashier sets order type to "Delivery"
3. Address form appears: captures "123 Main St, Central"
4. Cart shows:
     🍱 Breakfast Deal × 1     UGX 18,000

5. Delivery fee rule: flat UGX 5,000, free above UGX 50,000
   → Subtotal UGX 18,000 < UGX 50,000
   → Delivery fee = UGX 5,000

6. Checkout payload:
   {
     lines: [{ comboId: 'breakfast-deal', ... }],
     orderType: 'delivery',
     deliveryAddress: '123 Main St',
     deliveryPhone: '+256 7XX...',
     deliveryZone: 'Central'
   }

7. Backend expands combo into Croissant + Latte + Juice lines
8. GL posting:
   Dr Cash/AR     UGX 23,000
     Cr Sales      UGX 18,000
     Cr Delivery   UGX  5,000

9. Receipt:
   Breakfast Deal
     Croissant           1   10,000
     Latte               1    8,000
     Orange Juice        1        0
                           ─────────
   Subtotal                   18,000
   Delivery fee                5,000
   ─────────────────────────────────
   TOTAL                      23,000
```

### Flow 2: Free delivery threshold met

```
Same as above but order is UGX 55,000 → fee = 0
  Subtotal                   55,000
  Delivery fee                    0  (free over UGX 50,000)
  ─────────────────────────────────
  TOTAL                      55,000
```

### Flow 3: Combo admin creates a new combo

```
1. Manager goes to Menu > Combos > "+ New Combo"
2. Name: "Lunch Combo"
3. Price: UGX 25,000
4. Adds items: Rice (qty 1), Chicken (qty 1), Drink (qty 1)
5. Saves → combo appears in POS menu grid immediately
6. Cashier taps the "Lunch Combo" card → adds to cart at UGX 25,000
7. At checkout, backend expands to Rice (0 UGX) + Chicken (25,000 UGX) + Drink (0 UGX)
```
