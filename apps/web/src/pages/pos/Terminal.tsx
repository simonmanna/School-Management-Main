import { useAuthStore } from '@/stores/auth.store';
/**
 * Terminal — Cafe POS orchestrator.
 *
 * Stitches together: Topbar + CategoryStrip + MenuGrid + OrderPanel + dialogs
 * + cart store + the new backend endpoints (checkout, holds, override, X/Z).
 *
 * Flow:
 *   1. Cashier opens shift (ShiftOpenDialog) — required to start selling.
 *   2. Search by name OR scan barcode (auto-lookup on Enter in the topbar).
 *   3. Tap products to add to cart. Cart has line discounts, transaction
 *      discounts (override-gated), and per-line notes.
 *   4. Press Charge → PaymentDialog → multi-tender → POST /pos/checkout
 *      with idempotency key. Backend creates invoice + payments + stock-out
 *      atomically; cart clears on success.
 *   5. Press Hold → POST /pos/holds → cart is parked, can be recalled later.
 *   6. Press Reports → /pos/reports (X/Z + hourly + top-items).
 *   7. Press Close shift → variance report + Z-report.
 *
 * Permissions-aware: if the cashier doesn't have pos:discount, the discount
 * buttons are hidden. If they don't have pos:reports, the Reports button is
 * hidden.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Coffee, LayoutGrid, ArrowLeft, Printer, Clock } from 'lucide-react';
import { Lock as LockIcon } from 'lucide-react';

import { Topbar } from './Topbar';
import { enqueueSale } from '@/features/pos/offline-queue';
import { AddOnsDialog } from './AddOnsDialog';
import { VariantPicker } from './VariantPicker';
import { AccompanimentPicker } from './AccompanimentPicker';
import { CategoryStrip } from './CategoryStrip';
import { MenuGrid } from './MenuGrid';
import { OrderPanel } from './OrderPanel';
import { PaymentDialog } from './PaymentDialog';
import { DiscountDialog } from './DiscountDialog';
import { LineDiscountDialog } from './LineDiscountDialog';
import { CustomerDialog } from './CustomerDialog';
import { OverrideDialog } from './OverrideDialog';
import { PinConfirmDialog } from './PinConfirmDialog';
import { DiscountReasonDialog } from './DiscountReasonDialog';
import { ShiftOpenDialog } from './ShiftOpenDialog';
import { ShiftCloseDialog } from './ShiftCloseDialog';
import { ReceiptPreview, type ReceiptLine } from './ReceiptPreview';
import { ReceiptPreviewDialog } from './ReceiptPreviewDialog';
import { TableSelectorDialog } from './TableSelectorDialog';
import { MoveItemsDialog } from './MoveItemsDialog';
import { SplitBillDialog } from './SplitBillDialog';

import { VoidItemDialog } from './VoidItemDialog';
import { CancelOrderDialog } from './CancelOrderDialog';
import { ReprintDialog } from './ReprintDialog';
import type { PosTable } from '@/features/tables/types';
import { STATUS_META, zoneLabel as zoneLabelOf, fmtMoney, minutesBetween } from '@/features/tables/utils';
import { useTables, useTransferItems, usePosTablesStream, useTableZones } from '@/features/tables/api';

import {
  useOpenSession,
  useCheckout,
  useSettleTab,
  useSaveTab,
  useStoreCredit,
  useFireKitchen,
  useFireOrderKitchen,
  usePrintBill,
  usePrintKot,
  usePrintAdditionalBill,
  useReprintReceipt,
  useCreateOrder,
  useCreditInfo,
  useSplitState,
  useOrdersList,
  useResumeOrder,
  useSettleOrder,
  useSaveOrderItems,
  useCancelOrder,
  type OrderLineBody,
} from './api';
import { OrdersListPanel } from './OrdersListPanel';
import { useMenuItemsAvailable } from '@/features/menu/api';
import { useMenuItemBundle, useCombos } from './pos-features-api';
import { api, resolveAssetUrl } from '@/lib/api';
import { useCartStore, selectSubtotal, selectTotal } from '@/features/pos/cart.store';
import type { CartLine, DiscountType, PaymentTender } from '@/features/pos/types';
import type { Customer, SettleMode } from './types';

import { usePosAuthStore } from '@/features/pos/pos-auth.store';
import { usePosSettings } from '@/features/pos/api';
import { useScannerDebounce } from './scanner-debounce';
import PosLoginScreen from './PosLoginScreen';
import RetailTerminal from './RetailTerminal';
import RentalTerminal from './RentalTerminal';

import './pos-pro.css';

const fmt = (n: number | string) => `${useAuthStore.getState().organization?.currencyCode ?? 'IDR'} ${Number(n || 0).toLocaleString()}`;

/** Stable signature of an order's line-set — used to detect cart⇄server drift
 * so auto-save only fires on a real change (and never loops with the loader). */
function orderSig(
  lines: Array<{ productId?: string; menuItemId?: string; sku?: string; name?: string; description?: string; quantity: number | string; unitPrice: number | string; discountPercent?: number | string; taxId?: string | null; note?: string | null }>,
): string {
  return JSON.stringify(
    lines.map((l) => [
      l.menuItemId ?? l.productId ?? l.sku ?? '',
      l.name ?? l.description ?? '',
      Number(l.quantity),
      Number(l.unitPrice),
      Number(l.discountPercent ?? 0),
      l.taxId ?? '',
      l.note ?? '',
    ]),
  );
}

/** Map a server order line (Document line) into a cart line. */
function serverLineToCart(l: any): CartLine {
  const id =
    l.id ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2));
  return {
    lineId: id,
    productId: l.productId ?? undefined,
    menuItemId: l.menuItemId ?? undefined,
    name: l.description,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unitPrice),
    discountPercent: Number(l.discountPercent ?? 0),
    taxId: l.taxId ?? undefined,
    note: l.note ?? undefined,
    taxInclusive: l.taxInclusive ?? undefined,
    // Restore per-line modifiers so the reloaded cart/KOT shows them. unitPrice
    // is already modifier-folded (so the display total is unchanged); cartLineToPayload
    // un-bakes the id-bearing deltas on the way back out, keeping the money exact.
    modifiers: Array.isArray(l.modifiers) && l.modifiers.length > 0
      ? l.modifiers.map((m: any) => ({ modifierId: m.modifierId ?? '', name: m.name, kitchenPrintName: m.kitchenPrintName ?? null, priceDelta: Number(m.priceDelta ?? 0) }))
      : undefined,
    variantId: l.variantId ?? undefined,
    variantName: l.variantName ?? undefined,
    variantPrice: l.variantPrice !== undefined ? Number(l.variantPrice) : undefined,
    accompanimentOptionIds: l.accompanimentOptionIds ?? undefined,
    accompanimentNames: l.accompanimentNames ?? undefined,
    accompanimentPriceImpact: l.accompanimentPriceImpact !== undefined ? Number(l.accompanimentPriceImpact) : undefined,
    course: l.course ?? undefined,
  };
}

/** Map cart lines into printable receipt lines (modifier objects → names). */
function cartToReceiptLines(ls: CartLine[]): ReceiptLine[] {
  return ls.map((l) => ({
    name: l.name,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountPercent: l.discountPercent,
    note: l.note,
    modifiers: l.modifiers?.map((m) => (m as any).kitchenPrintName ?? m.name).filter(Boolean),
    variantName: l.variantName,
    accompanimentNames: l.accompanimentNames,
  }));
}

/** Map a cart line into a checkout / save-tab line payload.
 *  Fixed-amount discounts are converted to equivalent percentage (API only
 *  stores discountPercent on DocumentLine). */
function cartLineToPayload(l: CartLine) {
  const base = l.quantity * l.unitPrice;
  const computedPct = l.discountType === 'fixed_amount' && l.discountAmount
    ? base > 0 ? Math.min(100, (l.discountAmount / base) * 100) : 0
    : l.discountPercent;
  // The cart's unitPrice is DISPLAY-baked: base menu price + accompaniment impact
  // + modifier deltas (see AddOnsDialog / effectiveBasePrice). The API re-resolves
  // accompaniment/modifier prices from the DB and folds them into unitPrice ITSELF,
  // so we must send the *un-baked* base here — otherwise add-ons are counted twice
  // (e.g. settle 400: tender 2080 ≠ amount due 4080). Variant lines are unaffected:
  // the API uses variantPrice (not this) as the base, so the subtraction is a no-op
  // for the charged price there.
  // Only un-bake deltas the API will re-fold — i.e. modifiers it can re-resolve by
  // id. A modifier whose source row was deleted (no id) is dropped server-side, so
  // leaving its delta in keeps the charged total exact.
  const modifierDelta = (l.modifiers ?? []).reduce((s, m) => s + (m.modifierId ? Number(m.priceDelta || 0) : 0), 0);
  const accImpact = Number(l.accompanimentPriceImpact || 0);
  const baseUnitPrice = l.unitPrice - modifierDelta - accImpact;
  return {
    productId: l.productId,
    menuItemId: l.menuItemId,
    sku: l.sku,
    description: l.name,
    quantity: l.quantity,
    unitPrice: baseUnitPrice,
    taxId: l.taxId,
    discountPercent: computedPct > 0 ? computedPct : undefined,
    note: l.note,
    modifiers: l.modifiers && l.modifiers.length > 0 ? l.modifiers : undefined,
    comboId: l.comboId,
    taxInclusive: l.taxInclusive,
    variantId: l.variantId,
    variantName: l.variantName,
    variantPrice: l.variantPrice,
    accompanimentOptionIds: l.accompanimentOptionIds,
    accompanimentNames: l.accompanimentNames,
    accompanimentPriceImpact: l.accompanimentPriceImpact,
    course: l.course,
  };
}

