/**
 * POS cart store — zustand.
 *
 * Single source of truth for the active cart. Persisted to sessionStorage so
 * a page reload (or accidental F5) doesn't lose the cashier's work. Cleared
 * explicitly after a successful checkout or when the cashier taps "New sale".
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CartLine, DiscountType } from './types';

export type OrderType = 'dine-in' | 'takeaway' | 'delivery';

interface CartState {
  lines: CartLine[];
  transactionDiscountPercent: number;
  transactionDiscountType: DiscountType;
  transactionDiscountAmount: number;
  transactionDiscountReason?: string;
  overrideById?: string;
  /** P3: manager PIN for F-OVR re-verify at checkout time. Never persisted to local storage. */
  overridePin?: string;
  cashSessionId?: string;
  /**
   * H2 — optimistic-lock token of the table's open order as last read from the
   * server. Echoed back on every tab save so a stale full-replace from another
   * device is rejected (409) instead of silently clobbering. Set on load; bumped
   * from each save response. Undefined for walk-in carts (no table).
   */
  tabVersion?: number;
  /**
   * Odoo-style multi-order: the id of the open server Order this cart is backed
   * by (table-bound OR tableless walk-in/retail). Set when an order is auto-created
   * on the first item or resumed from the Orders panel; cleared by clear()/New
   * Order. `tabVersion` is its optimistic-lock token whether or not there's a table.
   */
  orderId?: string;
  /** Workflow state */
  orderType?: OrderType;
  tableId?: string;
  tableNumber?: number;
  tableName?: string;
  sentToKitchen: boolean;
  /**
   * Idempotency-Key for THIS cart's checkout/settle. Generated once when the
   * cart is created and reused across every settle attempt (online retries AND
   * offline replay) so a lost response can never double-charge. A fresh key is
   * minted on clear()/load() — i.e. once the previous sale is done.
   */
  idempotencyKey: string;
  /** Add a product line, merging by (productId or sku) + taxInclusive flag. */
  addLine: (line: Omit<CartLine, 'lineId' | 'discountPercent'> & { discountPercent?: number }) => void;
  setQuantity: (lineId: string, qty: number) => void;
  /** Set line discount. amount is percent or fixed amount based on type. */
  setDiscount: (lineId: string, amount: number, type?: DiscountType) => void;
  /** Odoo-numpad "Price" mode — override a line's unit price directly. */
  setUnitPrice: (lineId: string, price: number) => void;
  /** P5 — assign a course to a line for fire/hold (undefined = uncoursed). */
  setCourse: (lineId: string, course: number | undefined) => void;
  setNote: (lineId: string, note: string) => void;
  removeLine: (lineId: string) => void;
  /** Order-level discount. type=percentage → amount is percent; type=fixed → amount in minor units. */
  setTransactionDiscount: (amount: number, type?: DiscountType) => void;
  setOverrideById: (id: string | undefined) => void;
  setCashSession: (id: string | undefined) => void;
  /** H2 — record the tab's server version (from a load or a save response). */
  setTabVersion: (v: number | undefined) => void;
  /** Multi-order — bind/unbind the cart to its open server Order. */
  setOrderId: (id: string | undefined) => void;
  setOrderType: (type: OrderType | undefined) => void;
  setTable: (id: string | undefined, number?: number, name?: string) => void;
  markSentToKitchen: (v: boolean) => void;
  /**
   * Replace cart wholesale (used when recalling a hold or loading a server tab).
   * `opts` restores the transaction-level discount + override; when omitted every
   * transaction-discount field resets to its neutral value so a stale discount
   * from the previous cart can never leak onto the freshly-loaded order.
   */
  load: (
    lines: CartLine[],
    opts?: {
      transactionDiscountPercent?: number;
      transactionDiscountType?: DiscountType;
      transactionDiscountAmount?: number;
      overrideById?: string;
      overridePin?: string;
    },
  ) => void;
  clear: () => void;
}

