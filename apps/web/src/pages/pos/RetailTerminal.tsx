import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ShoppingBag, Lock as LockIcon } from 'lucide-react';

import { Topbar } from './Topbar';
import { OfflineIndicator } from './OfflineIndicator';
import { enqueueSale } from '@/features/pos/offline-queue';
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
import { VoidItemDialog } from './VoidItemDialog';
import { CancelOrderDialog } from './CancelOrderDialog';
import { ReprintDialog } from './ReprintDialog';
import { OrdersListPanel } from './OrdersListPanel';
import { HandoverDialog } from './HandoverDialog';
import { CustomerProfileDialog } from './CustomerProfileDialog';

import { useProductsForPos } from '@/features/pos/api';
import { useProductCategories } from '@/features/products/api';
import {
  useOpenSession, useCheckout, useStoreCredit, useReprintReceipt, useCreateOrder, useCreditInfo,
  useOrdersList, useResumeOrder, useSettleOrder, useSaveOrderItems, useCancelOrder, type OrderLineBody,
} from './api';
import { useCombos } from './pos-features-api';
import { useCartStore, selectSubtotal, selectTotal } from '@/features/pos/cart.store';
import type { CartLine, DiscountType, PaymentTender } from '@/features/pos/types';
import type { Customer, SettleMode } from './types';

import { usePosAuthStore } from '@/features/pos/pos-auth.store';
import { useScannerDebounce } from './scanner-debounce';
import PosLoginScreen from './PosLoginScreen';
import { api, resolveAssetUrl } from '@/lib/api';
import './pos-pro.css';

const fmt = (n: number | string) => `${useAuthStore.getState().organization?.currencyCode ?? 'IDR'} ${Number(n || 0).toLocaleString()}`;

function cartToReceiptLines(ls: CartLine[]): ReceiptLine[] {
  return ls.map((l) => ({
    name: l.name,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountPercent: l.discountPercent,
    note: l.note,
  }));
}

/** Cheap change-detector for the order autosave (dedupes identical saves). */
const orderSig = (ls: CartLine[]) =>
  JSON.stringify(ls.map((l) => [l.productId ?? l.sku, l.quantity, l.unitPrice, l.discountPercent, l.discountType, l.discountAmount, l.note, l.comboId]));

/** Map the local cart to the server order's line payload (whitelisted fields only). */
function toOrderLines(ls: CartLine[]): OrderLineBody[] {
  return ls.map((l) => ({
    productId: l.productId,
    menuItemId: l.menuItemId,
    sku: l.sku,
    description: l.name,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    taxId: l.taxId,
    discountPercent: l.discountPercent > 0 ? l.discountPercent : undefined,
    discountType: l.discountType,
    discountAmount: l.discountAmount,
    discountReason: l.discountReason,
    note: l.note,
    modifiers: l.modifiers && l.modifiers.length > 0 ? l.modifiers : undefined,
    comboId: l.comboId,
    taxInclusive: l.taxInclusive,
  }));
}

/** Rehydrate a resumed server order line back into a cart line. */
function serverLineToCart(ln: any): CartLine {
  return {
    lineId: (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2),
    productId: ln.productId ?? undefined,
    menuItemId: ln.menuItemId ?? undefined,
    sku: undefined,
    name: ln.description,
    quantity: Number(ln.quantity),
    unitPrice: Number(ln.unitPrice),
    discountPercent: Number(ln.discountPercent ?? 0),
    taxId: ln.taxId ?? undefined,
    taxInclusive: ln.taxInclusive ?? undefined,
    note: ln.note ?? undefined,
    modifiers: (ln.modifiers ?? []).map((m: any) => ({ modifierId: m.modifierId, name: m.name, priceDelta: Number(m.priceDelta) })),
  };
}