const TerminalPage: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const posUser = usePosAuthStore((s) => s.user);
  const [showPosLogin, setShowPosLogin] = useState(!usePosAuthStore.getState().user);

  /* ============== Catalog (menu-based) ============== */
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { data: menuPayload } = useMenuItemsAvailable();
  const categories = useMemo(
    () => (menuPayload?.categories ?? []).map((c: any) => ({ id: c.id, name: c.name, color: c.color, icon: c.icon })),
    [menuPayload],
  );
  // The POS sells MenuItems (not raw products). Map them into the catalog-card
  // shape MenuGrid expects; `id` is the MenuItem id used for the sale line.
  const products = useMemo(() => {
    const term = search.trim().toLowerCase();
    const catName = new Map((menuPayload?.categories ?? []).map((c: any) => [c.id, c.name]));
    return (menuPayload?.items ?? [])
      .filter((it: any) => it.isAvailable)
      .filter((it: any) => !activeCategory || it.categoryId === activeCategory)
      .filter((it: any) => !term || it.name.toLowerCase().includes(term) || (it.code ?? '').toLowerCase().includes(term))
      .map((it: any) => ({
        id: it.id,
        name: it.name,
        sku: it.code,
        // basePrice is stored in whole currency units ({orgCur()}).
        salesPrice: it.basePrice != null ? Number(it.basePrice) : 0,
        categoryId: it.categoryId,
        category: it.categoryId ? { name: catName.get(it.categoryId) ?? '' } : null,
        // Signed URL resolved by PosMenuService.resolveImage; shown in MenuGrid.
        // Absolutize so the <img> loads from the API origin (dev proxy-less).
        image: resolveAssetUrl(it.image) ?? null,
      }));
  }, [menuPayload, activeCategory, search]);

  // Combos are fixed-price bundles managed separately (GET /pos/modifiers/combos).
  // They span categories, so we surface them only in the "All" view and let the
  // backend expand the `comboId` line into component rows at checkout.
  const { data: combos } = useCombos();
  const comboCards = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (combos ?? [])
      .filter(() => !activeCategory)
      .filter((c) => !term || c.name.toLowerCase().includes(term))
      .map((c) => ({
        id: c.id,
        name: c.name,
        sku: null,
        salesPrice: Number(c.price || 0),
        categoryId: null,
        category: null,
        image: resolveAssetUrl(c.imageUrl) ?? null,
        isCombo: true,
        comboSummary: c.items
          .map((it) => `${it.quantity > 1 ? `${it.quantity}× ` : ''}${it.productName}`)
          .join(' + '),
      }));
  }, [combos, activeCategory, search]);

  // Combos render first (they're specials), then the menu items.
  const gridItems = useMemo(() => [...comboCards, ...products], [comboCards, products]);

  /* ============== Shift ============== */
  const { data: session, isLoading: sessionLoading, isFetching: sessionFetching, refetch: refetchSession } = useOpenSession();
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);

  /* ============== Customer ============== */
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  /* Redeemable store-credit balance for the selected customer (drives the
   * store_credit tender tile in PaymentDialog). */
  const { data: storeCredit } = useStoreCredit(customer?.id);
  /* House-account standing — drives the Charge dialog's credit panel. */
  const { data: creditInfo } = useCreditInfo(customer?.id);

  /* ============== Discounts ============== */
  const [showDiscount, setShowDiscount] = useState(false);
  const [lineForDiscount, setLineForDiscount] = useState<CartLine | null>(null);

  /* ============== Void item ============== */
  const [voidLine, setVoidLine] = useState<CartLine | null>(null);

  /* ============== Move Items ============== */
  const [showMoveItems, setShowMoveItems] = useState(false);

  /* ============== Split Bill ============== */
  const [showSplit, setShowSplit] = useState(false);

  /* ============== Move items ============== */
  const [transferBusy, setTransferBusy] = useState(false);

  /* ============== Cancel order ============== */
  const [showCancelOrder, setShowCancelOrder] = useState(false);
  const [cancelInvoice, setCancelInvoice] = useState<{ id: string; number: string } | null>(null);

  /* ============== Payment ============== */
  const [showPayment, setShowPayment] = useState(false);

  /* ============== Manager override ============== */
  const [overrideKind, setOverrideKind] = useState<'discount' | 'void' | 'manual_refund' | null>(null);
  const [overrideResolver, setOverrideResolver] = useState<((result: {managerId: string; pin: string} | null) => void) | null>(null);

  /* ============== PIN confirm (item delete) ============== */
  const [showPinConfirm, setShowPinConfirm] = useState(false);
  const [pendingRemoveLine, setPendingRemoveLine] = useState<CartLine | null>(null);

  /* ============== Discount reason (P4) ============== */
  const [showDiscountReason, setShowDiscountReason] = useState(false);

  /* ============== Receipt preview (Sprint P3) ============== */
  const [showBillPreview, setShowBillPreview] = useState(false);
  const [showKotPreview, setShowKotPreview] = useState(false);
  const [kotLines, setKotLines] = useState<CartLine[]>([]);
  const [showAdditionalBillPreview, setShowAdditionalBillPreview] = useState(false);
  const [additionalBillLines, setAdditionalBillLines] = useState<CartLine[]>([]);
  const [additionalBillCopy, setAdditionalBillCopy] = useState(1);
  const [additionalBillPreviousSubtotal, setAdditionalBillPreviousSubtotal] = useState(0);
  const [additionalBillGrandTotal, setAdditionalBillGrandTotal] = useState(0);
  const [lastCompleted, setLastCompleted] = useState<{
    lines: ReceiptLine[]; total: number; discountPercent: number; discountAmount: number;
    orderTypeLabel?: string; tableLabel?: string; customerName?: string;
    invoiceNumber?: string; invoiceId?: string; receiptHtml?: string;
  } | null>(null);
  const canReprint = usePosAuthStore((s) => s.user?.permissions?.includes('pos:reports') ?? false);
  const canDeleteItem = usePosAuthStore((s) => s.user?.permissions?.includes('pos:delete_item') ?? false);
  /* pos:discount gates the numpad % mode + Disc/Discount buttons, and is reused
   * as the price-override right (no dedicated pos:price_override permission). */
  const canDiscount = usePosAuthStore((s) => s.user?.permissions?.includes('pos:discount') ?? false);
  const [showReprint, setShowReprint] = useState<{ invoiceId: string; title: string } | null>(null);

  /* ============== Order type (Dine In / Takeaway / Delivery) ============== */
  /* selectedTableId � the table being worked on (null = grid view). */
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  /* tableView: 'grid' | 'detail' | 'ordering' � sub-state within tables mode. */
  const [tableView, setTableView] = useState<'grid' | 'detail' | 'ordering'>('grid');
  const tableCartsRef = useRef<Map<string, {
    lines: CartLine[];
    sentLineIds: string[];
    transactionDiscountPercent: number;
    transactionDiscountType: DiscountType;
    transactionDiscountAmount: number;
  }>>(new Map());
  const currentSentLineIds = useRef<Set<string>>(new Set());

  /* ============== P4: 4-layer order flow (variant → accompaniment → add-ons → cart) ============== */
  const [pendingItem, setPendingItem] = useState<{
    productId: string;
    productName: string;
    sku: string | null;
    taxInclusive?: boolean;
    basePrice: number;
    variantId?: string;
    variantName?: string;
    variantPrice?: number;
    accompanimentOptionIds?: string[];
    accompanimentNames?: string[];
    accompanimentPriceImpact?: number;
  } | null>(null);

  const { data: pendingBundle } = useMenuItemBundle(pendingItem?.productId ?? null);

  const nextStep = useMemo<'variant' | 'accompaniment' | 'addons' | 'direct' | null>(() => {
    if (!pendingItem || !pendingBundle) return null;
    if (pendingBundle.variants.length > 0 && !pendingItem.variantId) return 'variant';
    if (pendingBundle.accompanimentGroups.length > 0 && !pendingItem.accompanimentOptionIds) return 'accompaniment';
    if (pendingBundle.groups.length > 0) return 'addons';
    return 'direct';
  }, [pendingItem, pendingBundle]);

  const cancelOrderFlow = useCallback(() => setPendingItem(null), []);

  const onVariantConfirm = useCallback((variantId: string, variantName: string, variantPrice: number) => {
    setPendingItem((prev) => (prev ? { ...prev, variantId, variantName, variantPrice } : prev));
  }, []);

  const onAccompanimentConfirm = useCallback((selections: Array<{ optionId: string; optionName: string; priceImpact: number }>) => {
    setPendingItem((prev) =>
      prev
        ? {
            ...prev,
            accompanimentOptionIds: selections.map((s) => s.optionId),
            accompanimentNames: selections.map((s) => s.optionName),
            accompanimentPriceImpact: selections.reduce((sum, s) => sum + s.priceImpact, 0),
          }
        : prev,
    );
  }, []);

  /** Compute the effective base price for AddOnsDialog = variantPrice ?? basePrice + accompanimentImpact */
  const effectiveBasePrice = useMemo(() => {
    if (!pendingItem) return 0;
    const base = pendingItem.variantPrice ?? pendingItem.basePrice;
    return base + (pendingItem.accompanimentPriceImpact ?? 0);
  }, [pendingItem]);

  const onAddAddOnsConfirm = useCallback(
    (input: {
      productId: string;
      productName: string;
      unitPrice: number;
      sku: string | null;
      modifiers: Array<{ modifierId: string; name: string; priceDelta: number }>;
      quantity: number;
      note: string;
      taxInclusive?: boolean;
    }) => {
      if (!pendingItem) return;
      useCartStore.getState().addLine({
        menuItemId: input.productId,
        sku: input.sku ?? undefined,
        name: input.productName,
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        note: input.note || undefined,
        taxInclusive: input.taxInclusive,
        modifiers: input.modifiers.length > 0 ? input.modifiers : undefined,
        variantId: pendingItem.variantId,
        variantName: pendingItem.variantName,
        variantPrice: pendingItem.variantPrice,
        accompanimentOptionIds: pendingItem.accompanimentOptionIds,
        accompanimentNames: pendingItem.accompanimentNames,
        accompanimentPriceImpact: pendingItem.accompanimentPriceImpact,
      });
      setPendingItem(null);
    },
    [pendingItem],
  );

  /* ============== Fullscreen ============== */
  const [fullscreen, setFullscreen] = useState(false);

  const enterFullscreen = useCallback(() => {
    setFullscreen(true);
    document.body.classList.add('pos-terminal-fullscreen');
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  // Listen for browser-fullscreen-change to keep React state + body class in sync (ESC exit)
  useEffect(() => {
    const onFsChange = () => {
      const isFullscreen = !!document.fullscreenElement;
      setFullscreen(isFullscreen);
      document.body.classList.toggle('pos-terminal-fullscreen', isFullscreen);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  /* ============== Cart (zustand) ============== */
  const lines = useCartStore((s) => s.lines);
  const transactionDiscountPercent = useCartStore((s) => s.transactionDiscountPercent);
  const transactionDiscountType = useCartStore((s) => s.transactionDiscountType);
  const transactionDiscountAmount = useCartStore((s) => s.transactionDiscountAmount);
  const transactionDiscountReason = useCartStore((s) => s.transactionDiscountReason);
  const total = useCartStore(selectTotal);
  const tableId = useCartStore((s) => s.tableId);
  const addLine = useCartStore((s) => s.addLine);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const setDiscount = useCartStore((s) => s.setDiscount);
  const setNote = useCartStore((s) => s.setNote);
  const removeLine = useCartStore((s) => s.removeLine);
  const setTransactionDiscount = useCartStore((s) => s.setTransactionDiscount);
  const setCashSession = useCartStore((s) => s.setCashSession);
  const setOrderType = useCartStore((s) => s.setOrderType);
  const clearCart = useCartStore((s) => s.clear);
  const orderId = useCartStore((s) => s.orderId);
  const setOrderId = useCartStore((s) => s.setOrderId);

  /* ============== Tables (live via SSE, fallback poll 20s) ============== */
  usePosTablesStream();
  const qc = useQueryClient();
  const { data: tables = [], isLoading: tablesLoading } = useTables({ active: true, status: undefined });
  const { data: zones = [] } = useTableZones();

  /* Derived selected table � derived from selectedTableId + tables list */
  const selectedTable = selectedTableId
    ? tables.find((t) => t.id === selectedTableId) ?? null
    : null;

  /* ============== Per-table cart persistence ============== */
  const saveCurrentTableCart = useCallback(() => {
    const key = selectedTableId ?? 'walk-in';
    tableCartsRef.current.set(key, {
      lines: useCartStore.getState().lines,
      sentLineIds: Array.from(currentSentLineIds.current),
      transactionDiscountPercent: useCartStore.getState().transactionDiscountPercent,
      transactionDiscountType: useCartStore.getState().transactionDiscountType,
      transactionDiscountAmount: useCartStore.getState().transactionDiscountAmount,
    });
  }, [selectedTableId]);

  const loadTableCart = useCallback((tableId: string) => {
    const saved = tableCartsRef.current.get(tableId);
    const t = tables.find((t) => t.id === tableId) ?? null;
    useCartStore.setState({
      lines: saved?.lines ?? [],
      transactionDiscountPercent: saved?.transactionDiscountPercent ?? 0,
      transactionDiscountType: saved?.transactionDiscountType ?? 'percentage',
      transactionDiscountAmount: saved?.transactionDiscountAmount ?? 0,
      orderType: 'dine-in',
      tableId: tableId ?? undefined,
      tableNumber: t ? t.number : undefined,
      tableName: t ? t.name : undefined,
      sentToKitchen: false,
    });
    currentSentLineIds.current = new Set(saved?.sentLineIds ?? []);
  }, [tables]);

  const tableHasLocalCart = useCallback((tableId: string) => {
    const cart = tableCartsRef.current.get(tableId);
    return !!(cart && cart.lines.length > 0);
  }, []);

  const localCartTotal = useCallback((tableId: string) => {
    const cart = tableCartsRef.current.get(tableId);
    if (!cart) return 0;
    return cart.lines.reduce((s, l) => s + l.unitPrice * l.quantity * (1 - l.discountPercent / 100), 0);
  }, []);

  /* M4 open-tab dine-in — server order is the source of truth per table. */
  const settleTabMut = useSettleTab();
  const saveTab = useSaveTab();
  const fireKitchen = useFireKitchen();
  const fireOrderKitchen = useFireOrderKitchen();
  const printBill = usePrintBill();
  const printKot = usePrintKot();
  const printAdditionalBill = usePrintAdditionalBill();
  const reprintReceipt = useReprintReceipt();
  const transferItemsMut = useTransferItems();
  const createOrderMut = useCreateOrder();
  /* Odoo-style multi-order (Orders panel) — tableless walk-in/takeaway/delivery
   * orders persist as open Orders and are resumable; dine-in keeps its table tab. */
  const resumeOrderMut = useResumeOrder();
  const settleOrderMut = useSettleOrder();
  const saveOrderItems = useSaveOrderItems();
  const cancelOrderMut = useCancelOrder();
  const { data: ordersFeed } = useOrdersList({}, !!session);
  const ordersCount = ordersFeed?.count ?? 0;
  /* When a split is active on this table, the tab's lines are pinned server-side
   * (saveTab 400s). Used to suppress auto-save + redirect settle to the split. */
  const { data: splitState } = useSplitState(tableId ?? undefined, !!tableId);
  const splitActive = !!splitState?.splitActive;
  /* True while we're fetching+loading a table's order — gates auto-save so the
   * cleared/loading cart isn't pushed back to the server. */
  const [pendingTableLoad, setPendingTableLoad] = useState<string | null>(null);
  /* Signature of the line-set last synced to/from the server (guards the
   * load⇄auto-save loop: we only save when the cart differs from this). */
  const tabSyncSig = useRef<string>('');
  /* Odoo-style Orders panel + tableless-order auto-create/autosave bookkeeping. */
  const [showOrders, setShowOrders] = useState(false);
  const pendingOrderCreate = useRef(false);
  const orderSaveSig = useRef('');

  /* Imperatively fetch THIS table's open order fresh from the server and load it
   * into the cart. Deterministic — no react-query cache races on switch/return. */
  const loadTableOrder = useCallback(async (id: string) => {
    try {
      const doc = (await api.get(`/pos/tabs/${id}`)).data as any;
      const serverLines = (((doc?.lines) ?? []) as any[]).map(serverLineToCart);
      // Only apply if the cashier is still on this table (didn't switch again).
      if (useCartStore.getState().tableId === id) {
        useCartStore.getState().load(serverLines);
        // H2 — remember the server version so saves carry the optimistic-lock token.
        useCartStore.getState().setTabVersion(doc?.version);
        tabSyncSig.current = orderSig(serverLines);
      }
    } catch {
      if (useCartStore.getState().tableId === id) {
        useCartStore.getState().load([]);
        useCartStore.getState().setTabVersion(undefined);
        tabSyncSig.current = orderSig([]);
      }
    } finally {
      setPendingTableLoad((cur) => (cur === id ? null : cur));
    }
  }, []);

  const handleTableClick = useCallback((t: PosTable) => {
    // One open order per table. Flush the table we're leaving, clear the cart,
    // set the new table, then imperatively fetch + load THIS table's order.
    const cart = useCartStore.getState();
    // Flush any unsaved edit on the table we're leaving. The payload is captured
    // synchronously from the snapshot here, so clearing the cart immediately after
    // is safe; we keep the network call non-blocking (table switch stays snappy)
    // but surface a failed save so a stale server tab can't slip by unnoticed.
    if (cart.tableId && cart.tableId !== t.id && orderSig(cart.lines) !== tabSyncSig.current) {
      const leavingNumber = cart.tableNumber;
      saveTab
        .mutateAsync({ tableId: cart.tableId, lines: cart.lines.map(cartLineToPayload), partnerId: customer?.id, expectedVersion: cart.tabVersion })
        .catch((e: any) =>
          toast.error(e?.response?.data?.message || `Failed to save T${leavingNumber ?? ''} order before switching`),
        );
    }
    setPendingTableLoad(t.id);          // gate auto-save until the load finishes
    cart.clear();
    cart.setTable(t.id, t.number, t.name);
    tabSyncSig.current = '__loading__';
    setSelectedTableId(t.id);
    setTableView('ordering');
    enterFullscreen();
    void loadTableOrder(t.id);
  }, [saveTab, customer?.id, loadTableOrder, enterFullscreen]);

  const handleNewOrder = useCallback((t: PosTable) => {
    tableCartsRef.current.delete(t.id);
    loadTableCart(t.id);
    currentSentLineIds.current = new Set();
    setSelectedTableId(t.id);
    setTableView('ordering');
  }, [loadTableCart]);

  const handleContinueDraft = useCallback((t: PosTable) => {
    loadTableCart(t.id);
    setSelectedTableId(t.id);
    setTableView('ordering');
  }, [loadTableCart]);

  const handleGoBackToGrid = useCallback(async () => {
    const cart = useCartStore.getState();
    if (cart.tableId && orderSig(cart.lines) !== tabSyncSig.current) {
      const currentSig = orderSig(cart.lines);
      try {
        await saveTab.mutateAsync({ tableId: cart.tableId, lines: cart.lines.map(cartLineToPayload), partnerId: customer?.id, expectedVersion: cart.tabVersion });
        tabSyncSig.current = currentSig;
      } catch (e: any) {
        toast.error(e?.response?.data?.message || 'Failed to save the order — your latest changes may not be persisted');
      }
    }
    saveCurrentTableCart();
    setSelectedTableId(null);
    setTableView('grid');
  }, [saveCurrentTableCart, saveTab, customer?.id]);

  /* Close / clear the current order. B4: also cancel the SERVER draft (empty
   * save → draft cancelled + table freed) so a reload can't resurrect stale
   * items. We only wipe local state once the server confirms. */
  const handleCloseOrder = useCallback(async () => {
    const closingTableId = useCartStore.getState().tableId;
    if (closingTableId) {
      try {
        await saveTab.mutateAsync({ tableId: closingTableId, lines: [], partnerId: customer?.id });
      } catch (e: any) {
        toast.error(e?.response?.data?.message || 'Failed to cancel the order on the server');
        return;
      }
      tableCartsRef.current.delete(closingTableId);
    }
    tabSyncSig.current = orderSig([]);
    setSelectedTableId(null);
    setTableView('grid');
    clearCart();
    setCustomer(null);
    useCartStore.setState({ tableId: undefined, tableNumber: undefined, tableName: undefined, sentToKitchen: false });
  }, [saveTab, customer?.id, clearCart]);

  /* Auto-save cart to tableCartsRef when leaving the OrderPanel view. */
  useEffect(() => {
    if (tableView === 'ordering') {
      return () => { saveCurrentTableCart(); };
    }
  }, [tableView, saveCurrentTableCart]);

  /* Switch order type: dine-in, takeaway, or delivery. When leaving dine-in
   * (table mode), flush any in-progress table cart and show menu directly. */
  const handleChangeOrderType = useCallback((type: 'dine-in' | 'takeaway' | 'delivery') => {
    const cart = useCartStore.getState();
    if (cart.tableId) {
      if (orderSig(cart.lines) !== tabSyncSig.current) {
        saveTab
          .mutateAsync({ tableId: cart.tableId, lines: cart.lines.map(cartLineToPayload), partnerId: customer?.id, expectedVersion: cart.tabVersion })
          .catch(() => { /* best effort */ });
      }
      setSelectedTableId(null);
      clearCart();
      useCartStore.setState({ tableId: undefined, tableNumber: undefined, tableName: undefined, sentToKitchen: false });
      tabSyncSig.current = orderSig([]);
    }
    setOrderType(type);
    setTableView(type === 'dine-in' ? 'grid' : 'ordering');
    setSelectedTableId(null);
  }, [clearCart, setOrderType, saveTab, customer?.id]);

  /* ============== Mutations ============== */
  const checkout = useCheckout();

  /* On mount, baseline the sync signature and default order type. */
  useEffect(() => {
    const state = useCartStore.getState();
    tabSyncSig.current = orderSig(state.lines);
    if (!state.orderType) useCartStore.getState().setOrderType('dine-in');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Auto-save: persist the cart back to the table's order whenever it changes
   * (debounced). No table selected = walk-in sale, no auto-save. */
  useEffect(() => {
    // While a split is active the tab is pinned (saveTab 400s) — never auto-save.
    if (!tableId || pendingTableLoad || splitActive) return;
    const currentSig = orderSig(lines);
    if (currentSig === tabSyncSig.current) return;
    const payloadLines = lines.map(cartLineToPayload);

    // Fire the save with an explicit optimistic-lock token. On a genuine version
    // conflict we self-heal ONCE: re-read the current server version, keep the
    // cart as-is (so a just-applied line discount isn't lost), and retry. Last
    // write wins for the cashier who owns this screen — matches the "never block
    // the sale" rule. Only if the retry ALSO conflicts (a real concurrent writer)
    // do we fall back to reloading the server truth.
    const fire = (expectedVersion: number | undefined, isRetry: boolean) => {
      saveTab.mutate(
        { tableId, lines: payloadLines, partnerId: customer?.id, expectedVersion },
        {
          onSuccess: () => {
            tabSyncSig.current = currentSig;
            qc.invalidateQueries({ queryKey: ['pos-tables'] });
          },
          onError: async (e: any) => {
            const serverMsg: string | undefined = e?.response?.data?.message;
            // A billed-but-unpaid order also holds the table and returns 409, but
            // reloading won't clear it (the tab is locked until it's settled/
            // voided). Only the genuine optimistic-lock conflict is recoverable.
            const isVersionConflict = e?.response?.status === 409 && /modified by someone else/i.test(serverMsg ?? '');
            if (isVersionConflict && !isRetry) {
              try {
                const doc = (await api.get(`/pos/tabs/${tableId}`)).data as any;
                useCartStore.getState().setTabVersion(doc?.version);
                fire(doc?.version, true);
                return;
              } catch {
                // fall through to the reload path below
              }
            }
            if (isVersionConflict) {
              toast.error(serverMsg || 'This table was updated on another device — reloading the latest order. Re-add your last change if needed.');
              setPendingTableLoad(tableId);
              void loadTableOrder(tableId);
            } else {
              toast.error(serverMsg || e?.message || 'Failed to save order');
            }
          },
        },
      );
    };

    const h = setTimeout(() => fire(useCartStore.getState().tabVersion, false), 700);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, tableId, pendingTableLoad, customer?.id, splitActive]);

  const locked = !sessionLoading && !session && !sessionFetching;
  const orderTypeFromStore = useCartStore((s) => s.orderType);

  /* ── Odoo-style tableless multi-order (takeaway / delivery walk-ins) ──────
   * Dine-in persists via the table tab above. For a tableless order we mirror it:
   * auto-create an open Order on the first item so it's resumable from the Orders
   * panel, autosave it, and settle it by id. Best-effort — an offline create just
   * keeps the local cart (settles via checkout), so a sale is never blocked. */
  useEffect(() => {
    if (locked || tableId || orderId || pendingOrderCreate.current) return;
    if (lines.length === 0 || orderTypeFromStore === 'dine-in') return;
    pendingOrderCreate.current = true;
    createOrderMut.mutateAsync({
      orderType: orderTypeFromStore === 'delivery' ? 'delivery' : 'takeaway',
      partnerId: customer?.id,
      cashSessionId: session?.id,
      guestCount: 1,
      lines: useCartStore.getState().lines.map(cartLineToPayload) as OrderLineBody[],
    }).then((order) => {
      const st = useCartStore.getState();
      if (!st.orderId && !st.tableId && st.lines.length > 0) {
        st.setOrderId((order as any).id);
        st.setTabVersion((order as any).version);
        orderSaveSig.current = orderSig(st.lines);
      }
    }).catch(() => { /* offline / failed — keep local cart, settle via checkout */ })
      .finally(() => { pendingOrderCreate.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, orderId, tableId, locked, orderTypeFromStore, customer?.id, session?.id]);

  useEffect(() => {
    if (!orderId || tableId) return; // tableless only; tables use the tab autosave
    const sig = orderSig(lines);
    if (sig === orderSaveSig.current) return;
    const t = setTimeout(async () => {
      const st = useCartStore.getState();
      if (st.orderId !== orderId || st.tableId) return;
      if (st.lines.length === 0) {
        try { await cancelOrderMut.mutateAsync({ orderId, reason: 'Order emptied' }); } catch { /* noop */ }
        if (useCartStore.getState().orderId === orderId) { setOrderId(undefined); useCartStore.getState().setTabVersion(undefined); }
        orderSaveSig.current = '';
        return;
      }
      try {
        const saved = await saveOrderItems.mutateAsync({ orderId, lines: st.lines.map(cartLineToPayload) as OrderLineBody[], expectedVersion: st.tabVersion });
        if (useCartStore.getState().orderId === orderId && typeof (saved as any)?.version === 'number') {
          useCartStore.getState().setTabVersion((saved as any).version);
        }
        orderSaveSig.current = sig;
      } catch (e: any) {
        if (e?.response?.status === 409) {
          try { const fresh: any = await resumeOrderMut.mutateAsync(orderId); if (useCartStore.getState().orderId === orderId) useCartStore.getState().setTabVersion(fresh.version); } catch { /* noop */ }
        }
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, orderId, tableId]);

  /* Flush the current order (table OR tableless) before switching away. */
  const flushCurrentOrder = useCallback(async () => {
    const st = useCartStore.getState();
    if (st.tableId && orderSig(st.lines) !== tabSyncSig.current) {
      try { await saveTab.mutateAsync({ tableId: st.tableId, lines: st.lines.map(cartLineToPayload), partnerId: customer?.id, expectedVersion: st.tabVersion }); } catch { /* noop */ }
    } else if (st.orderId && st.lines.length > 0) {
      try { await saveOrderItems.mutateAsync({ orderId: st.orderId, lines: st.lines.map(cartLineToPayload) as OrderLineBody[], expectedVersion: st.tabVersion }); } catch { /* noop */ }
    }
  }, [saveTab, saveOrderItems, customer?.id]);

  /* New tableless order — the current one stays open in the Orders panel. */
  const newTablelessOrder = useCallback(async () => {
    await flushCurrentOrder();
    clearCart();
    orderSaveSig.current = '';
    tabSyncSig.current = orderSig([]);
    setSelectedTableId(null);
    setOrderType('takeaway');
    setTableView('ordering');
    setShowOrders(false);
  }, [flushCurrentOrder, clearCart, setOrderType]);

  /* Resume any order from the panel. A dine-in order routes back to its table
   * (reusing handleTableClick); a tableless one loads into the ordering view. */
  const openOrder = useCallback(async (id: string) => {
    setShowOrders(false);
    if (useCartStore.getState().orderId === id) return;
    await flushCurrentOrder();
    try {
      const view: any = await resumeOrderMut.mutateAsync(id);
      if (view.tableId) {
        const t = tables.find((x) => x.id === view.tableId);
        if (t) { handleTableClick(t); return; }
      }
      const cartLines = (view.lines ?? []).map(serverLineToCart);
      clearCart();
      setOrderType(view.orderType === 'delivery' ? 'delivery' : 'takeaway');
      useCartStore.getState().load(cartLines);
      setOrderId(id);
      useCartStore.getState().setTabVersion(view.version);
      orderSaveSig.current = orderSig(cartLines);
      setSelectedTableId(null);
      setTableView('ordering');
      enterFullscreen();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Could not open order');
    }
  }, [flushCurrentOrder, resumeOrderMut, clearCart, setOrderType, setOrderId, tables, handleTableClick, enterFullscreen]);

  const [isTabSettle, setIsTabSettle] = useState(false);

  /* Keep cart's cashSessionId in sync with the active shift. */
  useEffect(() => {
    setCashSession(session?.id ?? undefined);
  }, [session?.id, setCashSession]);

  /* Clear POS PIN session when leaving the terminal — forces re-PIN on next visit. */
  useEffect(() => {
    return () => {
      usePosAuthStore.getState().logout();
    };
  }, []);

  const ORDER_TYPE_LABELS: Record<string, string> = { 'dine-in': 'Dine In', takeaway: 'Takeaway', delivery: 'Delivery' };
  const orderTypeLabel = orderTypeFromStore ? ORDER_TYPE_LABELS[orderTypeFromStore] ?? 'Dine In' : 'Dine In';
  const activeTableLabel = selectedTable ? `T${selectedTable.number}${selectedTable.name ? ` ${selectedTable.name}` : ''}` : null;
  const [showTableSelector, setShowTableSelector] = useState(false);

  /* ============== Catalog actions ============== */
  const onPickProduct = useCallback(
    (p: any) => {
      if (locked) return;
      // Combo card → single combo line (no variant/accompaniment/add-on steps).
      // The backend expands `comboId` into component rows at checkout.
      if (p.isCombo) {
        addLine({
          productId: p.id,
          name: p.name,
          quantity: 1,
          unitPrice: Number(p.salesPrice || 0),
          comboId: p.id,
        });
        return;
      }
      // Start the 4-layer order flow (variant → accompaniment → add-ons → cart).
      // The bundle fetch determines which steps to show; nextStep resolves below.
      setPendingItem({
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        basePrice: Number(p.salesPrice || 0),
        taxInclusive: p.taxInclusive,
      });
    },
    [locked, addLine],
  );

  /* When no customization steps exist, add directly to cart. */
  useEffect(() => {
    if (nextStep !== 'direct' || !pendingItem) return;
    addLine({
      menuItemId: pendingItem.productId,
      sku: pendingItem.sku ?? undefined,
      name: pendingItem.productName,
      quantity: 1,
      unitPrice: pendingItem.basePrice,
      taxInclusive: pendingItem.taxInclusive,
      variantId: pendingItem.variantId,
      variantName: pendingItem.variantName,
      variantPrice: pendingItem.variantPrice,
      accompanimentOptionIds: pendingItem.accompanimentOptionIds,
      accompanimentNames: pendingItem.accompanimentNames,
      accompanimentPriceImpact: pendingItem.accompanimentPriceImpact,
    });
    setPendingItem(null);
  }, [nextStep, pendingItem, addLine]);

  /* P6: mirror the cart to localStorage so /pos/display (the customer-facing
     pole display) can poll and re-render in real time. */
  useEffect(() => {
    const snap = {
      lines,
      transactionDiscountPercent,
      total,
      tendered: 0,
      change: 0,
      status: lines.length === 0 ? 'idle' : 'building',
    };
    try { localStorage.setItem('pos-display-cart', JSON.stringify(snap)); } catch { /* noop */ }
  }, [lines, transactionDiscountPercent, total]);

  /* Legacy auto-add on exact SKU match (kept for backwards compat; the
     debouncer below also fires so the two paths are belt-and-suspenders). */
  useEffect(() => {
    const q = search.trim();
    if (!q || locked) return;
    const match = (products as any[]).find(
      (p) => p.sku && p.sku.toLowerCase() === q.toLowerCase(),
    );
    if (match) {
      onPickProduct(match);
      setSearch('');
    }
  }, [search, products, onPickProduct, locked]);

  /* P6: HID scanner debouncing — the topbar search calls onScan only when
     the input looks like a scan (rapid keystrokes). Slow typing still works. */
  const onScan = useCallback((code: string) => {
    // Menu-based POS: resolve a scanned code against the loaded MenuItems (by
    // their code/sku), not the raw products catalogue.
    const match = (products as any[]).find(
      (p) => p.sku && p.sku.toLowerCase() === code.toLowerCase(),
    );
    if (match) { onPickProduct(match); setSearch(''); }
  }, [products, onPickProduct]);
  useScannerDebounce(search, onScan);

  const onInc = (line: CartLine) => setQuantity(line.lineId, line.quantity + 1);
  const onDec = (line: CartLine) => setQuantity(line.lineId, line.quantity - 1);
  const onRemove = (line: CartLine) => {
    setPendingRemoveLine(line);
    setShowPinConfirm(true);
  };
  const onPinVerified = () => {
    if (pendingRemoveLine) removeLine(pendingRemoveLine.lineId);
    setShowPinConfirm(false);
    setPendingRemoveLine(null);
  };
  const onLineDiscount = (line: CartLine) => setLineForDiscount(line);
  const onLineDiscountApply = (lineId: string, amount: number, type?: DiscountType) => {
    setDiscount(lineId, amount, type);
    if (amount > 0) {
      toast.success(type === 'fixed_amount' ? `Line discount ${fmt(amount)} applied` : `Line discount ${amount}% applied`);
    } else {
      toast.success('Line discount cleared');
    }
  };
  const onLineNote = (line: CartLine) => {
    const next = window.prompt(`Note for "${line.name}"`, line.note ?? '');
    if (next !== null) setNote(line.lineId, next);
  };

  /* ============== Manager override helper ============== */
  const requestOverride = useCallback((kind: 'discount' | 'void' | 'manual_refund'): Promise<{managerId: string; pin: string} | null> => {
    return new Promise<{managerId: string; pin: string} | null>((resolve) => {
      setOverrideKind(kind);
      setOverrideResolver(() => resolve);
    });
  }, []);

  const onOverrideVerified = (result: {managerId: string; pin: string} | null) => {
    if (overrideResolver) overrideResolver(result);
    setOverrideKind(null);
    setOverrideResolver(null);
  };

  /* ============== Order-level discount ============== */
  const onApplyOrderDiscount = (percent: number) => {
    onApplyOrderDiscountEx(percent, 'percentage');
  };
  const onApplyOrderDiscountEx = (amount: number, type: DiscountType) => {
    const needsOverride = type === 'percentage' ? amount >= 10 : amount >= 50000;
    if (needsOverride) {
      requestOverride('discount').then((result) => {
        if (!result) {
          toast.error('Manager override cancelled');
          return;
        }
        setTransactionDiscount(amount, type);
        useCartStore.setState({ overrideById: result.managerId, overridePin: result.pin });
        if (amount > 0) setShowDiscountReason(true);
        toast.success(type === 'fixed_amount' ? `${fmt(amount)} discount applied with override` : `${amount}% discount applied with override`);
      });
    } else {
      setTransactionDiscount(amount, type);
      if (amount > 0) setShowDiscountReason(true);
      toast.success(type === 'fixed_amount' ? `${fmt(amount)} discount applied` : `${amount}% discount applied`);
    }
  };

  /* ============== Charge (payment) ============== */
  const onCharge = () => {
    if (lines.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    setShowPayment(true);
  };

  /* Settle (pay) the table's order. Flush any pending edit, then open payment. */
  const handleSettleTab = async () => {
    if (!tableId || lines.length === 0) { toast.error('Nothing to settle'); return; }
    // A split owns settlement — go straight to the Split screen (no saveTab, which
    // the guard would 400). The catch below is just a fallback for the race where
    // splitActive hasn't loaded yet.
    if (splitActive) { setShowSplit(true); return; }
    const flushOnce = (expectedVersion?: number) =>
      saveTab.mutateAsync({ tableId, lines: lines.map(cartLineToPayload), partnerId: customer?.id, expectedVersion });
    try {
      await flushOnce(useCartStore.getState().tabVersion);
      tabSyncSig.current = orderSig(lines);
    } catch (e: any) {
      // A split owns settlement of this tab — guide the cashier to the Split
      // screen instead of dead-ending on the guard's 400.
      const msg = e?.response?.data?.message || '';
      if (/split in progress/i.test(msg)) {
        toast.info('A split is in progress — settle each bill in the Split screen.');
        setShowSplit(true);
        return;
      }
      // Optimistic-lock conflict: adopt the server's current version and retry the
      // flush ONCE, preserving the on-screen cart (incl. any discount), so settling
      // isn't dead-ended by a stale token. Falls through to payment on success.
      const isVersionConflict = e?.response?.status === 409 && /modified by someone else/i.test(msg);
      if (!isVersionConflict) { toast.error('Could not save the order before settling'); return; }
      try {
        const doc = (await api.get(`/pos/tabs/${tableId}`)).data as any;
        useCartStore.getState().setTabVersion(doc?.version);
        await flushOnce(doc?.version);
        tabSyncSig.current = orderSig(lines);
      } catch {
        toast.error('Could not save the order before settling');
        return;
      }
    }
    setIsTabSettle(true);
    setShowPayment(true);
  };

  /* Transfer selected items to another table. We flush the cart first so the
   * server draft's line ids line up 1:1 with the on-screen order, then map our
   * selection (made against cart lineIds) onto the canonical server line ids
   * before moving them. Finally we reload THIS table to show the remainder. */
  /* Move Items — invoked by MoveItemsDialog after step 2 (destination + selection). */
  const doMoveItems = useCallback(async (targetId: string, selection: Array<{ lineId: string; quantity: number }>) => {
    if (!tableId || !selection.length) return;
    setTransferBusy(true);
    try {
      const currentLines = useCartStore.getState().lines;
      const saved = await saveTab.mutateAsync({ tableId, lines: currentLines.map(cartLineToPayload), partnerId: customer?.id });
      tabSyncSig.current = orderSig(currentLines);
      const serverLines: any[] = (saved as any)?.lines ?? [];
      const items = selection
        .map((s) => {
          const idx = currentLines.findIndex((l) => l.lineId === s.lineId);
          const srv = idx >= 0 ? serverLines[idx] : undefined;
          return srv ? { lineId: srv.id as string, quantity: s.quantity } : null;
        })
        .filter((x): x is { lineId: string; quantity: number } => x != null);
      if (items.length === 0) { toast.error('Could not match the selected items to the saved order'); return; }
      const res = await transferItemsMut.mutateAsync({ sourceId: tableId, targetId, items });
      const moved = ((res as any)?.movedSummary ?? []).reduce((s: number, i: any) => s + Number(i.quantity), 0);
      const dest = tables.find((t) => t.id === targetId);
      toast.success(`Moved ${moved} item(s) to T${dest?.number ?? ''}`);
      setShowMoveItems(false);
      setPendingTableLoad(tableId);
      tabSyncSig.current = '__loading__';
      await loadTableOrder(tableId);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Move failed');
    } finally {
      setTransferBusy(false);
    }
  }, [tableId, saveTab, customer?.id, transferItemsMut, tables, loadTableOrder]);

  /* Credit / charge-to-account sale.
   *
   * This is the SAME settle the cashier does for cash — only the settle mode
   * differs, so it goes through onSettle and therefore through whichever of the
   * three server paths already owns this cart (open tab / open order / cart
   * checkout). It used to build a second Order of its own, which left the
   * original one open, kept the table busy and skipped the idempotency key. */
  const onCreditSale = async () => {
    if (!customer?.id) { toast.error('Select a customer to charge on account'); return; }
    if (lines.length === 0) { toast.error('Cart is empty'); return; }
    await onSettle({ tenders: [], transactionDiscountPercent: 0, settleMode: 'credit' });
  };

  const onSettle = async (input: { tenders: PaymentTender[]; transactionDiscountPercent: number; amountTendered?: number; overrideById?: string; overridePin?: string; settleMode?: SettleMode }) => {
    const isCredit = input.settleMode === 'credit';
    /* Credit collects nothing, so there is no change to announce — say who now
     * owes what instead. */
    const settledToast = (invoiceNumber?: string) => {
      if (isCredit) return `Charged ${fmt(total)} to ${customer?.name ?? 'account'} — due later`;
      return invoiceNumber ? `Order ${invoiceNumber} settled` : 'Order settled';
    };
    /* Compute effective transaction discount percent (handles fixed-amount). */
    const effectiveTxPct = transactionDiscountType === 'fixed_amount' && transactionDiscountAmount > 0
      ? (() => { const sub = selectSubtotal(useCartStore.getState()); return sub > 0 ? Math.min(100, (transactionDiscountAmount / sub) * 100) : 0; })()
      : transactionDiscountPercent;
    /* One stable Idempotency-Key per cart — reused across every settle attempt
     * (online retries + offline replay) so a lost response never double-charges.
     * clear()/load() mint a fresh key once this sale is done. */
    const idemKey = useCartStore.getState().idempotencyKey;
    /* M4: settle the accumulated server tab instead of cart-checkout */
    if (isTabSettle && tableId) {
      const finishSettle = () => {
        setIsTabSettle(false);
        tabSyncSig.current = '';
        clearCart();
        setCustomer(null);
        setShowPayment(false);
        setSelectedTableId(null);
        setTableView('grid');
        refetchSession();
        currentSentLineIds.current.clear();
      };
      try {
        const res = await settleTabMut.mutateAsync({
          tableId,
          tenders: input.tenders,
          amountTendered: input.amountTendered,
          transactionDiscountPercent: effectiveTxPct,
          transactionDiscountType: transactionDiscountType !== 'percentage' ? transactionDiscountType : undefined,
          transactionDiscountAmount: transactionDiscountType === 'fixed_amount' ? transactionDiscountAmount : undefined,
          discountReason: transactionDiscountReason,
          cashSessionId: session?.id,
          settleMode: input.settleMode,
          partnerId: customer?.id,
          _idemKey: idemKey,
        });
        toast.success(isCredit
          ? settledToast()
          : `Order settled — change ${fmt((res as any).change ?? 0)}`);
        // Pop the settlement receipt so the cashier can print it.
        setLastCompleted({
          lines: cartToReceiptLines(lines),
          total,
          invoiceNumber: (res as any).invoiceNumber,
          invoiceId: (res as any).invoiceId,
          receiptHtml: (res as any).receiptHtml,
          discountPercent: effectiveTxPct,
          discountAmount: 0,
          orderTypeLabel: orderTypeLabel ?? undefined,
          tableLabel: activeTableLabel ?? undefined,
          customerName: customer?.name,
        });
        finishSettle();
      } catch (e: any) {
              // E4: queue the settle ONLY when the network is genuinely down (no
              // response). We deliberately do NOT queue on 5xx here — a tab settle
              // posts + tenders server-side, so a partial failure must not be blindly
              // replayed under a fresh idempotency key.
              const status = e?.response?.status;
              const networkDown = !status || status === 0;
              if (networkDown) {
          try {
            const queued = await enqueueSale(
              { tenders: input.tenders, amountTendered: input.amountTendered, cashSessionId: session?.id, settleMode: input.settleMode },
              { endpoint: `/pos/tabs/${tableId}/settle`, idempotencyKey: idemKey },
            );
            toast.warning(
              `Network down — settle queued (${queued.idempotencyKey.slice(0, 8)}). It will sync when you're back online.`,
              { duration: 12000 },
            );
            finishSettle();
            return;
          } catch (qErr: any) {
            toast.error(`Queue failed: ${qErr?.message || 'unknown'}`);
            return;
          }
        }
        toast.error(e?.response?.data?.message || 'Settle failed');
      }
      return;
    }

    /* Tableless open order (auto-created takeaway/delivery) → settle by id. No new
     * order is created; falls through to checkout only when there's no server order
     * (offline auto-create skipped), so a sale is never blocked. */
    const activeOrderId = useCartStore.getState().orderId;
    if (activeOrderId && !tableId) {
      try {
        await flushCurrentOrder();
        const res: any = await settleOrderMut.mutateAsync({
          orderId: activeOrderId,
          tenders: input.tenders,
          amountTendered: input.amountTendered,
          transactionDiscountPercent: effectiveTxPct,
          transactionDiscountType: transactionDiscountType !== 'percentage' ? transactionDiscountType : undefined,
          transactionDiscountAmount: transactionDiscountType === 'fixed_amount' ? transactionDiscountAmount : undefined,
          discountReason: transactionDiscountReason,
          overrideById: input.overrideById,
          overridePin: input.overridePin,
          cashSessionId: session?.id,
          settleMode: input.settleMode,
          partnerId: customer?.id,
          _idemKey: idemKey,
        });
        toast.success(isCredit
          ? settledToast(res.invoiceNumber)
          : `Order ${res.invoiceNumber} settled — change ${fmt(res.change ?? 0)}`);
        setLastCompleted({
          lines: cartToReceiptLines(lines),
          total, invoiceNumber: res.invoiceNumber, invoiceId: res.invoiceId,
          receiptHtml: res.receiptHtml,
          discountPercent: effectiveTxPct, discountAmount: 0,
          orderTypeLabel: orderTypeLabel ?? undefined,
          customerName: customer?.name,
        });
        clearCart();
        setCustomer(null);
        setShowPayment(false);
        refetchSession();
      } catch (e: any) {
        const msg = e?.response?.data?.message || e?.message || 'Settle failed';
        if (/manager override/i.test(msg) && !input.overrideById) {
          const result = await requestOverride('discount');
          if (result) { await onSettle({ ...input, overrideById: result.managerId, overridePin: result.pin }); return; }
        }
        toast.error(msg);
      }
      return;
    }

    const checkoutLines = lines.map((l) => {
      const base = l.quantity * l.unitPrice;
      const pct = l.discountType === 'fixed_amount' && l.discountAmount
        ? base > 0 ? Math.min(100, (l.discountAmount / base) * 100) : 0
        : l.discountPercent;
      return {
        productId: l.productId,
        menuItemId: l.menuItemId,
        sku: l.sku,
        description: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxId: l.taxId,
        discountPercent: pct > 0 ? pct : undefined,
        discountType: l.discountType,
        discountAmount: l.discountAmount,
        discountReason: l.discountReason,
        note: l.note,
        modifiers: l.modifiers && l.modifiers.length > 0 ? l.modifiers : undefined,
        comboId: l.comboId,
        taxInclusive: l.taxInclusive,
        variantId: l.variantId,
        accompanimentOptionIds: l.accompanimentOptionIds,
      };
    });
    const payload = {
      lines: checkoutLines,
      tenders: input.tenders,
      amountTendered: input.amountTendered,
      transactionDiscountPercent: effectiveTxPct,
      transactionDiscountType: transactionDiscountType !== 'percentage' ? transactionDiscountType : undefined,
      transactionDiscountAmount: transactionDiscountType === 'fixed_amount' ? transactionDiscountAmount : undefined,
      discountReason: transactionDiscountReason,
      overrideById: input.overrideById,
      overridePin: input.overridePin,
      cashSessionId: session?.id,
      branchId: undefined,
      reference: undefined,
      partnerId: customer?.id,
      // Tables (ADR-012): tie the sale to the active table when present.
      tableId: tableId || undefined,
      orderType: orderTypeFromStore === 'dine-in' ? 'dine_in' : orderTypeFromStore === 'takeaway' ? 'takeaway' : 'delivery',
      guestCount: undefined as number | undefined,
      settleMode: input.settleMode,
    } as any;
    try {
      const res = await checkout.mutateAsync({ ...payload, _idemKey: idemKey });
      toast.success(isCredit
        ? settledToast(res.invoiceNumber)
        : `Sale ${res.invoiceNumber} settled — change ${fmt(res.change)}`);

      setLastCompleted({
        lines: cartToReceiptLines(lines),
        total, invoiceNumber: res.invoiceNumber, invoiceId: res.invoiceId,
        receiptHtml: res.receiptHtml,
        discountPercent: effectiveTxPct,
        discountAmount: effectiveTxPct > 0 ? total - lines.reduce((s, l) => s + l.unitPrice * l.quantity * (1 - l.discountPercent / 100), 0) : 0,
        orderTypeLabel: orderTypeLabel ?? undefined,
        tableLabel: activeTableLabel ?? undefined,
        customerName: customer?.name,
      });
      clearCart();
      setCustomer(null);
      setShowPayment(false);
      refetchSession();
    } catch (e: any) {
          const msg = e?.response?.data?.message || e?.message || 'Checkout failed';
          // P11 offline fallback: if the network is down (no response at all,
          // or a 5xx/timeout), queue the sale locally. The next time the cashier
          // reconnects, the queue replays with the SAME Idempotency-Key so the
          // backend returns the original response — no double-charge.
          const status = e?.response?.status;
          const isOffline = !status || status === 0 || status >= 500 || status === 408 || status === 429;
          if (isOffline) {
        try {
          const queued = await enqueueSale(payload, { idempotencyKey: idemKey });
          toast.warning(
            `Network down — sale queued (${queued.idempotencyKey.slice(0, 8)}). It will sync automatically when you're back online.`,
            { duration: 12000 },
          );
          // Still clear the cart and show a "draft" receipt placeholder so
          // the cashier can hand the customer a hand-written slip if needed.
          setLastCompleted({
            lines: cartToReceiptLines(lines),
            total, invoiceNumber: `PENDING-${queued.idempotencyKey.slice(0, 8).toUpperCase()}`,
            discountPercent: effectiveTxPct,
            discountAmount: effectiveTxPct > 0 ? total - lines.reduce((s, l) => s + l.unitPrice * l.quantity * (1 - l.discountPercent / 100), 0) : 0,
            orderTypeLabel: orderTypeLabel ?? undefined,
            tableLabel: activeTableLabel ?? undefined,
            customerName: customer?.name,
          });
          clearCart();
          setCustomer(null);
          setShowPayment(false);
          return;
        } catch (qErr: any) {
          // If even IndexedDB is unavailable, surface the original error.
          toast.error(`Queue failed: ${qErr?.message || 'unknown'}. Original error: ${msg}`);
          throw e;
        }
      }
      // If the backend says manager override is required, prompt and retry.
      if (/manager override/i.test(msg) && !input.overrideById) {
        const result = await requestOverride('discount');
        if (result) {
          await onSettle({ ...input, overrideById: result.managerId, overridePin: result.pin });
          return;
        }
      }
      toast.error(msg);
      throw e;
    }
  };

  /* ============== Hold ============== */
  /* ============== Bill / KOT preview ============== */
  const resolveOpenOrder = async (): Promise<{ orderId: string; billPrintCount: number } | null> => {
    const open = selectedTable?.orders?.find((o) => !o.closedAt);
    if (open?.orderId) {
      return { orderId: open.orderId, billPrintCount: Number(open.order?.billPrintCount ?? 0) };
    }
    if (tableId) {
      try {
        const order = await api.get(`/pos/orders/by-table/${tableId}`).then((r: any) => r.data);
        if (order?.id) {
          return { orderId: order.id, billPrintCount: Number(order.billPrintCount ?? 0) };
        }
      } catch { /* ignore fallback failure */ }
    }
    return null;
  };

  const onPrintBill = async () => {
    if (lines.length === 0) { toast.error('Cart is empty'); return; }
    try {
      const saved = await saveTab.mutateAsync({
        tableId: selectedTableId!,
        lines: lines.map(cartLineToPayload),
        partnerId: customer?.id,
      });
      if (!saved?.id) { toast.error('No open order on this table'); return; }
      try {
        await printBill.mutateAsync({ invoiceId: saved.id });
      } catch { /* non-fatal — print failure shouldn't block preview */ }
      setShowBillPreview(true);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to save order');
    }
  };

  /* Print only items added since the last bill print. */
  const onPrintAdditionalBill = async () => {
    if (lines.length === 0) { toast.error('Cart is empty'); return; }
    const openOrder = await resolveOpenOrder();
    if (!openOrder) { toast.error('No open order on this table'); return; }
    if (openOrder.billPrintCount === 0) {
      toast.error('Print the initial bill first before printing an additional bill.');
      return;
    }
    try {
      const saved = await saveTab.mutateAsync({
        tableId: selectedTableId!,
        lines: lines.map(cartLineToPayload),
        partnerId: customer?.id,
      });
      const refreshed = await api.get(`/pos/tabs/${selectedTableId!}`).then((r: any) => r.data);
      const serverLines = (refreshed?.lines ?? []) as any[];
      const unbilledIds = new Set(
        serverLines
          .filter((l: any) => l.billPrintedAt == null)
          .map((l: any) => l.id),
      );
      const srvLines = (saved as any)?.lines ?? [];
      const matched = lines
        .map((cartLine) => {
          const idx = srvLines.findIndex((sl: any) => sl.description === cartLine.name && Number(sl.quantity) === cartLine.quantity);
          const srvId = idx >= 0 ? srvLines[idx]?.id : undefined;
          return { cartLine, srvId };
        })
        .filter((x) => x.srvId && unbilledIds.has(x.srvId))
        .map((x) => x.cartLine);
      if (matched.length === 0) {
        toast.info('No new items to bill since the last print.');
        return;
      }
      const additionalSubtotal = matched.reduce((s, l) => s + l.unitPrice * l.quantity * (1 - l.discountPercent / 100), 0);
      const docSubtotal = Number(refreshed?.subtotal ?? 0);
      const previousSubtotal = Math.max(0, docSubtotal - additionalSubtotal);
      const grandTotal = Number(refreshed?.totalAmount ?? 0);
      setAdditionalBillLines(matched);
      setAdditionalBillCopy(openOrder.billPrintCount + 1);
      setAdditionalBillPreviousSubtotal(previousSubtotal);
      setAdditionalBillGrandTotal(grandTotal);
      setShowAdditionalBillPreview(true);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to prepare additional bill');
    }
  };

  /* ============== Split Bill ============== */
  /* Dine-in: open the split workspace (divide the tab into independent bills).
   * Flush the cart first so server DocumentLine ids match the on-screen order —
   * the split references those ids. Walk-in sales fall back to multi-tender. */
  const onSplit = async () => {
    if (!tableId) {
      toast.info('Split bill is for dine-in tables. For counter sales, add multiple tenders at payment.');
      setShowPayment(true);
      return;
    }
    if (lines.length === 0) { toast.error('Cart is empty'); return; }
    // If a split is already in progress the tab's lines are pinned server-side —
    // flushing the cart would 400 ("Split in progress"), so just reopen the
    // workspace and let it drive from server state.
    try {
      const st = (await api.get(`/pos/tabs/${tableId}/split`)).data as any;
      if (st?.splitActive) { setShowSplit(true); return; }
    } catch { /* fall through to the normal flush */ }
    try {
      await saveTab.mutateAsync({ tableId, lines: lines.map(cartLineToPayload), partnerId: customer?.id });
      tabSyncSig.current = orderSig(lines);
    } catch {
      // Never trap the cashier — open the workspace anyway (the dialog reads the
      // authoritative server state and can still cancel/continue the split).
      toast.error('Could not sync the latest items before splitting — showing the saved order.');
    }
    setShowSplit(true);
  };

  /* ============== Fullscreen toggle ============== */
  const onToggleFullscreen = () => {
    const next = !fullscreen;
    setFullscreen(next);
    document.body.classList.toggle('pos-terminal-fullscreen', next);
    try {
      if (next) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    } catch { /* noop */ }
  };

  /* ============== Keyboard shortcuts ============== */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'F2') { e.preventDefault(); onCharge(); }
      else if (e.key === 'F4') { e.preventDefault(); onSplit(); }
      else if (e.key === 'F8') { e.preventDefault(); onPrintBill(); }
      else if (e.key === 'Escape') {
        setShowPayment(false); setShowCustomer(false);
        setShowDiscount(false); setShowOpenShift(false); setShowCloseShift(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCharge, onSplit, onPrintBill]);

  const logout = () => {
    useAuthStore.getState().clear();
    navigate('/login', { replace: true });
  };

  const handleUserChanged = () => {
    // Force re-render — locked state recalculates via posUser
    setShowPosLogin(!usePosAuthStore.getState().user);
    refetchSession();
  };

  return (
    <div className={'pos-shell-pro' + (fullscreen ? ' dark-mode' : '')}>
      {/* POS PIN Login screen — shown until a cashier authenticates */}
      {showPosLogin && !posUser ? (
        <PosLoginScreen onLoggedIn={() => { setShowPosLogin(false); refetchSession(); }} onBeforeSubmit={enterFullscreen} />
      ) : null}

      <Topbar
        search={search}
        onSearch={setSearch}
        onOpenReports={() => navigate('/pos/reports')}
        onOpenShift={() => setShowOpenShift(true)}
        onCloseShift={() => setShowCloseShift(true)}
        onOpenTableSelector={() => setShowTableSelector(true)}
        activeTableLabel={selectedTable ? `T${selectedTable.number}${selectedTable.name ? ` ${selectedTable.name}` : ''}` : null}
        staffName={user?.firstName}
        staffRole={(user as any)?.roles?.[0]}
        session={session ?? null}
        fullscreen={fullscreen}
        onToggleFullscreen={onToggleFullscreen}
        onLogout={logout}
        onUserChanged={handleUserChanged}
        onOpenOrders={() => setShowOrders(true)}
        ordersCount={ordersCount}
        // rightExtras={<OfflineIndicator />}
        orderType={orderTypeFromStore ?? 'dine-in'}
      />

      <div className={tableView === 'grid' && !selectedTableId ? 'pos-body-pro pos-body-pro--tables' : 'pos-body-pro'}>
        {locked ? (
          <div className="pos-lock-overlay-pro">
            <div className="pos-lock-icon"><LockIcon className="h-10 w-10" /></div>
            <div className="pos-lock-title">Open your shift to start selling</div>
            <div className="pos-lock-sub">Pick a cash register, count your opening float, then tap "Open shift".</div>
            <button
              type="button"
              onClick={() => setShowOpenShift(true)}
              className="pos-action-btn-pro bg-emerald h-12 px-6"
              style={{ width: 'auto', paddingLeft: 24, paddingRight: 24, minHeight: 48 }}
            >
              <Coffee className="pos-action-icon" /> Open shift
            </button>
          </div>
        ) : showOrders ? (
          /* Odoo-style Orders panel (full-page, all order types) */
          <div className="pos-menus-pro">
            <OrdersListPanel
              open={showOrders}
              activeOrderId={orderId ?? undefined}
              onOpenOrder={openOrder}
              onNewOrder={newTablelessOrder}
              onClose={() => setShowOrders(false)}
            />
          </div>
        ) : (orderTypeFromStore === 'dine-in' || !orderTypeFromStore) && !selectedTableId && tableView !== 'ordering' ? (
          /* Dine-in table grid (full-page, no cart) */
          <div className="pos-menus-pro">
            <div className="flex flex-col h-full">
              {/* Minimal header */}
              <div className="flex items-end justify-between px-6 pt-5 pb-2">
                <div>
                  <h2 className="text-base font-bold text-slate-700">Tables</h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {tables.length} tables · {tables.filter(t => t.status === 'occupied').length} occupied
                  </p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                {tablesLoading ? (
                  <div className="text-center text-slate-400 py-12">Loading tables...</div>
                ) : tables.length === 0 ? (
                  <div className="text-center text-slate-400 py-12">
                    <LayoutGrid className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p className="font-semibold">No tables configured</p>
                    <p className="text-xs mt-1">Create tables in the Tables admin page first.</p>
                  </div>
                ) : (() => {
                  const grouped = new Map<string, PosTable[]>();
                  for (const t of tables) {
                    const key = t.zone;
                    const arr = grouped.get(key) ?? [];
                    arr.push(t);
                    grouped.set(key, arr);
                  }
                  const zoneOrder = new Map(zones.map((z, i) => [z.key, i]));
                  return Array.from(grouped.entries())
                    .sort((a, b) =>
                      (zoneOrder.get(a[0]) ?? 999) - (zoneOrder.get(b[0]) ?? 999) || a[0].localeCompare(b[0]),
                    );
                })().map(([zoneKey, list]) => (
                  <div key={zoneKey} className="mb-6 last:mb-0">
                    <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400 mb-3">
                      {zoneLabelOf(zones, zoneKey)} · {list.length}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
                      {list.map((t) => {
                        const openOrders = (t.orders ?? []).filter((o) => !o.closedAt);
                        const backendTotal = openOrders.reduce((s, o) => s + Number(o.order?.totalAmount ?? 0), 0);
                        const hasLocal = tableHasLocalCart(t.id);
                        const local = localCartTotal(t.id);
                        const combinedTotal = backendTotal + local;
                        const combinedCount = openOrders.length + (hasLocal ? 1 : 0);
                        const meta = STATUS_META[t.status] ?? STATUS_META.available;
                        const statusLabel = t.status === 'occupied' ? 'Occupied' : t.status === 'out_of_service' ? 'Out of service' : t.status === 'reserved' ? 'Reserved' : 'Available';
                        const zoneLabel = t.zoneName ?? t.zone;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => handleTableClick(t)}
                            className={`relative rounded-xl border p-5 text-left transition-all duration-200
                              min-h-[140px] sm:min-h-[140px] flex flex-col
                              hover:shadow-xl hover:-translate-y-1
                              ${t.status === 'occupied' ? 'bg-orange-50/80 border-orange-300' : t.status === 'reserved' ? 'bg-blue-50/30 border-blue-200' : t.status === 'out_of_service' ? 'bg-slate-100 border-slate-300' : 'bg-emerald-50 border-emerald-300 border-l-4'}
                            `}
                          >
                            {/* Occupied top indicator */}
                            {t.status === 'occupied' && (
                              <div className="absolute top-0 left-0 right-0 h-1.5 rounded-t-xl bg-orange-400" />
                            )}

                            {/* Draft badge */}
                            {hasLocal && (
                              <div className="absolute top-2 left-2 z-10">
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                  Draft
                                </span>
                              </div>
                            )}

                            <div className="text-[24px] font-bold text-slate-800 leading-tight mb-1">
                              {t.name}
                            </div>

                            {/* Zone label below name */}
                            <div className="text-sm font-medium text-slate-400 capitalize mb-auto">
                              {zoneLabel} - T{t.number}
                            </div>

                            {/* Table code (replaces seats) + status */}
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-sm font-bold text-slate-600 bg-white/70 px-2 py-1 rounded border border-slate-200 font-mono tracking-wider">
                                {t.name}
                              </span>
                              <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${meta.pill}`}>
                                {statusLabel}
                              </span>
                            </div>

                            {/* Order footer */}
                            {combinedCount > 0 ? (
                              <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                                <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                                  <Clock className="w-3 h-3" />
                                  {minutesBetween(openOrders[0]?.openedAt ?? new Date(), null)}m
                                </span>
                                <span className="text-[11px] font-bold text-slate-700">{fmtMoney(combinedTotal)}</span>
                              </div>
                            ) : (
                              <div className="mt-3 pt-2.5 border-t border-slate-100 text-[11px] text-slate-400 font-medium">
                                Tap to open
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (orderTypeFromStore === 'dine-in' || !orderTypeFromStore) && selectedTableId && tableView === 'detail' && selectedTable ? (
          /* Dine-in table detail view (left) + OrderPanel (right) */
          <div className="pos-menus-pro">
            <TableDetailView
              table={selectedTable}
              onBack={handleGoBackToGrid}
              onStartOrder={handleNewOrder}
              onContinueDraft={handleContinueDraft}
              hasLocalCart={tableHasLocalCart(selectedTable.id)}
            />
          </div>
        ) : (
          /* Menu (left) + OrderPanel (right) — ordering, takeaway, delivery */
          <>
            <div className="pos-menus-pro">
              <CategoryStrip
                categories={categories as any}
                activeId={activeCategory}
                onSelect={setActiveCategory}
              />
              <div className="relative flex-1 flex flex-col min-h-0">
                <MenuGrid products={gridItems as any} locked={locked} onPick={onPickProduct} />
              </div>
            </div>
          </>
        )}

        {/* OrderPanel — hidden in full-page tables grid + Orders panel modes */}
        {!locked && tableView !== 'grid' && !showOrders && (
          <OrderPanel
            customerName={customer?.name}
            orderTypeLabel={orderTypeLabel}
            orderType={orderTypeFromStore ?? 'dine-in'}
            onChangeOrderType={handleChangeOrderType}
            tableLabel={selectedTable ? `T${selectedTable.number}${selectedTable.name ? ` ${selectedTable.name}` : ''}` : undefined}
            tableId={tableId}
            billAlreadyPrinted={!!selectedTable?.orders?.find((o) => !o.closedAt && (o.order?.billPrintCount ?? 0) > 0)}
            onPrintAdditionalBill={onPrintAdditionalBill}
            onInc={onInc}
            onDec={onDec}
            onRemove={canDeleteItem ? onRemove : undefined}
            canDiscount={canDiscount}
            canOverridePrice={canDiscount}
            onNote={onLineNote}
            onLineDiscount={onLineDiscount}
            onPrintBill={onPrintBill}
            onCharge={onCharge}
            onSplit={onSplit}
            onAddCustomer={() => setShowCustomer(true)}
            onAddDiscount={() => setShowDiscount(true)}
            onCloseOrder={handleCloseOrder}
            onPrintKot={async () => {
              if (lines.length === 0) { toast.error('Cart is empty'); return; }
              let printedLineIds = new Set<string>();
              if (tableId) {
                try {
                  await fireKitchen.mutateAsync({ tableId });
                  const refreshed = await api.get(`/pos/tabs/${tableId}`).then((r: any) => r.data);
                  const srvLines = (refreshed?.lines ?? []) as any[];
                  printedLineIds = new Set(srvLines.filter((l: any) => l.kitchenLastPrintedAt != null).map((l: any) => l.id));
                } catch { /* KDS/KOT non-fatal */ }
              }
              const unprinted = lines.filter((l) => !printedLineIds.has(l.lineId));
              if (unprinted.length === 0) { toast.info('All items already sent to kitchen'); return; }
              setKotLines(unprinted);
              setShowKotPreview(true);
            }}
            onFireCourse={async (course) => {
              const st = useCartStore.getState();
              if (st.lines.length === 0) { toast.error('Cart is empty'); return; }
              let oid = st.orderId;
              if (!oid && tableId) { const r = await resolveOpenOrder(); oid = r?.orderId; }
              if (!oid) { toast.error('No open order to fire'); return; }
              // Persist the current lines (incl. course assignments) before firing.
              try {
                const saved = await saveOrderItems.mutateAsync({ orderId: oid, lines: st.lines.map(cartLineToPayload) as OrderLineBody[], expectedVersion: st.tabVersion });
                if (useCartStore.getState().orderId === oid && typeof (saved as any)?.version === 'number') {
                  useCartStore.getState().setTabVersion((saved as any).version);
                }
              } catch { /* proceed; autosave may already have persisted the courses */ }
              try {
                const res: any = await fireOrderKitchen.mutateAsync({ orderId: oid, course });
                const label = ['', 'Starter', 'Main', 'Dessert'][course] ?? `Course ${course}`;
                toast.success(res?.count ? `${label} fired to kitchen` : (res?.message ?? 'Nothing new to fire'));
              } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Fire failed'); }
            }}
            onVoidItem={(line) => setVoidLine(line)}
            onMoveItems={() => setShowMoveItems(true)}
            onSettleTab={tableId ? handleSettleTab : undefined}
          />
        )}
      </div>

      {/* Dialogs */}
      <ShiftOpenDialog
        open={showOpenShift}
        onClose={() => setShowOpenShift(false)}
        onOpened={() => refetchSession()}
      />
      <ShiftCloseDialog
        open={showCloseShift}
        session={session ?? null}
        onClose={() => setShowCloseShift(false)}
        onClosed={() => {
          refetchSession();
          setTimeout(() => navigate('/pos/reports'), 600);
        }}
      />
      <CustomerDialog
        open={showCustomer}
        onClose={() => setShowCustomer(false)}
        onPick={(c) => { setCustomer(c); toast.success(`Customer: ${c.name}`); }}
      />
      <DiscountDialog
        key={'discount-' + showDiscount}
        open={showDiscount}
        initialPercent={transactionDiscountPercent}
        onClose={() => setShowDiscount(false)}
        onApply={onApplyOrderDiscount}
        onApplyEx={onApplyOrderDiscountEx}
      />
      {lineForDiscount ? (
        <LineDiscountDialog
          open={!!lineForDiscount}
          line={lineForDiscount}
          onClose={() => setLineForDiscount(null)}
          onApply={onLineDiscountApply}
        />
      ) : null}
      <DiscountReasonDialog
        open={showDiscountReason}
        onClose={() => setShowDiscountReason(false)}
        onSelect={(reason) => {
          useCartStore.setState({ transactionDiscountReason: reason });
          setShowDiscountReason(false);
        }}
      />
      <PaymentDialog
        open={showPayment}
        total={total}
        effectiveDiscountPercent={Math.max(transactionDiscountPercent, ...lines.map((l) => l.discountPercent))}
        storeCreditBalance={storeCredit?.balance ?? 0}
        onRequestOverride={requestOverride}
        onClose={() => { setShowPayment(false); setIsTabSettle(false); }}
        onSettle={onSettle}
        creditEnabled={!!customer?.id}
        onCreditSale={onCreditSale}
        customerName={customer?.name}
        creditInfo={creditInfo ?? null}
        onPickCustomer={() => setShowCustomer(true)}
      />
      <OverrideDialog
        open={!!overrideKind}
        kind={overrideKind ?? 'discount'}
        onClose={() => onOverrideVerified(null)}
        onVerified={onOverrideVerified}
      />
      <PinConfirmDialog
        open={showPinConfirm}
        title="Confirm to delete item"
        description="Enter your PIN to remove this item from the order."
        onClose={() => { setShowPinConfirm(false); setPendingRemoveLine(null); }}
        onVerified={onPinVerified}
      />

      {/* Void item dialog */}
      <VoidItemDialog
        open={!!voidLine}
        line={voidLine}
        onClose={() => setVoidLine(null)}
        onConfirm={(lineId) => {
          removeLine(lineId);
          toast.success('Item voided');
        }}
      />

      {/* Move Items — 2-step wizard */}
      {tableId ? (
        <MoveItemsDialog
          open={showMoveItems}
          onClose={() => setShowMoveItems(false)}
          tableId={tableId}
          lines={lines}
          onConfirm={doMoveItems}
          busy={transferBusy}
        />
      ) : null}

      {/* Split bill — divide the tab into independently-payable bills */}
      <SplitBillDialog
        open={showSplit}
        tableId={tableId ?? null}
        tableLabel={activeTableLabel ?? undefined}
        cashSessionId={session?.id}
        onClose={() => setShowSplit(false)}
        onTableClosed={() => {
          setShowSplit(false);
          tabSyncSig.current = '';
          clearCart();
          setCustomer(null);
          setSelectedTableId(null);
          setTableView('grid');
          refetchSession();
          currentSentLineIds.current.clear();
        }}
      />

      {/* Cancel order dialog */}
      <CancelOrderDialog
        open={showCancelOrder}
        invoiceId={cancelInvoice?.id ?? null}
        invoiceNumber={cancelInvoice?.number ?? null}
        onClose={() => { setShowCancelOrder(false); setCancelInvoice(null); }}
        onDone={() => { clearCart(); setCustomer(null); }}
      />

      <ReceiptPreview
        open={showBillPreview}
        onClose={() => setShowBillPreview(false)}
        type="bill"
        title="Bill Receipt"
        lines={cartToReceiptLines(lines)}
        total={total}
        discountPercent={transactionDiscountPercent || undefined}
        discountAmount={total - lines.reduce((s, l) => s + l.unitPrice * l.quantity * (1 - l.discountPercent / 100), 0)}
        orderTypeLabel={orderTypeLabel ?? undefined}
        tableLabel={activeTableLabel ?? undefined}
        customerName={customer?.name}
        onPrint={async () => {
          const docId = selectedTable?.orders?.find((o) => !o.closedAt)?.orderId;
          if (docId) {
            try { await printBill.mutateAsync({ invoiceId: docId }); } catch { /* non-fatal */ }
          }
        }}
      />

      <ReceiptPreview
        open={showKotPreview}
        onClose={() => setShowKotPreview(false)}
        type="kot"
        title="Kitchen Order Ticket"
        lines={cartToReceiptLines(kotLines)}
        total={kotLines.reduce((s, l) => s + l.unitPrice * l.quantity * (1 - l.discountPercent / 100), 0)}
        orderTypeLabel={orderTypeLabel ?? undefined}
        tableLabel={activeTableLabel ?? undefined}
        customerName={customer?.name}
        onPrint={async () => {
          const docId = selectedTable?.orders?.find((o) => !o.closedAt)?.orderId || selectedTableId;
          if (docId) {
            try { await printKot.mutateAsync({ invoiceId: docId }); } catch { /* non-fatal */ }
          }
        }}
      />

      <ReceiptPreview
        open={showAdditionalBillPreview}
        onClose={() => setShowAdditionalBillPreview(false)}
        type="bill"
        title={`Additional Bill #${additionalBillCopy}`}
        subtitle="ADDITIONAL BILL"
        lines={cartToReceiptLines(additionalBillLines)}
        total={additionalBillLines.reduce((s, l) => s + l.unitPrice * l.quantity * (1 - l.discountPercent / 100), 0)}
        orderTypeLabel={orderTypeLabel ?? undefined}
        tableLabel={activeTableLabel ?? undefined}
        customerName={customer?.name}
        previousSubtotal={additionalBillPreviousSubtotal}
        grandTotal={additionalBillGrandTotal}
        onPrint={async () => {
          const docId = selectedTable?.orders?.find((o) => !o.closedAt)?.orderId;
          if (docId) {
            try { await printAdditionalBill.mutateAsync({ invoiceId: docId }); } catch { /* non-fatal */ }
          }
        }}
      />

      {/* After settle: pop the settlement receipt so the cashier can print it.
          Server-rendered PDF when we have an invoiceId; the client snapshot is a
          fallback only for offline-queued sales (no invoiceId yet). */}
      {lastCompleted?.invoiceId ? (
        <ReceiptPreviewDialog
          open
          invoiceId={lastCompleted.invoiceId}
          invoiceNumber={lastCompleted.invoiceNumber}
          receiptHtml={lastCompleted.receiptHtml}
          canReprint={false}
          onVoid={(id, num) => {
            setLastCompleted(null);
            setCancelInvoice({ id, number: num });
            setShowCancelOrder(true);
          }}
          onClose={() => setLastCompleted(null)}
        />
      ) : lastCompleted ? (
        <ReceiptPreview
          open
          onClose={() => setLastCompleted(null)}
          type="bill"
          title={`Receipt ${lastCompleted.invoiceNumber ?? ''}`}
          subtitle="Offline — sync pending"
          lines={lastCompleted.lines}
          total={lastCompleted.total}
          discountPercent={lastCompleted.discountPercent}
          discountAmount={lastCompleted.discountAmount}
          orderTypeLabel={lastCompleted.orderTypeLabel}
          tableLabel={lastCompleted.tableLabel}
          customerName={lastCompleted.customerName}
        />
      ) : null}
      {canReprint && (
        <>
          {lastCompleted?.invoiceId && (
            <button
              type="button"
              className="fixed bottom-4 right-4 z-50 bg-sky-700 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-semibold hover:bg-sky-800"
              onClick={() => setShowReprint({ invoiceId: lastCompleted.invoiceId!, title: 'Receipt' })}
            >
              <Printer className="inline h-4 w-4 mr-1" /> Reprint
            </button>
          )}
          <ReprintDialog
            open={!!showReprint}
            title={showReprint?.title ?? ''}
            onClose={() => setShowReprint(null)}
            onConfirm={(reason) => {
              if (!showReprint) return;
              reprintReceipt.mutateAsync({ invoiceId: showReprint.invoiceId, reason });
              toast.success(`Reprint queued: ${reason}`);
            }}
          />
        </>
      )}

      {/* P4 4-layer order flow dialogs */}
      <VariantPicker
        open={nextStep === 'variant'}
        productName={pendingItem?.productName ?? ''}
        variants={pendingBundle?.variants ?? []}
        onClose={cancelOrderFlow}
        onConfirm={onVariantConfirm}
      />
      <AccompanimentPicker
        open={nextStep === 'accompaniment'}
        productName={pendingItem?.productName ?? ''}
        groups={pendingBundle?.accompanimentGroups ?? []}
        onClose={cancelOrderFlow}
        onBack={() => setPendingItem((prev) => prev ? { ...prev, variantId: undefined, variantName: undefined, variantPrice: undefined } : prev)}
        onConfirm={onAccompanimentConfirm}
      />
      <AddOnsDialog
        open={nextStep === 'addons'}
        productId={pendingItem?.productId ?? null}
        basePrice={effectiveBasePrice > 0 ? effectiveBasePrice : undefined}
        onClose={cancelOrderFlow}
        onBack={() => setPendingItem((prev) => prev ? { ...prev, accompanimentOptionIds: undefined, accompanimentNames: undefined, accompanimentPriceImpact: undefined } : prev)}
        onAdd={onAddAddOnsConfirm}
      />

      {/* Tables (ADR-012) */}
      <TableSelectorDialog
        open={showTableSelector}
        onClose={() => setShowTableSelector(false)}
        selectedId={tableId ?? null}
        onPick={(t) => {
          // Route through the single switch handler so the previous table's cart
          // is flushed + cleared and THIS table's open order is loaded. Calling
          // setTable() alone would relabel tableId while keeping the old items
          // (they'd then auto-save onto the newly-picked table).
          setShowTableSelector(false);
          handleTableClick(t as unknown as PosTable);
        }}
      />

    </div>
  );
};

/* ============================================================
 * TableDetailView — shows a selected table's existing backend
 * orders and lets the cashier open a new order for it.
 * ============================================================ */
interface TableDetailViewProps {
  table: PosTable;
  onBack: () => void;
  onStartOrder: (t: PosTable) => void;
  onContinueDraft: (t: PosTable) => void;
  hasLocalCart: boolean;
}

const TableDetailView: React.FC<TableDetailViewProps> = ({ table, onBack, onStartOrder, onContinueDraft, hasLocalCart }) => {
  const statusBadge: Record<string, { label: string; cls: string }> = {
    available: { label: 'Available', cls: 'bg-emerald-100 text-emerald-700' },
    occupied: { label: 'Occupied', cls: 'bg-amber-100 text-amber-700' },
    reserved: { label: 'Reserved', cls: 'bg-sky-100 text-sky-700' },
    out_of_service: { label: 'Out of Service', cls: 'bg-slate-100 text-slate-600' },
  };
  const badge = statusBadge[table.status] ?? { label: table.status, cls: 'bg-slate-100 text-slate-600' };
  const openOrders = (table.orders ?? []).filter((o) => !o.closedAt);
  const tableTotal = openOrders.reduce((s, o) => s + Number(o.order?.totalAmount ?? 0), 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b bg-white">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs font-bold text-indigo-700 hover:text-indigo-900 px-2 py-1 rounded hover:bg-indigo-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All Tables
        </button>
        <div className="w-px h-5 bg-slate-200" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-slate-800">
              Table {table.number}{table.name ? ` — ${table.name}` : ''}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {table.seats} seats · Zone: {table.zone} · {openOrders.length} open order{openOrders.length !== 1 ? 's' : ''}
            {tableTotal > 0 && <span className="ml-2 font-semibold text-slate-700">· Total {fmt(tableTotal)}</span>}
            {hasLocalCart && <span className="ml-2 font-semibold text-amber-600">· ⚡ Draft in progress</span>}
          </div>
        </div>
          {hasLocalCart ? (
            <button
              type="button"
              onClick={() => onContinueDraft(table)}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 shadow-sm"
            >
              <span className="text-sm leading-none">⚡</span> Continue Draft
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onStartOrder(table)}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-sm"
            >
              <span className="text-sm leading-none">＋</span> New Order
            </button>
          )}
      </div>

      {/* Orders scrollable area */}
      <div className="flex-1 overflow-y-auto p-5">
        {openOrders.length === 0 && !hasLocalCart ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <LayoutGrid className="h-12 w-12 mb-3 opacity-40" />
            <p className="font-semibold text-sm">No open orders</p>
            <p className="text-xs mt-1">Tap "New Order" to start ringing up this table.</p>
          </div>
        ) : openOrders.length === 0 && hasLocalCart ? (
          <div className="flex flex-col items-center justify-center h-full text-amber-600">
            <p className="font-semibold text-sm">⚡ Draft in progress</p>
            <p className="text-xs mt-1">Items have been added but not yet sent to kitchen.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Open Orders</h3>
            {openOrders.map((o) => (
              <div
                key={o.id}
                className="flex items-center gap-4 bg-white border border-slate-200 rounded-xl px-5 py-4 hover:border-indigo-300 hover:shadow-sm transition-all"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                      {o.order?.orderNumber ?? `#${o.id.slice(0, 6)}`}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400">
                      {o.openedAt ? `${Math.max(1, Math.floor((Date.now() - new Date(o.openedAt).getTime()) / 60000))}m ago` : 'New'}
                    </span>
                  </div>
                  {o.customerName && (
                    <div className="text-xs text-slate-600 font-medium truncate">{o.customerName}</div>
                  )}
                  {o.notes && (
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">Note: {o.notes}</div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-slate-800">
                    {o.order ? fmt(Number(o.order.totalAmount || 0)) : '—'}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {o.order?.status ?? 'open'} · {o.guestCount ?? '?'} guests
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** POS mode router — renders CafeTerminal, RetailTerminal or RentalTerminal based on org config. */
function TerminalPageRouter() {
  const { data: settings } = usePosSettings();
  const posMode = (settings as any)?.posMode ?? 'cafe';
  if (posMode === 'retail') return <RetailTerminal />;
  if (posMode === 'rental') return <RentalTerminal />;
  return <TerminalPage />;
}

export default TerminalPageRouter;