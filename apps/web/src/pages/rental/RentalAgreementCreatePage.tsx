import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { useProductsForPos } from '@/features/pos/api';
import { useRentalCatalog, useCreateAgreement } from '@/features/rental/api';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

interface Line {
  productId: string;
  productName: string;
  quantity: number;
  ratePeriod: string;
  unitRate: number;
}

export function RentalAgreementCreatePage() {
  const navigate = useNavigate();
  const { data: products = [] } = useProductsForPos();
  const { data: catalog } = useRentalCatalog();
  const create = useCreateAgreement();

  const [partnerId, setPartnerId] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [startAt, setStartAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueAt, setDueAt] = useState(() => new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const rentableProductIds = useMemo(() => new Set((catalog?.rates ?? []).map((r: any) => r.productId)), [catalog]);

  const addLine = (p: any) => {
    const rate = (catalog?.rates ?? []).find((r: any) => r.productId === p.id && r.isActive !== false);
    setLines((ls) => {
      const existing = ls.find((l) => l.productId === p.id);
      if (existing) return ls.map((l) => (l.productId === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, {
        productId: p.id,
        productName: p.name,
        quantity: 1,
        ratePeriod: rate?.period ?? 'day',
        unitRate: rate ? Number(rate.price) : 0,
      }];
    });
  };

  const searchPartner = async (term: string) => {
    if (term.trim().length < 2) return;
    try {
      const res = await api.get('/partners', { params: { search: term, pageSize: 5 } });
      const first = (res.data as any)?.items?.[0];
      if (first) {
        setPartnerId(first.id);
        setPartnerName(first.name);
      }
    } catch {
      /* noop */
    }
  };

  const handleCreate = async () => {
    if (!partnerId) {
      toast.error('Enter a partner');
      return;
    }
    if (!lines.length) {
      toast.error('Add at least one line');
      return;
    }
    if (!startAt || !dueAt || dueAt <= startAt) {
      toast.error('Check the window');
      return;
    }
    setBusy(true);
    try {
      const agreement = await create.mutateAsync({
        partnerId,
        startAt: new Date(startAt).toISOString(),
        dueAt: new Date(dueAt + 'T23:59:59').toISOString(),
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, ratePeriod: l.ratePeriod, unitRate: l.unitRate })),
      });
      toast.success('Agreement created');
      navigate(`/rental/agreements/${agreement.id}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={() => navigate('/rental/agreements')} className="hover:text-foreground">Rentals</button>
        <span>/</span>
        <span>Agreements</span>
        <span>/</span>
        <span className="text-foreground">New</span>
      </nav>

      <div className="flex items-center gap-3">
        <ArrowLeft className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">New rental agreement</h1>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">Partner & window</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Partner (name or phone)</span>
              <input
                value={partnerName}
                onChange={(e) => { setPartnerName(e.target.value); setPartnerId(''); }}
                onBlur={(e) => searchPartner(e.target.value)}
                placeholder="Type at least 2 characters, then blur to resolve"
                className="w-full rounded-md border bg-card px-3 py-2 text-sm"
              />
              {partnerId && <p className="mt-1 text-xs text-emerald-600">Resolved: {partnerId}</p>}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Pickup</span>
                <input type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="w-full rounded-md border bg-card px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Due</span>
                <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="w-full rounded-md border bg-card px-3 py-2 text-sm" />
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">Lines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-4">
            <div className="max-h-64 space-y-1 overflow-auto">
              {products
                .filter((p: any) => rentableProductIds.has(p.id))
                .map((p: any) => (
                  <button
                    key={p.id}
                    onClick={() => addLine(p)}
                    className="flex w-full items-center justify-between rounded-md border bg-card px-3 py-2 text-left text-sm hover:border-primary"
                  >
                    <span>{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {fmt((catalog?.rates ?? []).find((r: any) => r.productId === p.id)?.price ?? 0)}/
                      {(catalog?.rates ?? []).find((r: any) => r.productId === p.id)?.period ?? 'day'}
                    </span>
                  </button>
                ))}
            </div>
            <div className="divide-y rounded-md border">
              {lines.length === 0 && <p className="p-3 text-sm text-muted-foreground">No lines yet.</p>}
              {lines.map((l) => (
                <div key={l.productId} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="truncate">{l.productName} × {l.quantity}</span>
                  <span className="text-muted-foreground">{fmt(l.unitRate * l.quantity)}</span>
                </div>
              ))}
            </div>
            <Button className="w-full" disabled={busy || !lines.length} onClick={handleCreate}>
              <CalendarDays className="h-4 w-4" /> {busy ? 'Creating…' : 'Create agreement'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
