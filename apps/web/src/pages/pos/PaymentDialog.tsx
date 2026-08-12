import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
// Multi-tender payment dialog. Maps directly to POST /pos/checkout with `tenders`.
// Quick-amount buttons, change calculation, manager override for high discounts.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote, Smartphone, CreditCard, Building2, Wallet, Check, X, Plus, Gift, UserPlus, AlertTriangle,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PaymentMethod, PaymentTender } from './types';

/** The pay panel offers the tender methods PLUS a non-tender "settle on account"
 *  mode (credit_settlement) that books the sale to the customer's AR instead of
 *  collecting money now. It is routed to onCreditSale, not added as a tender. */
type SettleMode = PaymentMethod | 'credit_settlement';
type MethodTile = { key: SettleMode; label: string; icon: React.ReactNode; color: string };

const METHODS: MethodTile[] = [
  { key: 'cash', label: 'Cash', icon: <Banknote className="h-4 w-4" />, color: '#16a34a' },
  { key: 'mobile_money', label: 'Mobile Money', icon: <Smartphone className="h-4 w-4" />, color: '#f59e0b' },
  { key: 'card', label: 'Card', icon: <CreditCard className="h-4 w-4" />, color: '#1a7fcf' },
  { key: 'bank', label: 'Bank', icon: <Building2 className="h-4 w-4" />, color: '#8b5cf6' },
];

const fmt = (n: number | string) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;

interface Props {
  open: boolean;
  total: number;
  /** Highest discount percentage currently applied (line + transaction). */
  effectiveDiscountPercent?: number;
  /** Selected customer's redeemable store-credit balance (0 / undefined hides it). */
  storeCreditBalance?: number;
  /** Called by parent when the cashier needs to verify a manager. */
  onRequestOverride: (kind: 'discount' | 'void' | 'manual_refund') => Promise<{managerId: string; pin: string} | null>;
  onClose: () => void;
  onSettle: (input: {
    tenders: PaymentTender[];
    transactionDiscountPercent: number;
    /** Cash physically handed over (may exceed total) so the backend can record the change. */
    amountTendered?: number;
    overrideById?: string;
    overridePin?: string;
  }) => Promise<void>;
  /** Enables the "Charge to account" (postpaid credit) action — true when a real customer is selected. */
  creditEnabled?: boolean;
  /** Runs the credit (postpaid AR) sale through the Order→Invoice→Receipt pipeline. */
  onCreditSale?: () => Promise<void>;
  /** Selected customer's display name, shown on the credit panel. */
  customerName?: string;
  /** Selected customer's credit standing (GET /pos/customers/:id/credit). */
  creditInfo?: { creditLimit: number; outstanding: number; available: number | null; creditHold: boolean } | null;
  /** Opens the customer picker — the credit tile is useless without a customer. */
  onPickCustomer?: () => void;
}

