import { schoolTodayNow } from '@/lib/format';
import { CustomFieldsSection, missingRequired, pickCustomFieldValues, useCustomFieldDefs } from '@/features/school/custom-fields';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, GraduationCap, Plus, Trash2, User, Zap } from 'lucide-react';
import {
  useClasses,
  useCreateStudent,
  useNationalities,
  useRegisterStudent,
  useSections,
  useStudentCategories,
  useTerminology,
  useTerms,
  type InlineGuardianInput,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';
import { DuplicatePupilDialog, likelyDuplicatesFrom, type LikelyDuplicate } from '@/features/school/duplicate-pupil-dialog';

const RELATIONSHIPS = ['father', 'mother', 'guardian', 'uncle', 'aunt', 'sibling', 'grandparent', 'other'];
const FALLBACK_NATIONALITIES = ['Ugandan', 'Kenyan', 'Tanzanian', 'Rwandan', 'South Sudanese', 'Burundian', 'Congolese', 'Other'];
const RELIGIONS = ['Christian', 'Muslim', 'Hindu', 'Traditional', 'Other'];
const ENTRY_STATUSES = ['New entrant', 'Transfer', 'Re-admission', 'Returning'];
const RESIDENTIAL = [['day', 'Day'], ['boarder', 'Boarder']] as [string, string][];
// Free-form details kept on the pupil's customFields — the same keys an
// application carries over when it is converted, so both records read alike.
const CF_KEYS = ['formerSchool', 'learnerId', 'schoolPayCode'] as const;

type GuardianRow = { firstName: string; lastName: string; relationship: string; phone: string; email: string; occupation: string };
const emptyGuardian = (): GuardianRow => ({ firstName: '', lastName: '', relationship: 'father', phone: '', email: '', occupation: '' });

type Mode = 'admit' | 'register';

/**
 * Full-page pupil admission, laid out like the application form.
 *
 * - `admit`: POST /school/students — admission no. is typed, term defaults to
 *   the current one.
 * - `register`: POST /school/students/register — "register & place": term and
 *   roll number are required, admission no. is generated when blank.
 *
 * Both create the pupil, their guardians and the class placement in one
 * server transaction.
 */
export function SchoolStudentAdmitPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const labels = useTerminology();
  const { data: classes } = useClasses();
  const { data: sections } = useSections();
  const { data: terms } = useTerms();
  const { data: nationalities } = useNationalities();
  const { data: studentCategories } = useStudentCategories();
  const { data: cfDefs } = useCustomFieldDefs('student');
  const create = useCreateStudent();
  const register = useRegisterStudent();

  const isRegister = mode === 'register';
  const title = isRegister ? 'Quick register & place' : 'Admit student';

  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<Record<string, string>>({ admissionDate: schoolTodayNow() });
  const [guardians, setGuardians] = useState<GuardianRow[]>([emptyGuardian()]);
  const [ownCf, setOwnCf] = useState<Record<string, unknown>>({});
  const [dupes, setDupes] = useState<{ matches: LikelyDuplicate[]; retry: (reason: string) => Promise<void> } | null>(null);

  // Default the term to the current one (register needs it; admit uses it too).
  useEffect(() => {
    if (form.termId) return;
    const list = terms?.data ?? [];
    const current = list.find((t) => t.isCurrent);
    if (current) setForm((f) => ({ ...f, termId: current.id }));
  }, [terms]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setG = (i: number, patch: Partial<GuardianRow>) =>
    setGuardians((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));

  const classSections = (sections?.data ?? []).filter((x: any) => x.classId === form.classId && x.isActive !== false);
  const activeNationalities = (nationalities ?? []).filter((n: any) => n.isActive);
  const className = (cid?: string) => (cid ? (classes?.data ?? []).find((c) => c.id === cid)?.name ?? '—' : '—');
  const termName = (tid?: string) => (tid ? (terms?.data ?? []).find((t) => t.id === tid)?.name ?? '—' : '—');
  const categoryName = (cid?: string) => (cid ? (studentCategories ?? []).find((c: any) => c.id === cid)?.name ?? '—' : '—');
  const fullName = () => [form.firstName?.trim(), form.lastName?.trim()].filter(Boolean).join(' ');
  const filledGuardians = () => guardians.filter((g) => g.firstName.trim() || g.lastName.trim());

  const validateStep1 = (): string | null => {
    if (!form.lastName?.trim()) return 'Surname is required';
    if (!form.firstName?.trim()) return 'Other names are required';
    if (!isRegister && !form.admissionNo?.trim()) return 'Admission no. is required';
    if (!form.admissionDate) return 'Admission date is required';
    if (!form.dateOfBirth) return 'Date of birth is required';
    if (!form.gender) return 'Gender is required';
    if (!form.nationality) return 'Nationality is required';
    if (!form.entryStatus) return 'Entry status is required';
    if (!form.residenceType) return 'Residential status is required';
    if (isRegister && !form.termId) return 'Term is required';
    if (!form.classId) return 'A class must be selected';
    if (classSections.length > 0 && !form.sectionId) return `This class is divided — choose a ${labels.section.toLowerCase()}`;
    if (isRegister && !form.rollNumber?.trim()) return 'Roll number is required';
    const g1 = guardians[0];
    if (!g1?.lastName.trim()) return 'Guardian 1 surname is required';
    if (!g1?.firstName.trim()) return 'Guardian 1 other names are required';
    if (!g1?.relationship) return 'Guardian 1 relationship is required';
    if (!g1?.phone.trim()) return 'Guardian 1 phone number is required';
    const g2 = guardians[1];
    if (g2 && (g2.firstName.trim() || g2.lastName.trim() || g2.phone.trim()) && !g2.firstName.trim()) return 'Guardian 2 other names are required';
    const missing = missingRequired(cfDefs, ownCf);
    if (missing.length) return `Also required: ${missing.join(', ')}`;
    return null;
  };

  const goNext = () => {
    const err = validateStep1();
    if (err) { notify.error(err); return; }
    setStep(2);
    window.scrollTo({ top: 0 });
  };

  const guardianPayload = (): InlineGuardianInput[] =>
    filledGuardians().map((g) => ({
      firstName: g.firstName.trim(),
      lastName: g.lastName.trim() || undefined,
      relationship: g.relationship || undefined,
      phone: g.phone.trim() || undefined,
      email: g.email.trim() || undefined,
      occupation: g.occupation.trim() || undefined,
    }));

  const customFields = (): Record<string, unknown> => {
    const extras: Record<string, unknown> = {};
    for (const k of CF_KEYS) if (form[k]?.trim()) extras[k] = form[k].trim();
    return { ...extras, ...pickCustomFieldValues(cfDefs, ownCf) };
  };

  const save = async (override?: { duplicateReason: string }) => {
    const common = {
      name: fullName(),
      dateOfBirth: form.dateOfBirth || undefined,
      gender: (form.gender || undefined) as 'male' | 'female' | 'other' | undefined,
      nationality: form.nationality || undefined,
      religion: form.religion || undefined,
      residenceType: (form.residenceType || undefined) as 'day' | 'boarder' | undefined,
      studentCategoryId: form.studentCategoryId || undefined,
      email: form.email?.trim() || undefined,
      phone: form.phone?.trim() || undefined,
      address: form.address?.trim() || undefined,
      entryStatus: form.entryStatus || undefined,
      nin: form.nin?.trim() || undefined,
      classId: form.classId,
      sectionId: form.sectionId || undefined,
      termId: form.termId || undefined,
      guardians: guardianPayload(),
      customFields: customFields(),
      ...(override ? { allowDuplicate: true, duplicateReason: override.duplicateReason } : {}),
    };
    try {
      let id: string | undefined;
      if (isRegister) {
        const res = await register.mutateAsync({
          ...common,
          termId: form.termId,
          admissionNo: form.admissionNo?.trim() || undefined,
          enrollmentDate: form.admissionDate,
          rollNumber: form.rollNumber.trim(),
        });
        id = res?.profile?.id;
        notify.success('Student registered and placed');
      } else {
        const res = await create.mutateAsync({
          ...common,
          admissionNo: form.admissionNo.trim(),
          enrollmentDate: form.admissionDate,
        });
        id = res?.id;
        notify.success('Student admitted');
      }
      setDupes(null);
      navigate(id ? `/school/students/${id}` : '/school/students');
    } catch (e: any) {
      const matches = likelyDuplicatesFrom(e);
      if (matches) {
        setDupes({ matches, retry: (duplicateReason) => save({ duplicateReason }) });
        return;
      }
      notify.error(e?.response?.data?.message ?? (isRegister ? 'Could not register student' : 'Could not admit student'));
    }
  };

  const busy = create.isPending || register.isPending;

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/school/students')}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {isRegister ? <Zap className="h-5 w-5" /> : <GraduationCap className="h-5 w-5" />} {title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isRegister
              ? 'Register the pupil and place them in a class in one step.'
              : 'Pupil details, class placement and guardians.'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <StepDot label="Student Information" active={step === 1} done={step === 2} />
        <div className="h-px w-10 bg-border" />
        <StepDot label="Confirmation" active={step === 2} muted={step === 1} />
      </div>

      {step === 1 ? (
        <div className="space-y-5">
          <Card><CardContent className="p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><User className="h-4 w-4" /> Student Information</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Surname" required><Input value={form.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} placeholder="E.g. Atimango" /></Field>
              <Field label="Other names" required><Input value={form.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} placeholder="E.g. Isabelle Atweoki" /></Field>
              <Field label="Admission no." required={!isRegister}>
                <Input value={form.admissionNo ?? ''} onChange={(e) => set('admissionNo', e.target.value)} placeholder={isRegister ? 'Auto if blank' : 'E.g. 2026/0123'} />
              </Field>
              <Field label="Admission date" required><Input type="date" value={form.admissionDate ?? ''} onChange={(e) => set('admissionDate', e.target.value)} /></Field>
              <Field label="Date of birth" required><Input type="date" value={form.dateOfBirth ?? ''} onChange={(e) => set('dateOfBirth', e.target.value)} /></Field>
              <Field label="Gender" required>
                <Select value={form.gender ?? ''} onChange={(v) => set('gender', v)} options={[['', 'Choose a gender'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other']]} />
              </Field>
              <Field label="Nationality" required>
                <Select
                  value={form.nationality ?? ''}
                  onChange={(v) => set('nationality', v)}
                  options={[
                    ['', 'Choose a nationality'],
                    ...(activeNationalities.length
                      ? activeNationalities.map((n: any) => [n.name, n.name] as [string, string])
                      : FALLBACK_NATIONALITIES.map((n) => [n, n] as [string, string])),
                  ]}
                />
              </Field>
              <Field label="Student category">
                <Select
                  value={form.studentCategoryId ?? ''}
                  onChange={(v) => set('studentCategoryId', v)}
                  options={[
                    ['', studentCategories?.length ? 'Choose a category' : 'No categories configured'],
                    ...(studentCategories ?? []).filter((c: any) => c.isActive).map((c: any) => [c.id, c.name] as [string, string]),
                  ]}
                />
              </Field>
              <Field label="Entry status" required>
                <Select value={form.entryStatus ?? ''} onChange={(v) => set('entryStatus', v)} options={[['', 'Choose entry status'], ...ENTRY_STATUSES.map((n) => [n, n] as [string, string])]} />
              </Field>
              <Field label="Residential status" required>
                <Select value={form.residenceType ?? ''} onChange={(v) => set('residenceType', v)} options={[['', 'Choose residential status'], ...RESIDENTIAL]} />
              </Field>
              <Field label="Religion">
                <Select value={form.religion ?? ''} onChange={(v) => set('religion', v)} options={[['', 'Choose a religion'], ...RELIGIONS.map((n) => [n, n] as [string, string])]} />
              </Field>
              <Field label="Former school"><Input value={form.formerSchool ?? ''} onChange={(e) => set('formerSchool', e.target.value)} placeholder="Optional" /></Field>
              <Field label="Home address" full>
                <Input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} placeholder="E.g. Plot 5, Kampala Road" />
              </Field>
              <Field label="National Identification Number"><Input value={form.nin ?? ''} onChange={(e) => set('nin', e.target.value)} placeholder="E.g. CM973535343" /></Field>
              <Field label="Learner's Identification Number"><Input value={form.learnerId ?? ''} onChange={(e) => set('learnerId', e.target.value)} placeholder="Enter learner's identification number" /></Field>
              <Field label="School pay code"><Input value={form.schoolPayCode ?? ''} onChange={(e) => set('schoolPayCode', e.target.value)} placeholder="Enter student's school pay code" /></Field>
              <Field label="Student email"><Input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="Optional" /></Field>
              <Field label="Student phone"><Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="Optional" /></Field>
            </div>
            <CustomFieldsSection entityType="student" values={ownCf} onChange={setOwnCf} className="mt-4 grid grid-cols-1 gap-3 border-t pt-4 md:grid-cols-2" />
          </CardContent></Card>

          <Card><CardContent className="p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><GraduationCap className="h-4 w-4" /> Class placement</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Term" required={isRegister}>
                <Select
                  value={form.termId ?? ''}
                  onChange={(v) => set('termId', v)}
                  options={[['', isRegister ? 'Choose term' : 'Current term'], ...(terms?.data ?? []).map((t) => [t.id, t.isCurrent ? `${t.name} (current)` : t.name] as [string, string])]}
                />
              </Field>
              <Field label="Class" required>
                <Select
                  value={form.classId ?? ''}
                  onChange={(v) => setForm((f) => ({ ...f, classId: v, sectionId: '' }))}
                  options={[['', 'Choose a class'], ...(classes?.data ?? []).map((c) => [c.id, c.name] as [string, string])]}
                />
              </Field>
              <Field label={labels.section} required={classSections.length > 0}>
                <select
                  className="w-full rounded-md border bg-card px-3 py-2 text-sm"
                  value={form.sectionId ?? ''}
                  disabled={!form.classId || classSections.length === 0}
                  onChange={(e) => set('sectionId', e.target.value)}
                >
                  <option value="">
                    {!form.classId ? 'Choose a class first' : classSections.length ? `Choose a ${labels.section.toLowerCase()}` : 'Not divided'}
                  </option>
                  {classSections.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              {isRegister && (
                <Field label="Roll number" required><Input value={form.rollNumber ?? ''} onChange={(e) => set('rollNumber', e.target.value)} placeholder="E.g. 23" /></Field>
              )}
            </div>
          </CardContent></Card>

          <GuardianCard index={0} title="Guardian 1" required guardians={guardians} setG={setG} />
          {guardians.length < 2 ? (
            <Button variant="outline" size="sm" onClick={() => setGuardians((gs) => [...gs, emptyGuardian()])}><Plus className="h-3.5 w-3.5" /> Add Guardian 2</Button>
          ) : (
            <GuardianCard index={1} title="Guardian 2 (Optional)" required={false} guardians={guardians} setG={setG} onRemove={() => setGuardians((gs) => gs.slice(0, 1))} />
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => navigate('/school/students')}>Cancel</Button>
            <Button onClick={goNext} disabled={busy}><span>Next</span><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <Card><CardContent className="p-5">
            <h3 className="mb-4 text-sm font-semibold">Confirmation</h3>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
              <Row k="Surname" v={form.lastName} />
              <Row k="Other names" v={form.firstName} />
              <Row k="Admission no." v={form.admissionNo || (isRegister ? 'Auto-generated' : '')} />
              <Row k="Admission date" v={form.admissionDate} />
              <Row k="Date of birth" v={form.dateOfBirth} />
              <Row k="Gender" v={form.gender} />
              <Row k="Nationality" v={form.nationality} />
              <Row k="Student category" v={categoryName(form.studentCategoryId)} />
              <Row k="Entry status" v={form.entryStatus} />
              <Row k="Residential status" v={form.residenceType} />
              <Row k="Religion" v={form.religion} />
              <Row k="Former school" v={form.formerSchool} />
              <Row k="Home address" v={form.address} />
              <Row k="NIN" v={form.nin} />
              <Row k="Learner ID" v={form.learnerId} />
              <Row k="School pay code" v={form.schoolPayCode} />
              <Row k="Student email" v={form.email} />
              <Row k="Student phone" v={form.phone} />
              <Row k="Term" v={form.termId ? termName(form.termId) : 'Current term'} />
              <Row k="Class" v={className(form.classId)} />
              <Row k={labels.section} v={classSections.find((s: any) => s.id === form.sectionId)?.name} />
              {isRegister && <Row k="Roll number" v={form.rollNumber} />}
            </dl>
          </CardContent></Card>

          {filledGuardians().map((g, i) => (
            <Card key={i}><CardContent className="p-5">
              <h4 className="mb-3 text-sm font-semibold">{i === 0 ? 'Guardian 1' : 'Guardian 2'}</h4>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
                <Row k="Surname" v={g.lastName} />
                <Row k="Other names" v={g.firstName} />
                <Row k="Relationship" v={g.relationship} />
                <Row k="Phone" v={g.phone} />
                <Row k="Email" v={g.email} />
                <Row k="Occupation" v={g.occupation} />
              </dl>
            </CardContent></Card>
          ))}

          <div className="flex flex-wrap gap-3">
            <Button variant="ghost" onClick={() => setStep(1)}><ChevronLeft className="h-4 w-4" /> Back</Button>
            <Button onClick={() => void save()} disabled={busy}>
              {isRegister ? <><Zap className="h-4 w-4" /> Register &amp; place</> : <><GraduationCap className="h-4 w-4" /> Admit student</>}
            </Button>
          </div>
        </div>
      )}

      <DuplicatePupilDialog
        matches={dupes?.matches ?? null}
        name={fullName() || 'This pupil'}
        pending={busy}
        onCancel={() => setDupes(null)}
        onConfirmDifferent={(reason) => void dupes?.retry(reason)}
      />
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
  guardians: GuardianRow[];
  setG: (i: number, patch: Partial<GuardianRow>) => void;
  onRemove?: () => void;
}) {
  const g = guardians[index];
  return (
    <Card><CardContent className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}{required && <span className="text-rose-500"> *</span>}</h3>
        {onRemove && <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove guardian"><Trash2 className="h-3.5 w-3.5" /></Button>}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Surname" required={required}><Input value={g.lastName} onChange={(e) => setG(index, { lastName: e.target.value })} placeholder="E.g. Okello" /></Field>
        <Field label="Other names" required={required}><Input value={g.firstName} onChange={(e) => setG(index, { firstName: e.target.value })} placeholder="E.g. James Paul" /></Field>
        <Field label="Relationship" required={required}>
          <Select value={g.relationship} onChange={(v) => setG(index, { relationship: v })} options={[['', 'Choose a relationship'], ...RELATIONSHIPS.map((r) => [r, r[0].toUpperCase() + r.slice(1)] as [string, string])]} />
        </Field>
        <Field label="Phone number" required={required}><Input value={g.phone} onChange={(e) => setG(index, { phone: e.target.value })} placeholder="E.g. 0700123456" /></Field>
        <Field label="Email address"><Input type="email" value={g.email} onChange={(e) => setG(index, { email: e.target.value })} placeholder="E.g. guardian@email.com" /></Field>
        <Field label="Occupation"><Input value={g.occupation} onChange={(e) => setG(index, { occupation: e.target.value })} placeholder="Optional" /></Field>
      </div>
    </CardContent></Card>
  );
}

function Field({ label, required, full, children }: { label: string; required?: boolean; full?: boolean; children: React.ReactNode }) {
  return <div className={full ? 'space-y-1 md:col-span-2 lg:col-span-4' : 'space-y-1'}><Label className="text-xs">{label}{required && <span className="text-rose-500"> *</span>}</Label>{children}</div>;
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (<><dt className="text-muted-foreground">{k}</dt><dd className="font-medium capitalize">{v || '—'}</dd></>);
}
