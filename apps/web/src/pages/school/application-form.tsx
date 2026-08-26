import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Send, ArrowLeft, User, Plus, Trash2, Clock, ShieldCheck, ChevronRight, ChevronLeft } from 'lucide-react';
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
  useAdmissionCycles,
  useNationalities,
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
import { ApplicationDocuments } from './_components/ApplicationDocuments';

const RELATIONSHIPS = ['father', 'mother', 'guardian', 'uncle', 'aunt', 'other'];
// Nationality is now org-scoped master data (Task 6) — the hardcoded list is
// kept only as a fallback if no nationalities have been configured yet.
const FALLBACK_NATIONALITIES = ['Ugandan', 'Kenyan', 'Tanzanian', 'Rwandan', 'South Sudanese', 'Burundian', 'Congolese', 'Other'];
const RELIGIONS = ['Christian', 'Muslim', 'Hindu', 'Traditional', 'Other'];
const ENTRY_STATUSES = ['New entrant', 'Transfer', 'Re-admission', 'Returning'];
const RESIDENTIAL = [['day', 'Day'], ['boarder', 'Boarder']] as [string, string][];
// Custom-field keys still captured as free-form JSON. The four operational
// fields (nationality, residenceType, entryStatus, address) are promoted to
// top-level columns (Task 3) and MUST NOT be written here.
const CF_KEYS = ['formerSchool', 'religion', 'learnerId', 'schoolPayCode', 'admissionDate'];

const emptyGuardian = (): AdmissionGuardianInput => ({ firstName: '', lastName: '', relationship: 'father', phone: '' });

