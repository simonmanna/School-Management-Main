import { useMemo, useState } from 'react';
import { CalendarHeart } from 'lucide-react';
import { useHrHolidays, useCreateHrHoliday, useUpdateHrHoliday, useDeleteHrHoliday } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function HrHolidaysPage() {
  const year = new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const { data } = useHrHolidays({ year });
  const create = useCreateHrHoliday();
  const update = useUpdateHrHoliday();
  const remove = useDeleteHrHoliday();

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const openCreate = () => { setEditing(null); setForm({ isRecurring: false }); setOpen(true); };
  const openEdit = (h: any) => { setEditing(h); setForm({ name: h.name, date: h.date.slice(0, 10), isRecurring: h.isRecurring }); setOpen(true); };
  const submit = async () => {
    const payload = { name: form.name, date: new Date(form.date).toISOString(), isRecurring: form.isRecurring };
    if (editing) await update.mutateAsync({ id: editing.id, dto: payload });
    else await create.mutateAsync(payload);
    setOpen(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Holidays</h1>
          <p className="text-sm text-muted-foreground">Official days off — attendance on these days is marked OFF_DAY.</p>
        </div>
        <Button onClick={openCreate}>New holiday</Button>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} holidays · {year}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No holidays configured for {year}.</p>}
            {rows.map((h: any) => (
              <div key={h.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <CalendarHeart className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{h.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(h.date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {h.isRecurring && <Badge variant="outline" className="bg-cyan-100 text-cyan-800">Recurring yearly</Badge>}
                  <button onClick={() => openEdit(h)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60">Edit</button>
                  <button onClick={() => { if (confirm(`Delete holiday ${h.name}?`)) remove.mutate(h.id); }}
                    className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit holiday' : 'New holiday'}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Name *</Label>
              <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Date *</Label>
              <Input type="date" value={form.date ?? ''} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isRecurring ?? false} onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })} />
              Repeats every year
            </label>
            <Button onClick={submit} disabled={!form.name || !form.date || create.isPending || update.isPending}>
              {editing ? 'Save changes' : 'Create holiday'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
