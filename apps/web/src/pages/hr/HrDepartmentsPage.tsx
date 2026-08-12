import { useMemo, useState } from 'react';
import { Plus, Building2 } from 'lucide-react';
import { useHrDepartments, useCreateHrDepartment, useUpdateHrDepartment, useDeleteHrDepartment, useHrEmployees } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function HrDepartmentsPage() {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const { data } = useHrDepartments({ search: search || undefined });
  const { data: empData } = useHrEmployees({ pageSize: 200 });
  const create = useCreateHrDepartment();
  const update = useUpdateHrDepartment();
  const remove = useDeleteHrDepartment();

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const employees = useMemo(() => empData?.rows ?? [], [empData]);

  const openCreate = () => { setEditing(null); setForm({ isActive: true }); setOpen(true); };
  const openEdit = (d: any) => { setEditing(d); setForm({ code: d.code, name: d.name, description: d.description ?? '', managerId: d.managerId ?? '', isActive: d.isActive }); setOpen(true); };
  const submit = async () => {
    const payload = { ...form, managerId: form.managerId || null, description: form.description || null };
    if (editing) await update.mutateAsync({ id: editing.id, dto: payload });
    else await create.mutateAsync(payload);
    setOpen(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Departments</h1>
          <p className="text-sm text-muted-foreground">Org structure — every employee and position hangs off a department.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New department</Button>
      </div>

      <div className="flex items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code…"
          className="w-64 rounded-md border bg-card px-3 py-2 text-sm" />
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} departments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No departments yet.</p>}
            {rows.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{d.code} · {d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.manager ? `Manager: ${d.manager.firstName}${d.manager.lastName ? ' ' + d.manager.lastName : ''}` : 'No manager'}
                      {' · '}{d._count?.employees ?? 0} employees · {d._count?.positions ?? 0} positions
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!d.isActive && <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>}
                  <button onClick={() => openEdit(d)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60">Edit</button>
                  <button onClick={() => { if (confirm(`Delete department ${d.name}?`)) remove.mutate(d.id); }}
                    className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit department' : 'New department'}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Code *</Label>
                <Input value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="DEPT-001" />
              </div>
              <div>
                <Label>Name *</Label>
                <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <Label>Manager</Label>
              <select value={form.managerId ?? ''} onChange={(e) => setForm({ ...form, managerId: e.target.value })}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">None</option>
                {employees.map((e: any) => (
                  <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName}{e.lastName ? ' ' + e.lastName : ''}</option>
                ))}
              </select>
            </div>
            <Button onClick={submit} disabled={!form.code || !form.name || create.isPending || update.isPending}>
              {editing ? 'Save changes' : 'Create department'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
