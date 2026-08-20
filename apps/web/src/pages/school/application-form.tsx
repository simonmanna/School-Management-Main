import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Send, ArrowLeft, User, Users, Plus, Trash2, Clock, ShieldCheck } from 'lucide-react';
import {
  useAdmission,
  useCreateAdmission,
  useUpdateAdmission,
  useSubmitApplication,
  useAdmissionHistory,
  useCommitteeSummary,
  useRevealNin,
  useAcademicYears,
  useClasses,
  type CreateAdmissionInput,
  type UpdateAdmissionInput,
  type AdmissionGuardianInput,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';
import { statusMeta } from './_components/admission-status';

const RELATIONSHIPS = ['father', 'mother', 'guardian', 'uncle', 'aunt', 'other'];
const SOURCES = ['', 'referral', 'website', 'walk_in', 'agent', 'sibling', 'other'];

const emptyGuardian = (): AdmissionGuardianInput => ({ firstName: '', relationship: 'father', isPrimary: false });

export function SchoolApplicationFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();

  const { data: existing } = useAdmission(id);
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const { data: history } = useAdmissionHistory(id);
  const { data: committee } = useCommitteeSummary(id);
  const create = useCreateAdmission();
  const update = useUpdateAdmission();
  const submit = useSubmitApplication();
  const revealNin = useRevealNin();

  const [form, setForm] = useState<Record<string, string>>({});
  const [guardians, setGuardians] = useState<AdmissionGuardianInput[]>([emptyGuardian()]);
  const [revealed, setRevealed] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    const cf = (existing.customFields ?? {}) as Record<string, any>;
    setForm({
      academicYearId: existing.academicYearId ?? '',
      applyingForClassId: existing.applyingForClassId ?? '',
      applicantFirstName: existing.applicantFirstName ?? '',
      applicantLastName: existing.applicantLastName ?? '',
      applicantDob: existing.applicantDob ? String(existing.applicantDob).slice(0, 10) : '',
      applicantGender: existing.applicantGender ?? '',
      nationality: cf.nationality ?? '',
      formerSchool: cf.formerSchool ?? '',
      address: cf.address ?? '',
      sourceOfEnquiry: (existing as any).sourceOfEnquiry ?? '',
    });
  }, [existing]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setG = (i: number, patch: Partial<AdmissionGuardianInput>) =>
    setGuardians((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));

  const collectExtras = (): Record<string, unknown> => {
    const extras: Record<string, unknown> = {};
    for (const k of ['nationality', 'formerSchool', 'address']) if (form[k]) extras[k] = form[k];
    return extras;
  };

  const validGuardians = () => guardians.filter((g) => g.firstName.trim());

  const save = async (asDraft: boolean) => {
    if (!form.academicYearId || !form.applicantFirstName || !form.applicantLastName) {
      notify.error('Academic year, first and last name are required');
      return;
    }
    try {
      if (!isEdit) {
        const dto: CreateAdmissionInput = {
          academicYearId: form.academicYearId,
          applicantFirstName: form.applicantFirstName,
          applicantLastName: form.applicantLastName,
          applicantDob: form.applicantDob || undefined,
          applicantGender: (form.applicantGender || undefined) as CreateAdmissionInput['applicantGender'],
          applyingForClassId: form.applyingForClassId || undefined,
          nin: form.nin || undefined,
          sourceOfEnquiry: form.sourceOfEnquiry || undefined,
          asDraft,
          guardians: validGuardians(),
          customFields: collectExtras(),
        };
        const created = await create.mutateAsync(dto);
        notify.success(asDraft ? 'Draft saved' : 'Application submitted');
        navigate(`/school/applications/${created.id}`);
      } else {
        const dto: UpdateAdmissionInput = {
          applicantFirstName: form.applicantFirstName,
          applicantLastName: form.applicantLastName,
          applicantDob: form.applicantDob || undefined,
          applicantGender: (form.applicantGender || undefined) as UpdateAdmissionInput['applicantGender'],
          applyingForClassId: form.applyingForClassId || undefined,
          sourceOfEnquiry: form.sourceOfEnquiry || undefined,
          customFields: collectExtras(),
        };
        await update.mutateAsync({ id: id!, dto });
        // Submit a draft into the pipeline through the completeness gate.
        if (!asDraft && existing?.status === 'draft') {
          const res: any = await submit.mutateAsync(id!);
          notify.success(res?.status === 'documents_pending' ? `Submitted — pending documents: ${res.missing.join(', ')}` : 'Application submitted');
        } else {
          notify.success('Application updated');
        }
      }
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not save application');
    }
  };

  const doReveal = async () => {
    try { const r = await revealNin.mutateAsync(id!); setRevealed(r.nin ?? '(none on file)'); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not reveal'); }
  };

  const busy = create.isPending || update.isPending || submit.isPending;
  const isDraft = !isEdit || existing?.status === 'draft';

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/school/applications')}><ArrowLeft className="h-4 w-4" /> Back</Button>
          <div>
            <h1 className="text-xl font-semibold">{isEdit ? 'Application' : 'New student application'}</h1>
            <p className="text-sm text-muted-foreground">Applicant, guardians and academic details.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEdit && existing && <Badge className={statusMeta(existing.status).cls}>{statusMeta(existing.status).label}</Badge>}
          <Button variant="secondary" onClick={() => save(true)} disabled={busy}><Save className="h-4 w-4" /> Save draft</Button>
          {isDraft && <Button onClick={() => save(false)} disabled={busy}><Send className="h-4 w-4" /> Submit</Button>}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Applicant */}
          <Card><CardContent className="p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><User className="h-4 w-4" /> Applicant information</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Surname" required><Input value={form.applicantLastName ?? ''} onChange={(e) => set('applicantLastName', e.target.value)} /></Field>
              <Field label="Other names" required><Input value={form.applicantFirstName ?? ''} onChange={(e) => set('applicantFirstName', e.target.value)} /></Field>
              <Field label="Date of birth"><Input type="date" value={form.applicantDob ?? ''} onChange={(e) => set('applicantDob', e.target.value)} /></Field>
              <Field label="Gender">
                <Select value={form.applicantGender ?? ''} onChange={(v) => set('applicantGender', v)} options={[['', 'Choose'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other']]} />
              </Field>
              <Field label="Nationality"><Input value={form.nationality ?? ''} onChange={(e) => set('nationality', e.target.value)} /></Field>
              {!isEdit && <Field label="National ID (NIN)"><Input value={form.nin ?? ''} onChange={(e) => set('nin', e.target.value)} placeholder="Encrypted at rest" /></Field>}
              <Field label="Former school"><Input value={form.formerSchool ?? ''} onChange={(e) => set('formerSchool', e.target.value)} /></Field>
              <Field label="Applying for class">
                <Select value={form.applyingForClassId ?? ''} onChange={(v) => set('applyingForClassId', v)} options={[['', '—'], ...(classes?.data ?? []).map((c: any) => [c.id, c.name] as [string, string])]} />
              </Field>
              <Field label="Academic year" required>
                <Select value={form.academicYearId ?? ''} onChange={(v) => set('academicYearId', v)} options={[['', '—'], ...(years?.data ?? []).map((y: any) => [y.id, y.name] as [string, string])]} />
              </Field>
              <Field label="Source of enquiry">
                <Select value={form.sourceOfEnquiry ?? ''} onChange={(v) => set('sourceOfEnquiry', v)} options={SOURCES.map((s) => [s, s ? s.replace('_', ' ') : 'Choose'] as [string, string])} />
              </Field>
              <Field label="Address" full>
                <textarea className="w-full rounded-md border bg-card px-3 py-2 text-sm" rows={2} value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />
              </Field>
            </div>
            {isEdit && (
              <div className="mt-3 flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={doReveal} disabled={revealNin.isPending}><ShieldCheck className="h-3.5 w-3.5" /> Reveal NIN</Button>
                {revealed !== null && <span className="font-mono text-sm">{revealed}</span>}
              </div>
            )}
          </CardContent></Card>

          {/* Guardians (structured; captured at create) */}
          {!isEdit && (
            <Card><CardContent className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" /> Guardians</h3>
                <Button variant="outline" size="sm" onClick={() => setGuardians((gs) => [...gs, emptyGuardian()])}><Plus className="h-3.5 w-3.5" /> Add guardian</Button>
              </div>
              <div className="space-y-4">
                {guardians.map((g, i) => (
                  <div key={i} className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Guardian {i + 1}</span>
                      {guardians.length > 1 && <Button variant="ghost" size="sm" onClick={() => setGuardians((gs) => gs.filter((_, idx) => idx !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>}
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <Field label="First name"><Input value={g.firstName} onChange={(e) => setG(i, { firstName: e.target.value })} /></Field>
                      <Field label="Last name"><Input value={g.lastName ?? ''} onChange={(e) => setG(i, { lastName: e.target.value })} /></Field>
                      <Field label="Relationship">
                        <Select value={g.relationship} onChange={(v) => setG(i, { relationship: v })} options={RELATIONSHIPS.map((r) => [r, r[0].toUpperCase() + r.slice(1)] as [string, string])} />
                      </Field>
                      <Field label="Phone"><Input value={g.phone ?? ''} onChange={(e) => setG(i, { phone: e.target.value })} /></Field>
                      <Field label="Email"><Input value={g.email ?? ''} onChange={(e) => setG(i, { email: e.target.value })} /></Field>
                      <Field label="Occupation"><Input value={g.occupation ?? ''} onChange={(e) => setG(i, { occupation: e.target.value })} /></Field>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs">
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!g.isPrimary} onChange={(e) => setG(i, { isPrimary: e.target.checked })} /> Primary</label>
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!g.isEmergency} onChange={(e) => setG(i, { isEmergency: e.target.checked })} /> Emergency contact</label>
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!g.financiallyResponsible} onChange={(e) => setG(i, { financiallyResponsible: e.target.checked })} /> Financially responsible</label>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Guardians become the student's contacts, fee payer and emergency contacts at enrollment.</p>
            </CardContent></Card>
          )}
        </div>

        {/* Side rail: committee + timeline (edit only) */}
        {isEdit && (
          <div className="space-y-5">
            {committee && committee.assigned > 0 && (
              <Card><CardContent className="p-5">
                <h3 className="mb-3 text-sm font-semibold">Committee</h3>
                <p className="text-sm text-muted-foreground">{committee.completed}/{committee.assigned} reviews in</p>
                {committee.leaning && <p className="mt-1 text-sm">Leaning: <span className="font-medium capitalize">{committee.leaning}</span></p>}
                {committee.averageScore != null && <p className="text-sm">Avg score: <span className="font-medium">{committee.averageScore}</span></p>}
              </CardContent></Card>
            )}
            <Card><CardContent className="p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Clock className="h-4 w-4" /> Timeline</h3>
              <div className="space-y-3">
                {(history ?? []).map((h) => (
                  <div key={h.id} className="flex gap-3 text-sm">
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-indigo-400" />
                    <div>
                      <p className="font-medium capitalize">{h.action.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">{statusMeta(h.toStatus).label} · {new Date(h.changedAt).toLocaleString()}</p>
                      {h.reason && <p className="text-xs text-muted-foreground">{h.reason}</p>}
                    </div>
                  </div>
                ))}
                {(history ?? []).length === 0 && <p className="text-sm text-muted-foreground">No history yet.</p>}
              </div>
            </CardContent></Card>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, required, full, children }: { label: string; required?: boolean; full?: boolean; children: React.ReactNode }) {
  return <div className={full ? 'md:col-span-3 space-y-1' : 'space-y-1'}><Label className="text-xs">{label}{required && <span className="text-rose-500"> *</span>}</Label>{children}</div>;
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
