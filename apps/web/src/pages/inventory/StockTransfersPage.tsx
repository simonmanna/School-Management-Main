import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useTransfers, useCreateTransfer, useApproveTransfer } from '@/features/inventory/transfers-api';

interface Location { id: string; code: string; name: string }
interface Product { id: string; code: string; name: string }

interface TransferLine {
  productId: string;
  productName: string;
  quantity: number;
  distStrategy: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export function StockTransfersPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [fromLocId, setFromLocId] = useState('');
  const [toLocId, setToLocId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<TransferLine[]>([
    { productId: '', productName: '', quantity: 1, distStrategy: 'FEFO' },
  ]);

  const { data: transfers, isLoading } = useTransfers();
  const createTransfer = useCreateTransfer();
  const approveTransfer = useApproveTransfer();

  const products = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await api.get<{ data: Product[] }>('/products?pageSize=200');
      return res.data.data ?? [];
    },
  });

  const locations = useQuery<Location[]>({
    queryKey: ['inventory-locations'],
    queryFn: async () => {
      const res = await api.get<{ data: Location[] }>('/inventory/locations');
      return res.data.data ?? [];
    },
  });

  const locMap = new Map(locations.data?.map((l) => [l.id, l]));

  const pickProduct = (idx: number, productId: string) => {
    const p = products.data?.find((x) => x.id === productId);
    if (!p) return;
    const next = [...lines];
    next[idx] = { ...next[idx], productId, productName: p.name };
    setLines(next);
  };

  const handleSubmit = () => {
    const items = lines
      .filter((l) => l.productId && l.quantity > 0)
      .map((l) => ({
        productId: l.productId,
        qtyRequested: l.quantity,
        distStrategy: l.distStrategy,
      }));
    createTransfer.mutate(
      { fromLocationId: fromLocId, toLocationId: toLocId, items, notes: notes || undefined },
      {
        onSuccess: () => {
          setShowForm(false);
          setFromLocId('');
          setToLocId('');
          setNotes('');
          setLines([{ productId: '', productName: '', quantity: 1, distStrategy: 'FEFO' }]);
          qc.invalidateQueries({ queryKey: ['inventory-product-stock-levels'] });
          qc.invalidateQueries({ queryKey: ['inventory-stats'] });
        },
      },
    );
  };

  const canSubmit = fromLocId && toLocId && fromLocId !== toLocId && lines.some((l) => l.productId && l.quantity > 0) && !createTransfer.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stock Transfers</h1>
          <p className="text-sm text-muted-foreground">Transfer stock between locations</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="mr-2 h-4 w-4" />New Transfer
        </Button>
      </div>

      {isLoading && <Skeleton className="h-48 w-full" />}
      {transfers && transfers.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No transfers yet. Click "New Transfer" to create one.</CardContent></Card>
      )}
      {transfers && transfers.length > 0 && (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">Transfer #</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">From → To</th>
                <th className="px-3 py-2 text-right font-medium">Items</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Notes</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((tr) => {
                const fromLoc = locMap.get(tr.fromLocId);
                const toLoc = locMap.get(tr.toLocId);
                return (
                  <tr key={tr.id} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs font-medium">{tr.transferCode}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dateTime(tr.createdAt)}</td>
                    <td className="px-3 py-2">
                      {fromLoc?.code ?? '—'} → {toLoc?.code ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{tr.items?.length ?? 0}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-2.5 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[tr.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {tr.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-48 truncate text-muted-foreground">{tr.notes ?? '—'}</td>
                    <td className="px-3 py-2">
                      {tr.status === 'pending' && (
                        <Button size="sm" variant="outline" onClick={() => approveTransfer.mutate(tr.id)} disabled={approveTransfer.isPending}>
                          {approveTransfer.isPending ? '…' : 'Approve'}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Stock Transfer</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">From Location</label>
                <Select value={fromLocId} onValueChange={setFromLocId}>
                  <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                  <SelectContent>
                    {locations.data?.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">To Location</label>
                <Select value={toLocId} onValueChange={setToLocId}>
                  <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                  <SelectContent>
                    {locations.data?.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {fromLocId && toLocId && fromLocId === toLocId && (
              <p className="text-sm text-destructive">Source and destination must be different</p>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Items</label>
                <Button size="sm" variant="outline" onClick={() => setLines([...lines, { productId: '', productName: '', quantity: 1, distStrategy: 'FEFO' }])}>
                  <Plus className="mr-1 h-3 w-3" />Add Item
                </Button>
              </div>
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-2 py-1 text-left font-medium">Product</th>
                      <th className="px-2 py-1 text-right font-medium">Quantity</th>
                      <th className="px-2 py-1 font-medium">Strategy</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((ln, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="px-2 py-1">
                          <select
                            className="w-full rounded border bg-background px-1 py-0.5 text-sm"
                            value={ln.productId}
                            onChange={(e) => pickProduct(idx, e.target.value)}
                          >
                            <option value="">Select product…</option>
                            {products.data?.map((p) => (
                              <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            type="number" min="1" className="h-7 w-24 text-right"
                            value={ln.quantity}
                            onChange={(e) => {
                              const next = [...lines];
                              next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                              setLines(next);
                            }}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Select value={ln.distStrategy} onValueChange={(v) => {
                            const next = [...lines];
                            next[idx] = { ...next[idx], distStrategy: v };
                            setLines(next);
                          }}>
                            <SelectTrigger className="h-7 w-24"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="FEFO">FEFO</SelectItem>
                              <SelectItem value="FIFO">FIFO</SelectItem>
                              <SelectItem value="MANUAL">Manual</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Notes</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional transfer notes" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              <Save className="mr-2 h-4 w-4" />{createTransfer.isPending ? 'Creating…' : 'Create Transfer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
