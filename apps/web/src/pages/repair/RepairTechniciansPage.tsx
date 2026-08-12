import { useState } from 'react';
import { Plus, User } from 'lucide-react';
import { useRepairTechnicians, useCreateTechnician, useUpdateTechnician, useDeleteTechnician } from '@/features/repair/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function RepairTechniciansPage() {
  const { data } = useRepairTechnicians();
  const create = useCreateTechnician();
  const update = useUpdateTechnician();
  const del = useDeleteTechnician();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: '', name: '', phone: '', email: '', skills: '', hourlyRate: '', availability: 'Mon–Sat',
  });
  const [editing, setEditing] = useState<any | null>(null);
  const [error, setError] = useState('');

  const rows = Array.isArray(data) ? data : (data as any)?.items ?? [];

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => {
    setEditing(null);
    setForm({ code: '', name: '', phone: '', email: '', skills: '', hourlyRate: '', availability: 'Mon–Sat' });
    setShowForm(true);
  };

  const openEdit = (t: any) => {
    setEditing(t);
    setForm({
      code: t.code, name: t.name, phone: t.phone ?? '', email: t.email ?? '',
      skills: (t.skills ?? []).join(', '), hourlyRate: String(t.hourlyRate ?? ''), availability: t.availability ?? '',
    });
    setShowForm(true);
  };

  const submit = async () => {
    setError('');
    const dto = {
      ...form,
      skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : undefined,
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, dto });
      else await create.mutateAsync(dto);
      setShowForm(false);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? String(e?.message ?? e));
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Technicians</h1>
          <p className="text-sm text-muted-foreground">Workshop staff, skills and hourly rates.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New technician</Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">{editing ? `Edit ${editing.name}` : 'New technician'}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-4">
            <Input placeholder="Code (TCH-001)" value={form.code} onChange={(e) => set('code', e.target.value)} />
            <Input placeholder="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <Input placeholder="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            <Input placeholder="Email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            <Input placeholder="Skills (comma separated)" value={form.skills} onChange={(e) => set('skills', e.target.value)} />
            <Input type="number" placeholder="Hourly rate (Rp)" value={form.hourlyRate} onChange={(e) => set('hourlyRate', e.target.value)} />
            <Input placeholder="Availability (Mon–Sat)" value={form.availability} onChange={(e) => set('availability', e.target.value)} />
            <div className="flex items-end gap-2">
              <Button onClick={submit} disabled={create.isPending || update.isPending}>Save</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
            {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} technicians</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No technicians yet.</p>}
            {rows.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{t.name} <span className="text-xs text-muted-foreground">· {t.code}</span></p>
                    <p className="text-xs text-muted-foreground">
                      {(t.skills ?? []).join(', ') || 'No skills'} · Rp {Number(t.hourlyRate ?? 0).toLocaleString('id-ID')}/h
                      {t.availability ? ` · ${t.availability}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!t.isActive && <Badge variant="outline">inactive</Badge>}
                  <Button size="sm" variant="outline" onClick={() => openEdit(t)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => del.mutateAsync(t.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
