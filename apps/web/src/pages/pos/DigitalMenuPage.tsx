import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
/**
 * POS F — Digital Menu (Phase 1 MVP) — customer-facing page.
 *
 * Mobile-first. No login. URL: /menu/:branchId/:tableId?token=xxx
 *
 * The token is the MenuQrSession token; the backend resolves it to a
 * valid org/branch/table and returns the public catalog. The customer
 * builds a cart, places an order, and tracks it. Orders hit the same
 * PosService.checkout the cashier uses, so the KDS + loyalty + receipts
 * all just work.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Coffee, ShoppingBag, Trash2, Check, Loader2, MapPin, Receipt, Sparkles } from 'lucide-react';
import './pos-pro.css';

interface ProductFE {
  id: string; name: string; description?: string | null; price: number;
  imageUrl?: string | null; categoryId?: string | null; categoryName?: string | null;
  inStock: boolean;
}
interface ComboFE { id: string; name: string; description?: string | null; price: number; imageUrl?: string | null; items: Array<{ productId: string; productName: string; quantity: number }>; }
interface CategoryFE { id: string; name: string; color?: string | null; icon?: string | null; }
interface CatalogResp {
  session: { id: string; branchId: string; tableNumber?: string | null };
  orgName: string; branchName: string;
  categories: CategoryFE[]; products: ProductFE[]; combos: ComboFE[];
}

interface CartLine { productId: string; productName: string; unitPrice: number; quantity: number; comboId?: string; notes?: string; }
type OrderStatus = 'received' | 'accepted' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';

const fmt = (n: number) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;

const STAGES: Array<{ key: OrderStatus; label: string; emoji: string }> = [
  { key: 'received', label: 'Received', emoji: '✅' },
  { key: 'preparing', label: 'Preparing', emoji: '👨‍🍳' },
  { key: 'ready', label: 'Ready', emoji: '🛎️' },
  { key: 'served', label: 'Served', emoji: '🎉' },
];

export const DigitalMenuPage: React.FC = () => {
  const [search] = useSearchParams();
  const token = search.get('token') ?? '';

  const [catalog, setCatalog] = useState<CatalogResp | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway' | 'pickup'>('dine_in');
  const [paymentMethod, setPaymentMethod] = useState<'mobile_money' | 'card' | 'cash_on_pickup'>('mobile_money');
  const [paymentRef, setPaymentRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<OrderStatus>('received');
  const [orderError, setOrderError] = useState<string | null>(null);

  // Load catalog.
  useEffect(() => {
    if (!token) { setCatalogError('Missing token — please scan the QR again.'); return; }
    (async () => {
      try {
        const res = await fetch(`/api/v1/menu/public/catalog?token=${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || `HTTP ${res.status}`);
        const data = (await res.json()) as CatalogResp;
        setCatalog(data);
      } catch (e: any) {
        setCatalogError(e?.message || 'Failed to load menu');
      }
    })();
  }, [token]);

  // Poll order status.
  useEffect(() => {
    if (!orderId || !token) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/menu/public/orders/${orderId}/track?token=${encodeURIComponent(token)}`);
        if (res.ok) {
          const data = await res.json();
          setOrderStatus(data.status);
        }
      } catch { /* noop */ }
    }, 5_000);
    return () => clearInterval(id);
  }, [orderId, token]);

  const filteredProducts = useMemo(() => {
    if (!catalog) return [];
    return activeCategory ? catalog.products.filter((p) => p.categoryId === activeCategory) : catalog.products;
  }, [catalog, activeCategory]);

  const cartTotal = useMemo(() => cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0), [cart]);

  const addToCart = (p: ProductFE) => {
    setCart((c) => {
      const existing = c.find((l) => l.productId === p.id);
      if (existing) {
        return c.map((l) => l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...c, { productId: p.id, productName: p.name, unitPrice: p.price, quantity: 1 }];
    });
  };
  const addComboToCart = (c: ComboFE) => {
    setCart((cart) => [...cart, { productId: c.id, productName: c.name, unitPrice: c.price, quantity: 1, comboId: c.id }]);
  };
  const updateQty = (idx: number, qty: number) => {
    setCart((c) => c.map((l, i) => i === idx ? { ...l, quantity: Math.max(0, qty) } : l).filter((l) => l.quantity > 0));
  };
  const removeLine = (idx: number) => setCart((c) => c.filter((_, i) => i !== idx));

  const placeOrder = async () => {
    if (!cart.length || !customerName.trim()) return;
    setSubmitting(true); setOrderError(null);
    try {
      const res = await fetch('/api/v1/menu/public/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token, customerName, customerPhone, orderType,
          notes: '',
          lines: cart.map((l) => ({
            productId: l.productId, productName: l.productName,
            unitPrice: l.unitPrice, quantity: l.quantity,
            description: l.productName, comboId: l.comboId,
          })),
          tenders: [{ method: paymentMethod, amount: cartTotal, reference: paymentRef || undefined }],
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || `HTTP ${res.status}`);
      const data = await res.json();
      setOrderId(data.onlineOrderId);
      setOrderNumber(data.orderNumber);
      setOrderStatus('received');
      setShowCart(false);
    } catch (e: any) {
      setOrderError(e?.message || 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  if (catalogError) {
    return (
      <div className="min-h-screen bg-rose-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm text-center">
          <div className="text-5xl mb-3">⚠️</div>
          <h1 className="text-xl font-bold text-rose-700">Menu unavailable</h1>
          <p className="text-sm text-slate-600 mt-2">{catalogError}</p>
          <button
            onClick={() => window.location.href = '/'}
            className="mt-4 px-4 py-2 bg-slate-100 rounded-lg text-sm font-semibold"
          >Back</button>
        </div>
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="min-h-screen bg-amber-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-amber-600 animate-spin" />
      </div>
    );
  }

  // Order tracking view.
  if (orderId) {
    const reachedIdx = STAGES.findIndex((s) => s.key === orderStatus);
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-white">
        <div className="max-w-md mx-auto p-5">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
              <Check className="h-3 w-3" /> Order received
            </div>
            <h1 className="text-3xl font-extrabold mt-3">#{orderNumber}</h1>
            <p className="text-sm text-slate-500 mt-1">at {catalog.orgName}{catalog.session.tableNumber ? ` · Table ${catalog.session.tableNumber}` : ''}</p>
          </div>

          {/* Stage tracker */}
          <div className="space-y-3 mb-6">
            {STAGES.map((s, i) => {
              const reached = i <= reachedIdx;
              const current = i === reachedIdx;
              return (
                <div key={s.key} className={'rounded-2xl p-4 flex items-center gap-3 ' + (reached ? 'bg-emerald-50 border-2 border-emerald-300' : 'bg-slate-50 border-2 border-slate-100')}>
                  <div className="text-2xl">{s.emoji}</div>
                  <div className="flex-1">
                    <div className="font-bold text-sm">{s.label}</div>
                    {current ? <div className="text-[11px] text-emerald-700 font-semibold">in progress</div> : null}
                  </div>
                  {reached ? <Check className="h-5 w-5 text-emerald-600" /> : null}
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 p-4 text-sm">
            <div className="flex justify-between font-bold"><span>Total</span><span>{fmt(cartTotal)}</span></div>
            <div className="text-xs text-slate-500 mt-1">
              Payment: {paymentMethod.replace('_', ' ')}{paymentRef ? ` · ${paymentRef}` : ''}
            </div>
          </div>

          <button
            onClick={() => { setOrderId(null); setCart([]); setCustomerName(''); setCustomerPhone(''); setPaymentRef(''); }}
            className="mt-6 w-full py-3 rounded-xl bg-slate-900 text-white font-bold"
          >New order</button>
        </div>
      </div>
    );
  }

  // Cart view.
  if (showCart) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-md mx-auto p-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setShowCart(false)} className="text-sm text-slate-600">← Back</button>
            <h1 className="text-lg font-bold">Your order</h1>
            <div className="w-12" />
          </div>

          {cart.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <ShoppingBag className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>Your cart is empty.</p>
            </div>
          ) : (
            <>
              <div className="space-y-2 mb-4">
                {cart.map((l, idx) => (
                  <div key={idx} className="bg-white rounded-xl p-3 flex items-center gap-3 shadow-sm">
                    <div className="flex-1">
                      <div className="font-bold text-sm">{l.productName}</div>
                      <div className="text-xs text-slate-500">{fmt(l.unitPrice)} each</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => updateQty(idx, l.quantity - 1)} className="w-7 h-7 rounded-full bg-slate-100">−</button>
                      <span className="w-6 text-center font-bold">{l.quantity}</span>
                      <button onClick={() => updateQty(idx, l.quantity + 1)} className="w-7 h-7 rounded-full bg-slate-100">+</button>
                    </div>
                    <div className="font-mono font-bold w-24 text-right">{fmt(l.unitPrice * l.quantity)}</div>
                    <button onClick={() => removeLine(idx)} className="text-rose-500"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-xl p-3 mb-4 space-y-2">
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Your name *"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
                <input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="Phone (for loyalty points)"
                  inputMode="tel"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                >
                  <option value="dine_in">🍽️ Dine in</option>
                  <option value="takeaway">🥡 Takeaway</option>
                  <option value="pickup">🛍️ Pickup</option>
                </select>
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  {(['mobile_money', 'card', 'cash_on_pickup'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setPaymentMethod(m)}
                      className={'py-2 rounded-lg text-xs font-bold ' + (paymentMethod === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700')}
                    >
                      {m === 'mobile_money' ? '📱 MoMo' : m === 'card' ? '💳 Card' : '💵 Cash'}
                    </button>
                  ))}
                </div>
                {paymentMethod === 'mobile_money' ? (
                  <input
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    placeholder="MoMo reference (e.g. MTN-12345)"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono"
                  />
                ) : null}
              </div>

              <div className="bg-slate-900 text-white rounded-xl p-3 mb-4 flex items-center justify-between">
                <span className="font-bold">Total</span>
                <span className="font-mono text-2xl font-extrabold">{fmt(cartTotal)}</span>
              </div>

              {orderError ? (
                <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">
                  {orderError}
                </div>
              ) : null}

              <button
                onClick={placeOrder}
                disabled={submitting || !cart.length || !customerName.trim()}
                className="w-full py-3 rounded-xl bg-emerald-500 disabled:bg-slate-300 text-white font-bold"
              >
                {submitting ? <Loader2 className="h-4 w-4 mr-1 inline animate-spin" /> : <Receipt className="h-4 w-4 mr-1 inline" />}
                {submitting ? 'Placing order…' : `Place order · ${fmt(cartTotal)}`}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Menu browse view.
  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      {/* Header */}
      <div className="bg-gradient-to-br from-amber-500 to-orange-500 text-white p-5 rounded-b-3xl shadow-lg">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-2 text-sm opacity-90">
            <Coffee className="h-4 w-4" />
            {catalog.orgName}
          </div>
          <h1 className="text-3xl font-extrabold mt-1">Menu</h1>
          <div className="flex items-center gap-1.5 text-sm opacity-90 mt-1">
            <MapPin className="h-3 w-3" />
            {catalog.branchName}
            {catalog.session.tableNumber ? <span>· Table {catalog.session.tableNumber}</span> : null}
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4">
        {/* Combos first if any */}
        {catalog.combos.length > 0 ? (
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Combos
            </h2>
            <div className="space-y-2">
              {catalog.combos.map((c) => (
                <button
                  key={c.id}
                  onClick={() => addComboToCart(c)}
                  className="w-full bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 rounded-2xl p-3 text-left flex items-center gap-3 active:scale-95 transition"
                >
                  <div className="text-2xl">🍱</div>
                  <div className="flex-1">
                    <div className="font-bold">{c.name}</div>
                    <div className="text-xs text-slate-500">
                      {c.items.map((it) => `${it.quantity}× ${it.productName}`).join(' + ')}
                    </div>
                  </div>
                  <div className="font-mono font-bold text-purple-700">{fmt(c.price)}</div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Category pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            onClick={() => setActiveCategory(null)}
            className={'px-3 py-1.5 rounded-full text-sm font-bold whitespace-nowrap ' + (activeCategory === null ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700')}
          >
            All
          </button>
          {catalog.categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={'px-3 py-1.5 rounded-full text-sm font-bold whitespace-nowrap ' + (activeCategory === c.id ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-700')}
            >
              {c.icon ? <span className="mr-1">{c.icon}</span> : null}
              {c.name}
            </button>
          ))}
        </div>

        {/* Product list */}
        <div className="space-y-2">
          {filteredProducts.map((p) => (
            <button
              key={p.id}
              onClick={() => p.inStock && addToCart(p)}
              disabled={!p.inStock}
              className={'w-full bg-white rounded-2xl p-3 flex items-center gap-3 text-left shadow-sm ' + (p.inStock ? 'active:scale-95 transition' : 'opacity-50')}
            >
              <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center text-2xl flex-shrink-0">
                {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover rounded-xl" /> : '☕'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{p.name}</div>
                {p.description ? <div className="text-xs text-slate-500 line-clamp-2">{p.description}</div> : null}
                {!p.inStock ? <div className="text-[10px] text-rose-600 font-bold uppercase">Out of stock</div> : null}
              </div>
              <div className="font-mono font-bold text-emerald-700">{fmt(p.price)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Floating cart bar */}
      {cart.length > 0 ? (
        <div className="fixed bottom-0 inset-x-0 p-3 bg-gradient-to-t from-white to-transparent">
          <div className="max-w-md mx-auto">
            <button
              onClick={() => setShowCart(true)}
              className="w-full py-3 rounded-2xl bg-slate-900 text-white font-bold flex items-center justify-between px-5 shadow-2xl active:scale-95 transition"
            >
              <span className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                View cart ({cart.reduce((s, l) => s + l.quantity, 0)})
              </span>
              <span className="font-mono">{fmt(cartTotal)}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default DigitalMenuPage;