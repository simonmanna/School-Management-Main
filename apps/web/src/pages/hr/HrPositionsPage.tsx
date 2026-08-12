import { useMemo, useState } from 'react';
import { Plus, Briefcase } from 'lucide-react';
import { useHrPositions, useHrDepartments, useCreateHrPosition, useUpdateHrPosition, useDeleteHrPosition } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const fmt = (n: number | string | null) =>
  n === null || n === undefined ? '—' : `Rp ${Number(n).toLocaleString('id-ID')}`;

export function HrPositionsPage() {
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const { data } = useHrPositions({ search: search || undefined, departmentId: departmentId || undefined });
  const { data: depts } = useHrDepartments();
  const create = useCreateHrPosition();
  const update = useUpdateHrPosition();
  const remove = useDeleteHrPosition();

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const openCreate = () => { setEditing(null); setForm({ isActive: true }); setOpen(true); };
  const openEdit = (p: any) => { setEditing(p); setForm({ code: p.code, name: p.name, departmentId: p.departmentId ?? '', defaultSalary: p.defaultSalary ?? '', isActive: p.isActive }); setOpen(true); };
  const submit = async () => {
    const payload: any = { code: form.code, name: form.name, isActive: form.isActive };
    if (form.departmentId) payload.departmentId = form.departmentId;
    if (form.defaultSalary !== '' && form.defaultSalary !== null) payload.defaultSalary = Number(form.defaultSalary);
    if (editing) await update.mutateAsync({ id: editing.id, dto: payload });
    else await create.mutateAsync(payload);
    setOpen(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Positions</h1>
          <p className="text-sm text-muted-foreground">Job titles with default pay, grouped by department.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New position</Button>
      </div>

      <div className="flex items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code…"
          className="w-64 rounded-md border bg-card px-3 py-2 text-sm" />
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
          className="rounded-md border bg-card px-3 py-2 text-sm">
          <option value="">All departments</option>
          {(depts?.rows ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} positions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No positions yet.</p>}
            {rows.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{p.code} · {p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.department?.name ?? 'No department'} · {p._count?.employees ?? 0} employees
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{fmt(p.defaultSalary)}</span>
                  {!p.isActive && <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>}
                  <button onClick={() => openEdit(p)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60">Edit</button>
                  <button onClick={() => { if (confirm(`Delete position ${p.name}?`)) remove.mutate(p.id); }}
                    className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit position' : 'New position'}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Code *</Label>
                <Input value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="POS-001" />
              </div>
              <div>
                <Label>Name *</Label>
                <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Department</Label>
              <select value={form.departmentId ?? ''} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">None</option>
                {(depts?.rows ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Default salary</Label>
              <Input type="number" value={form.defaultSalary ?? ''} onChange={(e) => setForm({ ...form, defaultSalary: e.target.value })} />
            </div>
            <Button onClick={submit} disabled={!form.code || !form.name || create.isPending || update.isPending}>
              {editing ? 'Save changes' : 'Create position'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
