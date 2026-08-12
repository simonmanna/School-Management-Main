import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Package, Search, AlertTriangle, TrendingDown,
  Boxes, RefreshCw, MapPin, XCircle, Plus, Minus,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { notify } from '@/lib/notify';

interface ProductStockLevel {
  id: string;
  code: string;
  name: string;
  sku: string | null;
  productType: string;
  minQuantity: number | null;
  batchTracking: boolean;
  uom: string | null;
  totalQuantity: number;
  averageCost: number;
  totalValue: number;
  isLow: boolean;
  isOut: boolean;
}

interface Stats { totalItems: number; lowStockCount: number; totalLocations: number; totalProducts: number }
interface Location { id: string; code: string; name: string; type: string }

const PRODUCT_TYPE_LABELS: Record<string, string> = {
  stockable: 'Stockable',
  consumable: 'Consumable',
  service: 'Service',
  fee: 'Fee',
  subscription: 'Subscription',
  asset: 'Asset',
};

export function InventoryItemsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('all');
  const [view, setView] = useState<'all' | 'low' | 'out'>('all');
  const debouncedSearch = useDebouncedValue(search, 350);

  const stats = useQuery<Stats>({
    queryKey: ['inventory-stats'],
    queryFn: async () => (await api.get<Stats>('/inventory/stats')).data,
    refetchInterval: 30_000,
  });

  const locations = useQuery<Location[]>({
    queryKey: ['inventory-locations'],
    queryFn: async () => {
      const res = await api.get<{ data: Location[] }>('/inventory/locations');
      return res.data.data ?? [];
    },
  });

  const params = new URLSearchParams();
  if (debouncedSearch) params.set('search', debouncedSearch);
  if (locationId && locationId !== 'all') params.set('locationId', locationId);
  if (view === 'low') params.set('lowStock', 'true');
  if (view === 'out') params.set('outOfStock', 'true');

  const items = useQuery<{ data: ProductStockLevel[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>({
    queryKey: ['inventory-product-stock-levels', debouncedSearch, locationId, view],
    queryFn: async () => (await api.get(`/inventory/product-stock-levels?${params.toString()}`)).data,
  });

  const products = useQuery<{ data: { id: string; code: string; name: string }[] }>({
    queryKey: ['products-simple'],
    queryFn: async () => (await api.get('/products?pageSize=200')).data,
  });

  const qc = useQueryClient();

  // — Direct Stock In state
  const [inOpen, setInOpen] = useState(false);
  const [inLocId, setInLocId] = useState('');
  const [inNotes, setInNotes] = useState('');
  const [inLines, setInLines] = useState<{ productId: string; name: string; quantity: number; unitCost: string; batchNumber: string; expiryDate: string }[]>([
    { productId: '', name: '', quantity: 1, unitCost: '', batchNumber: '', expiryDate: '' },
  ]);

  const directIn = useMutation({
    mutationFn: async () => {
      const items = inLines
        .filter((l) => l.productId && l.quantity > 0)
        .map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          ...(l.unitCost ? { unitCost: Number(l.unitCost) } : {}),
          ...(l.batchNumber ? { batchNumber: l.batchNumber } : {}),
          ...(l.expiryDate ? { expiryDate: l.expiryDate } : {}),
        }));
      const res = await api.post('/inventory/direct-stock/in', { locationId: inLocId, items, notes: inNotes || undefined });
      return res.data;
    },
    onSuccess: (data: any) => {
      notify.success(`Stock in ${data.code} completed`);
      setInOpen(false);
      setInLocId('');
      setInNotes('');
      setInLines([{ productId: '', name: '', quantity: 1, unitCost: '', batchNumber: '', expiryDate: '' }]);
      qc.invalidateQueries({ queryKey: ['inventory-product-stock-levels'] });
      qc.invalidateQueries({ queryKey: ['inventory-stats'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Stock in failed'),
  });

  // — Direct Stock Out state
  const [outOpen, setOutOpen] = useState(false);
  const [outLocId, setOutLocId] = useState('');
  const [outNotes, setOutNotes] = useState('');
  const [outLines, setOutLines] = useState<{ productId: string; name: string; quantity: number; distStrategy: string; batchNumber: string }[]>([
    { productId: '', name: '', quantity: 1, distStrategy: 'FEFO', batchNumber: '' },
  ]);

  const directOut = useMutation({
    mutationFn: async () => {
      const items = outLines
        .filter((l) => l.productId && l.quantity > 0)
        .map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          distStrategy: l.distStrategy,
          ...(l.batchNumber ? { batchNumber: l.batchNumber } : {}),
        }));
      const res = await api.post('/inventory/direct-stock/out', { locationId: outLocId, items, notes: outNotes || undefined });
      return res.data;
    },
    onSuccess: (data: any) => {
      notify.success(`Stock out ${data.code} completed`);
      setOutOpen(false);
      setOutLocId('');
      setOutNotes('');
      setOutLines([{ productId: '', name: '', quantity: 1, distStrategy: 'FEFO', batchNumber: '' }]);
      qc.invalidateQueries({ queryKey: ['inventory-product-stock-levels'] });
      qc.invalidateQueries({ queryKey: ['inventory-stats'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Stock out failed'),
  });

  const pickInProduct = (idx: number, productId: string) => {
    const p = products.data?.data?.find((x) => x.id === productId);
    if (!p) return;
    const next = [...inLines];
    next[idx] = { ...next[idx], productId, name: p.name };
    setInLines(next);
  };

  const pickOutProduct = (idx: number, productId: string) => {
    const p = products.data?.data?.find((x) => x.id === productId);
    if (!p) return;
    const next = [...outLines];
    next[idx] = { ...next[idx], productId, name: p.name };
    setOutLines(next);
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Stock Levels</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setInOpen(true)}>
              <Plus className="mr-1 h-3 w-3" />Direct Stock In
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setOutOpen(true)}>
              <Minus className="mr-1 h-3 w-3" />Direct Stock Out
            </Button>
            <Button variant="outline" size="sm" onClick={() => items.refetch()}>
              <RefreshCw className="mr-2 h-3 w-3" />Refresh
            </Button>
          </div>
        </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Card className="p-2">
          <CardContent className="flex items-center gap-2 p-0">
            <Package className="h-4 w-4 text-sky-600 shrink-0" />
            <div className="flex w-full items-center justify-between gap-1">
              <span className="text-xs text-muted-foreground">Total Products</span>
              <span className="text-sm font-bold text-sky-600">{stats.data?.totalProducts ?? '—'}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="p-2">
          <CardContent className="flex items-center gap-2 p-0">
            <Boxes className="h-4 w-4 text-emerald-600 shrink-0" />
            <div className="flex w-full items-center justify-between gap-1">
              <span className="text-xs text-muted-foreground">In Stock</span>
              <span className="text-sm font-bold text-emerald-600">{stats.data?.totalItems ?? '—'}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="p-2">
          <CardContent className="flex items-center gap-2 p-0">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <div className="flex w-full items-center justify-between gap-1">
              <span className="text-xs text-muted-foreground">Low Stock</span>
              <span className="text-sm font-bold text-amber-600">{stats.data?.lowStockCount ?? '—'}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="p-2">
          <CardContent className="flex items-center gap-2 p-0">
            <MapPin className="h-4 w-4 text-indigo-600 shrink-0" />
            <div className="flex w-full items-center justify-between gap-1">
              <span className="text-xs text-muted-foreground">Locations</span>
              <span className="text-sm font-bold text-indigo-600">{stats.data?.totalLocations ?? '—'}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8" placeholder="Search products…"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={locationId} onValueChange={setLocationId}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All locations" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.data?.map((l) => (
              <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          <Button size="sm" variant={view === 'all' ? 'default' : 'outline'} onClick={() => setView('all')}>All</Button>
          <Button size="sm" variant={view === 'low' ? 'default' : 'outline'} onClick={() => setView('low')}>
            <TrendingDown className="mr-1 h-3 w-3" />Low Stock
          </Button>
          <Button size="sm" variant={view === 'out' ? 'default' : 'outline'} onClick={() => setView('out')}>
            <XCircle className="mr-1 h-3 w-3" />Out of Stock
          </Button>
        </div>
      </div>

      {items.isLoading && <Skeleton className="h-64 w-full" />}

      {items.data && (
        <>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-left font-medium">Code</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">On Hand</th>
                  <th className="px-3 py-2 text-right font-medium">Min Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Avg Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Total Value</th>
                  <th className="px-3 py-2 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.data.data.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No products found</td></tr>
                )}
                {items.data.data.map((item) => {
                  const value = item.averageCost * item.totalQuantity;
                  return (
                    <tr key={item.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/inventory/items/${item.id}`)}>
                      <td className="px-3 py-2 font-medium hover:text-primary hover:underline">{item.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.code}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-xs">{PRODUCT_TYPE_LABELS[item.productType] ?? item.productType}</Badge>
                      </td>
                      <td className={`px-3 py-2 text-right font-mono tabular-nums ${item.isOut ? 'text-destructive' : item.isLow ? 'text-amber-600' : ''}`}>
                        {item.totalQuantity}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {item.minQuantity ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatMoney(item.averageCost)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {formatMoney(value)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.isOut ? (
                          <Badge variant="destructive">Out of stock</Badge>
                        ) : item.isLow ? (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-800">Low stock</Badge>
                        ) : (
                          <Badge variant="default" className="bg-emerald-100 text-emerald-800">In stock</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{items.data.meta.total} product(s)</span>
            <span>Page {items.data.meta.page} of {items.data.meta.totalPages}</span>
          </div>
        </>
      )}
    </div>

    {/* Direct Stock In Dialog */}
    <Dialog open={inOpen} onOpenChange={setInOpen}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Direct Stock In</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <Select value={inLocId} onValueChange={setInLocId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Select location…" /></SelectTrigger>
              <SelectContent>
                {locations.data?.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-1 font-medium">Product</th>
                <th className="pb-1 font-medium text-right">Qty</th>
                <th className="pb-1 font-medium text-right">Unit Cost</th>
                <th className="pb-1 font-medium">Batch #</th>
                <th className="pb-1 font-medium">Expiry</th>
                <th className="pb-1 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {inLines.map((line, idx) => (
                <tr key={idx}>
                  <td className="py-1 pr-1">
                    <Select value={line.productId} onValueChange={(v) => pickInProduct(idx, v)}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {products.data?.data?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1 px-1">
                    <Input type="number" min={1} className="w-20 text-right" value={line.quantity} onChange={(e) => {
                      const next = [...inLines]; next[idx] = { ...next[idx], quantity: Number(e.target.value) }; setInLines(next);
                    }} />
                  </td>
                  <td className="py-1 px-1">
                    <Input type="number" step="0.01" min={0} className="w-24 text-right" placeholder="Cost" value={line.unitCost} onChange={(e) => {
                      const next = [...inLines]; next[idx] = { ...next[idx], unitCost: e.target.value }; setInLines(next);
                    }} />
                  </td>
                  <td className="py-1 px-1">
                    <Input className="w-28" placeholder="Batch #" value={line.batchNumber} onChange={(e) => {
                      const next = [...inLines]; next[idx] = { ...next[idx], batchNumber: e.target.value }; setInLines(next);
                    }} />
                  </td>
                  <td className="py-1 px-1">
                    <Input type="date" className="w-32" value={line.expiryDate} onChange={(e) => {
                      const next = [...inLines]; next[idx] = { ...next[idx], expiryDate: e.target.value }; setInLines(next);
                    }} />
                  </td>
                  <td className="py-1 pl-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={inLines.length <= 1} onClick={() => setInLines((s) => s.filter((_, i) => i !== idx))}>
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Button variant="outline" size="sm" onClick={() => setInLines((s) => [...s, { productId: '', name: '', quantity: 1, unitCost: '', batchNumber: '', expiryDate: '' }])}>
            <Plus className="mr-1 h-3 w-3" />Add Item
          </Button>

          <Input placeholder="Notes (optional)" value={inNotes} onChange={(e) => setInNotes(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setInOpen(false)}>Cancel</Button>
          <Button disabled={!inLocId || inLines.every((l) => !l.productId) || directIn.isPending} onClick={() => directIn.mutate()}>
            {directIn.isPending ? 'Processing…' : 'Complete Stock In'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Direct Stock Out Dialog */}
    <Dialog open={outOpen} onOpenChange={setOutOpen}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Direct Stock Out</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <Select value={outLocId} onValueChange={setOutLocId}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Select location…" /></SelectTrigger>
              <SelectContent>
                {locations.data?.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-1 font-medium">Product</th>
                <th className="pb-1 font-medium text-right">Qty</th>
                <th className="pb-1 font-medium">Strategy</th>
                <th className="pb-1 font-medium">Batch #</th>
                <th className="pb-1 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {outLines.map((line, idx) => (
                <tr key={idx}>
                  <td className="py-1 pr-1">
                    <Select value={line.productId} onValueChange={(v) => pickOutProduct(idx, v)}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {products.data?.data?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1 px-1">
                    <Input type="number" min={1} className="w-20 text-right" value={line.quantity} onChange={(e) => {
                      const next = [...outLines]; next[idx] = { ...next[idx], quantity: Number(e.target.value) }; setOutLines(next);
                    }} />
                  </td>
                  <td className="py-1 px-1">
                    <Select value={line.distStrategy} onValueChange={(v) => {
                      const next = [...outLines]; next[idx] = { ...next[idx], distStrategy: v, batchNumber: v !== 'MANUAL' ? '' : next[idx].batchNumber }; setOutLines(next);
                    }}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FEFO">FEFO</SelectItem>
                        <SelectItem value="FIFO">FIFO</SelectItem>
                        <SelectItem value="MANUAL">Manual</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1 px-1">
                    <Input className="w-28" placeholder={line.distStrategy === 'MANUAL' ? 'Required' : 'Optional'} value={line.batchNumber} onChange={(e) => {
                      const next = [...outLines]; next[idx] = { ...next[idx], batchNumber: e.target.value }; setOutLines(next);
                    }} />
                  </td>
                  <td className="py-1 pl-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={outLines.length <= 1} onClick={() => setOutLines((s) => s.filter((_, i) => i !== idx))}>
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Button variant="outline" size="sm" onClick={() => setOutLines((s) => [...s, { productId: '', name: '', quantity: 1, distStrategy: 'FEFO', batchNumber: '' }])}>
            <Plus className="mr-1 h-3 w-3" />Add Item
          </Button>

          <Input placeholder="Notes (optional)" value={outNotes} onChange={(e) => setOutNotes(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOutOpen(false)}>Cancel</Button>
          <Button disabled={!outLocId || outLines.every((l) => !l.productId) || directOut.isPending} onClick={() => directOut.mutate()}>
            {directOut.isPending ? 'Processing…' : 'Complete Stock Out'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
  );
}
