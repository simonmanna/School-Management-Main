import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Truck, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

interface Match {
  id: string;
  purchaseOrderId: string;
  purchaseOrderLineId: string;
  productId: string | null;
  orderedQuantity: number | string;
  receivedQuantity: number | string;
  billedQuantity: number | string;
  orderedUnitPrice: number | string;
  billedUnitPrice: number | string | null;
  quantityVariance: number | string;
  priceVariance: number | string;
  status: 'pending' | 'matched' | 'partial' | 'mismatch' | 'blocked';
  thresholdExceeded: boolean;
  notes: string | null;
  lastCheckedAt: string;
  order?: { orderNumber: string; partnerId: string };
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  matched: 'default',
  partial: 'secondary',
  pending: 'outline',
  mismatch: 'destructive',
  blocked: 'destructive',
};

export function ThreeWayMatchPage() {
  const [status, setStatus] = useState<string>('all');
  const list = useQuery<Match[]>({
    queryKey: ['three-way-match', status],
    queryFn: async () => (await api.get<Match[]>(`/procurement/three-way-match${status !== 'all' ? `?status=${status}` : ''}`)).data,
    refetchInterval: 60_000,
  });

  const stats = list.data
    ? {
        total: list.data.length,
        matched: list.data.filter((m) => m.status === 'matched').length,
        partial: list.data.filter((m) => m.status === 'partial').length,
        blocked: list.data.filter((m) => m.status === 'blocked').length,
        mismatch: list.data.filter((m) => m.status === 'mismatch').length,
        pending: list.data.filter((m) => m.status === 'pending').length,
      }
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Three-Way Match</h1>
        <p className="text-sm text-muted-foreground">
          Compares PO line quantities/prices against goods receipts and vendor bills. Blocked lines cannot be posted.
        </p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="Total" value={stats.total} icon={Truck} />
          <StatTile label="Matched" value={stats.matched} icon={CheckCircle2} color="text-emerald-600" />
          <StatTile label="Partial" value={stats.partial} icon={RefreshCw} color="text-yellow-600" />
          <StatTile label="Mismatch" value={stats.mismatch} icon={AlertTriangle} color="text-orange-600" />
          <StatTile label="Blocked" value={stats.blocked} icon={AlertTriangle} color="text-destructive" />
        </div>
      )}

      <div className="flex gap-2">
        {['all', 'pending', 'matched', 'partial', 'mismatch', 'blocked'].map((s) => (
          <Button
            key={s}
            variant={status === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatus(s)}
          >
            {s}
          </Button>
        ))}
      </div>

      {list.isLoading && <Skeleton className="h-32 w-full" />}
      {list.data && list.data.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No three-way match entries yet.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-3 py-2">PO</th>
                  <th className="px-3 py-2 text-right">Ordered</th>
                  <th className="px-3 py-2 text-right">Received</th>
                  <th className="px-3 py-2 text-right">Billed</th>
                  <th className="px-3 py-2 text-right">Qty Var</th>
                  <th className="px-3 py-2 text-right">Price Var</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Last Check</th>
                </tr>
              </thead>
              <tbody>
                {list.data?.map((m) => (
                  <tr key={m.id} className="border-b">
                    <td className="px-3 py-2 font-mono text-xs">{m.order?.orderNumber ?? m.purchaseOrderId.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(m.orderedQuantity).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(m.receivedQuantity).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(m.billedQuantity).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(m.quantityVariance).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(m.priceVariance).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS_VARIANT[m.status]}>{m.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(m.lastCheckedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({ label, value, icon: Icon, color = 'text-primary' }: { label: string; value: number; icon: any; color?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className={`h-5 w-5 ${color}`} />
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}
