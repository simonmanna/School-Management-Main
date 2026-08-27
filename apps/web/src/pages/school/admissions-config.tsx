import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, FileText, ListChecks, MessageSquare, Workflow } from 'lucide-react';
import {
  useAdmissionRequirements,
  useUpsertRequirement,
  useDeleteRequirement,
  useOfferTemplates,
  useUpsertOfferTemplate,
  useDeleteOfferTemplate,
  useEnquiries,
  useCreateEnquiry,
  useUpdateEnquiry,
  type AdmissionRequirement,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';

type Tab = 'requirements' | 'templates' | 'enquiries';

export function SchoolAdmissionsConfigPage() {
  const [tab, setTab] = useState<Tab>('requirements');
  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Admissions configuration</h1>
          <p className="text-sm text-muted-foreground">Requirements, offer-letter templates and enquiries.</p>
        </div>
        {/* Which stages a school requires lives on its own page — it is a different
            kind of setting from the per-item CRUD in these tabs. */}
        <Link
          to="/school/admissions/workflow"
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <Workflow className="h-4 w-4" /> Admission workflow
        </Link>
      </div>
      <div className="flex gap-1 border-b">
        {([['requirements', 'Requirements', ListChecks], ['templates', 'Offer templates', FileText], ['enquiries', 'Enquiries', MessageSquare]] as const).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-indigo-500 font-medium' : 'border-transparent text-muted-foreground'}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {tab === 'requirements' && <RequirementsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'enquiries' && <EnquiriesTab />}
    </div>
  );
}

function RequirementsTab() {
  const { data: reqs, isLoading } = useAdmissionRequirements();
  const upsert = useUpsertRequirement();
  const del = useDeleteRequirement();
  const [form, setForm] = useState<Partial<AdmissionRequirement>>({ kind: 'document', gate: 'submit', required: true });

  const add = async () => {
    if (!form.code || !form.label) { notify.error('Code and label are required'); return; }
    try {
      await upsert.mutateAsync(form);
      notify.success('Requirement saved');
      setForm({ kind: 'document', gate: 'submit', required: true });
    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Save failed'); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-6">
          <div className="space-y-1"><Label className="text-xs">Kind</Label>
            <select className="w-full rounded-md border bg-card px-2 py-2 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as any })}>
              <option value="document">Document</option><option value="field">Field</option><option value="fee">Fee</option>
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Code</Label><Input value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="birth_cert" /></div>
          <div className="space-y-1 md:col-span-2"><Label className="text-xs">Label</Label><Input value={form.label ?? ''} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Birth certificate" /></div>
          <div className="space-y-1"><Label className="text-xs">Gate</Label>
            <select className="w-full rounded-md border bg-card px-2 py-2 text-sm" value={form.gate} onChange={(e) => setForm({ ...form, gate: e.target.value as any })}>
              <option value="submit">On submit</option><option value="enroll">On enroll</option>
            </select>
          </div>
          <div className="flex items-end"><Button onClick={add} disabled={upsert.isPending} className="w-full"><Plus className="h-4 w-4" /> Add</Button></div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Kind</th><th className="px-4 py-2 font-medium">Code</th><th className="px-4 py-2 font-medium">Label</th><th className="px-4 py-2 font-medium">Gate</th><th className="px-4 py-2" /></tr></thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && (reqs ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No requirements configured. Add the documents applicants must provide.</td></tr>}
              {(reqs ?? []).map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-4 py-2 capitalize">{r.kind}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-4 py-2">{r.label}</td>
                  <td className="px-4 py-2"><Badge className="bg-slate-100 text-slate-700">{r.gate}</Badge></td>
                  <td className="px-4 py-2 text-right"><Button variant="ghost" size="sm" onClick={() => del.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function TemplatesTab() {
  const { data: templates, isLoading } = useOfferTemplates();
  const upsert = useUpsertOfferTemplate();
  const del = useDeleteOfferTemplate();
  const [form, setForm] = useState<{ name: string; body: string; validityDays: number; isDefault: boolean }>({ name: '', body: '', validityDays: 14, isDefault: false });

  const save = async () => {
    if (!form.name || !form.body) { notify.error('Name and body are required'); return; }
    try { await upsert.mutateAsync(form); notify.success('Template saved'); setForm({ name: '', body: '', validityDays: 14, isDefault: false }); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Save failed'); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1"><Label className="text-xs">Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1"><Label className="text-xs">Validity (days)</Label><Input type="number" value={form.validityDays} onChange={(e) => setForm({ ...form, validityDays: Number(e.target.value) })} /></div>
            <div className="flex items-end gap-2"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} /><Label className="text-xs">Default template</Label></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Body — tokens: {'{{applicantName}}'}, {'{{className}}'}, {'{{expiresAt}}'}</Label>
            <textarea className="w-full rounded-md border bg-card px-3 py-2 text-sm" rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </div>
          <Button onClick={save} disabled={upsert.isPending}><Plus className="h-4 w-4" /> Save template</Button>
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {(templates ?? []).map((t) => (
          <Card key={t.id}>
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2"><span className="font-medium">{t.name}</span>{t.isDefault && <Badge className="bg-emerald-100 text-emerald-700">Default</Badge>}</div>
                <Button variant="ghost" size="sm" onClick={() => del.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">{t.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">Valid {t.validityDays} days</p>
            </CardContent>
          </Card>
        ))}
        {!isLoading && (templates ?? []).length === 0 && <p className="text-sm text-muted-foreground">No templates yet.</p>}
      </div>
    </div>
  );
}

function EnquiriesTab() {
  const { data: enquiries, isLoading } = useEnquiries();
  const create = useCreateEnquiry();
  const update = useUpdateEnquiry();
  const [form, setForm] = useState<Record<string, string>>({});

  const add = async () => {
    if (!form.applicantName) { notify.error('Applicant name is required'); return; }
    try { await create.mutateAsync(form); notify.success('Enquiry logged'); setForm({}); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Save failed'); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-5">
          <div className="space-y-1"><Label className="text-xs">Applicant</Label><Input value={form.applicantName ?? ''} onChange={(e) => setForm({ ...form, applicantName: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Guardian</Label><Input value={form.guardianName ?? ''} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Phone</Label><Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="space-y-1"><Label className="text-xs">Source</Label>
            <select className="w-full rounded-md border bg-card px-2 py-2 text-sm" value={form.source ?? ''} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              <option value="">—</option><option value="referral">Referral</option><option value="website">Website</option><option value="walk_in">Walk-in</option><option value="agent">Agent</option><option value="sibling">Sibling</option><option value="other">Other</option>
            </select>
          </div>
          <div className="flex items-end"><Button onClick={add} disabled={create.isPending} className="w-full"><Plus className="h-4 w-4" /> Log</Button></div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground"><tr><th className="px-4 py-2 font-medium">Applicant</th><th className="px-4 py-2 font-medium">Guardian</th><th className="px-4 py-2 font-medium">Contact</th><th className="px-4 py-2 font-medium">Source</th><th className="px-4 py-2 font-medium">Status</th></tr></thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
              {!isLoading && (enquiries ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No enquiries logged.</td></tr>}
              {(enquiries ?? []).map((e) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-medium">{e.applicantName}</td>
                  <td className="px-4 py-2">{e.guardianName ?? '—'}</td>
                  <td className="px-4 py-2 text-xs">{e.phone ?? e.email ?? '—'}</td>
                  <td className="px-4 py-2 capitalize">{e.source ?? '—'}</td>
                  <td className="px-4 py-2">
                    <select className="rounded-md border bg-card px-2 py-1 text-xs" value={e.status} onChange={(ev) => update.mutate({ id: e.id, status: ev.target.value })}>
                      <option value="new">New</option><option value="contacted">Contacted</option><option value="converted">Converted</option><option value="closed">Closed</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
