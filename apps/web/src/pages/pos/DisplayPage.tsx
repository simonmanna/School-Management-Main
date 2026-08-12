import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
/**
 * POS P6 — Customer-facing pole display.
 *
 * Mounted on a second monitor / tablet facing the customer. Reads the active
 * cart from localStorage (the Terminal page writes the cart there) and
 * renders a large, readable receipt-style view. Re-renders on every cart
 * mutation via the browser's `storage` event.
 *
 * Visit /pos/display in fullscreen on the second monitor. When the cashier
 * adds items or tenders, the customer's screen updates in real time.
 */
import React, { useEffect, useState } from 'react';
import { Coffee, Check } from 'lucide-react';
import type { CartLine } from '@/features/pos/types';
import './pos-pro.css';

interface CartSnapshot {
  lines: CartLine[];
  transactionDiscountPercent: number;
  total: number;
  tendered: number;
  change: number;
  status: 'idle' | 'building' | 'tendering' | 'paid';
  lastInvoiceNumber?: string;
  lastTotal?: number;
}

const fmt = (n: number | string) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;

const STORAGE_KEY = 'pos-display-cart';

const DisplayPage: React.FC = () => {
  const [snap, setSnap] = useState<CartSnapshot>({
    lines: [], transactionDiscountPercent: 0, total: 0, tendered: 0, change: 0, status: 'idle',
  });
  const [orgName, setOrgName] = useState('Cafe');

  // Poll localStorage (Terminal writes it on every cart mutation).
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) setSnap(JSON.parse(raw));
        const org = localStorage.getItem('pos-display-org');
        if (org) setOrgName(org);
      } catch { /* noop */ }
    };
    read();
    const id = setInterval(read, 500); // simple polling — `storage` event only fires cross-tab
    return () => clearInterval(id);
  }, []);

  // Try to grab the org name from the auth store on first paint (same origin
  // is fine — the terminal logged the user in on this same browser).
  useEffect(() => {
    try {
      const auth = JSON.parse(localStorage.getItem('cafe-pos-auth') || '{}');
      if (auth?.state?.organization?.name) setOrgName(auth.state.organization.name);
    } catch { /* noop */ }
  }, []);

  return (
    <div
      className="pos-shell-pro"
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        color: '#fff',
        padding: '2rem 3rem',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3 text-3xl font-extrabold">
          <Coffee className="h-10 w-10 text-amber-400" /> {orgName}
        </div>
        <div className="text-2xl text-slate-300 font-mono">
          {new Date().toLocaleString()}
        </div>
      </div>

      {/* Status banner */}
      {snap.status === 'paid' ? (
        <div className="rounded-3xl bg-emerald-500 text-white p-8 text-center shadow-2xl mb-6 animate-pulse">
          <Check className="h-20 w-20 mx-auto mb-3" />
          <div className="text-5xl font-extrabold">Thank you!</div>
          <div className="text-2xl mt-2">Receipt #{snap.lastInvoiceNumber} — {fmt(snap.lastTotal ?? 0)}</div>
          {snap.change > 0 ? (
            <div className="text-3xl mt-3">Change: <strong>{fmt(snap.change)}</strong></div>
          ) : null}
        </div>
      ) : snap.status === 'tendering' && snap.tendered > 0 ? (
        <div className="rounded-3xl bg-blue-500 text-white p-6 text-center shadow-2xl mb-6">
          <div className="text-2xl">Tendered</div>
          <div className="text-5xl font-extrabold">{fmt(snap.tendered)}</div>
          {snap.change > 0 ? (
            <div className="text-3xl mt-3">Change: <strong>{fmt(snap.change)}</strong></div>
          ) : null}
        </div>
      ) : snap.lines.length === 0 ? (
        <div className="rounded-3xl bg-slate-800 text-slate-300 p-12 text-center shadow-2xl mb-6">
          <Coffee className="h-20 w-20 mx-auto mb-4 opacity-50" />
          <div className="text-3xl font-bold">Welcome!</div>
          <div className="text-xl mt-2 opacity-80">Please place your order at the counter.</div>
        </div>
      ) : null}

      {/* Items list */}
      {snap.lines.length > 0 ? (
        <div className="flex-1 overflow-y-auto rounded-3xl bg-slate-800/60 backdrop-blur p-6 shadow-xl">
          {snap.lines.map((it) => (
            <div key={it.lineId} className="flex items-center justify-between py-3 border-b border-slate-700/50 last:border-0">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-12 h-12 rounded-xl bg-slate-700 flex items-center justify-center text-2xl">
                  {it.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-2xl font-bold truncate">{it.name}</div>
                  {it.note ? <div className="text-sm text-amber-300 italic">! {it.note}</div> : null}
                </div>
                <div className="text-2xl text-slate-300 font-mono mr-4">×{it.quantity}</div>
              </div>
              <div className="text-2xl font-bold text-right" style={{ minWidth: 140 }}>
                {fmt(it.quantity * it.unitPrice * (1 - it.discountPercent / 100))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Total */}
      {snap.lines.length > 0 ? (
        <div className="rounded-3xl bg-amber-500 text-slate-900 p-6 mt-6 text-center shadow-2xl">
          <div className="text-2xl font-semibold">Total</div>
          <div className="text-7xl font-extrabold font-mono mt-2">{fmt(snap.total)}</div>
          {snap.transactionDiscountPercent > 0 ? (
            <div className="text-base mt-1">includes {snap.transactionDiscountPercent}% discount</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default DisplayPage;