import React, { useMemo, useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Package, Search, User, X, ArrowRight, CheckCircle2 } from 'lucide-react';

import PosLoginScreen from './PosLoginScreen';
import { usePosAuthStore } from '@/features/pos/pos-auth.store';
import { useProductsForPos } from '@/features/pos/api';
import {
  useCreateAgreement,
  useConfirmAgreement,
  useCheckoutAgreement,
  useRentalCatalog,
} from '@/features/rental/api';
import { api } from '@/lib/api';
import './pos-pro.css';

const fmt = (n: number | string) => `${useAuthStore.getState().organization?.currencyCode ?? 'IDR'} ${Number(n || 0).toLocaleString('id-ID')}`;

interface RentalLine {
  productId: string;
  productName: string;
  quantity: number;
  ratePeriod: string;
  unitRate: number;
}

/** Customer picker — reuses the partners search endpoint. */
function CustomerPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (c: { id: string; name: string } | null) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Array<{ id: string; name: string }>>([]);

  const searchCustomers = async (term: string) => {
    setSearch(term);
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    try {
      const res = await api.get('/partners', { params: { search: term, pageSize: 8 } });
      setResults((res.data as any)?.items ?? []);
    } catch {
      setResults([]);
    }
  };

  return (
    <div className="relative">
      {value ? (
        <div className="flex items-center justify-between rounded-lg border bg-card p-3">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{value.name}</span>
          </div>
          <button onClick={() => onChange(null)} className="text-muted-foreground hover:text-foreground" aria-label="Clear customer">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between rounded-lg border border-dashed bg-card p-3 text-muted-foreground hover:border-primary"
        >
          <span className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Select customer (required)
          </span>
          <Search className="h-4 w-4" />
        </button>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border bg-card p-3 shadow-lg">
          <input
            autoFocus
            value={search}
            onChange={(e) => searchCustomers(e.target.value)}
            placeholder="Search by name or phone…"
            className="mb-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <div className="max-h-52 space-y-1 overflow-auto">
            {results.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                  setSearch('');
                }}
                className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
              >
                {c.name}
              </button>
            ))}
            {results.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">Type at least 2 characters…</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const RentalTerminal: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const posUser = usePosAuthStore((s) => s.user);
  const [showPosLogin, setShowPosLogin] = useState(!usePosAuthStore.getState().user);

  const { data: products = [] } = useProductsForPos();
  const { data: catalog } = useRentalCatalog();

  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<RentalLine[]>([]);
  const [startAt, setStartAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [endAt, setEndAt] = useState(() => new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  const [depositAmount, setDepositAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [busy, setBusy] = useState(false);

  const createAgreement = useCreateAgreement();
  const confirmAgreement = useConfirmAgreement();
  const checkoutAgreement = useCheckoutAgreement();

  // Products eligible for rental (have rates defined in the catalog).
  const rentableProductIds = useMemo(() => new Set((catalog?.rates ?? []).map((r: any) => r.productId)), [catalog]);
  const rentable = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((p: any) => rentableProductIds.has(p.id) || (p as any).rentalIsPooled)
      .filter((p: any) => !term || p.name.toLowerCase().includes(term) || (p.sku ?? '').toLowerCase().includes(term));
  }, [products, rentableProductIds, search]);

  const addLine = (p: any) => {
    const rate = (catalog?.rates ?? []).find((r: any) => r.productId === p.id && r.isActive !== false);
    setLines((ls) => {
      const existing = ls.find((l) => l.productId === p.id);
      if (existing) return ls.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [
        ...ls,
        {
          productId: p.id,
          productName: p.name,
          quantity: 1,
          ratePeriod: rate?.period ?? 'day',
          unitRate: rate ? Number(rate.price) : 0,
        },
      ];
    });
  };

  const setQty = (productId: string, quantity: number) =>
    setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, quantity: Math.max(1, quantity) } : l)));

  const removeLine = (productId: string) => setLines((ls) => ls.filter((l) => l.productId !== productId));

  const total = useMemo(() => lines.reduce((s, l) => s + l.unitRate * l.quantity, 0), [lines]);

  const handleCheckout = async () => {
    if (!customer) {
      toast.error('Select a customer first');
      return;
    }
    if (!lines.length) {
      toast.error('Add at least one item');
      return;
    }
    if (!startAt || !endAt || endAt <= startAt) {
      toast.error('Check the rental window');
      return;
    }
    setBusy(true);
    try {
      const agreement = await createAgreement.mutateAsync({
        partnerId: customer.id,
        startAt: new Date(startAt).toISOString(),
        dueAt: new Date(endAt + 'T23:59:59').toISOString(),
        depositPolicy: 'fixed',
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          ratePeriod: l.ratePeriod,
          unitRate: l.unitRate,
        })),
      });
      if (agreement.status === 'pending_approval') {
        toast.info('Agreement created — waiting for approval');
        navigate(`/rental/agreements/${agreement.id}`);
        return;
      }
      const confirmed = await confirmAgreement.mutateAsync(agreement.id);
      const checkedOut = await checkoutAgreement.mutateAsync({
        id: confirmed.id,
        dto: {
          depositAmount: depositAmount > 0 ? depositAmount : undefined,
          depositMethod: depositAmount > 0 ? paymentMode : undefined,
          paymentMode,
        },
      });
      toast.success(`Checked out ${checkedOut.agreementNumber ?? 'agreement'}`);
      setLines([]);
      setCustomer(null);
      setDepositAmount(0);
      navigate(`/rental/agreements/${agreement.id}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Checkout failed');
    } finally {
      setBusy(false);
    }
  };

  if (showPosLogin && !posUser) {
    return <PosLoginScreen onLoggedIn={() => setShowPosLogin(false)} />;
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Minimal rental header (Topbar is cafe-shift-specific). */}
      <header className="flex items-center justify-between border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-semibold leading-none">Rental Terminal</p>
            <p className="text-xs text-muted-foreground">{user?.firstName ?? 'POS'}</p>
          </div>
        </div>
        <button
          onClick={() => navigate('/')}
          className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
        >
          Exit
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: rentable catalog */}
        <div className="flex w-1/2 flex-col border-r">
          <div className="border-b p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rentable items…"
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Showing items with rental rates configured ({rentable.length}).
            </p>
          </div>
          <div className="grid flex-1 auto-rows-min grid-cols-3 gap-2 overflow-auto p-3">
            {rentable.map((p: any) => {
              const rate = (catalog?.rates ?? []).find((r: any) => r.productId === p.id && r.isActive !== false);
              return (
                <button
                  key={p.id}
                  onClick={() => addLine(p)}
                  className="flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left transition hover:border-primary"
                >
                  <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.sku ?? p.code ?? ''}</span>
                  <span className="mt-auto text-sm font-semibold text-primary">
                    {rate ? `${fmt(rate.price)}/${rate.period}` : 'No rate'}
                  </span>
                </button>
              );
            })}
            {rentable.length === 0 && (
              <p className="col-span-3 p-6 text-center text-sm text-muted-foreground">
                No rentable products yet. Configure rental rates in the Products module first.
              </p>
            )}
          </div>
        </div>

        {/* Right: agreement builder */}
        <div className="flex w-1/2 flex-col">
          <div className="space-y-3 border-b p-3">
            <CustomerPicker value={customer} onChange={setCustomer} />
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Pickup date</span>
                <input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="w-full rounded-md border bg-card px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Due date</span>
                <input type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="w-full rounded-md border bg-card px-3 py-2 text-sm" />
              </label>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-3">
            {lines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <Package className="h-10 w-10" />
                <p className="text-sm">Tap items on the left to build the agreement.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {lines.map((l) => (
                  <div key={l.productId} className="flex items-center gap-2 rounded-lg border bg-card p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmt(l.unitRate)} / {l.ratePeriod}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setQty(l.productId, l.quantity - 1)} className="h-7 w-7 rounded border text-sm">−</button>
                      <span className="w-8 text-center text-sm font-medium">{l.quantity}</span>
                      <button onClick={() => setQty(l.productId, l.quantity + 1)} className="h-7 w-7 rounded border text-sm">+</button>
                    </div>
                    <button onClick={() => removeLine(l.productId)} className="text-muted-foreground hover:text-destructive" aria-label="Remove">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3 border-t p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Estimated rental fee / period</span>
              <span className="text-lg font-semibold">{fmt(total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Deposit (optional)</span>
                <input
                  type="number"
                  min={0}
                  value={depositAmount || ''}
                  onChange={(e) => setDepositAmount(Number(e.target.value))}
                  placeholder="0"
                  className="w-full rounded-md border bg-card px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Payment mode</span>
                <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="mobile_money">Mobile money</option>
                  <option value="mixed">Mixed</option>
                </select>
              </label>
            </div>
            <button
              onClick={handleCheckout}
              disabled={busy || !customer || !lines.length}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? (
                <span>Processing…</span>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Checkout rental
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RentalTerminal;
