import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Plus } from 'lucide-react';
import { useRentalAgreements } from '@/features/rental/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { date } from '@/lib/format';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'checked_out', label: 'Checked out' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_approval: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-800',
  checked_out: 'bg-emerald-100 text-emerald-800',
  overdue: 'bg-red-100 text-red-800',
  closed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

export function RentalAgreementsPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { data } = useRentalAgreements({ status: status || undefined, search: search || undefined, pageSize: 50 });

  const rows = useMemo(() => data?.items ?? [], [data]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Rental Agreements</h1>
          <p className="text-sm text-muted-foreground">Quote → hold → agreement → checkout → return lifecycle.</p>
        </div>
        <Link to="/rental/agreements/new">
          <Button><Plus className="h-4 w-4" /> New agreement</Button>
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agreement number…"
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
          <CardTitle className="text-sm">{rows.length} agreements</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No agreements match the filters.</p>}
            {rows.map((a) => (
              <Link key={a.id} to={`/rental/agreements/${a.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{a.agreementNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.startAt ? date(a.startAt) : '—'} → {a.dueAt ? date(a.dueAt) : '—'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{fmt(a.lines?.reduce((s, l) => s + Number(l.lineTotal), 0) ?? 0)}</span>
                  <Badge variant="outline" className={STATUS_STYLES[a.status] ?? ''}>{a.status}</Badge>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
