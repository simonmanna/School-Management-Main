import { useState } from 'react';
import { Phone, PhoneIncoming, PhoneOutgoing, Plus, Edit, Trash2 } from 'lucide-react';
import {
  usePhoneCalls, useCreatePhoneCall, useUpdatePhoneCall, useDeletePhoneCall,
  usePartners, type PhoneCall, type CallDirection, type CallStatus,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notify } from '@/lib/notify';

const timeOf = (d?: string | null) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const dateOf = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '');

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
  });

  const filtered = (calls.data ?? []).filter((c) =>
    c.contactName.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search) ||
    c.subject?.toLowerCase().includes(search.toLowerCase()) ||
    c.outcome?.toLowerCase().includes(search.toLowerCase())
  );

  const resetForm = () => setForm({ partnerId: '', direction: 'inbound', contactName: '', phone: '', subject: '', outcome: '', notes: '', durationSec: '', status: 'completed' });

  const handleSubmit = async () => {
    if (!form.contactName || !form.phone) { notify.error('Contact name and phone required'); return; }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...form, durationSec: form.durationSec ? Number(form.durationSec) : undefined });
        notify.success('Call updated');
      } else {
        await create.mutateAsync({ ...form, durationSec: form.durationSec ? Number(form.durationSec) : undefined });
        notify.success('Call logged');
      }
      resetForm(); setEditing(null); setOpen(false);
    } catch { notify.error(editing ? 'Update failed' : 'Create failed'); }
  };

  const edit = (c: PhoneCall) => {
    setEditing(c);
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
    });
    setOpen(true);
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this call record?')) return;
    try { await del.mutateAsync(id); notify.success('Deleted'); } catch { notify.error('Delete failed'); }
  };

  const dirOptions: { value: CallDirection | ''; label: string }[] = [{ value: '', label: 'All directions' }, { value: 'inbound', label: 'Inbound' }, { value: 'outbound', label: 'Outbound' }];
  const statusOptions: { value: CallStatus | ''; label: string }[] = [{ value: '', label: 'All statuses' }, { value: 'completed', label: 'Completed' }, { value: 'missed', label: 'Missed' }, { value: 'voicemail', label: 'Voicemail' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'cancelled', label: 'Cancelled' }];

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Phone className="h-6 w-6" /> Phone Calls</h1>
          <p className="text-sm text-muted-foreground">Log and track inbound/outbound phone calls at the front desk.</p>
        </div>
        <Button onClick={() => { resetForm(); setEditing(null); setOpen(true); }}><Plus className="mr-1 h-4 w-4" /> Log call</Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <Select value={direction} onValueChange={(v) => setDirection(v as CallDirection | '')}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Direction" /></SelectTrigger>
            <SelectContent>{dirOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as CallStatus | '')}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>{statusOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={partnerId} onValueChange={(v) => setPartnerId(v)}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Partner (optional)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
{partnersList.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Search contact, phone, subject…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-72" />
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="text-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Dir.</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="text-center">{dirIcon(c.direction)}</TableCell>
                  <TableCell className="font-medium">{c.contactName}{c.partner && <span className="text-muted-foreground ml-1">({c.partner.name})</span>}</TableCell>
                  <TableCell className="font-mono">{c.phone}</TableCell>
                  <TableCell className="text-muted-foreground">{c.subject ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.outcome ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.durationSec ? `${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : '—'}</TableCell>
                  <TableCell>{statusBadge(c.status)}</TableCell>
                  <TableCell><TimeCell d={c.callAt} /></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => edit(c)}><Edit className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No calls logged yet.{" "}{!calls.isLoading && <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" />Log first call</Button>}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
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
{partnersList.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
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