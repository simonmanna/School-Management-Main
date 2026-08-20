import { useMemo, useState } from 'react';
import { MapPin, Plus, Pencil, Trash2, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { notify } from '@/lib/notify';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSchoolCalendarEvents,
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  useDeleteCalendarEvent,
  useTerms,
  type CalendarEventType,
  type SchoolCalendarEvent,
} from '@/features/school/api';

const TYPE_META: Record<CalendarEventType, { label: string; dot: string; chip: string }> = {
  holiday:     { label: 'Holiday',     dot: 'bg-red-500',    chip: 'bg-red-50 text-red-700 border-red-200' },
  exam:        { label: 'Exam',        dot: 'bg-rose-500',   chip: 'bg-rose-50 text-rose-700 border-red-200' },
  event:       { label: 'Event',       dot: 'bg-blue-500',   chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  meeting:     { label: 'Meeting',     dot: 'bg-amber-500',  chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  trip:        { label: 'Trip',        dot: 'bg-teal-500',   chip: 'bg-teal-50 text-teal-700 border-teal-200' },
  sports:      { label: 'Sports',      dot: 'bg-green-500',  chip: 'bg-green-50 text-green-700 border-green-200' },
  ceremony:    { label: 'Ceremony',    dot: 'bg-purple-500', chip: 'bg-purple-50 text-purple-700 border-purple-200' },
  working_day: { label: 'Working Day', dot: 'bg-slate-500',  chip: 'bg-slate-50 text-slate-700 border-slate-200' },
};
const TYPE_ORDER = Object.keys(TYPE_META) as CalendarEventType[];

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function SchoolTripsPage() {
  const today = toISO(new Date());
  const horizon = toISO(new Date(Date.now() + 365 * 864e5));

  const { data: events, isLoading, isError, refetch } = useSchoolCalendarEvents(today, horizon);
  const { data: terms } = useTerms();

  const [termFilter, setTermFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolCalendarEvent | null>(null);
  const [form, setForm] = useState<{
    title: string; type: CalendarEventType; startDate: string; endDate: string; termId?: string; description?: string;
  }>({ title: '', type: 'trip', startDate: today, endDate: today });

  const create = useCreateCalendarEvent();
  const update = useUpdateCalendarEvent();
  const remove = useDeleteCalendarEvent();
  const qc = useQueryClient();

  // Only trips / field activities.
  const rows = useMemo(() => {
    let r = (events ?? []).filter((e) => e.type === 'trip');
    if (termFilter) r = r.filter((e) => e.termId === termFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      r = r.filter((e) => e.title.toLowerCase().includes(s) || (e.description ?? '').toLowerCase().includes(s));
    }
    return [...r].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [events, termFilter, search]);

  const openCreate = () => {
    setEditing(null);
    setForm({ title: '', type: 'trip', startDate: today, endDate: today, termId: termFilter || '', description: '' });
    setDialogOpen(true);
  };
  const openEdit = (ev: SchoolCalendarEvent) => {
    setEditing(ev);
    setForm({ title: ev.title, type: ev.type, startDate: ev.startDate, endDate: ev.endDate, termId: ev.termId ?? '', description: ev.description ?? '' });
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!form.title.trim()) { notify.error('Title is required'); return; }
    if (form.endDate < form.startDate) { notify.error('End date cannot be before start date'); return; }
    const payload = {
      title: form.title.trim(), type: form.type, startDate: form.startDate, endDate: form.endDate,
      termId: form.termId || null, description: form.description || undefined,
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, ...payload });
      else await create.mutateAsync(payload);
      qc.invalidateQueries({ queryKey: ['school', 'calendar-events'] });
      setDialogOpen(false);
      notify.success(editing ? 'Trip updated' : 'Trip created');
    } catch (e: any) { notify.error('Save failed', e?.message); }
  };
  const onDelete = async (ev: SchoolCalendarEvent) => {
    if (!confirm(`Delete "${ev.title}"?`)) return;
    try { await remove.mutateAsync(ev.id); qc.invalidateQueries({ queryKey: ['school', 'calendar-events'] }); notify.success('Trip deleted'); }
    catch (e: any) { notify.error('Delete failed', e?.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><MapPin className="h-6 w-6" /> Trips &amp; Field Activities</h1>
          <p className="text-sm text-muted-foreground">Educational trips, excursions and field activities. Visible to all staff on the school calendar.</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> New Trip</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-8 w-56" />
        </div>
        <select value={termFilter} onChange={(e) => setTermFilter(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
          <option value="">All terms</option>
          {(terms?.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Trips</CardTitle></CardHeader>
        <CardContent>
          {isError ? (
            <div className="py-8 text-center text-sm text-destructive">Failed to load trips. <Button variant="link" size="sm" onClick={() => refetch()}>Retry</Button></div>
          ) : isLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded bg-muted/40" />)}</div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No trips yet. Click “New Trip” to add one.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((e) => {
                const meta = TYPE_META[e.type];
                const range = e.startDate === e.endDate ? fmt(e.startDate) : `${fmt(e.startDate)} – ${fmt(e.endDate)}`;
                return (
                  <li key={e.id} className="flex items-start gap-3 py-3">
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{e.title}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${meta.chip}`}>{meta.label}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{range}{e.description ? ` · ${e.description}` : ''}</div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(e)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => onDelete(e)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDialogOpen(false)}>
          <div className="w-full max-w-md rounded-lg bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-semibold">{editing ? 'Edit Trip' : 'New Trip'}</h2>
            <div className="space-y-3">
              <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Science Museum Field Trip" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Type</Label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CalendarEventType })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                    {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
                  </select>
                </div>
                <div><Label>Term</Label>
                  <select value={form.termId ?? ''} onChange={(e) => setForm({ ...form, termId: e.target.value })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                    <option value="">None</option>
                    {(terms?.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Start</Label><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
                <div><Label>End</Label><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
              </div>
              <div><Label>Description</Label><Textarea value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Destination, transport, itinerary…" /></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={create.isPending || update.isPending}>{editing ? 'Save' : 'Create'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
