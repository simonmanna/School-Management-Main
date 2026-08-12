/** Shared types for the POS feature. Mirrors the API shapes. */

export type DiscountType = 'percentage' | 'fixed_amount';

export interface CartLine {
  /** Stable client-side id (used as React key + line id). */
  lineId: string;
  productId?: string;
  /** Menu-based POS: the sellable MenuItem id (recipe decremented on sale). */
  menuItemId?: string;
  sku?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  discountType?: DiscountType;
  discountAmount?: number;
  discountReason?: string;
  taxId?: string;
  note?: string;
  /** P4: modifier add-ons. Their priceDeltas are baked into unitPrice. */
  modifiers?: Array<{ modifierId: string; name: string; kitchenPrintName?: string | null; priceDelta: number }>;
  /** Selected variant id. Variant price replaces basePrice. */
  variantId?: string;
  /** Human-readable variant label (e.g. "Medium"). */
  variantName?: string;
  /** Variant's absolute price (before modifier delta). */
  variantPrice?: number;
  /** Selected accompaniment option ids (one per group). */
  accompanimentOptionIds?: string[];
  /** Human-readable accompaniment names (e.g. ["Rice", "Fries"]). */
  accompanimentNames?: string[];
  /** Sum of accompaniment price impacts. */
  accompanimentPriceImpact?: number;
  /** P4: if set, this line is a combo. Backend expands it on checkout. */
  comboId?: string;
  /** P10: when true, the line's price is VAT-inclusive. */
  taxInclusive?: boolean;
  /** P5 course grouping for fire/hold (1=starter, 2=main, 3=dessert, …). */
  course?: number;
}

export type PaymentMethod = 'cash' | 'bank' | 'card' | 'mobile_money' | 'store_credit';

export interface PaymentTender {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

export interface PosProduct {
  id: string;
  code: string;
  sku: string | null;
  name: string;
  productType: 'stockable' | 'service' | 'consumable' | string;
  salesPrice: string | null;
  categoryId?: string | null;
  category?: { id: string; name: string } | null;
  image?: string | null;
  isActive: boolean;
}

export interface PosHold {
  id: string;
  name: string;
  status: 'open' | 'recalled' | 'cancelled';
  totalAmount: string;
  partnerId: string | null;
  branchId: string | null;
  cashSessionId: string | null;
  notes: string | null;
  createdAt: string;
  lines: Array<{
    id: string;
    productId: string | null;
    description: string;
    quantity: string;
    unitPrice: string;
    discountPercent: string;
    taxId: string | null;
    lineNumber: number;
    note: string | null;
  }>;
}

export interface CheckoutResult {
  invoiceId: string;
  invoiceNumber: string;
  paymentIds: string[];
  total: number;
  change: number;
  receiptHtml?: string;
  receiptText?: string;
  receiptId?: string;
}

export interface XReport {
  asOf: string;
  cashSession: {
    id: string;
    cashRegisterId: string;
    userId: string | null;
    openedAt: string | null;
    openingFloat: string;
  } | null;
  totals: {
    saleCount: number;
    salesTotal: string;
    refundsTotal: string;
    netSales: string;
    overridesTotal: string;
    payInsTotal: string;
    payOutsTotal: string;
    expectedCash: string;
  };
  byMethod: Array<{ method: string; count: number; total: string }>;
  byCategory: Array<{ categoryId: string | null; categoryName: string; count: number; total: string }>;
}

export interface HourlyBucket { hour: number; count: number; total: string; }
export interface TopItemRow { productId: string; name: string; sku: string | null; quantity: number; total: string; }