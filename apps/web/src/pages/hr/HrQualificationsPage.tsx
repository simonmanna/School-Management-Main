import { useMemo, useState } from 'react';
import { Plus, Award, AlertTriangle } from 'lucide-react';
import { useHrQualifications, useCreateHrQualification, useDeleteHrQualification, useHrCertifications, useHrExpiringCertifications, useCreateHrCertification, useDeleteHrCertification, useHrEmployees } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function HrQualificationsPage() {
  const [tab, setTab] = useState<'qual' | 'cert'>('qual');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const { data: quals } = useHrQualifications({});
  const { data: certs } = useHrCertifications({});
  const { data: expiring } = useHrExpiringCertifications(30);
  const { data: empData } = useHrEmployees({ pageSize: 300 });
  const createQual = useCreateHrQualification();
  const deleteQual = useDeleteHrQualification();
  const createCert = useCreateHrCertification();
  const deleteCert = useDeleteHrCertification();

  const qualRows = useMemo(() => quals?.rows ?? [], [quals]);
  const certRows = useMemo(() => certs?.rows ?? [], [certs]);
  const employees = useMemo(() => empData?.rows ?? [], [empData]);

  const submit = async () => {
    if (tab === 'qual') {
      if (!form.employeeId || !form.title) return;
      await createQual.mutateAsync({ employeeId: form.employeeId, title: form.title, institution: form.institution || null, yearObtained: form.yearObtained ? Number(form.yearObtained) : null, certificateNumber: form.certificateNumber || null });
    } else {
      if (!form.employeeId || !form.name) return;
      await createCert.mutateAsync({ employeeId: form.employeeId, name: form.name, issuer: form.issuer || null, expiryDate: form.expiryDate || null, certificateNumber: form.certificateNumber || null, documentUrl: form.documentUrl || null });
    }
    setOpen(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Qualifications & Certifications</h1>
          <p className="text-sm text-muted-foreground">Track degrees, teaching licenses and professional certs — with expiry alerts for renewed compliance.</p>
        </div>
        <Button onClick={() => { setForm({}); setOpen(true); }}><Plus className="h-4 w-4" /> Add</Button>
      </div>

      <div className="flex gap-2">
        {(['qual', 'cert'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md border px-3 py-1.5 text-sm ${tab === t ? 'bg-muted font-medium' : ''}`}>
            {t === 'qual' ? 'Qualifications' : 'Certifications'}
          </button>
        ))}
      </div>

      {tab === 'cert' && expiring?.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardHeader className="border-b"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> {expiring.length} certification(s) expiring within 30 days</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {expiring.map((c: any) => (
                <div key={c.id} className="px-4 py-2 text-sm">{c.employee ? `${c.employee.firstName} ${c.employee.lastName ?? ''}` : 'Employee'} — {c.name} expires {c.expiryDate ? new Date(c.expiryDate).toISOString().slice(0, 10) : '—'}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{tab === 'qual' ? qualRows.length : certRows.length} {tab === 'qual' ? 'qualifications' : 'certifications'}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {(tab === 'qual' ? qualRows : certRows).length === 0 && <p className="p-6 text-sm text-muted-foreground">Nothing yet.</p>}
            {(tab === 'qual' ? qualRows : certRows).map((r: any) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <Award className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{tab === 'qual' ? r.title : r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.employee ? `${r.employee.firstName} ${r.employee.lastName ?? ''}` : 'Employee'}
                      {tab === 'qual' ? (r.institution ? ` · ${r.institution}` : '') : (r.expiryDate ? ` · expires ${new Date(r.expiryDate).toISOString().slice(0, 10)}` : '')}
                    </p>
                  </div>
                </div>
                {tab === 'cert' && <Badge variant="outline" className={r.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}>{r.status}</Badge>}
                <button onClick={() => { if (confirm('Delete?')) (tab === 'qual' ? deleteQual : deleteCert).mutate(r.id); }} className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add {tab === 'qual' ? 'qualification' : 'certification'}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Employee *</Label>
              <select value={form.employeeId ?? ''} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select employee</option>
                {employees.map((e: any) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName} {e.lastName ?? ''}</option>)}
              </select>
            </div>
            <div><Label>{tab === 'qual' ? 'Title *' : 'Name *'}</Label><Input value={form.title ?? form.name ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value, name: e.target.value })} /></div>
            <div><Label>{tab === 'qual' ? 'Institution' : 'Issuer'}</Label><Input value={form.institution ?? form.issuer ?? ''} onChange={(e) => setForm({ ...form, institution: e.target.value, issuer: e.target.value })} /></div>
            {tab === 'qual' ? (
              <div><Label>Year obtained</Label><Input type="number" value={form.yearObtained ?? ''} onChange={(e) => setForm({ ...form, yearObtained: e.target.value })} /></div>
            ) : (
              <div><Label>Expiry date</Label><Input type="date" value={form.expiryDate ?? ''} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></div>
            )}
            <Button onClick={submit} disabled={createQual.isPending || createCert.isPending}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