export function SchoolApplicationFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();

  const { data: existing } = useAdmission(id);
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const { data: cycles } = useAdmissionCycles();
  const { data: nationalities } = useNationalities();
  const { data: history } = useAdmissionHistory(id);
  const { data: committee } = useCommitteeSummary(id);
  const create = useCreateAdmission();
  const update = useUpdateAdmission();
  const submit = useSubmitApplication();
  const revealNin = useRevealNin();

  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<Record<string, string>>({});
  const [guardians, setGuardians] = useState<AdmissionGuardianInput[]>([emptyGuardian()]);
  const [revealed, setRevealed] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) {
      // New application: default the academic year to the current one.
      const current = (years?.data ?? []).find((y: any) => (y as any).isCurrent) ?? (years?.data ?? [])[0];
      if (current && !form.academicYearId) setForm((f) => ({ ...f, academicYearId: current.id }));
      // Auto-select a single open admission cycle (Task 2). If there are zero or
      // many open cycles we leave it to the user; a closed cycle is never chosen.
      const open = (cycles ?? []).filter((c: any) => c.status === 'open');
      if (open.length === 1 && !form.admissionCycleId) {
        setForm((f) => ({ ...f, admissionCycleId: open[0].id }));
      }
      return;
    }
    const cf = (existing.customFields ?? {}) as Record<string, any>;
    // Promoted operational fields (Task 3) read from top-level columns first,
    // falling back to legacy customFields so old records stay readable.
    const nationality = existing.nationality ?? cf.nationality ?? '';
    const residenceType = existing.residenceType ?? cf.residenceType ?? '';
    const entryStatus = existing.entryStatus ?? cf.entryStatus ?? '';
    const address = existing.address ?? cf.address ?? '';
    setForm({
      academicYearId: existing.academicYearId ?? '',
      admissionCycleId: existing.admissionCycleId ?? '',
      applyingForClassId: existing.applyingForClassId ?? '',
      applicantFirstName: existing.applicantFirstName ?? '',
      applicantLastName: existing.applicantLastName ?? '',
      applicantDob: existing.applicantDob ? String(existing.applicantDob).slice(0, 10) : '',
      applicantGender: existing.applicantGender ?? '',
      nin: (existing as any).nin ?? '',
      sourceOfEnquiry: (existing as any).sourceOfEnquiry ?? '',
      admissionDate: cf.admissionDate ? String(cf.admissionDate).slice(0, 10) : '',
      nationality,
      entryStatus,
      residenceType,
      religion: cf.religion ?? '',
      learnerId: cf.learnerId ?? '',
      schoolPayCode: cf.schoolPayCode ?? '',
      formerSchool: cf.formerSchool ?? '',
      address,
    });
  }, [existing]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setG = (i: number, patch: Partial<AdmissionGuardianInput>) =>
    setGuardians((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));

  const collectExtras = (): Record<string, unknown> => {
    const extras: Record<string, unknown> = {};
    for (const k of CF_KEYS) if (form[k]) extras[k] = form[k];
    return extras;
  };

  const validGuardians = () => guardians.filter((g) => g.firstName.trim() || (g.lastName ?? '').trim());

  const validateStep1 = (): string | null => {
    if (!form.academicYearId) return 'Academic year must be selected';
    if (!form.applicantLastName?.trim()) return 'Surname is required';
    if (!form.applicantFirstName?.trim()) return 'Other names are required';
    if (!form.admissionDate) return 'Admission date is required';
    if (!form.applicantDob) return 'Date of birth is required';
    if (!form.applicantGender) return 'Gender is required';
    if (!form.nationality) return 'Nationality is required';
    if (!form.entryStatus) return 'Entry status is required';
    if (!form.residenceType) return 'Residential status is required';
    if (!form.applyingForClassId) return 'A class must be selected';
    const g1 = guardians[0];
    if (!g1?.lastName?.trim()) return 'Guardian 1 surname is required';
    if (!g1?.firstName?.trim()) return 'Guardian 1 other names are required';
    if (!g1?.relationship) return 'Guardian 1 relationship is required';
    if (!g1?.phone?.trim()) return 'Guardian 1 phone number is required';
    return null;
  };

  const goNext = () => {
    const err = validateStep1();
    if (err) { notify.error(err); return; }
    setStep(2);
  };

  const save = async (asDraft: boolean) => {
    if (!form.academicYearId || !form.applicantFirstName || !form.applicantLastName) {
      notify.error('Academic year, first and last name are required');
      return;
    }
    try {
      if (!isEdit) {
        const dto: CreateAdmissionInput = {
          academicYearId: form.academicYearId,
          admissionCycleId: form.admissionCycleId || undefined,
          applicantFirstName: form.applicantFirstName,
          applicantLastName: form.applicantLastName,
          applicantDob: form.applicantDob || undefined,
          applicantGender: (form.applicantGender || undefined) as CreateAdmissionInput['applicantGender'],
          applyingForClassId: form.applyingForClassId || undefined,
          nin: form.nin || undefined,
          sourceOfEnquiry: form.sourceOfEnquiry || undefined,
          // Promoted operational fields (Task 3) — top-level, not customFields.
          nationality: form.nationality || undefined,
          residenceType: (form.residenceType || undefined) as CreateAdmissionInput['residenceType'],
          entryStatus: form.entryStatus || undefined,
          address: form.address || undefined,
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
          admissionCycleId: form.admissionCycleId || undefined,
          sourceOfEnquiry: form.sourceOfEnquiry || undefined,
          // Promoted operational fields (Task 3) — top-level, not customFields.
          nationality: form.nationality || undefined,
          residenceType: (form.residenceType || undefined) as UpdateAdmissionInput['residenceType'],
          entryStatus: form.entryStatus || undefined,
          address: form.address || undefined,
          customFields: collectExtras(),
        };
        await update.mutateAsync({ id: id!, dto });
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

  const className = (cid?: string) => (cid ? (classes?.data ?? []).find((c: any) => c.id === cid)?.name ?? '—' : '—');

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
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-3">
        <StepDot label="Student Information" active={step === 1} done={step === 2} />
        <div className="h-px w-10 bg-border" />
        <StepDot label="Confirmation" active={step === 2} done={false} muted={step === 1} />
      </div>

      {step === 1 ? (
        <div className="space-y-5">
          {/* Student Information */}
          <Card><CardContent className="p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><User className="h-4 w-4" /> Student Information</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Academic year" required full>
                <Select value={form.academicYearId ?? ''} onChange={(v) => set('academicYearId', v)} options={[['', 'Choose a year'], ...(years?.data ?? []).map((y: any) => [y.id, y.name] as [string, string])]} />
              </Field>
              <Field label="Admission cycle" full>
                {(() => {
                  const all = cycles ?? [];
                  const open = all.filter((c: any) => c.status === 'open');
                  const closed = all.filter((c: any) => c.status !== 'open');
                  return (
                    <Select
                      value={form.admissionCycleId ?? ''}
                      onChange={(v) => set('admissionCycleId', v)}
                      options={[
                        ['', 'No cycle / choose later'],
                        ...(open.length ? [['__open', '— Open —'] as [string, string]] : []),
                        ...open.map((c: any) => [c.id, c.name] as [string, string]),
                        ...(closed.length ? [['__closed', '— Closed —'] as [string, string]] : []),
                        ...closed.map((c: any) => [c.id, `${c.name} (closed)`] as [string, string]),
                      ]}
                    />
                  );
                })()}
              </Field>
              <Field label="Surname" required><Input value={form.applicantLastName ?? ''} onChange={(e) => set('applicantLastName', e.target.value)} placeholder="E.g. Atimango" /></Field>
              <Field label="Other names" required><Input value={form.applicantFirstName ?? ''} onChange={(e) => set('applicantFirstName', e.target.value)} placeholder="E.g. Isabelle Atweoki" /></Field>
              <Field label="Admission date" required><Input type="date" value={form.admissionDate ?? ''} onChange={(e) => set('admissionDate', e.target.value)} /></Field>
              <Field label="Date of birth" required><Input type="date" value={form.applicantDob ?? ''} onChange={(e) => set('applicantDob', e.target.value)} /></Field>
              <Field label="Gender" required>
                <Select value={form.applicantGender ?? ''} onChange={(v) => set('applicantGender', v)} options={[['', 'Choose a gender'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other']]} />
              </Field>
              <Field label="Nationality" required>
                <Select
                  value={form.nationality ?? ''}
                  onChange={(v) => set('nationality', v)}
                  options={[
                    ['', nationalities?.length ? 'Choose a nationality' : 'No nationalities configured'],
                    ...(nationalities ?? [])
                      .filter((n: any) => n.isActive)
                      .map((n: any) => [n.name, n.name] as [string, string]),
                    // Keep a legacy value selectable even if it was deactivated.
                    ...(form.nationality && !(nationalities ?? []).some((n: any) => n.name === form.nationality)
                      ? [[form.nationality, `${form.nationality} (legacy)`] as [string, string]]
                      : []),
                    ...(!(nationalities ?? []).some((n: any) => n.isActive)
                      ? FALLBACK_NATIONALITIES.map((n) => [n, n] as [string, string])
                      : []),
                  ]}
                />
                {(!(nationalities ?? []).some((n: any) => n.isActive) && nationalities?.length) && (
                  <p className="mt-1 text-xs text-amber-600">No active nationalities — configure them in Company Settings.</p>
                )}
              </Field>
              <Field label="Entry status" required>
                <Select value={form.entryStatus ?? ''} onChange={(v) => set('entryStatus', v)} options={[['', 'Choose entry status'], ...ENTRY_STATUSES.map((n) => [n, n] as [string, string])]} />
              </Field>
              <Field label="Residential status" required>
                <Select value={form.residenceType ?? ''} onChange={(v) => set('residenceType', v)} options={[['', 'Choose residential status'], ...RESIDENTIAL]} />
              </Field>
              <Field label="Home address" full>
                <Input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} placeholder="E.g. Plot 5, Kampala Road" />
              </Field>
              <Field label="Select a class" required>
                <Select value={form.applyingForClassId ?? ''} onChange={(v) => set('applyingForClassId', v)} options={[['', 'Choose a class'], ...(classes?.data ?? []).map((c: any) => [c.id, c.name] as [string, string])]} />
              </Field>
              <Field label="Religion">
                <Select value={form.religion ?? ''} onChange={(v) => set('religion', v)} options={[['', 'Choose a religion'], ...RELIGIONS.map((n) => [n, n] as [string, string])]} />
              </Field>
              <Field label="National Identification Number"><Input value={form.nin ?? ''} onChange={(e) => set('nin', e.target.value)} placeholder="E.g. CM973535343" /></Field>
              <Field label="Learner's Identification Number"><Input value={form.learnerId ?? ''} onChange={(e) => set('learnerId', e.target.value)} placeholder="Enter learner's identification number" /></Field>
              <Field label="School pay code" full>
                <Input value={form.schoolPayCode ?? ''} onChange={(e) => set('schoolPayCode', e.target.value)} placeholder="Enter student's school pay code" />
              </Field>
            </div>
          </CardContent></Card>

          {/* Guardian 1 */}
          <GuardianCard index={0} title="Guardian 1" required guardians={guardians} setG={setG} onRemove={undefined} />
          {/* Guardian 2 (optional) */}
          {guardians.length < 2 ? (
            <Button variant="outline" size="sm" onClick={() => setGuardians((gs) => [...gs, emptyGuardian()])}><Plus className="h-3.5 w-3.5" /> Add Guardian 2</Button>
          ) : (
            <GuardianCard index={1} title="Guardian 2 (Optional)" required={false} guardians={guardians} setG={setG} onRemove={() => setGuardians((gs) => gs.slice(0, 1))} />
          )}

          <div className="flex justify-end">
            <Button onClick={goNext} disabled={busy}><span>Next</span><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card><CardContent className="p-5">
              <h3 className="mb-4 text-sm font-semibold">Confirmation</h3>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
                <Row k="Academic year" v={(years?.data ?? []).find((y: any) => y.id === form.academicYearId)?.name} />
                <Row k="Surname" v={form.applicantLastName} />
                <Row k="Other names" v={form.applicantFirstName} />
                <Row k="Admission date" v={form.admissionDate} />
                <Row k="Date of birth" v={form.applicantDob} />
                <Row k="Gender" v={form.applicantGender} />
                <Row k="Nationality" v={form.nationality} />
                <Row k="Entry status" v={form.entryStatus} />
                <Row k="Residential status" v={form.residenceType} />
                <Row k="Class" v={className(form.applyingForClassId)} />
                <Row k="Religion" v={form.religion} />
                <Row k="NIN" v={form.nin} />
                <Row k="Learner ID" v={form.learnerId} />
                <Row k="School pay code" v={form.schoolPayCode} />
              </dl>
            </CardContent></Card>

            {validGuardians().map((g, i) => (
              <Card key={i}><CardContent className="p-5">
                <h4 className="mb-3 text-sm font-semibold">{i === 0 ? 'Guardian 1' : 'Guardian 2'}</h4>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
                  <Row k="Surname" v={g.lastName} />
                  <Row k="Other names" v={g.firstName} />
                  <Row k="Relationship" v={g.relationship} />
                  <Row k="Phone" v={g.phone} />
                  <Row k="Alt phone" v={g.altPhone} />
                  <Row k="Email" v={g.email} />
                  <Row k="Address" v={g.address} />
                </dl>
              </CardContent></Card>
            ))}

            {isEdit ? (
              <div className="flex flex-wrap gap-3">
                <Button variant="ghost" onClick={() => setStep(1)}><ChevronLeft className="h-4 w-4" /> Back</Button>
                {isDraft && <Button variant="secondary" onClick={() => save(true)} disabled={busy}><Save className="h-4 w-4" /> Save draft</Button>}
                {isDraft && <Button onClick={() => save(false)} disabled={busy}><Send className="h-4 w-4" /> Submit</Button>}
                {!isDraft && <Button onClick={() => save(false)} disabled={busy}>Update</Button>}
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <Button variant="ghost" onClick={() => setStep(1)}><ChevronLeft className="h-4 w-4" /> Back</Button>
                <Button variant="secondary" onClick={() => save(true)} disabled={busy}><Save className="h-4 w-4" /> Save draft</Button>
                <Button onClick={() => save(false)} disabled={busy}><Send className="h-4 w-4" /> Submit application</Button>
              </div>
            )}
          </div>

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
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={doReveal} disabled={revealNin.isPending}><ShieldCheck className="h-3.5 w-3.5" /> Reveal NIN</Button>
                {revealed !== null && <span className="font-mono text-sm">{revealed}</span>}
              </div>
              <ApplicationDocuments
                applicationId={id!}
                admissionCycleId={existing?.admissionCycleId}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepDot({ label, active, done, muted }: { label: string; active?: boolean; done?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${active ? 'bg-primary text-primary-foreground' : done ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'}`}>
        {done ? '✓' : '•'}
      </div>
      <span className={`text-sm ${muted ? 'text-muted-foreground' : active || done ? 'font-medium' : ''}`}>{label}</span>
    </div>
  );
}

function GuardianCard({ index, title, required, guardians, setG, onRemove }: {
  index: number;
  title: string;
  required: boolean;
  guardians: AdmissionGuardianInput[];
  setG: (i: number, patch: Partial<AdmissionGuardianInput>) => void;
  onRemove?: () => void;
}) {
  const g = guardians[index];
  return (
    <Card><CardContent className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}{required && <span className="text-rose-500"> *</span>}</h3>
        {onRemove && <Button variant="ghost" size="sm" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Surname" required={required}><Input value={g.lastName ?? ''} onChange={(e) => setG(index, { lastName: e.target.value })} placeholder="E.g. Okello" /></Field>
        <Field label="Other names" required={required}><Input value={g.firstName ?? ''} onChange={(e) => setG(index, { firstName: e.target.value })} placeholder="E.g. James Paul" /></Field>
        <Field label="Relationship" required={required}>
          <Select value={g.relationship} onChange={(v) => setG(index, { relationship: v })} options={[['', 'Choose a relationship'], ...RELATIONSHIPS.map((r) => [r, r[0].toUpperCase() + r.slice(1)] as [string, string])]} />
        </Field>
        <Field label="Phone number" required={required}><Input value={g.phone ?? ''} onChange={(e) => setG(index, { phone: e.target.value })} placeholder="E.g. 0700123456" /></Field>
        <Field label="Alternative phone number"><Input value={g.altPhone ?? ''} onChange={(e) => setG(index, { altPhone: e.target.value })} placeholder="E.g. 0712345678" /></Field>
        <Field label="Email address"><Input value={g.email ?? ''} onChange={(e) => setG(index, { email: e.target.value })} placeholder="E.g. guardian@email.com" /></Field>
        <Field label="Address" full><Input value={g.address ?? ''} onChange={(e) => setG(index, { address: e.target.value })} placeholder="E.g. Plot 5, Kampala Road" /></Field>
      </div>
    </CardContent></Card>
  );
}

function Field({ label, required, full, children }: { label: string; required?: boolean; full?: boolean; children: React.ReactNode }) {
  return <div className={full ? 'md:col-span-4 space-y-1' : 'space-y-1'}><Label className="text-xs">{label}{required && <span className="text-rose-500"> *</span>}</Label>{children}</div>;
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (<><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v || '—'}</dd></>);
}
