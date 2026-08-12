import { useState } from 'react';
import { toast } from 'sonner';
import { Tag, Package } from 'lucide-react';
import { useRentalCatalog, useUpsertRate, useCreatePackage } from '@/features/rental/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

export function RentalCatalogPage() {
  const { data } = useRentalCatalog({ includeInactive: true });
  const upsertRate = useUpsertRate();
  const createPackage = useCreatePackage();

  const [rateOpen, setRateOpen] = useState(false);
  const [pkgOpen, setPkgOpen] = useState(false);
  const [productId, setProductId] = useState('');
  const [period, setPeriod] = useState('day');
  const [minUnits, setMinUnits] = useState(1);
  const [price, setPrice] = useState('');

  const [pkgProductId, setPkgProductId] = useState('');
  const [pkgCode, setPkgCode] = useState('');
  const [pkgName, setPkgName] = useState('');

  const rates = data?.rates ?? [];
  const packages = data?.packages ?? [];

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.success(msg);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? msg + ' failed');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Rates & Packages</h1>
          <p className="text-sm text-muted-foreground">Per-period rental pricing and bundle packages.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setRateOpen((v) => !v)}><Tag className="h-4 w-4" /> New rate</Button>
          <Button variant="outline" onClick={() => setPkgOpen((v) => !v)}><Package className="h-4 w-4" /> New package</Button>
        </div>
      </div>

      {rateOpen && (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">Add rate band</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-5 items-end gap-2 p-4">
            <label className="col-span-2">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Product ID</span>
              <input value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="productId" className="w-full rounded-md border bg-card px-3 py-2 text-sm" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Period</span>
              <select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="hour">hour</option>
                <option value="day">day</option>
                <option value="week">week</option>
                <option value="month">month</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Min units</span>
              <input type="number" min={1} value={minUnits} onChange={(e) => setMinUnits(Number(e.target.value))} className="w-full rounded-md border bg-card px-3 py-2 text-sm" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Price</span>
              <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className="w-full rounded-md border bg-card px-3 py-2 text-sm" />
            </label>
            <Button
              className="col-start-5"
              size="sm"
              disabled={!productId || !price}
              onClick={() => run(
                () => upsertRate.mutateAsync({ productId, period, minUnits, price: Number(price) }),
                'Rate saved',
              )}
            >
              Save
            </Button>
          </CardContent>
        </Card>
      )}

      {pkgOpen && (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">Create package</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-4 items-end gap-2 p-4">
            <label className="col-span-2">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Product ID</span>
              <input value={pkgProductId} onChange={(e) => setPkgProductId(e.target.value)} placeholder="productId" className="w-full rounded-md border bg-card px-3 py-2 text-sm" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Code</span>
              <input value={pkgCode} onChange={(e) => setPkgCode(e.target.value)} placeholder="PKG-01" className="w-full rounded-md border bg-card px-3 py-2 text-sm" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
              <input value={pkgName} onChange={(e) => setPkgName(e.target.value)} placeholder="Weekend kit" className="w-full rounded-md border bg-card px-3 py-2 text-sm" />
            </label>
            <Button
              className="col-start-4"
              size="sm"
              disabled={!pkgProductId || !pkgCode}
              onClick={() => run(
                () => createPackage.mutateAsync({ productId: pkgProductId, code: pkgCode, name: pkgName || pkgCode }),
                'Package created',
              )}
            >
              Create
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">Rate bands ({rates.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rates.length === 0 && <p className="p-6 text-sm text-muted-foreground">No rates yet.</p>}
            {rates.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{r.productId.slice(0, 8)}… · {r.period}</p>
                  <p className="text-xs text-muted-foreground">min {r.minUnits} unit(s) · {r.maxUnits ? `max ${r.maxUnits}` : 'unlimited'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{fmt(r.price)}</span>
                  <Badge variant="outline" className={r.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'}>{r.isActive ? 'active' : 'inactive'}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">Packages ({packages.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {packages.length === 0 && <p className="p-6 text-sm text-muted-foreground">No packages yet.</p>}
            {packages.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{p.code} — {p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.description ?? '—'} · {p.items.length} item(s)</p>
                </div>
                <Badge variant="outline" className={p.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'}>{p.isActive ? 'active' : 'inactive'}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
