import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { useHrEmployees, useHrDepartments, useHrPositions, useCreateHrEmployee, useUpdateHrEmployee } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const fmt = (n: number | string | null) =>
  n === null || n === undefined ? '—' : `Rp ${Number(n).toLocaleString('id-ID')}`;

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CASUAL', 'PROBATION'];
const PAY_FREQUENCIES = ['MONTHLY', 'BIWEEKLY', 'WEEKLY', 'DAILY', 'HOURLY'];

const EMP_TYPE_STYLE: Record<string, string> = {
  FULL_TIME: 'bg-emerald-100 text-emerald-800',
  PART_TIME: 'bg-sky-100 text-sky-800',
  CONTRACT: 'bg-violet-100 text-violet-800',
  INTERN: 'bg-amber-100 text-amber-800',
  CASUAL: 'bg-muted text-muted-foreground',
  PROBATION: 'bg-cyan-100 text-cyan-800',
};

export function HrEmployeesPage() {
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ employmentType: 'FULL_TIME', payFrequency: 'MONTHLY' });

  const { data } = useHrEmployees({ search: search || undefined, departmentId: departmentId || undefined, pageSize: 50 });
  const { data: depts } = useHrDepartments();
  const { data: positions } = useHrPositions();
  const create = useCreateHrEmployee();
  const update = useUpdateHrEmployee();

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const openCreate = () => {
    setEditing(null);
    setForm({ employmentType: 'FULL_TIME', payFrequency: 'MONTHLY' });
    setOpen(true);
  };
  const openEdit = (e: any) => {
    setEditing(e);
    setForm({
      firstName: e.firstName,
      lastName: e.lastName ?? '',
      email: e.email ?? '',
      phone: e.phone ?? '',
      employmentType: e.employmentType,
      payFrequency: e.payFrequency,
      departmentId: e.departmentId ?? '',
      positionId: e.positionId ?? '',
      baseSalary: e.baseSalary ?? '',
      hourlyRate: e.hourlyRate ?? '',
    });
    setOpen(true);
  };
  const submit = async () => {
    const payload: any = {
      firstName: form.firstName,
      lastName: form.lastName || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      employmentType: form.employmentType,
      payFrequency: form.payFrequency,
      departmentId: form.departmentId || null,
      positionId: form.positionId || null,
    };
    if (form.baseSalary !== '' && form.baseSalary !== null && form.baseSalary !== undefined)
      payload.baseSalary = Number(form.baseSalary);
    if (form.hourlyRate !== '' && form.hourlyRate !== null && form.hourlyRate !== undefined)
      payload.hourlyRate = Number(form.hourlyRate);
    if (editing) await update.mutateAsync({ id: editing.id, dto: payload });
    else await create.mutateAsync(payload);
    setOpen(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Employees</h1>
          <p className="text-sm text-muted-foreground">People, their pay and their org masters.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New employee</Button>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code, name, email, phone…"
          className="w-64 rounded-md border bg-card px-3 py-2 text-sm"
        />
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
          <option value="">All departments</option>
          {(depts?.rows ?? []).map((d: any) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} employees</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No employees match the filters.</p>}
            {rows.map((e: any) => (
              <div key={e.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <Link to={`/hr/employees/${e.id}`} className="flex flex-1 items-center gap-3">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{e.employeeCode} · {e.firstName}{e.lastName ? ' ' + e.lastName : ''}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.department?.name ?? 'No department'} · {e.position?.name ?? 'No position'}
                      {e.email ? ` · ${e.email}` : ''}
                    </p>
                  </div>
                </Link>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{fmt(e.baseSalary)}</span>
                  <Badge variant="outline" className={EMP_TYPE_STYLE[e.employmentType] ?? ''}>{e.employmentType.replace(/_/g, ' ')}</Badge>
                  <button onClick={() => openEdit(e)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60">Edit</button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit employee' : 'New employee'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First name *</Label>
                <Input value={form.firstName ?? ''} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </div>
              <div>
                <Label>Last name</Label>
                <Input value={form.lastName ?? ''} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email</Label>
                <Input value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Employment type</Label>
                <select value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                  {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <Label>Pay frequency</Label>
                <select value={form.payFrequency} onChange={(e) => setForm({ ...form, payFrequency: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                  {PAY_FREQUENCIES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Department</Label>
                <select value={form.departmentId ?? ''} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                  <option value="">None</option>
                  {(depts?.rows ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Position</Label>
                <select value={form.positionId ?? ''} onChange={(e) => setForm({ ...form, positionId: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                  <option value="">None</option>
                  {(positions?.rows ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Base salary</Label>
                <Input type="number" value={form.baseSalary ?? ''} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} />
              </div>
              <div>
                <Label>Hourly rate</Label>
                <Input type="number" value={form.hourlyRate ?? ''} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} />
              </div>
            </div>
            <Button onClick={submit} disabled={!form.firstName || create.isPending || update.isPending}>
              {editing ? 'Save changes' : 'Create employee'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
