import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Wrench } from 'lucide-react';
import { useRepairOrders } from '@/features/repair/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { date } from '@/lib/format';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'received', label: 'Received' },
  { value: 'diagnosis', label: 'Diagnosis' },
  { value: 'waiting_approval', label: 'Waiting approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'repairing', label: 'Repairing' },
  { value: 'testing', label: 'Testing' },
  { value: 'ready_pickup', label: 'Ready for pickup' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_STYLES: Record<string, string> = {
  received: 'bg-blue-100 text-blue-800',
  diagnosis: 'bg-violet-100 text-violet-800',
  waiting_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-cyan-100 text-cyan-800',
  repairing: 'bg-emerald-100 text-emerald-800',
  testing: 'bg-teal-100 text-teal-800',
  ready_pickup: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-sky-100 text-sky-800',
  closed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

export function RepairOrdersPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { data } = useRepairOrders({ status: status || undefined, search: search || undefined, pageSize: 50 });

  const rows = useMemo(() => data?.items ?? [], [data]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Repair Orders</h1>
          <p className="text-sm text-muted-foreground">Receive → diagnose → quote → repair → test → deliver → close.</p>
        </div>
        <Link to="/repair/orders/new">
          <Button><Plus className="h-4 w-4" /> New repair order</Button>
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search repair number, serial, IMEI…"
          className="w-64 rounded-md border bg-card px-3 py-2 text-sm"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} repair orders</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No repair orders match the filters.</p>}
            {rows.map((o: any) => (
              <Link key={o.id} to={`/repair/orders/${o.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{o.repairNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.itemType ?? 'Item'} {o.brand && o.model ? `· ${o.brand} ${o.model}` : o.brand ? `· ${o.brand}` : ''} · {o.partner?.name ?? 'Walk-in'}
                      {o.serialNumber ? ` · SN ${o.serialNumber}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {o.dueDate && <span className="hidden text-xs text-muted-foreground md:inline">{date(o.dueDate)}</span>}
                  <span className="text-sm font-medium">{fmt(o.totalAmount)}</span>
                  <Badge variant="outline" className={STATUS_STYLES[o.status] ?? ''}>{o.status.replace(/_/g, ' ')}</Badge>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
