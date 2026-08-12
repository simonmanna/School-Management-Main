import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { useRepairJobs } from '@/features/repair/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { date } from '@/lib/format';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'testing', label: 'Testing' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-emerald-100 text-emerald-800',
  testing: 'bg-amber-100 text-amber-800',
  completed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

export function RepairJobsPage() {
  const [status, setStatus] = useState('');
  const { data } = useRepairJobs({ status: status || undefined, pageSize: 50 });
  const rows = useMemo(() => data?.items ?? [], [data]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Work Orders</h1>
          <p className="text-sm text-muted-foreground">Workshop jobs across all repair orders.</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} work orders</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No work orders match the filter.</p>}
            {rows.map((j: any) => (
              <Link key={j.id} to={`/repair/orders/${j.repairOrderId}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{j.jobNumber} · {j.order?.repairNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.technician?.name ?? 'Unassigned'}
                      {j.deadline ? ` · due ${date(j.deadline)}` : ''}
                      {j.actualHours != null ? ` · ${j.actualHours} h` : j.estimatedHours != null ? ` · est ${j.estimatedHours} h` : ''}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className={STATUS_STYLES[j.status] ?? ''}>{j.status.replace(/_/g, ' ')}</Badge>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
