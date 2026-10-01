import { useState } from 'react';
import { AlertTriangle, Plus, Edit, Trash2 } from 'lucide-react';
import {
  useComplaints, useCreateComplaint, useUpdateComplaint, useDeleteComplaint,
  usePartners, type Complaint, type ComplaintCategory, type ComplaintStatus, type ComplaintPriority,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
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

const categoryIcon = (c: ComplaintCategory) => {
  const icons: Record<ComplaintCategory, string> = {
    academic: '📚', behavior: '⚠️', facilities: '🏢', staff_conduct: '👤',
    communication: '💬', fees: '💰', transport: '🚌', meals: '🍽️', safety: '🛡️', other: '📋',
  };
  return icons[c] ?? '📋';
};
const categoryLabel = (c: ComplaintCategory) => c.charAt(0).toUpperCase() + c.slice(1).replace('_', ' ');
const statusBadge = (s: ComplaintStatus) => {
  const variants: Record<ComplaintStatus, string> = {
    open: 'bg-red-100 text-red-700',
    in_progress: 'bg-blue-100 text-blue-700',
    awaiting_response: 'bg-amber-100 text-amber-700',
    resolved: 'bg-emerald-100 text-emerald-700',
    closed: 'bg-gray-100 text-gray-600',
    escalated: 'bg-purple-100 text-purple-700',
  };
  return <span className={`rounded px-2 py-0.5 text-xs ${variants[s]}`}>{s.replace('_', ' ')}</span>;
};
const priorityBadge = (p: ComplaintPriority) => {
  const variants: Record<ComplaintPriority, string> = {
    low: 'bg-gray-100 text-gray-700',
    medium: 'bg-sky-100 text-sky-700',
    high: 'bg-orange-100 text-orange-700',
    urgent: 'bg-red-100 text-red-700',
  };
  return <span className={`rounded px-2 py-0.5 text-xs ${variants[p]}`}>{p}</span>;
};
const TimeCell = ({ d }: { d?: string | null }) => (
  <div className="leading-tight">
    <div className="font-medium">{timeOf(d)}</div>
    <div className="text-xs text-muted-foreground">{dateOf(d)}</div>
  </div>
);

export function ComplaintsPage() {
  const { data: partners } = usePartners();
  const partnersList = (partners as { data: { id: string; name: string }[] } | undefined)?.data ?? [];
  const [category, setCategory] = useState<ComplaintCategory | ''>('');
  const [status, setStatus] = useState<ComplaintStatus | ''>('');
  const [priority, setPriority] = useState<ComplaintPriority | ''>('');
  const [partnerId, setPartnerId] = useState('');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });

  const complaints = useComplaints({ category: category || undefined, status: status || undefined, priority: priority || undefined, partnerId: partnerId || undefined });
  const create = useCreateComplaint();
  const update = useUpdateComplaint();
  const del = useDeleteComplaint();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Complaint | null>(null);
  const [form, setForm] = useState({
    partnerId: '',
    category: 'other' as ComplaintCategory,
    subject: '',
    description: '',
    status: 'open' as ComplaintStatus,
    priority: 'medium' as ComplaintPriority,
    assignedToId: '',
    resolution: '',
    receivedDate: '',
    receivedHour: '',
    receivedMinute: '',
    receivedAmPm: 'AM' as 'AM' | 'PM',
  });

  const q = search.toLowerCase();
  const filtered = (complaints.data ?? []).filter((c) =>
    (c.subject.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      (c.resolution ?? '').toLowerCase().includes(q)) &&
    inRange(c.receivedAt, range.from, range.to)
  );
  const hasFilters = Boolean(category || status || priority || partnerId || search || range.from || range.to);
  const clearFilters = () => { setCategory(''); setStatus(''); setPriority(''); setPartnerId(''); setSearch(''); setRange({ from: '', to: '' }); };

  const resetForm = () => setForm({ partnerId: '', category: 'other', subject: '', description: '', status: 'open', priority: 'medium', assignedToId: '', resolution: '', receivedDate: '', receivedHour: '', receivedMinute: '', receivedAmPm: 'AM' });

  const handleSubmit = async () => {
    if (!form.subject || !form.description) { notify.error('Subject and description required'); return; }
    const receivedAt = buildTimestamp(form.receivedDate, form.receivedHour, form.receivedMinute, form.receivedAmPm);
    const dto = {
      partnerId: form.partnerId || undefined,
      category: form.category,
      subject: form.subject,
      description: form.description,
      status: form.status,
      priority: form.priority,
      assignedToId: form.assignedToId || undefined,
      resolution: form.resolution || undefined,
      receivedAt,
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...dto });
        notify.success('Complaint updated');
      } else {
        await create.mutateAsync(dto);
        notify.success('Complaint logged');
      }
      resetForm(); setEditing(null); setOpen(false);
    } catch { notify.error(editing ? 'Update failed' : 'Create failed'); }
  };

  const edit = (c: Complaint) => {
    setEditing(c);
    const ts = splitTimestamp(c.receivedAt);
    setForm({
      partnerId: c.partnerId ?? '',
      category: c.category,
      subject: c.subject,
      description: c.description,
      status: c.status,
      priority: c.priority,
      assignedToId: c.assignedToId ?? '',
      resolution: c.resolution ?? '',
      receivedDate: ts.date,
      receivedHour: ts.hour,
      receivedMinute: ts.minute,
      receivedAmPm: ts.ampm as 'AM' | 'PM',
    });
    setOpen(true);
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this complaint record?')) return;
    try { await del.mutateAsync(id); notify.success('Deleted'); } catch { notify.error('Delete failed'); }
  };

  const catOptions: { value: ComplaintCategory | ''; label: string }[] = [{ value: '', label: 'All categories' }, { value: 'academic', label: 'Academic' }, { value: 'behavior', label: 'Behavior' }, { value: 'facilities', label: 'Facilities' }, { value: 'staff_conduct', label: 'Staff Conduct' }, { value: 'communication', label: 'Communication' }, { value: 'fees', label: 'Fees' }, { value: 'transport', label: 'Transport' }, { value: 'meals', label: 'Meals' }, { value: 'safety', label: 'Safety' }, { value: 'other', label: 'Other' }];
  const statusOptions: { value: ComplaintStatus | ''; label: string }[] = [{ value: '', label: 'All statuses' }, { value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In Progress' }, { value: 'awaiting_response', label: 'Awaiting Response' }, { value: 'resolved', label: 'Resolved' }, { value: 'closed', label: 'Closed' }, { value: 'escalated', label: 'Escalated' }];
  const priorityOptions: { value: ComplaintPriority | ''; label: string }[] = [{ value: '', label: 'All priorities' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }];

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><AlertTriangle className="h-6 w-6" /> Complaints</h1>
          <p className="text-sm text-muted-foreground">Log and track formal complaints with resolution workflow.</p>
        </div>
        <Button onClick={() => { resetForm(); setEditing(null); setOpen(true); }}><Plus className="mr-1 h-4 w-4" /> Log complaint</Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <FilterField label="Received from" wide>
            <Input type="datetime-local" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </FilterField>
          <FilterField label="Received to" wide>
            <Input type="datetime-local" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </FilterField>
          <FilterField label="Category">
            <Select value={category} onValueChange={(v) => setCategory(v as ComplaintCategory | '')}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>{catOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.value ? `${categoryIcon(o.value)} ${o.label}` : o.label}</SelectItem>)}</SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Status">
            <Select value={status} onValueChange={(v) => setStatus(v as ComplaintStatus | '')}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>{statusOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Priority">
            <Select value={priority} onValueChange={(v) => setPriority(v as ComplaintPriority | '')}>
              <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>{priorityOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Complainant">
            <Select value={partnerId} onValueChange={(v) => setPartnerId(v)}>
              <SelectTrigger><SelectValue placeholder="All complainants" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All complainants</SelectItem>
                {partnersList.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Search" className="min-w-[140px]">
            <Input placeholder="Subject, description…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </FilterField>
          <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasFilters}>Clear</Button>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="text-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Received</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs font-medium"><span aria-hidden>{categoryIcon(c.category)}</span>{categoryLabel(c.category)}</span></TableCell>
                  <TableCell className="font-medium">{c.subject}</TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">{c.description}</TableCell>
                  <TableCell>{statusBadge(c.status)}</TableCell>
                  <TableCell>{priorityBadge(c.priority)}</TableCell>
                  <TableCell className="text-muted-foreground">{c.assignedToId ? `Staff ${c.assignedToId.slice(0,8)}` : '—'}</TableCell>
                  <TableCell><TimeCell d={c.receivedAt} /></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => edit(c)}><Edit className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(c.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">{(complaints.data ?? []).length > 0 ? 'No complaints match these filters.' : 'No complaints logged yet.'}{" "}{!complaints.isLoading && (complaints.data ?? []).length === 0 && <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" />Log first complaint</Button>}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit complaint' : 'Log complaint'}</DialogTitle>
            <DialogDescription>Record a formal complaint with category, priority, and resolution tracking.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as ComplaintCategory })}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                {['academic', 'behavior', 'facilities', 'staff_conduct', 'communication', 'fees', 'transport', 'meals', 'safety', 'other'].map((c) => <SelectItem key={c} value={c}>{categoryIcon(c as ComplaintCategory)} {categoryLabel(c as ComplaintCategory)}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as ComplaintPriority })}>
                <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
                <SelectContent>
                  {(['low', 'medium', 'high', 'urgent'] as const).map((p) => <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as ComplaintStatus })}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  {(['open', 'in_progress', 'awaiting_response', 'resolved', 'closed', 'escalated'] as const).map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Input placeholder="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            <Textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} />
            <Select value={form.partnerId} onValueChange={(v) => setForm({ ...form, partnerId: v })}>
              <SelectTrigger><SelectValue placeholder="Complainant (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {partnersList.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Assigned to staff ID (optional)" value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })} />
            <Textarea placeholder="Resolution details" value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} rows={3} />
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Received time (optional)</label>
              <div className="flex flex-wrap items-center gap-2">
                <Input type="date" value={form.receivedDate} onChange={(e) => setForm({ ...form, receivedDate: e.target.value })} className="w-auto" />
                <Select value={form.receivedHour} onValueChange={(v) => setForm({ ...form, receivedHour: v })}>
                  <SelectTrigger className="w-20"><SelectValue placeholder="Hr" /></SelectTrigger>
                  <SelectContent>{hourOptions.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                </Select>
                <span className="text-muted-foreground">:</span>
                <Select value={form.receivedMinute} onValueChange={(v) => setForm({ ...form, receivedMinute: v })}>
                  <SelectTrigger className="w-20"><SelectValue placeholder="Min" /></SelectTrigger>
                  <SelectContent>{minuteOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={form.receivedAmPm} onValueChange={(v) => setForm({ ...form, receivedAmPm: v as 'AM' | 'PM' })}>
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
            <Button onClick={handleSubmit} disabled={create.isPending || update.isPending}>{editing ? 'Save changes' : 'Log complaint'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}