import { useState } from 'react';
import { DoorOpen, LogOut, Plus } from 'lucide-react';
import { notify } from '@/lib/notify';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, type Column } from '@/components/data-table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useFrontDeskLogs, useCreateFrontDeskLog, useCheckoutFrontDeskLog,
  usePartners, type FrontDeskLog,
} from '@/features/school/api';
import { FilterField } from './_components/filter-field';
import { inRange } from './_components/in-range';

const timeOf = (d?: string | null) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const dateOf = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '');
const dur = (a?: string | null, b?: string | null) => {
  if (!a || !b) return '';
  const m = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
const TimeCell = ({ d }: { d?: string | null }) => (
  <div className="leading-tight">
    <div className="font-medium">{timeOf(d)}</div>
    <div className="text-xs text-muted-foreground">{dateOf(d)}</div>
  </div>
);
const statusBadge = (s: string) => (
  <span className={`rounded px-2 py-0.5 text-xs ${s === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
    {s === 'in' ? 'on site' : 'checked out'}
  </span>
);

const emptyRange = { inFrom: '', inTo: '', outFrom: '', outTo: '' };

const emptyForm = { partnerId: '', visitorName: '', phone: '', purpose: '', personVisited: '', notes: '' };

export function FrontDeskPage() {
  const partners = usePartners();
  const partnersList = (partners.data as { data: { id: string; name: string }[] } | undefined)?.data ?? [];
  const [status, setStatus] = useState<'' | 'in' | 'out'>('');
  const [search, setSearch] = useState('');

  const logs = useFrontDeskLogs(status || undefined);
  const create = useCreateFrontDeskLog();
  const checkout = useCheckoutFrontDeskLog();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const [range, setRange] = useState(emptyRange);
  const hasRange = Object.values(range).some(Boolean);

  const q = search.toLowerCase();
  const filtered = (logs.data ?? []).filter((l) =>
    (l.visitorName.toLowerCase().includes(q) ||
      (l.phone ?? '').includes(search) ||
      (l.purpose ?? '').toLowerCase().includes(q) ||
      (l.personVisited ?? '').toLowerCase().includes(q)) &&
    inRange(l.checkInAt, range.inFrom, range.inTo) &&
    inRange(l.checkOutAt, range.outFrom, range.outTo)
  );
  const onSite = (logs.data ?? []).filter((l) => l.status === 'in').length;

  const openNew = () => { setForm(emptyForm); setOpen(true); };

  const handleSubmit = async () => {
    if (!form.visitorName) { notify.error('Visitor name required'); return; }
    try {
      await create.mutateAsync({
        partnerId: form.partnerId || undefined,
        visitorName: form.visitorName,
        phone: form.phone || undefined,
        purpose: form.purpose || undefined,
        personVisited: form.personVisited || undefined,
        notes: form.notes || undefined,
      });
      notify.success('Visitor checked in');
      setForm(emptyForm); setOpen(false);
    } catch { notify.error('Check-in failed'); }
  };

  const checkOut = async (id: string) => {
    try { await checkout.mutateAsync({ id }); notify.success('Visitor checked out'); } catch { notify.error('Check-out failed'); }
  };

  const columns: Column<FrontDeskLog>[] = [
    {
      key: 'visitorName', header: 'Visitor', className: 'font-medium',
      render: (l) => <>{l.visitorName}{l.partner && <span className="text-muted-foreground ml-1">({l.partner.name})</span>}</>,
    },
    { key: 'phone', header: 'Phone', className: 'font-mono', render: (l) => l.phone ?? '—' },
    { key: 'purpose', header: 'Purpose', className: 'text-muted-foreground', sortValue: (l) => l.purpose ?? null, render: (l) => l.purpose ?? '—' },
    { key: 'personVisited', header: 'Host', className: 'text-muted-foreground', sortValue: (l) => l.personVisited ?? null, render: (l) => l.personVisited ?? '—' },
    { key: 'checkInAt', header: 'Check-in', sortValue: (l) => (l.checkInAt ? new Date(l.checkInAt).getTime() : null), render: (l) => <TimeCell d={l.checkInAt} /> },
    {
      key: 'checkOutAt', header: 'Check-out', sortValue: (l) => (l.checkOutAt ? new Date(l.checkOutAt).getTime() : null),
      render: (l) => (
        <>
          {l.checkOutAt ? <TimeCell d={l.checkOutAt} /> : <span className="text-muted-foreground">—</span>}
          {l.checkOutAt && <div className="text-xs text-sky-600">{dur(l.checkInAt, l.checkOutAt)}</div>}
        </>
      ),
    },
    { key: 'status', header: 'Status', render: (l) => statusBadge(l.status) },
    {
      key: 'actions', header: 'Actions', className: 'text-right', sortable: false,
      render: (l) => l.status === 'in' && (
        <Button size="sm" variant="outline" onClick={() => checkOut(l.id)} disabled={checkout.isPending}>
          <LogOut className="mr-1 h-3.5 w-3.5" />Check out
        </Button>
      ),
    },
  ];

  const statusOptions: { value: '' | 'in' | 'out'; label: string }[] = [
    { value: '', label: 'All statuses' }, { value: 'in', label: 'On site' }, { value: 'out', label: 'Checked out' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><DoorOpen className="h-6 w-6" /> Front Desk</h1>
          <p className="text-sm text-muted-foreground">Log visitors and walk-ins, and check them out on departure.</p>
        </div>
        <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> New visitor</Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <FilterField label="Status">
            <Select value={status} onValueChange={(v) => setStatus(v as '' | 'in' | 'out')}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>{statusOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Search" className="min-w-[140px]">
            <Input placeholder="Visitor, phone, purpose, host…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </FilterField>
          <FilterField label="Check-in from" wide>
            <Input type="datetime-local" value={range.inFrom} onChange={(e) => setRange({ ...range, inFrom: e.target.value })} />
          </FilterField>
          <FilterField label="Check-in to" wide>
            <Input type="datetime-local" value={range.inTo} onChange={(e) => setRange({ ...range, inTo: e.target.value })} />
          </FilterField>
          <FilterField label="Check-out from" wide>
            <Input type="datetime-local" value={range.outFrom} onChange={(e) => setRange({ ...range, outFrom: e.target.value })} />
          </FilterField>
          <FilterField label="Check-out to" wide>
            <Input type="datetime-local" value={range.outTo} onChange={(e) => setRange({ ...range, outTo: e.target.value })} />
          </FilterField>
          <div className="flex flex-col items-end gap-1">
            <span className="whitespace-nowrap text-xs text-muted-foreground">{onSite} on site</span>
            <Button variant="ghost" size="sm" onClick={() => setRange(emptyRange)} disabled={!hasRange}>Clear times</Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="text-sm">
          <DataTable<FrontDeskLog>
            columns={columns}
            data={filtered}
            loading={logs.isLoading}
            getRowId={(l) => l.id}
            searchable={false}
            pageSize={25}
            initialSort={{ key: 'checkInAt', dir: 'desc' }}
            emptyMessage={(logs.data ?? []).length > 0 ? 'No visitors match these filters.' : (
              <>No visitors logged yet.{' '}<Button variant="ghost" size="sm" onClick={openNew}><Plus className="mr-1 h-3.5 w-3.5" />Check in first visitor</Button></>
            )}
          />
        </CardContent>
      </Card>

      {/* New visitor dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New visitor</DialogTitle>
            <DialogDescription>Check in a visitor or walk-in. Check-in time is recorded now.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Select value={form.partnerId} onValueChange={(v) => setForm({ ...form, partnerId: v })}>
              <SelectTrigger><SelectValue placeholder="Existing visitor (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {partnersList.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Visitor name" value={form.visitorName} onChange={(e) => setForm({ ...form, visitorName: e.target.value })} />
              <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <Input placeholder="Purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
            <Input placeholder="Person visited" value={form.personVisited} onChange={(e) => setForm({ ...form, personVisited: e.target.value })} />
            <Input placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setForm(emptyForm); setOpen(false); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={create.isPending}><DoorOpen className="mr-1 h-4 w-4" />Check in</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