const RetailTerminal: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const posUser = usePosAuthStore((s) => s.user);
  const [showPosLogin, setShowPosLogin] = useState(!usePosAuthStore.getState().user);

  /* ============== Catalog (product-based) ============== */
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { data: products = [] } = useProductsForPos();
  const { data: productCategories = [] } = useProductCategories();

  const categories = useMemo(
    () => productCategories.map((c: any) => ({ id: c.id, name: c.name })),
    [productCategories],
  );

  const catalogItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((p: any) => !activeCategory || p.categoryId === activeCategory)
      .filter((p: any) => !term || p.name.toLowerCase().includes(term) || (p.sku ?? '').toLowerCase().includes(term))
      .map((p: any) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        salesPrice: p.salesPrice != null ? Number(p.salesPrice) : 0,
        categoryId: p.categoryId,
        category: p.category ? { name: p.category.name } : null,
        image: p.image ? resolveAssetUrl(p.image) : null,
      }));
  }, [products, activeCategory, search]);

  // Combo bundles (GET /pos/modifiers/combos) — span categories, so shown only
  // in the "All" view. The backend expands the `comboId` line at checkout.
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

  const gridItems = useMemo(() => [...comboCards, ...catalogItems], [comboCards, catalogItems]);

  /* ============== Shift ============== */
  const { data: session, isLoading: sessionLoading, isFetching: sessionFetching, refetch: refetchSession } = useOpenSession();
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [showCloseShift, setShowCloseShift] = useState(false);

  /* ============== Customer ============== */
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showCustomer, setShowCustomer] = useState(false);
  const { data: storeCredit } = useStoreCredit(customer?.id);
  /* House-account standing — drives the Charge dialog's credit panel. */
  const { data: creditInfo } = useCreditInfo(customer?.id);

  /* ============== Discounts ============== */
  const [showDiscount, setShowDiscount] = useState(false);
  const [lineForDiscount, setLineForDiscount] = useState<CartLine | null>(null);

  /* ============== Void item ============== */
  const [voidLine, setVoidLine] = useState<CartLine | null>(null);

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

  /* ============== Discount reason ============== */
  const [showDiscountReason, setShowDiscountReason] = useState(false);

  /* ============== Receipt preview ============== */
  const [lastCompleted, setLastCompleted] = useState<{
    lines: ReceiptLine[]; total: number; discountPercent: number; discountAmount: number;
    invoiceNumber?: string; invoiceId?: string; receiptHtml?: string;
    customerName?: string;
  } | null>(null);
  const canReprint = usePosAuthStore((s) => s.user?.permissions?.includes('pos:reports') ?? false);
  const canDeleteItem = usePosAuthStore((s) => s.user?.permissions?.includes('pos:delete_item') ?? false);
  const canDiscount = usePosAuthStore((s) => s.user?.permissions?.includes('pos:discount') ?? false);
  const [showReprint, setShowReprint] = useState<{ invoiceId: string; title: string } | null>(null);
  const [showOrders, setShowOrders] = useState(false);
  const [showHandover, setShowHandover] = useState(false);
  /** Gate the autosave while the first-item auto-create is in flight. */
  const pendingOrderCreate = useRef(false);
  /** Last-saved line signature so identical autosaves are skipped. */
  const orderSaveSig = useRef('');
  const [showCustomerProfile, setShowCustomerProfile] = useState(false);

  /* ============== Order type — retail is always takeaway ============== */
  /* ============== Fullscreen ============== */
  const [fullscreen, setFullscreen] = useState(false);

  const enterFullscreen = useCallback(() => {
    setFullscreen(true);
    document.body.classList.add('pos-terminal-fullscreen');
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

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
  const addLine = useCartStore((s) => s.addLine);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const setDiscount = useCartStore((s) => s.setDiscount);
  const setNote = useCartStore((s) => s.setNote);
  const removeLine = useCartStore((s) => s.removeLine);
  const setTransactionDiscount = useCartStore((s) => s.setTransactionDiscount);
  const setCashSession = useCartStore((s) => s.setCashSession);
  const clearCart = useCartStore((s) => s.clear);
  const orderId = useCartStore((s) => s.orderId);
  const setOrderId = useCartStore((s) => s.setOrderId);
  const setTabVersion = useCartStore((s) => s.setTabVersion);

  /* ============== Mutations ============== */
  const checkout = useCheckout();
  const createOrderMut = useCreateOrder();
  const reprintReceipt = useReprintReceipt();
  const resumeOrderMut = useResumeOrder();
  const settleOrderMut = useSettleOrder();
  const saveOrderItems = useSaveOrderItems();
  const cancelOrderMut = useCancelOrder();

  /* Live open-orders feed → nav badge count. Polls every 10s (see useOrdersList). */
  const { data: ordersFeed } = useOrdersList({}, !!session);
  const ordersCount = ordersFeed?.count ?? 0;

  /* Keep cart's cashSessionId in sync with the active shift. */
  useEffect(() => {
    setCashSession(session?.id ?? undefined);
  }, [session?.id, setCashSession]);

  /* Clear POS PIN session when leaving the terminal. */
  useEffect(() => {
    return () => { usePosAuthStore.getState().logout(); };
  }, []);

  const locked = !sessionLoading && !session && !sessionFetching;

  /* ============== Multi-order (Odoo-style) ============== */
  // Auto-create: the moment the cart gets its first item and isn't backed by a
  // server order yet, open one so it lives in the Orders panel and is resumable.
  // Best-effort — if it fails (offline) we keep selling from the local cart and
  // settle via checkout, so a sale is never blocked.
  useEffect(() => {
    if (locked || lines.length === 0 || orderId || pendingOrderCreate.current) return;
    pendingOrderCreate.current = true;
    createOrderMut.mutateAsync({
      orderType: 'takeaway',
      partnerId: customer?.id,
      cashSessionId: session?.id,
      guestCount: 1,
      lines: toOrderLines(useCartStore.getState().lines),
    }).then((order) => {
      const st = useCartStore.getState();
      if (!st.orderId && st.lines.length > 0) {
        st.setOrderId((order as any).id);
        st.setTabVersion((order as any).version);
        orderSaveSig.current = orderSig(st.lines);
      }
    }).catch(() => { /* offline / failed — local cart still sells via checkout */ })
      .finally(() => { pendingOrderCreate.current = false; });
  }, [lines.length, orderId, locked, customer?.id, session?.id, createOrderMut]);

  // Order-keyed autosave (debounced) — mirrors the dine-in tab autosave but for a
  // tableless order. Empty cart cancels the order; a 409 self-heals via resume.
  useEffect(() => {
    if (!orderId) return;
    const sig = orderSig(lines);
    if (sig === orderSaveSig.current) return;
    const t = setTimeout(async () => {
      const st = useCartStore.getState();
      if (st.orderId !== orderId) return; // switched away before the debounce fired
      if (st.lines.length === 0) {
        try { await cancelOrderMut.mutateAsync({ orderId, reason: 'Order emptied' }); } catch { /* noop */ }
        if (useCartStore.getState().orderId === orderId) { setOrderId(undefined); setTabVersion(undefined); }
        orderSaveSig.current = '';
        return;
      }
      try {
        const saved = await saveOrderItems.mutateAsync({
          orderId,
          lines: toOrderLines(st.lines),
          expectedVersion: st.tabVersion,
        });
        if (useCartStore.getState().orderId === orderId && typeof (saved as any)?.version === 'number') {
          setTabVersion((saved as any).version);
        }
        orderSaveSig.current = sig;
      } catch (e: any) {
        if (e?.response?.status === 409) {
          try {
            const fresh: any = await resumeOrderMut.mutateAsync(orderId);
            if (useCartStore.getState().orderId === orderId) setTabVersion(fresh.version);
          } catch { /* noop */ }
        }
      }
    }, 700);
    return () => clearTimeout(t);
  }, [lines, orderId, saveOrderItems, cancelOrderMut, resumeOrderMut, setOrderId, setTabVersion]);

  /** Flush the current order's latest lines to the server before switching away. */
  const flushCurrentOrder = useCallback(async () => {
    const st = useCartStore.getState();
    if (st.orderId && st.lines.length > 0) {
      try { await saveOrderItems.mutateAsync({ orderId: st.orderId, lines: toOrderLines(st.lines), expectedVersion: st.tabVersion }); } catch { /* noop */ }
    }
  }, [saveOrderItems]);

  /** Start a fresh order — the current one stays open in the Orders panel. */
  const newOrder = useCallback(async () => {
    await flushCurrentOrder();
    clearCart();
    orderSaveSig.current = '';
    setShowOrders(false);
  }, [flushCurrentOrder, clearCart]);

  /** Resume an order from the panel into the cart and continue selling. */
  const openOrder = useCallback(async (id: string) => {
    if (useCartStore.getState().orderId === id) { setShowOrders(false); return; }
    await flushCurrentOrder();
    try {
      const view: any = await resumeOrderMut.mutateAsync(id);
      const cartLines = (view.lines ?? []).map(serverLineToCart);
      clearCart();
      useCartStore.getState().load(cartLines);
      setOrderId(id);
      setTabVersion(view.version);
      orderSaveSig.current = orderSig(cartLines);
      setShowOrders(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Could not open order');
    }
  }, [flushCurrentOrder, resumeOrderMut, clearCart, setOrderId, setTabVersion]);

  /* ============== Catalog actions ============== */
  const onPickProduct = useCallback(
    (p: any) => {
      if (locked) return;
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
      addLine({
        productId: p.id,
        sku: p.sku ?? undefined,
        name: p.name,
        quantity: 1,
        unitPrice: Number(p.salesPrice || 0),
      });
    },
    [locked, addLine],
  );

  /* Legacy auto-add on exact SKU match (barcode scanner / manual entry). */
  useEffect(() => {
    const q = search.trim();
    if (!q || locked) return;
    const match = (catalogItems as any[]).find(
      (p) => p.sku && p.sku.toLowerCase() === q.toLowerCase(),
    );
    if (match) {
      onPickProduct(match);
      setSearch('');
      return;
    }
    api.get('/pos/lookup', { params: { sku: q } }).then((res: any) => {
      const product = res.data;
      if (product?.id) {
        addLine({ productId: product.id, sku: product.sku ?? undefined, name: product.name, quantity: 1, unitPrice: Number(product.salesPrice || 0) });
        setSearch('');
      }
    }).catch(() => {});
  }, [search, catalogItems, onPickProduct, locked, addLine]);

  const onScan = useCallback(async (code: string) => {
    const match = (catalogItems as any[]).find(
      (p) => p.sku && p.sku.toLowerCase() === code.toLowerCase(),
    );
    if (match) { onPickProduct(match); setSearch(''); return; }
    try {
      const res = await api.get('/pos/lookup', { params: { sku: code } }) as any;
      const product = res.data;
      if (product?.id) {
        addLine({ productId: product.id, sku: product.sku ?? undefined, name: product.name, quantity: 1, unitPrice: Number(product.salesPrice || 0) });
        setSearch('');
      }
    } catch { /* no match on server either */ }
  }, [catalogItems, onPickProduct, addLine]);
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
    toast.success(type === 'fixed_amount' ? `Line discount ${fmt(amount)} applied` : `Line discount ${amount}% applied`);
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
  const onApplyOrderDiscount = (percent: number) => { onApplyOrderDiscountEx(percent, 'percentage'); };
  const onApplyOrderDiscountEx = (amount: number, type: DiscountType) => {
    const needsOverride = type === 'percentage' ? amount >= 10 : amount >= 50000;
    if (needsOverride) {
      requestOverride('discount').then((result) => {
        if (!result) { toast.error('Manager override cancelled'); return; }
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
    if (lines.length === 0) { toast.error('Cart is empty'); return; }
    setShowPayment(true);
  };

  /* Credit / charge-to-account sale: the same settle, in credit mode. Goes
   * through onSettle so it reuses whichever server path already owns this cart
   * instead of creating a second Order of its own. */
  const onCreditSale = async () => {
    if (!customer?.id) { toast.error('Select a customer to charge on account'); return; }
    if (lines.length === 0) { toast.error('Cart is empty'); return; }
    await onSettle({ tenders: [], transactionDiscountPercent: 0, settleMode: 'credit' });
  };

  const onSettle = async (input: { tenders: PaymentTender[]; transactionDiscountPercent: number; amountTendered?: number; overrideById?: string; overridePin?: string; settleMode?: SettleMode }) => {
    const isCredit = input.settleMode === 'credit';
    /* Credit collects nothing — say who owes what instead of announcing change. */
    const settledToast = () => `Charged ${fmt(total)} to ${customer?.name ?? 'account'} — due later`;
    const effectiveTxPct = transactionDiscountType === 'fixed_amount' && transactionDiscountAmount > 0
      ? (() => { const sub = selectSubtotal(useCartStore.getState()); return sub > 0 ? Math.min(100, (transactionDiscountAmount / sub) * 100) : 0; })()
      : transactionDiscountPercent;
    const idemKey = useCartStore.getState().idempotencyKey;

    // Order-backed settle (Odoo path): the cart is already a live open order, so
    // flush its lines and settle it by id — no second order is created. Falls
    // through to the legacy checkout below only when there is no server order
    // (auto-create was offline / skipped), so a sale is never blocked.
    const activeOrderId = useCartStore.getState().orderId;
    if (activeOrderId) {
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
          ? settledToast()
          : `Order ${res.invoiceNumber} settled — change ${fmt(res.change ?? 0)}`);
        setLastCompleted({
          lines: cartToReceiptLines(lines),
          total, invoiceNumber: res.invoiceNumber, invoiceId: res.invoiceId,
          receiptHtml: res.receiptHtml,
          discountPercent: effectiveTxPct, discountAmount: 0,
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

    const checkoutLines = lines.map((l) => ({
      productId: l.productId,
      menuItemId: l.menuItemId,
      sku: l.sku,
      description: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxId: l.taxId,
      discountPercent: l.discountPercent > 0 ? l.discountPercent : undefined,
      discountType: l.discountType,
      discountAmount: l.discountAmount,
      discountReason: l.discountReason,
      note: l.note,
      modifiers: l.modifiers && l.modifiers.length > 0 ? l.modifiers : undefined,
      comboId: l.comboId,
      taxInclusive: l.taxInclusive,
    }));
    const payload = {
      lines: checkoutLines,
      tenders: input.tenders,
      transactionDiscountPercent: effectiveTxPct,
      transactionDiscountType: transactionDiscountType !== 'percentage' ? transactionDiscountType : undefined,
      transactionDiscountAmount: transactionDiscountType === 'fixed_amount' ? transactionDiscountAmount : undefined,
      discountReason: transactionDiscountReason,
      overrideById: input.overrideById,
      overridePin: input.overridePin,
      cashSessionId: session?.id,
      partnerId: customer?.id,
      orderType: 'takeaway' as const,
      settleMode: input.settleMode,
    };
    try {
      const res = await checkout.mutateAsync({ ...payload, _idemKey: idemKey } as any);
      toast.success(isCredit
        ? settledToast()
        : `Sale ${res.invoiceNumber} settled — change ${fmt(res.change)}`);
      setLastCompleted({
        lines: cartToReceiptLines(lines),
        total, invoiceNumber: res.invoiceNumber, invoiceId: res.invoiceId,
        receiptHtml: res.receiptHtml,
        discountPercent: effectiveTxPct,
        discountAmount: 0,
        customerName: customer?.name,
      });
      clearCart();
      setCustomer(null);
      setShowPayment(false);
      refetchSession();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Checkout failed';
      const status = e?.response?.status;
      const isOffline = !status || status === 0 || status >= 500 || status === 408 || status === 429;
      const networkDown = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline || networkDown) {
        try {
          const queued = await enqueueSale(payload as any, { idempotencyKey: idemKey });
          toast.warning(`Network down — sale queued (${queued.idempotencyKey.slice(0, 8)}).`);
          setLastCompleted({
            lines: cartToReceiptLines(lines), total,
            invoiceNumber: `PENDING-${queued.idempotencyKey.slice(0, 8).toUpperCase()}`,
            discountPercent: effectiveTxPct, discountAmount: 0,
            customerName: customer?.name,
          });
          clearCart();
          setCustomer(null);
          setShowPayment(false);
          return;
        } catch { /* fall through */ }
      }
      if (/manager override/i.test(msg) && !input.overrideById) {
        const result = await requestOverride('discount');
        if (result) { await onSettle({ ...input, overrideById: result.managerId, overridePin: result.pin }); return; }
      }
      toast.error(msg);
    }
  };

  /* ============== P6: mirror cart to localStorage for pole display ============== */
  useEffect(() => {
    const snap = { lines, transactionDiscountPercent, total, tendered: 0, change: 0, status: lines.length === 0 ? 'idle' : 'building' };
    try { localStorage.setItem('pos-display-cart', JSON.stringify(snap)); } catch { /* noop */ }
  }, [lines, transactionDiscountPercent, total]);

  /* ============== Keyboard shortcuts ============== */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'F2') { e.preventDefault(); onCharge(); }
      else if (e.key === 'Escape') {
        setShowPayment(false); setShowCustomer(false);
        setShowDiscount(false); setShowOpenShift(false); setShowCloseShift(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCharge]);

  const logout = () => {
    useAuthStore.getState().clear();
    navigate('/login', { replace: true });
  };

  const handleUserChanged = () => {
    setShowPosLogin(!usePosAuthStore.getState().user);
    refetchSession();
  };

  const onChangeOrderType = useCallback((_t: any) => {
    /* retail is always takeaway — no-op */
  }, []);

  return (
    <div className={'pos-shell-pro' + (fullscreen ? ' dark-mode' : '')}>
      {showPosLogin && !posUser ? (
        <PosLoginScreen onLoggedIn={() => { setShowPosLogin(false); refetchSession(); }} onBeforeSubmit={enterFullscreen} />
      ) : null}

      <Topbar
        search={search}
        onSearch={setSearch}
        onOpenReports={() => navigate('/pos/reports')}
        onOpenShift={() => setShowOpenShift(true)}
        onCloseShift={() => setShowCloseShift(true)}
        staffName={user?.firstName}
        staffRole={(user as any)?.roles?.[0]}
        session={session ?? null}
        fullscreen={fullscreen}
        onToggleFullscreen={() => {
          const next = !fullscreen;
          setFullscreen(next);
          document.body.classList.toggle('pos-terminal-fullscreen', next);
          try { if (next) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); } catch { /* noop */ }
        }}
        onLogout={logout}
        onUserChanged={handleUserChanged}
        onOpenOrders={() => setShowOrders(true)}
        ordersCount={ordersCount}
        rightExtras={<OfflineIndicator />}
      />

      <div className="pos-body-pro">
        {locked ? (
          <div className="pos-lock-overlay-pro">
            <div className="pos-lock-icon"><LockIcon className="h-10 w-10" /></div>
            <div className="pos-lock-title">Open your shift to start selling</div>
            <div className="pos-lock-sub">Pick a cash register, count your opening float, then tap "Open shift".</div>
            <button type="button" onClick={() => setShowOpenShift(true)} className="pos-action-btn-pro bg-emerald h-12 px-6"
              style={{ width: 'auto', paddingLeft: 24, paddingRight: 24, minHeight: 48 }}>
              <ShoppingBag className="pos-action-icon" /> Open shift
            </button>
          </div>
        ) : showOrders ? (
          <div className="pos-menus-pro">
            <OrdersListPanel
              open={showOrders}
              activeOrderId={orderId}
              onOpenOrder={openOrder}
              onNewOrder={newOrder}
              onClose={() => setShowOrders(false)}
            />
          </div>
        ) : (
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

        {!locked && (
          <OrderPanel
            customerName={customer?.name}
            orderTypeLabel="Takeaway"
            orderType="takeaway"
            onChangeOrderType={onChangeOrderType}
            onInc={onInc}
            onDec={onDec}
            onRemove={canDeleteItem ? onRemove : undefined}
            canDiscount={canDiscount}
            canOverridePrice={canDiscount}
            onNote={onLineNote}
            onLineDiscount={onLineDiscount}
            onPrintBill={() => {}}
            onCharge={onCharge}
            onSplit={() => {}}
            onAddCustomer={() => setShowCustomer(true)}
            onAddDiscount={() => setShowDiscount(true)}
            onCloseOrder={() => { clearCart(); setCustomer(null); }}
            onPrintKot={() => {}}
            onVoidItem={(line) => setVoidLine(line)}
            hideCafeFeatures
            onHold={newOrder}
            onHeldOrders={() => setShowOrders(true)}
            onHandover={() => setShowHandover(true)}
            onCustomerProfile={() => setShowCustomerProfile(true)}
          />
        )}
      </div>

      <ShiftOpenDialog open={showOpenShift} onClose={() => setShowOpenShift(false)} onOpened={() => refetchSession()} />
      <ShiftCloseDialog open={showCloseShift} session={session ?? null} onClose={() => setShowCloseShift(false)}
        onClosed={() => { refetchSession(); setTimeout(() => navigate('/pos/reports'), 600); }} />
      <CustomerDialog open={showCustomer} onClose={() => setShowCustomer(false)}
        onPick={(c) => { setCustomer(c); toast.success(`Customer: ${c.name}`); }} />
      <DiscountDialog key={'discount-' + showDiscount} open={showDiscount} initialPercent={transactionDiscountPercent}
        onClose={() => setShowDiscount(false)} onApply={onApplyOrderDiscount} onApplyEx={onApplyOrderDiscountEx} />
      {lineForDiscount ? (
        <LineDiscountDialog open={!!lineForDiscount} line={lineForDiscount} onClose={() => setLineForDiscount(null)}
          onApply={onLineDiscountApply} />
      ) : null}
      <DiscountReasonDialog open={showDiscountReason} onClose={() => setShowDiscountReason(false)}
        onSelect={(reason) => { useCartStore.setState({ transactionDiscountReason: reason }); setShowDiscountReason(false); }} />
      <PaymentDialog open={showPayment} total={total}
        effectiveDiscountPercent={Math.max(transactionDiscountPercent, ...lines.map((l) => l.discountPercent))}
        storeCreditBalance={storeCredit?.balance ?? 0} onRequestOverride={requestOverride}
        onClose={() => setShowPayment(false)} onSettle={onSettle}
        creditEnabled={!!customer?.id} onCreditSale={onCreditSale}
        customerName={customer?.name} creditInfo={creditInfo ?? null}
        onPickCustomer={() => setShowCustomer(true)} />
      <OverrideDialog open={!!overrideKind} kind={overrideKind ?? 'discount'} onClose={() => onOverrideVerified(null)}
        onVerified={onOverrideVerified} />
      <PinConfirmDialog open={showPinConfirm} title="Confirm to delete item" description="Enter your PIN to remove this item from the order."
        onClose={() => { setShowPinConfirm(false); setPendingRemoveLine(null); }} onVerified={onPinVerified} />
      <VoidItemDialog open={!!voidLine} line={voidLine} onClose={() => setVoidLine(null)}
        onConfirm={(lineId) => { removeLine(lineId); toast.success('Item voided'); }} />
      <CancelOrderDialog open={showCancelOrder} invoiceId={cancelInvoice?.id ?? null} invoiceNumber={cancelInvoice?.number ?? null}
        onClose={() => { setShowCancelOrder(false); setCancelInvoice(null); }} onDone={() => { clearCart(); setCustomer(null); }} />

      <HandoverDialog open={showHandover} session={session ?? null} currentUserId={posUser?.userId} onClose={() => setShowHandover(false)}
        onDone={() => { setShowHandover(false); refetchSession(); }} />
      <CustomerProfileDialog open={showCustomerProfile} partnerId={customer?.id ?? null} partnerName={customer?.name} onClose={() => setShowCustomerProfile(false)} />

      {lastCompleted?.invoiceId ? (
        <ReceiptPreviewDialog open invoiceId={lastCompleted.invoiceId} invoiceNumber={lastCompleted.invoiceNumber}
          receiptHtml={lastCompleted.receiptHtml} canReprint={false}
          onVoid={(id, num) => { setLastCompleted(null); setCancelInvoice({ id, number: num }); setShowCancelOrder(true); }}
          onClose={() => setLastCompleted(null)} />
      ) : lastCompleted ? (
        <ReceiptPreview open onClose={() => setLastCompleted(null)} type="bill"
          title={`Receipt ${lastCompleted.invoiceNumber ?? ''}`}
          subtitle="Offline — sync pending"
          lines={lastCompleted.lines} total={lastCompleted.total}
          discountPercent={lastCompleted.discountPercent} discountAmount={lastCompleted.discountAmount}
          customerName={lastCompleted.customerName} />
      ) : null}

      {canReprint && lastCompleted?.invoiceId && (
        <>
          <button type="button" className="fixed bottom-4 right-4 z-50 bg-sky-700 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-semibold hover:bg-sky-800"
            onClick={() => setShowReprint({ invoiceId: lastCompleted.invoiceId!, title: 'Receipt' })}>
            Reprint
          </button>
          <ReprintDialog open={!!showReprint} title={showReprint?.title ?? ''} onClose={() => setShowReprint(null)}
            onConfirm={(reason) => { if (!showReprint) return; reprintReceipt.mutateAsync({ invoiceId: showReprint.invoiceId, reason }); toast.success(`Reprint queued: ${reason}`); }} />
        </>
      )}
    </div>
  );
};

export default RetailTerminal;
