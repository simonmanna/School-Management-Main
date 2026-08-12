import { useMemo, useState } from 'react';
import { Plus, Clock } from 'lucide-react';
import { useHrShifts, useCreateHrShift, useUpdateHrShift, useDeleteHrShift } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SHIFT_TYPES = ['MORNING', 'AFTERNOON', 'NIGHT', 'SPLIT', 'ROTATING', 'FLEXIBLE'];

const SHIFT_TYPE_STYLE: Record<string, string> = {
  MORNING: 'bg-amber-100 text-amber-800',
  AFTERNOON: 'bg-orange-100 text-orange-800',
  NIGHT: 'bg-indigo-100 text-indigo-800',
  SPLIT: 'bg-violet-100 text-violet-800',
  ROTATING: 'bg-cyan-100 text-cyan-800',
  FLEXIBLE: 'bg-emerald-100 text-emerald-800',
};

export function HrShiftsPage() {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const { data } = useHrShifts({ search: search || undefined });
  const create = useCreateHrShift();
  const update = useUpdateHrShift();
  const remove = useDeleteHrShift();

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const openCreate = () => { setEditing(null); setForm({ shiftType: 'MORNING', startTime: '08:00', endTime: '17:00', graceMinutes: 15, isActive: true }); setOpen(true); };
  const openEdit = (s: any) => {
    setEditing(s);
    setForm({
      code: s.code, name: s.name, shiftType: s.shiftType, startTime: s.startTime, endTime: s.endTime,
      breakStart: s.breakStart ?? '', breakEnd: s.breakEnd ?? '', graceMinutes: s.graceMinutes,
      maxOvertimeMinutes: s.maxOvertimeMinutes ?? '', isActive: s.isActive, description: s.description ?? '',
    });
    setOpen(true);
  };
  const submit = async () => {
    const payload: any = {
      code: form.code, name: form.name, shiftType: form.shiftType,
      startTime: form.startTime, endTime: form.endTime,
      graceMinutes: Number(form.graceMinutes || 0), isActive: form.isActive,
      breakStart: form.breakStart || null, breakEnd: form.breakEnd || null,
      description: form.description || null,
      maxOvertimeMinutes: form.maxOvertimeMinutes === '' ? null : Number(form.maxOvertimeMinutes),
    };
    if (editing) await update.mutateAsync({ id: editing.id, dto: payload });
    else await create.mutateAsync(payload);
    setOpen(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Shifts</h1>
          <p className="text-sm text-muted-foreground">Shift patterns with grace windows — clock events are matched against these.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New shift</Button>
      </div>

      <div className="flex items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code…"
          className="w-64 rounded-md border bg-card px-3 py-2 text-sm" />
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} shifts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No shifts yet.</p>}
            {rows.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{s.code} · {s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.startTime}–{s.endTime}{s.breakStart ? ` · break ${s.breakStart}–${s.breakEnd}` : ''}
                      {' · '}{s.graceMinutes}min grace{s.maxOvertimeMinutes ? ` · ${s.maxOvertimeMinutes}min max OT` : ''}
                      {' · '}{s._count?.assignments ?? 0} assignments
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className={SHIFT_TYPE_STYLE[s.shiftType] ?? ''}>{s.shiftType.replace(/_/g, ' ')}</Badge>
                  {!s.isActive && <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>}
                  <button onClick={() => openEdit(s)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60">Edit</button>
                  <button onClick={() => { if (confirm(`Delete shift ${s.name}?`)) remove.mutate(s.id); }}
                    className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit shift' : 'New shift'}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Code *</Label>
                <Input value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SHIFT-001" />
              </div>
              <div>
                <Label>Name *</Label>
                <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Shift type</Label>
              <select value={form.shiftType} onChange={(e) => setForm({ ...form, shiftType: e.target.value })}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                {SHIFT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start time *</Label>
                <Input type="time" value={form.startTime ?? ''} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              </div>
              <div>
                <Label>End time *</Label>
                <Input type="time" value={form.endTime ?? ''} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Break start</Label>
                <Input type="time" value={form.breakStart ?? ''} onChange={(e) => setForm({ ...form, breakStart: e.target.value })} />
              </div>
              <div>
                <Label>Break end</Label>
                <Input type="time" value={form.breakEnd ?? ''} onChange={(e) => setForm({ ...form, breakEnd: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Grace minutes</Label>
                <Input type="number" value={form.graceMinutes ?? ''} onChange={(e) => setForm({ ...form, graceMinutes: e.target.value })} />
              </div>
              <div>
                <Label>Max overtime (min)</Label>
                <Input type="number" value={form.maxOvertimeMinutes ?? ''} onChange={(e) => setForm({ ...form, maxOvertimeMinutes: e.target.value })} />
              </div>
            </div>
            <Button onClick={submit} disabled={!form.code || !form.name || !form.startTime || !form.endTime || create.isPending || update.isPending}>
              {editing ? 'Save changes' : 'Create shift'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
