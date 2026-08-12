import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { formatMoney, dateTime } from '@/lib/format';

interface LedgerEntry {
  id: string;
  ledgerCode: string;
  productId: string;
  type: string;
  qtyBefore: number;
  quantityChange: number;
  balanceAfter: number;
  unitCost: number;
  totalValue: number;
  referenceType: string | null;
  referenceId: string | null;
  notes: string | null;
  performedBy: string | null;
  createdAt: string;
  product: { id: string; code: string; name: string };
  variant: { id: string; name: string } | null;
  location: { id: string; code: string; name: string };
  batch: { id: string; batchNumber: string; expiryDate: string } | null;
}

interface LedgerMeta { page: number; pageSize: number; total: number; totalPages: number }

const MOVE_TYPE_LABELS: Record<string, string> = {
  receipt: 'Receipt',
  issue: 'Issue',
  adjustment_in: 'Adj In',
  adjustment_out: 'Adj Out',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
  opening_balance: 'Opening Bal',
  waste: 'Waste',
  return_in: 'Return In',
  return_to_supplier: 'Rtn to Supplier',
  expiry_write_off: 'Expiry Write-Off',
};

function MoveBadge({ type }: { type: string }) {
  const isIn = type.includes('in') || type === 'receipt' || type === 'opening_balance' || type === 'return_in';
  return (
    <Badge variant={isIn ? 'default' : 'destructive'} className={isIn ? 'bg-emerald-100 text-emerald-800' : undefined}>
      {MOVE_TYPE_LABELS[type] ?? type}
    </Badge>
  );
}

export function StockLedgerPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [productSearch, setProductSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [refTypeFilter, setRefTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const locations = useQuery<{ id: string; code: string; name: string }[]>({
    queryKey: ['inventory-locations'],
    queryFn: async () => (await api.get<{ data: { id: string; code: string; name: string }[] }>('/inventory/locations')).data.data ?? [],
  });

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', '25');
  if (productSearch) params.set('productId', productSearch);
  if (locationId) params.set('locationId', locationId);
  if (typeFilter) params.set('type', typeFilter);
  if (refTypeFilter) params.set('referenceType', refTypeFilter);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  const ledger = useQuery<{ data: LedgerEntry[]; meta: LedgerMeta }>({
    queryKey: ['inventory-ledger', page, productSearch, locationId, typeFilter, refTypeFilter, dateFrom, dateTo],
    queryFn: async () => (await api.get(`/inventory/ledger?${params.toString()}`)).data,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Stock Ledger</h1>
        <Button variant="outline" size="sm" onClick={() => ledger.refetch()}>
          <RefreshCw className="mr-2 h-3 w-3" />Refresh
        </Button>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[160px]">
            <label className="mb-1 block text-xs text-muted-foreground">Product ID</label>
            <Input placeholder="Filter by product ID…" value={productSearch} onChange={(e) => { setProductSearch(e.target.value); setPage(1); }} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Location</label>
            <Select value={locationId} onValueChange={(v) => { setLocationId(v); setPage(1); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All locations</SelectItem>
                {locations.data?.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Type</label>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All types</SelectItem>
                {Object.entries(MOVE_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Reference</label>
            <Select value={refTypeFilter} onValueChange={(v) => { setRefTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All references</SelectItem>
                <SelectItem value="direct_stock_in">Direct Stock In</SelectItem>
                <SelectItem value="direct_stock_out">Direct Stock Out</SelectItem>
                <SelectItem value="stock_out">Stock Out</SelectItem>
                <SelectItem value="waste">Waste</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">From</label>
            <Input type="date" className="w-36" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">To</label>
            <Input type="date" className="w-36" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </div>
        </div>
      </Card>

      {ledger.isLoading && <Skeleton className="h-64 w-full" />}

      {ledger.data && (
        <>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Date</th>
                  <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Code</th>
                  <th className="px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-left font-medium">Location</th>
                  <th className="px-3 py-2 text-center font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Qty Before</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Change</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Qty After</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Unit Cost</th>
                  <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Total Value</th>
                  <th className="px-3 py-2 text-left font-medium">Reference</th>
                  <th className="px-3 py-2 text-left font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.data.length === 0 && (
                  <tr><td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">No ledger entries found</td></tr>
                )}
                {ledger.data.data.map((entry) => (
                  <tr key={entry.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/inventory/items/${entry.productId}`)}>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap text-xs">{dateTime(entry.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{entry.ledgerCode}</td>
                    <td className="px-3 py-2 font-medium hover:text-primary hover:underline whitespace-nowrap">
                      {entry.product.name}
                      {entry.variant && <span className="text-muted-foreground"> · {entry.variant.name}</span>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{entry.location.code}</td>
                    <td className="px-3 py-2 text-center"><MoveBadge type={entry.type} /></td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{entry.qtyBefore}</td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums ${entry.quantityChange > 0 ? 'text-emerald-600' : entry.quantityChange < 0 ? 'text-destructive' : ''}`}>
                      {entry.quantityChange > 0 ? '+' : ''}{entry.quantityChange}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{entry.balanceAfter}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(entry.unitCost)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(entry.totalValue)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {entry.referenceType && entry.referenceId
                        ? <span className="font-mono">{entry.referenceType.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}<br/>{entry.referenceId}</span>
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[120px] truncate">{entry.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{ledger.data.meta.total} entry(ies)</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span>Page {ledger.data.meta.page} of {ledger.data.meta.totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= ledger.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
