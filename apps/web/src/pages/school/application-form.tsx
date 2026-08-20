import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Send, ArrowLeft, User, Users } from 'lucide-react';
import {
  useAdmission,
  useCreateAdmission,
  useUpdateAdmission,
  useAdmissionAction,
  useAcademicYears,
  useClasses,
  type AdmissionStatus,
  type CreateAdmissionInput,
  type UpdateAdmissionInput,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';

const STATUS_META: Record<AdmissionStatus, { cls: string; label: string }> = {
  submitted: { cls: 'bg-slate-100 text-slate-700', label: 'Submitted' },
  under_review: { cls: 'bg-amber-100 text-amber-700', label: 'Under review' },
  exam_scheduled: { cls: 'bg-sky-100 text-sky-700', label: 'Exam scheduled' },
  accepted: { cls: 'bg-emerald-100 text-emerald-700', label: 'Accepted' },
  enrolled: { cls: 'bg-indigo-100 text-indigo-700', label: 'Enrolled' },
  rejected: { cls: 'bg-rose-100 text-rose-700', label: 'Rejected' },
  withdrawn: { cls: 'bg-zinc-100 text-zinc-600', label: 'Withdrawn' },
};

const GUARDIAN_REL = ['', 'father', 'mother', 'guardian', 'uncle', 'aunt'];

export function SchoolApplicationFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();

  const { data: existing } = useAdmission(id);
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const create = useCreateAdmission();
  const update = useUpdateAdmission();
  const act = useAdmissionAction();

  const [form, setForm] = useState<Record<string, string>>({});

  // Prefill from an existing application.
  useEffect(() => {
    if (!existing) return;
    const cf = (existing.customFields ?? {}) as Record<string, any>;
    setForm({
      academicYearId: existing.academicYearId ?? '',
      applyingForClassId: existing.applyingForClassId ?? '',
      applicantFirstName: existing.applicantFirstName ?? '',
      applicantLastName: existing.applicantLastName ?? '',
      applicantDob: existing.applicantDob ?? '',
      applicantGender: existing.applicantGender ?? '',
      applicationDate: cf.applicationDate ?? '',
      nationality: cf.nationality ?? '',
      residentialStatus: cf.residentialStatus ?? '',
      religion: cf.religion ?? '',
      nationalIdNumber: cf.nationalIdNumber ?? '',
      formerSchool: cf.formerSchool ?? '',
      address: cf.address ?? '',
      guardian1Surname: cf.guardian1Surname ?? '',
      guardian1OtherNames: cf.guardian1OtherNames ?? '',
      guardian1Relationship: cf.guardian1Relationship ?? '',
      guardian1Phone: cf.guardian1Phone ?? '',
      guardian1AltPhone: cf.guardian1AltPhone ?? '',
      guardian1Email: cf.guardian1Email ?? '',
      guardian1Address: cf.guardian1Address ?? '',
      guardian2Surname: cf.guardian2Surname ?? '',
      guardian2OtherNames: cf.guardian2OtherNames ?? '',
      guardian2Relationship: cf.guardian2Relationship ?? '',
      guardian2Phone: cf.guardian2Phone ?? '',
      guardian2Email: cf.guardian2Email ?? '',
    });
  }, [existing]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const collectExtras = (): Record<string, unknown> => {
    const extras: Record<string, unknown> = {};
    for (const k of ['applicationDate', 'nationality', 'residentialStatus', 'religion', 'nationalIdNumber',
      'formerSchool', 'address', 'guardian1Surname', 'guardian1OtherNames', 'guardian1Relationship', 'guardian1Phone',
      'guardian1AltPhone', 'guardian1Email', 'guardian1Address', 'guardian2Surname', 'guardian2OtherNames',
      'guardian2Relationship', 'guardian2Phone', 'guardian2Email']) {
      if (form[k]) extras[k] = form[k];
    }
    return extras;
  };

  const save = async (submitReview: boolean) => {
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
          customFields: collectExtras(),
        };
        const created = await create.mutateAsync(dto);
        notify.success('Application saved');
        if (submitReview) {
          await act.mutateAsync({ id: created.id, action: 'review' });
        }
        navigate(`/school/applications/${created.id}`);
      } else {
        const dto: UpdateAdmissionInput = {
          applicantFirstName: form.applicantFirstName,
          applicantLastName: form.applicantLastName,
          applicantDob: form.applicantDob || undefined,
          applicantGender: (form.applicantGender || undefined) as UpdateAdmissionInput['applicantGender'],
          applyingForClassId: form.applyingForClassId || undefined,
          customFields: collectExtras(),
        };
        await update.mutateAsync({ id: id!, dto });
        notify.success('Application updated');
        if (submitReview && existing?.status === 'submitted') {
          await act.mutateAsync({ id: id!, action: 'review' });
        }
      }
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not save application');
    }
  };

  const busy = create.isPending || update.isPending || act.isPending;

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/school/applications')}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{isEdit ? 'Application' : 'New student application'}</h1>
            <p className="text-sm text-muted-foreground">Front-desk application linked to Admissions.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEdit && existing && (
            <Badge className={STATUS_META[existing.status as AdmissionStatus]?.cls ?? 'bg-slate-100 text-slate-700'}>
              {STATUS_META[existing.status as AdmissionStatus]?.label ?? existing.status}
            </Badge>
          )}
          <Button variant="secondary" onClick={() => save(false)} disabled={busy}>
            <Save className="h-4 w-4" /> Save
          </Button>
          <Button onClick={() => save(true)} disabled={busy}>
            <Send className="h-4 w-4" /> Submit
          </Button>
        </div>
      </div>

      {/* Applicant information */}
      <Card>
        <CardContent className="p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><User className="h-4 w-4" /> Applicant information</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Surname" required><Input value={form.applicantLastName ?? ''} onChange={(e) => set('applicantLastName', e.target.value)} /></Field>
            <Field label="Other names" required><Input value={form.applicantFirstName ?? ''} onChange={(e) => set('applicantFirstName', e.target.value)} /></Field>
            <Field label="Application date"><Input type="date" value={form.applicationDate ?? ''} onChange={(e) => set('applicationDate', e.target.value)} /></Field>
            <Field label="Date of birth"><Input type="date" value={form.applicantDob ?? ''} onChange={(e) => set('applicantDob', e.target.value)} /></Field>
            <Field label="Gender">
              <Select value={form.applicantGender ?? ''} onChange={(v) => set('applicantGender', v)} options={[['', 'Choose a gender'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other']]} />
            </Field>
            <Field label="Nationality"><Input value={form.nationality ?? ''} onChange={(e) => set('nationality', e.target.value)} placeholder="E.g. Ugandan" /></Field>
            <Field label="Residential status">
              <Select value={form.residentialStatus ?? ''} onChange={(v) => set('residentialStatus', v)} options={[['', 'Choose residential status'], ['day', 'Day'], ['boarding', 'Boarding']]} />
            </Field>
            <Field label="Religion"><Input value={form.religion ?? ''} onChange={(e) => set('religion', e.target.value)} placeholder="E.g. Christian" /></Field>
            <Field label="National ID (NIN)"><Input value={form.nationalIdNumber ?? ''} onChange={(e) => set('nationalIdNumber', e.target.value)} placeholder="E.g. CM12345678901234" /></Field>
            <Field label="Former school"><Input value={form.formerSchool ?? ''} onChange={(e) => set('formerSchool', e.target.value)} placeholder="E.g. St. Mary's Primary" /></Field>
            <Field label="Applying for class">
              <Select value={form.applyingForClassId ?? ''} onChange={(v) => set('applyingForClassId', v)} options={[['', '—'], ...(classes?.data ?? []).map((c: any) => [c.id, c.name] as [string, string])]} />
            </Field>
            <Field label="Academic year" required>
              <Select value={form.academicYearId ?? ''} onChange={(v) => set('academicYearId', v)} options={[['', '—'], ...(years?.data ?? []).map((y: any) => [y.id, y.name] as [string, string])]} />
            </Field>
            <Field label="Address" full>
              <textarea className="w-full rounded-md border bg-card px-3 py-2 text-sm" rows={2} value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} placeholder="Home address or contact information" />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Guardian 1 */}
      <Card>
        <CardContent className="p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" /> Guardian 1 information</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Surname"><Input value={form.guardian1Surname ?? ''} onChange={(e) => set('guardian1Surname', e.target.value)} placeholder="E.g. Okello" /></Field>
            <Field label="Other names"><Input value={form.guardian1OtherNames ?? ''} onChange={(e) => set('guardian1OtherNames', e.target.value)} placeholder="E.g. John Paul" /></Field>
            <Field label="Relationship">
              <Select value={form.guardian1Relationship ?? ''} onChange={(v) => set('guardian1Relationship', v)} options={[['', 'Choose relationship'], ...GUARDIAN_REL.slice(1).map((r) => [r, r[0].toUpperCase() + r.slice(1)] as [string, string])]} />
            </Field>
            <Field label="Phone number"><Input value={form.guardian1Phone ?? ''} onChange={(e) => set('guardian1Phone', e.target.value)} placeholder="E.g. 0700123456" /></Field>
            <Field label="Alternative phone"><Input value={form.guardian1AltPhone ?? ''} onChange={(e) => set('guardian1AltPhone', e.target.value)} placeholder="E.g. 0701234567" /></Field>
            <Field label="Email"><Input value={form.guardian1Email ?? ''} onChange={(e) => set('guardian1Email', e.target.value)} placeholder="E.g. john@example.com" /></Field>
            <Field label="Address" full>
              <textarea className="w-full rounded-md border bg-card px-3 py-2 text-sm" rows={2} value={form.guardian1Address ?? ''} onChange={(e) => set('guardian1Address', e.target.value)} placeholder="Guardian's address" />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Guardian 2 */}
      <Card>
        <CardContent className="p-5">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" /> Guardian 2 information (optional)</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Surname"><Input value={form.guardian2Surname ?? ''} onChange={(e) => set('guardian2Surname', e.target.value)} /></Field>
            <Field label="Other names"><Input value={form.guardian2OtherNames ?? ''} onChange={(e) => set('guardian2OtherNames', e.target.value)} /></Field>
            <Field label="Relationship">
              <Select value={form.guardian2Relationship ?? ''} onChange={(v) => set('guardian2Relationship', v)} options={[['', 'Choose relationship'], ...GUARDIAN_REL.slice(1).map((r) => [r, r[0].toUpperCase() + r.slice(1)] as [string, string])]} />
            </Field>
            <Field label="Phone number"><Input value={form.guardian2Phone ?? ''} onChange={(e) => set('guardian2Phone', e.target.value)} /></Field>
            <Field label="Email"><Input value={form.guardian2Email ?? ''} onChange={(e) => set('guardian2Email', e.target.value)} /></Field>
          </div>
        </CardContent>
      </Card>
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
