import { useState } from 'react';
import { Phone, PhoneCall as PhoneCallIcon, PhoneIncoming, PhoneOutgoing, Plus, Pencil, Trash2 } from 'lucide-react';
import {
  usePhoneCalls, useCreatePhoneCall, useUpdatePhoneCall, useDeletePhoneCall,
  usePartners, type PhoneCall, type CallDirection, type CallStatus,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, type Column } from '@/components/data-table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notify } from '@/lib/notify';
import { FilterField } from './_components/filter-field';
import { inRange } from './_components/in-range';

const timeOf = (d?: string | null) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const dateOf = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '');

// Combine a date + hour/minute/AM-PM into an ISO string for the server.
function buildTimestamp(date: string, hour: string, minute: string, ampm: string): string | undefined {
  if (!date) return undefined;
  const h = Number(hour);
  const m = Number(minute);
  if (!h || h < 1 || h > 12 || m < 0 || m > 59) return undefined;
  let hh = h % 12;
  if (ampm === 'PM') hh += 12;
  const d = new Date(`${date}T00:00:00`);
  d.setHours(hh, m, 0, 0);
  return d.toISOString();
}
function splitTimestamp(iso?: string) {
  if (!iso) return { date: '', hour: '', minute: '', ampm: 'AM' };
  const d = new Date(iso);
  const date = d.toISOString().slice(0, 10);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { date, hour: String(h), minute: String(d.getMinutes()).padStart(2, '0'), ampm };
}
const hourOptions = Array.from({ length: 12 }, (_, i) => String(i + 1));
const minuteOptions = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

const dirIcon = (d: CallDirection) => d === 'inbound' ? <PhoneIncoming className="h-4 w-4 text-green-600" /> : <PhoneOutgoing className="h-4 w-4 text-blue-600" />;
const statusBadge = (s: CallStatus) => {
  const variants: Record<CallStatus, string> = {
    completed: 'bg-emerald-100 text-emerald-700',
    missed: 'bg-red-100 text-red-700',
    voicemail: 'bg-amber-100 text-amber-700',
    scheduled: 'bg-sky-100 text-sky-700',
    cancelled: 'bg-gray-100 text-gray-600',
  };
  return <span className={`rounded px-2 py-0.5 text-xs ${variants[s]}`}>{s}</span>;
};
const TimeCell = ({ d }: { d?: string | null }) => (
  <div className="leading-tight">
    <div className="font-medium">{timeOf(d)}</div>
    <div className="text-xs text-muted-foreground">{dateOf(d)}</div>
  </div>
);