const newLineId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? (crypto as any).randomUUID()
    : Math.random().toString(36).slice(2);

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      transactionDiscountPercent: 0,
      transactionDiscountType: 'percentage' as DiscountType,
      transactionDiscountAmount: 0,
      transactionDiscountReason: undefined,
      overrideById: undefined,
      overridePin: undefined,
      cashSessionId: undefined,
      tabVersion: undefined,
      orderId: undefined,
      orderType: undefined,
      tableId: undefined,
      tableNumber: undefined,
      tableName: undefined,
      sentToKitchen: false,
      idempotencyKey: newLineId(),
      addLine: (line) => {
        set((state) => {
          // Key on (product|sku) + taxInclusive + selected modifiers + note so a
          // differently-customized item lands on its OWN cart line (e.g. "Large
          // + Extra milk" vs "Small + No ice"), while an identical pick merges
          // (qty +1). P10: taxInclusive keeps the same product addable twice.
          const keyOf = (l: {
            productId?: string;
            menuItemId?: string;
            sku?: string;
            taxInclusive?: boolean;
            modifiers?: Array<{ modifierId: string }>;
            note?: string;
            variantId?: string;
            accompanimentOptionIds?: string[];
          }) =>
            (l.menuItemId ?? l.productId ?? l.sku?.toLowerCase() ?? '') +
            (l.taxInclusive ? '|incl' : '') +
            '|m:' + (l.modifiers ?? []).map((m) => m.modifierId).sort().join(',') +
            '|v:' + (l.variantId ?? '') +
            '|a:' + (l.accompanimentOptionIds ?? []).sort().join(',') +
            '|n:' + (l.note ?? '');
          const key = keyOf(line);
          const existing = state.lines.find((l) => keyOf(l) === key);
          if (existing) {
            return {
              lines: state.lines.map((l) =>
                l.lineId === existing.lineId ? { ...l, quantity: l.quantity + (line.quantity || 1) } : l,
              ),
            };
          }
          return {
            lines: [
              ...state.lines,
              {
                ...line,
                lineId: newLineId(),
                discountPercent: line.discountPercent ?? 0,
              },
            ],
          };
        });
      },
      setQuantity: (lineId, qty) =>
        set((state) => ({
          lines: state.lines
            .map((l) => (l.lineId === lineId ? { ...l, quantity: Math.max(0, qty) } : l))
            .filter((l) => l.quantity > 0),
        })),
      setDiscount: (lineId, amount, type) =>
        set((state) => ({
          lines: state.lines.map((l) =>
            l.lineId === lineId
              ? {
                  ...l,
                  discountPercent: type === 'fixed_amount' ? 0 : Math.max(0, Math.min(100, amount)),
                  discountType: type ?? 'percentage',
                  discountAmount: type === 'fixed_amount' ? Math.max(0, amount) : undefined,
                }
              : l,
          ),
        })),
      setUnitPrice: (lineId, price) =>
        set((state) => ({
          lines: state.lines.map((l) =>
            l.lineId === lineId ? { ...l, unitPrice: Math.max(0, price) } : l,
          ),
        })),
      setCourse: (lineId, course) =>
        set((state) => ({
          lines: state.lines.map((l) =>
            l.lineId === lineId ? { ...l, course } : l,
          ),
        })),
      setNote: (lineId, note) =>
        set((state) => ({
          lines: state.lines.map((l) => (l.lineId === lineId ? { ...l, note } : l)),
        })),
      removeLine: (lineId) =>
        set((state) => ({ lines: state.lines.filter((l) => l.lineId !== lineId) })),
      setTransactionDiscount: (amount, type) =>
        set((state) => ({
          transactionDiscountPercent: type === 'fixed_amount' ? 0 : Math.max(0, Math.min(100, amount)),
          transactionDiscountType: type ?? 'percentage',
          transactionDiscountAmount: type === 'fixed_amount' ? Math.max(0, amount) : 0,
          transactionDiscountReason: amount > 0 ? state.transactionDiscountReason : undefined,
        })),
      setOverrideById: (id) => set({ overrideById: id, overridePin: undefined }),
      setCashSession: (id) => set({ cashSessionId: id }),
      setTabVersion: (v) => set({ tabVersion: v }),
      setOrderId: (id) => set({ orderId: id }),
      setOrderType: (type) => set({ orderType: type }),
      setTable: (id, number, name) => set({ tableId: id, tableNumber: number, tableName: name }),
      markSentToKitchen: (v) => set({ sentToKitchen: v }),
      load: (lines, opts) =>
        set({
          lines,
          transactionDiscountPercent: opts?.transactionDiscountPercent ?? 0,
          transactionDiscountType: opts?.transactionDiscountType ?? 'percentage',
          transactionDiscountAmount: opts?.transactionDiscountAmount ?? 0,
          transactionDiscountReason: undefined,
          overrideById: opts?.overrideById,
          overridePin: opts?.overridePin,
          // New order loaded → new sale → fresh idempotency key.
          idempotencyKey: newLineId(),
        }),
      clear: () => set({
        lines: [], transactionDiscountPercent: 0, transactionDiscountType: 'percentage',
        transactionDiscountAmount: 0, transactionDiscountReason: undefined,
        overrideById: undefined, overridePin: undefined,
        orderId: undefined, tabVersion: undefined,
        orderType: undefined, tableId: undefined, tableNumber: undefined, tableName: undefined,
        sentToKitchen: false,
        // Previous sale finished → mint a key for the next cart.
        idempotencyKey: newLineId(),
      }),
    }),
    {
      name: 'pos-cart',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

/** Derived selectors (kept outside the store so they're tree-shake friendly). */
export const selectSubtotal = (state: CartState): number =>
  state.lines.reduce((sum, l) => {
    const lineTotal = l.quantity * l.unitPrice;
    const discount = l.discountType === 'fixed_amount'
      ? (l.discountAmount ?? 0)
      : lineTotal * (l.discountPercent / 100);
    return sum + Math.max(0, lineTotal - discount);
  }, 0);

export const selectTxDiscountAmount = (state: CartState): number => {
  const sub = selectSubtotal(state);
  if (state.transactionDiscountType === 'fixed_amount') {
    return Math.min(state.transactionDiscountAmount, sub);
  }
  return sub * (state.transactionDiscountPercent / 100);
};

export const selectTotal = (state: CartState): number =>
  Math.max(0, selectSubtotal(state) - selectTxDiscountAmount(state));

export const selectItemCount = (state: CartState): number =>
  state.lines.reduce((s, l) => s + l.quantity, 0);