export const PaymentDialog: React.FC<Props> = ({
  open, total, effectiveDiscountPercent = 0, storeCreditBalance = 0, onRequestOverride, onClose, onSettle,
  creditEnabled = false, onCreditSale, customerName, creditInfo, onPickCustomer,
}) => {
  const [tenders, setTenders] = useState<PaymentTender[]>([]);
  // Raw amount entered per tender, aligned index-wise with `tenders`. For cash this
  // may exceed the applied leg (over-tender → change); it is never sent as a tender.
  const [tenderRaw, setTenderRaw] = useState<number[]>([]);
  const [activeMethod, setActiveMethod] = useState<SettleMode>('cash');
  const [tendered, setTendered] = useState(() => String(total));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideId, setOverrideId] = useState<string | undefined>(undefined);
  const [overridePin, setOverridePin] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setTenders([]);
    setTenderRaw([]);
    setTendered(String(total));
    setReference('');
    setError(null);
    setOverrideId(undefined);
    setOverridePin(undefined);
    setActiveMethod('cash');
  }, [open, total]);

  // Store-credit tile only appears when the selected customer carries a balance.
  // Credit-settlement ("Credit") is ALWAYS offered: hiding it until a customer
  // was picked made the whole feature look missing. With no customer the tile
  // still shows and its panel explains what to do.
  const methods = useMemo(() => {
    const base = [...METHODS];
    if (storeCreditBalance > 0) {
      base.push({ key: 'store_credit', label: 'Store Credit', icon: <Gift className="h-4 w-4" />, color: '#0ea5e9' });
    }
    if (onCreditSale) {
      base.push({ key: 'credit_settlement', label: 'Credit', icon: <Wallet className="h-4 w-4" />, color: '#0284c7' });
    }
    return base;
  }, [storeCreditBalance, onCreditSale]);

  const isCredit = activeMethod === 'credit_settlement';

  const paid = useMemo(() => tenders.reduce((s, t) => s + (t.amount || 0), 0), [tenders]);
  const remaining = Math.max(0, total - paid);
  // Change = cash over-tender: each tender's raw entered amount minus the amount
  // actually applied to the bill (only cash is allowed to exceed the bill).
  const change = useMemo(
    () => tenders.reduce((s, t, i) => s + Math.max(0, (tenderRaw[i] ?? t.amount) - t.amount), 0),
    [tenders, tenderRaw],
  );
  const amountTendered = paid + change;
  const creditUsed = useMemo(
    () => tenders.filter((t) => t.method === 'store_credit').reduce((s, t) => s + t.amount, 0),
    [tenders],
  );
  const availableCredit = Math.max(0, storeCreditBalance - creditUsed);
  const tenderNum = Number(tendered);
  const tenderValid = Number.isFinite(tenderNum) && tenderNum > 0;
  const creditBlocked = activeMethod === 'store_credit' && availableCredit <= 0;

  // Why an on-account sale can't go through right now (null = it can). The API
  // enforces all of this too; this only saves the cashier a round-trip.
  const balanceAfter = (creditInfo?.outstanding ?? 0) + total;
  const creditBlockReason = useMemo(() => {
    if (!creditEnabled) return 'Select a customer to charge this sale to.';
    if (creditInfo?.creditHold) return 'This customer is on credit hold — new credit sales are blocked.';
    if (creditInfo?.available != null && creditInfo.available + 0.01 < total) {
      return `Over credit limit — only ${fmt(creditInfo.available)} of credit is available.`;
    }
    return null;
  }, [creditEnabled, creditInfo, total]);

  const addTender = () => {
    // credit_settlement is not a tender — it's routed to onCreditSale instead.
    if (activeMethod === 'credit_settlement') return;
    if (!tenderValid || remaining <= 0 || creditBlocked) return;
    let amount = Math.min(tenderNum, remaining);
    if (activeMethod === 'store_credit') amount = Math.min(amount, availableCredit);
    if (amount <= 0) return;
    const method: PaymentMethod = activeMethod;
    // Cash may exceed the bill (customer overpays → change). The tender LEG stays
    // clamped to `remaining` so tenders still sum to the total (backend guard),
    // while the raw amount handed over is remembered to compute the change.
    const raw = method === 'cash' ? tenderNum : amount;
    setTenders((prev) => [...prev, { method, amount, reference: reference.trim() || undefined }]);
    setTenderRaw((prev) => [...prev, raw]);
    setTendered(''); setReference('');
  };

  const removeTender = (i: number) => {
    setTenders((prev) => prev.filter((_, idx) => idx !== i));
    setTenderRaw((prev) => prev.filter((_, idx) => idx !== i));
  };

  const canSettle = tenders.length > 0 && paid >= total - 0.01;

  const settle = async () => {
    if (!canSettle) return;
    try {
      setBusy(true); setError(null);
      await onSettle({
        tenders,
        transactionDiscountPercent: 0,
        // Only sent when the customer overpaid in cash; exact payments omit it.
        amountTendered: change > 0 ? amountTendered : undefined,
        overrideById: overrideId,
        overridePin: overridePin,
      });
    } catch (e: any) {
      setError(e?.message || e?.response?.data?.message || 'Payment failed');
    } finally {
      setBusy(false);
    }
  };

  // Settle on account: no money collected now — books the sale to the customer's
  // AR (postpaid) via the credit pipeline. Routed to the parent, not a tender.
  const settleOnAccount = async () => {
    if (!onCreditSale) return;
    try {
      setBusy(true); setError(null);
      await onCreditSale();
    } catch (e: any) {
      setError(e?.message || e?.response?.data?.message || 'Credit settlement failed');
    } finally {
      setBusy(false);
    }
  };

  const requestOverride = async () => {
    const result = await onRequestOverride('discount');
    if (result) { setOverrideId(result.managerId); setOverridePin(result.pin); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[860px] p-0 overflow-hidden">
        <DialogHeader className="bg-gradient-to-r from-emerald-500 to-emerald-700 text-white p-4">
          <DialogTitle className="text-white text-base font-bold flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Charge
          </DialogTitle>
          <DialogDescription className="text-emerald-100 text-xs">
            Pay with one or many methods. Split by adding tenders until the total is covered.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px]">
          <div className="p-4 space-y-3">
            {/* Method tabs */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {methods.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className="flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-all"
                  style={{
                    borderColor: activeMethod === m.key ? m.color : '#e2e8f0',
                    background: activeMethod === m.key ? `${m.color}15` : '#fff',
                    color: activeMethod === m.key ? m.color : '#64748b',
                  }}
                  onClick={() => setActiveMethod(m.key)}
                >
                  {m.icon}
                  <span className="text-[11px] font-bold">{m.label}</span>
                </button>
              ))}
            </div>

            {isCredit ? (
              <div className="space-y-2">
                <div className="rounded-lg border-2 border-sky-200 bg-sky-50 p-4 space-y-1.5">
                  <div className="flex items-center gap-2 text-sky-800 font-bold text-sm">
                    <Wallet className="h-4 w-4" /> Settle on account (credit)
                  </div>
                  <p className="text-xs text-sky-700">
                    No money is collected now. {fmt(total)} is booked to the customer's
                    account (AR) and stays unpaid until a payment is recorded against
                    the invoice.
                  </p>
                </div>

                {!creditEnabled ? (
                  <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-4 space-y-2.5">
                    <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
                      <AlertTriangle className="h-4 w-4" /> No customer selected
                    </div>
                    <p className="text-xs text-amber-700">
                      An on-account sale has to be billed to a named customer — somebody
                      has to owe the money. Walk-in customers must pay now.
                    </p>
                    {onPickCustomer ? (
                      <Button onClick={onPickCustomer} className="w-full bg-amber-600 hover:bg-amber-700">
                        <UserPlus className="h-4 w-4 mr-1" /> Select customer
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Customer</span>
                      <span className="font-bold">{customerName ?? '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Credit limit</span>
                      <span className="font-mono">{creditInfo && creditInfo.creditLimit > 0 ? fmt(creditInfo.creditLimit) : 'No limit'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Already owing</span>
                      <span className="font-mono">{fmt(creditInfo?.outstanding ?? 0)}</span>
                    </div>
                    {creditInfo?.available != null ? (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Available</span>
                        <span className="font-mono font-bold text-emerald-600">{fmt(creditInfo.available)}</span>
                      </div>
                    ) : null}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5">
                      <span className="text-slate-500">Owing after this sale</span>
                      <span className="font-mono font-bold">{fmt(balanceAfter)}</span>
                    </div>
                  </div>
                )}

                {creditEnabled && creditBlockReason ? (
                  <div className="flex items-start gap-2 rounded-lg border-2 border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {creditBlockReason}
                  </div>
                ) : null}
              </div>
            ) : (
            <>
            <div>
              <Label>{activeMethod === 'cash' ? 'Cash tendered' : 'Amount to charge'}</Label>
              <Input
                type="number"
                value={tendered}
                onChange={(e) => setTendered(e.target.value)}
                placeholder="0"
                className="text-right text-xl h-12 font-mono font-bold"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') addTender(); }}
              />
              {activeMethod === 'store_credit' ? (
                <div className="flex items-center gap-2 mt-2 text-xs">
                  <span className="font-semibold text-sky-700">Available credit: {fmt(availableCredit)}</span>
                  <button
                    type="button"
                    className="px-2.5 py-1 rounded-md bg-sky-100 text-sky-700 hover:bg-sky-200 font-bold disabled:opacity-50"
                    disabled={availableCredit <= 0}
                    onClick={() => setTendered(String(Math.min(remaining, availableCredit)))}
                  >
                    Use max
                  </button>
                </div>
              ) : null}
            </div>

            {activeMethod !== 'cash' && activeMethod !== 'store_credit' ? (
              <div>
                <Label>Reference / transaction id (optional)</Label>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. MTN-12345"
                  className="font-mono"
                />
              </div>
            ) : null}

            <Button onClick={addTender} disabled={!tenderValid || remaining <= 0 || creditBlocked} className="w-full" style={{ background: methods.find((m) => m.key === activeMethod)?.color }}>
              <Plus className="h-4 w-4 mr-1" /> Add {methods.find((m) => m.key === activeMethod)?.label} — {fmt(activeMethod === 'cash' ? (tenderValid ? tenderNum : remaining) : Math.min(tenderValid ? tenderNum : remaining, activeMethod === 'store_credit' ? Math.min(remaining, availableCredit) : remaining))}
            </Button>
            </>

            )}

            {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          </div>

          {/* Right column: total + tenders + settle */}
          <div className="bg-slate-50 border-l border-slate-200 p-4 flex flex-col">
            <div className="text-center mb-3">
              <div className="text-xs uppercase tracking-wider text-slate-500">Total due</div>
              <div className="text-3xl font-extrabold text-slate-800 mt-1">{fmt(total)}</div>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Paid</span><span className="font-mono">{fmt(paid)}</span></div>
              <div className="flex justify-between font-bold text-emerald-600"><span>Remaining</span><span className="font-mono">{fmt(remaining)}</span></div>
              {change > 0 ? (
                <div className="flex justify-between font-bold text-amber-600"><span>Change</span><span className="font-mono">{fmt(change)}</span></div>
              ) : null}
            </div>
            <div className="mt-3 flex-1 overflow-y-auto space-y-1.5">
              {tenders.length === 0 ? (
                <p className="text-xs text-slate-400 text-center mt-4">No tenders yet</p>
              ) : tenders.map((t, i) => (
                <div key={i} className="flex items-center justify-between bg-white rounded border border-slate-200 px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: methods.find((m) => m.key === t.method)?.color }} />
                    <span className="font-bold">{t.method.replace('_', ' ')}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold">{fmt(t.amount)}</span>
                    <button type="button" onClick={() => removeTender(i)} className="text-rose-500 hover:text-rose-700"><X className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>

            {/* Optional manager override indicator (already verified upstream via parent) */}
            {overrideId ? (
              <div className="mt-2 text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-2 py-1">
                ✓ Manager override applied
              </div>
            ) : null}

            <Button
              onClick={isCredit ? settleOnAccount : settle}
              disabled={busy || (isCredit ? creditBlockReason != null : !canSettle)}
              className="w-full mt-3 h-12 text-base"
              style={{ background: isCredit ? '#0284c7' : '#16a34a' }}
            >
              {busy
                ? 'Processing…'
                : isCredit
                  ? <><Wallet className="h-4 w-4 mr-1" /> Charge {fmt(total)} to account</>
                  : <><Check className="h-4 w-4 mr-1" /> Settle {fmt(total)}</>}
            </Button>
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 p-3 bg-slate-50">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {/* Hidden helper — if discount > 10% and no override, allow cashier to request one */}
          {effectiveDiscountPercent > 10 && !overrideId ? (
            <Button onClick={requestOverride} variant="outline" className="border-amber-300 text-amber-700">
              Request manager override
            </Button>
          ) : null}
          {/* Postpaid credit is now a payment mode ("Credit") in the method grid. */}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};