export function PhoneCallsPage() {
  const partnersQuery = usePartners();
  const partners = partnersQuery.data;
  const partnersList = (partners as { data: { id: string; name: string }[] } | undefined)?.data ?? [];
  const [direction, setDirection] = useState<CallDirection | ''>('');
  const [status, setStatus] = useState<CallStatus | ''>('');
  const [partnerId, setPartnerId] = useState('');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });

  const calls = usePhoneCalls({ direction: direction || undefined, status: status || undefined, partnerId: partnerId || undefined });
  const create = useCreatePhoneCall();
  const update = useUpdatePhoneCall();
  const del = useDeletePhoneCall();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PhoneCall | null>(null);
  const [form, setForm] = useState({
    partnerId: '',
    direction: 'inbound' as CallDirection,
    contactName: '',
    phone: '',
    subject: '',
    outcome: '',
    notes: '',
    durationSec: '',
    status: 'completed' as CallStatus,
    callDate: '',
    callHour: '',
    callMinute: '',
    callAmPm: 'AM' as 'AM' | 'PM',
  });

  const q = search.toLowerCase();
  const filtered = (calls.data ?? []).filter((c) =>
    (c.contactName.toLowerCase().includes(q) ||
      c.phone.includes(search) ||
      (c.subject ?? '').toLowerCase().includes(q) ||
      (c.outcome ?? '').toLowerCase().includes(q)) &&
    inRange(c.callAt, range.from, range.to)
  );
  const hasFilters = Boolean(direction || status || partnerId || search || range.from || range.to);
  const clearFilters = () => { setDirection(''); setStatus(''); setPartnerId(''); setSearch(''); setRange({ from: '', to: '' }); };

  const openNew = () => { resetForm(); setEditing(null); setOpen(true); };
  const resetForm = () => setForm({ partnerId: '', direction: 'inbound', contactName: '', phone: '', subject: '', outcome: '', notes: '', durationSec: '', status: 'completed', callDate: '', callHour: '', callMinute: '', callAmPm: 'AM' });

  const handleSubmit = async () => {
    if (!form.contactName || !form.phone) { notify.error('Contact name and phone required'); return; }
    const callAt = buildTimestamp(form.callDate, form.callHour, form.callMinute, form.callAmPm);
    const dto = {
      partnerId: form.partnerId || undefined,
      direction: form.direction,
      contactName: form.contactName,
      phone: form.phone,
      subject: form.subject || undefined,
      outcome: form.outcome || undefined,
      notes: form.notes || undefined,
      durationSec: form.durationSec ? Number(form.durationSec) : undefined,
      status: form.status,
      callAt,
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...dto });
        notify.success('Call updated');
      } else {
        await create.mutateAsync(dto);
        notify.success('Call logged');
      }
      resetForm(); setEditing(null); setOpen(false);
    } catch { notify.error(editing ? 'Update failed' : 'Create failed'); }
  };

  const edit = (c: PhoneCall) => {
    setEditing(c);
    const ts = splitTimestamp(c.callAt);
    setForm({
      partnerId: c.partnerId ?? '',
      direction: c.direction,
      contactName: c.contactName,
      phone: c.phone,
      subject: c.subject ?? '',
      outcome: c.outcome ?? '',
      notes: c.notes ?? '',
      durationSec: c.durationSec?.toString() ?? '',
      status: c.status,
      callDate: ts.date,
      callHour: ts.hour,
      callMinute: ts.minute,
      callAmPm: ts.ampm as 'AM' | 'PM',
    });
    setOpen(true);
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this call record?')) return;
    try { await del.mutateAsync(id); notify.success('Deleted'); } catch { notify.error('Delete failed'); }
  };

  const dirOptions: { value: CallDirection | ''; label: string }[] = [{ value: '', label: 'All directions' }, { value: 'inbound', label: 'Inbound' }, { value: 'outbound', label: 'Outbound' }];
  const statusOptions: { value: CallStatus | ''; label: string }[] = [{ value: '', label: 'All statuses' }, { value: 'completed', label: 'Completed' }, { value: 'missed', label: 'Missed' }, { value: 'voicemail', label: 'Voicemail' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'cancelled', label: 'Cancelled' }];

  const actionBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 transition hover:shadow-sm disabled:opacity-50';
  const columns: Column<PhoneCall>[] = [
    {
      key: 'direction', header: 'Dir.', className: 'w-16',
      render: (c) => (
        <span title={c.direction} className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${c.direction === 'inbound' ? 'bg-emerald-50' : 'bg-blue-50'}`}>
          {dirIcon(c.direction)}
        </span>
      ),
    },
    {
      key: 'contactName', header: 'Contact', className: 'font-medium',
      render: (c) => <>{c.contactName}{c.partner && <span className="text-muted-foreground ml-1">({c.partner.name})</span>}</>,
    },
    { key: 'phone', header: 'Phone', className: 'font-mono', render: (c) => c.phone },
    { key: 'subject', header: 'Subject', className: 'text-muted-foreground', sortValue: (c) => c.subject ?? null, render: (c) => c.subject ?? '—' },
    { key: 'outcome', header: 'Outcome', className: 'text-muted-foreground', sortValue: (c) => c.outcome ?? null, render: (c) => c.outcome ?? '—' },
    {
      key: 'durationSec', header: 'Duration', className: 'text-muted-foreground', sortValue: (c) => c.durationSec ?? null,
      render: (c) => (c.durationSec ? `${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : '—'),
    },
    { key: 'status', header: 'Status', render: (c) => statusBadge(c.status) },
    { key: 'callAt', header: 'Time', sortValue: (c) => (c.callAt ? new Date(c.callAt).getTime() : null), render: (c) => <TimeCell d={c.callAt} /> },
    {
      key: 'actions', header: 'Actions', className: 'text-right', sortable: false,
      render: (c) => (
        <div className="flex justify-end gap-1.5">
          <a href={`tel:${c.phone}`} title="Call back" aria-label="Call back" className={`${actionBtn} bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100`}>
            <PhoneCallIcon className="h-3.5 w-3.5" />
          </a>
          <button type="button" onClick={() => edit(c)} title="Edit" aria-label="Edit call" className={`${actionBtn} bg-sky-50 text-sky-700 ring-sky-200 hover:bg-sky-100`}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => remove(c.id)} disabled={del.isPending} title="Delete" aria-label="Delete call" className={`${actionBtn} bg-red-50 text-red-600 ring-red-200 hover:bg-red-100`}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Phone className="h-6 w-6" /> Phone Calls</h1>
          <p className="text-sm text-muted-foreground">Log and track inbound/outbound phone calls at the front desk.</p>
        </div>
        <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> Log call</Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <FilterField label="Call time from" wide>
            <Input type="datetime-local" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </FilterField>
          <FilterField label="Call time to" wide>
            <Input type="datetime-local" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </FilterField>
          <FilterField label="Direction">
            <Select value={direction} onValueChange={(v) => setDirection(v as CallDirection | '')}>
              <SelectTrigger><SelectValue placeholder="Direction" /></SelectTrigger>
              <SelectContent>{dirOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Status">
            <Select value={status} onValueChange={(v) => setStatus(v as CallStatus | '')}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>{statusOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Partner">
            <Select value={partnerId} onValueChange={(v) => setPartnerId(v)}>
              <SelectTrigger><SelectValue placeholder="All partners" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All partners</SelectItem>
                {partnersList.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Search" className="min-w-[140px]">
            <Input placeholder="Contact, phone, subject…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </FilterField>
          <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasFilters}>Clear</Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="text-sm">
          <DataTable<PhoneCall>
            columns={columns}
            data={filtered}
            loading={calls.isLoading}
            getRowId={(c) => c.id}
            searchable={false}
            pageSize={25}
            initialSort={{ key: 'callAt', dir: 'desc' }}
            emptyMessage={(calls.data ?? []).length > 0 ? 'No calls match these filters.' : (
              <>No calls logged yet.{' '}<Button variant="ghost" size="sm" onClick={openNew}><Plus className="mr-1 h-3.5 w-3.5" />Log first call</Button></>
            )}
          />
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit call' : 'Log phone call'}</DialogTitle>
            <DialogDescription>Record an inbound or outbound call with details and outcome.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v as CallDirection })}>
              <SelectTrigger><SelectValue placeholder="Direction" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inbound">Inbound</SelectItem>
                <SelectItem value="outbound">Outbound</SelectItem>
              </SelectContent>
            </Select>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Contact name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
              <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <Select value={form.partnerId} onValueChange={(v) => setForm({ ...form, partnerId: v })}>
              <SelectTrigger><SelectValue placeholder="Linked partner (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
{partnersList.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            <Input placeholder="Outcome" value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} />
            <Input placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input type="number" placeholder="Duration (seconds)" value={form.durationSec} onChange={(e) => setForm({ ...form, durationSec: e.target.value })} />
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as CallStatus })}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  {(['completed', 'missed', 'voicemail', 'scheduled', 'cancelled'] as const).map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Call time (optional)</label>
              <div className="flex flex-wrap items-center gap-2">
                <Input type="date" value={form.callDate} onChange={(e) => setForm({ ...form, callDate: e.target.value })} className="w-auto" />
                <Select value={form.callHour} onValueChange={(v) => setForm({ ...form, callHour: v })}>
                  <SelectTrigger className="w-20"><SelectValue placeholder="Hr" /></SelectTrigger>
                  <SelectContent>{hourOptions.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                </Select>
                <span className="text-muted-foreground">:</span>
                <Select value={form.callMinute} onValueChange={(v) => setForm({ ...form, callMinute: v })}>
                  <SelectTrigger className="w-20"><SelectValue placeholder="Min" /></SelectTrigger>
                  <SelectContent>{minuteOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={form.callAmPm} onValueChange={(v) => setForm({ ...form, callAmPm: v as 'AM' | 'PM' })}>
                  <SelectTrigger className="w-20"><SelectValue placeholder="AM/PM" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AM">AM</SelectItem>
                    <SelectItem value="PM">PM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { resetForm(); setEditing(null); setOpen(false); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={create.isPending || update.isPending}>{editing ? 'Save changes' : 'Log call'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}