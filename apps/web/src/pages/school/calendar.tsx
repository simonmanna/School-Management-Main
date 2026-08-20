import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { notify } from '@/lib/notify';
import {
  useSchoolCalendarEvents,
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  useDeleteCalendarEvent,
  useTerms,
  type CalendarEventType,
  type SchoolCalendarEvent,
} from '@/features/school/api';

/* ── type → colour (reuses timetable special-schedule palette) ───────────────── */
const TYPE_META: Record<CalendarEventType, { label: string; dot: string; chip: string }> = {
  holiday:    { label: 'Holiday',    dot: 'bg-red-500',    chip: 'bg-red-50 text-red-700 border-red-200' },
  exam:       { label: 'Exam',       dot: 'bg-rose-500',   chip: 'bg-rose-50 text-rose-700 border-rose-200' },
  event:      { label: 'Event',      dot: 'bg-blue-500',   chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  meeting:    { label: 'Meeting',    dot: 'bg-amber-500',  chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  trip:       { label: 'Trip',       dot: 'bg-teal-500',   chip: 'bg-teal-50 text-teal-700 border-teal-200' },
  sports:     { label: 'Sports',     dot: 'bg-green-500',  chip: 'bg-green-50 text-green-700 border-green-200' },
  ceremony:   { label: 'Ceremony',   dot: 'bg-purple-500', chip: 'bg-purple-50 text-purple-700 border-purple-200' },
  working_day:{ label: 'Working Day',dot: 'bg-slate-500',  chip: 'bg-slate-50 text-slate-700 border-slate-200' },
};
const TYPE_ORDER = Object.keys(TYPE_META) as CalendarEventType[];

/* ── date helpers (no external lib) ─────────────────────────────────────────── */
const pad = (n: number) => String(n).padStart(2, '0');
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthMatrix(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday-first
  const start = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function SchoolCalendarPage() {
  const today = new Date();
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [termId, setTermId] = useState<string>('');

  const monthStart = new Date(view.year, view.month, 1);
  const monthEnd = new Date(view.year, view.month + 1, 0);
  const from = toISO(monthStart);
  const to = toISO(monthEnd);

  const { data: events, isLoading, isError, refetch } = useSchoolCalendarEvents(from, to);
  const { data: terms } = useTerms();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolCalendarEvent | null>(null);
  const [form, setForm] = useState<{
    title: string; type: CalendarEventType; startDate: string; endDate: string; termId?: string; description?: string;
  }>({ title: '', type: 'event', startDate: toISO(today), endDate: toISO(today) });

  const create = useCreateCalendarEvent();
  const update = useUpdateCalendarEvent();
  const remove = useDeleteCalendarEvent();
  const qc = useQueryClient();

  const cells = useMemo(() => monthMatrix(view.year, view.month), [view]);


  const openCreate = (iso?: string) => {
    setEditing(null);
    setForm({ title: '', type: 'event', startDate: iso ?? from, endDate: iso ?? from, termId, description: '' });
    setDialogOpen(true);
  };
  const openEdit = (ev: SchoolCalendarEvent) => {
    setEditing(ev);
    setForm({
      title: ev.title, type: ev.type, startDate: ev.startDate, endDate: ev.endDate,
      termId: ev.termId ?? '', description: ev.description ?? '',
    });
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
      notify.success(editing ? 'Event updated' : 'Event created');
    } catch (e: any) {
      notify.error('Save failed', e?.message);
    }
  };

  const onDelete = async (ev: SchoolCalendarEvent) => {
    if (!confirm(`Delete "${ev.title}"?`)) return;
    try { await remove.mutateAsync(ev.id); qc.invalidateQueries({ queryKey: ['school', 'calendar-events'] }); notify.success('Event deleted'); }
    catch (e: any) { notify.error('Delete failed', e?.message); }
  };

  const filtered = (events ?? []).filter((e) => !termId || e.termId === termId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><CalendarDays className="h-6 w-6" /> School Calendar</h1>
          <p className="text-sm text-muted-foreground">Holidays, exams and events. Feeds attendance and the timetable special schedule.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setView({ year: today.getFullYear(), month: today.getMonth() })}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => setView((v) => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 })}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-[130px] text-center font-medium">{MONTHS[view.month]} {view.year}</span>
          <Button variant="outline" size="icon" onClick={() => setView((v) => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 })}><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" onClick={() => openCreate()}><Plus className="h-4 w-4 mr-1" /> New</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div>
          <Label className="text-xs">Term</Label>
          <select value={termId} onChange={(e) => setTermId(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">All</option>
            {(terms?.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_ORDER.map((t) => (
            <span key={t} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${TYPE_META[t].chip}`}>
              <span className={`h-2 w-2 rounded-full ${TYPE_META[t].dot}`} /> {TYPE_META[t].label}
            </span>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{MONTHS[view.month]} {view.year}</CardTitle>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="py-8 text-center text-sm text-destructive">Failed to load calendar. <Button variant="link" size="sm" onClick={() => refetch()}>Retry</Button></div>
          ) : isLoading ? (
            <div className="grid grid-cols-7 gap-px">
              {Array.from({ length: 42 }).map((_, i) => <div key={i} className="min-h-[96px] animate-pulse rounded bg-muted/40" />)}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-px bg-border">
              {WEEKDAYS.map((w) => (
                <div key={w} className="bg-muted px-2 py-1 text-center text-xs font-medium text-muted-foreground">{w}</div>
              ))}
              {cells.map((d) => {
                const iso = toISO(d);
                const inMonth = d.getMonth() === view.month;
                const isToday = iso === toISO(today);
                const dayEvents = filtered.filter((e) => e.startDate <= iso && e.endDate >= iso);
                return (
                  <div
                    key={iso}
                    onClick={() => openCreate(iso)}
                    className={`min-h-[96px] cursor-pointer bg-background p-1.5 text-xs transition hover:bg-muted/40 ${inMonth ? '' : 'opacity-50'}`}
                  >
                    <div className={`mb-1 flex items-center justify-between ${isToday ? 'font-bold text-primary' : ''}`}>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>{d.getDate()}</span>
                      {dayEvents.length > 0 && <span className="text-[10px] text-muted-foreground">{dayEvents.length}</span>}
                    </div>
                    <div className="space-y-1">
                      {dayEvents.slice(0, 3).map((e) => {
                        const meta = TYPE_META[e.type];
                        const isFirst = e.startDate === iso;
                        return (
                          <button
                            key={e.id}
                            onClick={(ev) => { ev.stopPropagation(); openEdit(e); }}
                            className={`flex w-full items-center gap-1 truncate rounded border px-1 py-0.5 text-left ${meta.chip}`}
                            title={e.title}
                          >
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                            <span className="truncate">{isFirst ? e.title : '↳ ' + e.title}</span>
                          </button>
                        );
                      })}
                      {dayEvents.length > 3 && <div className="px-1 text-[10px] text-muted-foreground">+{dayEvents.length - 3} more</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!isLoading && !isError && filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No events this month. Click a date to add one.</p>
          )}
        </CardContent>
      </Card>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDialogOpen(false)}>
          <div className="w-full max-w-md rounded-lg bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editing ? 'Edit Event' : 'New Event'}</h2>
              {editing && (
                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => onDelete(editing)}><Trash2 className="h-4 w-4" /></Button>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Sports Day" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CalendarEventType })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                    {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Term</Label>
                  <select value={form.termId ?? ''} onChange={(e) => setForm({ ...form, termId: e.target.value })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                    <option value="">None</option>
                    {(terms?.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start</Label>
                  <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </div>
                <div>
                  <Label>End</Label>
                  <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
              </div>
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
