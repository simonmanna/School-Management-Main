import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronRight, Info, UserCheck, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';
import { date as fmtDate, useMoneyFormatter, useSchoolToday } from '@/lib/format';
import {
  useAcademicYears,
  useAdmissionEligibility,
  useClasses,
  useEnrollAdmission,
  useFeeStructures,
  useIdentityMatches,
  useSections,
  useStudentCategories,
  useTerminology,
  useTerms,
  type AdmissionApplication,
  type EnrollAdmissionInput,
  type EnrollAdmissionResult,
  type FeeStructure,
} from '@/features/school/api';
import { useAcademicLevels, useEnrollmentsForStudent } from '@/features/school/enrollment-api';
import { STAGE_LABELS } from './admission-status';
import { CustomFieldsSection, missingRequired, pickCustomFieldValues, useCustomFieldDefs } from '@/features/school/custom-fields';
import { ApplicationFeeDialog } from '../fees-integrity';

type EnrollmentType = NonNullable<EnrollAdmissionInput['enrollmentType']>;

const ENROLLMENT_TYPES: Array<{ value: EnrollmentType; label: string; returning: boolean }> = [
  { value: 'NEW', label: 'New admission', returning: false },
  { value: 'TRANSFER_IN', label: 'Transfer-in', returning: false },
  { value: 'RE_ENTRY', label: 'Re-entry (returning pupil)', returning: true },
  { value: 'CONTINUING', label: 'Continuing', returning: true },
];

const CLOSED_YEAR = new Set(['CLOSED', 'ARCHIVED']);
const field = 'w-full rounded-md border bg-card px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60';

const blankForm = {
  termId: '',
  enrollmentType: 'NEW' as EnrollmentType,
  levelId: '',
  classId: '',
  sectionId: '',
  enrollmentDate: '',
  enrollmentStatus: 'ACTIVE' as 'ACTIVE' | 'PENDING',
  studentCategoryId: '',
  rollNumber: '',
  prevName: '',
  prevLocation: '',
  prevClass: '',
  prevYear: '',
  prevTcRef: '',
  remarks: '',
  specialNotes: '',
  internalNotes: '',
  documentRefs: '',
};

/**
 * The one way an accepted application becomes a learner (F18). Admissions and the
 * front-desk Applications list both open this.
 *
 * Structured as the school's academic hierarchy: Academic Year → Level → Class →
 * Stream. The server creates a StudentEnrollment (membership of the year) and a
 * separate effective-dated EnrollmentPlacement (class + stream) in one
 * transaction, and re-checks every rule shown here — closed years, duplicate
 * enrollment, capacity, eligibility, identity. Fees are only previewed: billing
 * runs separately, so enrolling never creates invoices, receipts or journals.
 */
export function EnrollApplicationDialog({ app, onClose }: { app: AdmissionApplication | null; onClose: () => void }) {
  const navigate = useNavigate();
  const labels = useTerminology();
  const today = useSchoolToday();
  const money = useMoneyFormatter();
  const { data: terms } = useTerms();
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const { data: sections } = useSections();
  const { data: levels } = useAcademicLevels();
  const { data: categories } = useStudentCategories();
  const { data: feeStructures } = useFeeStructures();
  const { data: eligibility } = useAdmissionEligibility(app?.id);
  const { data: matches } = useIdentityMatches(app?.id);
  const enroll = useEnrollAdmission();
  const [feeFor, setFeeFor] = useState<AdmissionApplication | null>(null);
  const [form, setForm] = useState(blankForm);
  const [done, setDone] = useState<EnrollAdmissionResult | null>(null);
  // R03: the school's own pupil fields. Answers the family gave on the
  // application are pre-filled; anything required and still blank is asked here.
  const { data: cfDefs } = useCustomFieldDefs('student');
  const [cf, setCf] = useState<Record<string, unknown>>({});
  const set = <K extends keyof typeof blankForm>(k: K, v: (typeof blankForm)[K]) => setForm((f) => ({ ...f, [k]: v }));

  // ── Learner identity: one child, one record.
  const confirmed = (matches ?? []).find((m) => m.status === 'confirmed_same' && m.candidateType === 'student');
  const openMatches = (matches ?? []).filter((m) => m.status === 'open' && m.candidateType === 'student');
  const { data: priorEnrollments } = useEnrollmentsForStudent(confirmed?.candidateId);

  // ── Academic structure, filtered top-down.
  const year = (years?.data ?? []).find((y) => y.id === app?.academicYearId);
  const yearName = year?.name ?? app?.academicYear?.name ?? 'the academic year applied for';
  const yearClosed = !!year?.status && CLOSED_YEAR.has(year.status);
  // Only terms of the year the family applied for — the API refuses any other.
  const yearTerms = useMemo(
    () => (terms?.data ?? []).filter((t) => app && t.academicYearId === app.academicYearId),
    [terms?.data, app],
  );
  const activeClasses = useMemo(
    () =>
      (classes?.data ?? [])
        .filter((c) => c.isActive !== false)
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name)),
    [classes?.data],
  );
  const levelOfGrade = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of levels ?? []) for (const g of l.gradeLevels ?? []) m.set(g.id, l.id);
    return m;
  }, [levels]);
  const levelOptions = (levels ?? []).filter((l) => activeClasses.some((c) => levelOfGrade.get(c.gradeLevelId) === l.id));
  const hasLevels = levelOptions.length > 0;
  const levelClasses = hasLevels && form.levelId
    ? activeClasses.filter((c) => levelOfGrade.get(c.gradeLevelId) === form.levelId)
    : hasLevels ? [] : activeClasses;
  const selectedClass = activeClasses.find((c) => c.id === form.classId);
  const classSections = (sections?.data ?? []).filter((x) => x.classId === form.classId);
  // A stream is required only when the class is configured to be streamed and has streams.
  const streamRequired = !!selectedClass && selectedClass.allowsStreams !== false && classSections.length > 0;
  const term = yearTerms.find((t) => t.id === form.termId);

  useEffect(() => {
    if (!app) return;
    const a: any = app;
    const applied = (classes?.data ?? []).find((c) => c.id === app.applyingForClassId);
    const entry = String(a.entryStatus ?? '').toLowerCase();
    setForm({
      ...blankForm,
      termId: (yearTerms.find((t) => t.isCurrent) ?? yearTerms[0])?.id ?? '',
      enrollmentType: confirmed ? 'RE_ENTRY' : entry.startsWith('transfer') ? 'TRANSFER_IN' : 'NEW',
      levelId: applied ? levelOfGrade.get(applied.gradeLevelId) ?? '' : '',
      classId: app.applyingForClassId ?? '',
      enrollmentDate: today,
      studentCategoryId: app.studentCategoryId ?? '',
      prevName: typeof a.customFields?.previousSchool === 'string' ? a.customFields.previousSchool : '',
    });
    setCf({ ...(a.customFields ?? {}) });
    setDone(null);
  }, [app?.id, yearTerms.length, classes?.data?.length, levelOfGrade.size, confirmed?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fee preview: the same targeting the billing run uses (class, grade, residence).
  const residence = String((app as any)?.residenceType ?? 'day');
  const feePreview = useMemo(() => {
    if (!app || !selectedClass) return [];
    return (feeStructures?.data ?? [])
      .filter((s) => s.academicYearId === app.academicYearId && s.isActive !== false && s.status !== 'archived')
      .filter((s) => appliesTo(s, selectedClass.id, selectedClass.gradeLevelId, residence))
      .filter((s) => !s.schedules?.length || !form.termId || s.schedules.some((x) => x.termId === form.termId))
      .map((s) => ({
        id: s.id,
        name: s.name,
        published: s.status === 'published' || !!s.currentVersionId,
        mandatory: s.components.filter((c) => !c.isOptional).reduce((n, c) => n + Number(c.amount || 0), 0),
        optional: s.components.filter((c) => c.isOptional).reduce((n, c) => n + Number(c.amount || 0), 0),
        dueDate: s.schedules?.find((x) => x.termId === form.termId)?.dueDate ?? null,
      }));
  }, [app, feeStructures?.data, selectedClass, residence, form.termId]);
  const expectedFees = feePreview.reduce((n, s) => n + s.mandatory, 0);

  if (!app) return null;
  const a: any = app;

  const sameYearEnrollment = (priorEnrollments ?? []).find((e) => e.academicYearId === app.academicYearId);
  const lastEnrollment = [...(priorEnrollments ?? [])].sort((x, y) => String(y.admissionDate).localeCompare(String(x.admissionDate)))[0];
  const blocked = eligibility?.status === 'BLOCKED';
  const cfMissing = missingRequired(cfDefs, cf);
  const typeMeta = ENROLLMENT_TYPES.find((t) => t.value === form.enrollmentType);
  const categoryChanged = !!app.studentCategoryId && form.studentCategoryId !== app.studentCategoryId;
  const dateAfterTerm = !!term?.endDate && !!form.enrollmentDate && form.enrollmentDate > String(term.endDate).slice(0, 10);
  const dateBeforeTerm = !!term?.startDate && !!form.enrollmentDate && form.enrollmentDate < String(term.startDate).slice(0, 10);

  const problems: string[] = [];
  if (yearClosed) problems.push(`${yearName} is ${year!.status!.toLowerCase()} and takes no new enrollments.`);
  if (openMatches.length) problems.push('Resolve the possible existing-pupil match on the application first.');
  if (sameYearEnrollment) problems.push(`This learner already has a ${yearName} enrollment (${sameYearEnrollment.status.toLowerCase()}).`);
  if (typeMeta?.returning && !confirmed) problems.push(`${typeMeta.label} is only for a confirmed existing pupil.`);
  if (dateAfterTerm) problems.push(`The enrollment date is after ${term!.name} ends.`);

  const ready =
    !!form.termId && !!form.classId && (!hasLevels || !!form.levelId) && (!streamRequired || !!form.sectionId) &&
    !!form.enrollmentDate && !!form.rollNumber.trim() && !blocked && cfMissing.length === 0 && problems.length === 0;

  const className = selectedClass?.name;
  const streamName = classSections.find((x) => x.id === form.sectionId)?.name;

  const submit = async () => {
    const notes = [
      form.remarks.trim() && `Remarks: ${form.remarks.trim()}`,
      form.specialNotes.trim() && `Special admission notes: ${form.specialNotes.trim()}`,
      form.internalNotes.trim() && `Internal: ${form.internalNotes.trim()}`,
      form.documentRefs.trim() && `Supporting documents: ${form.documentRefs.trim()}`,
    ].filter(Boolean).join('\n');
    const previousSchool = {
      name: form.prevName.trim() || undefined,
      location: form.prevLocation.trim() || undefined,
      lastClass: form.prevClass.trim() || undefined,
      lastYear: form.prevYear.trim() || undefined,
      transferCertificateRef: form.prevTcRef.trim() || undefined,
    };
    const student: EnrollAdmissionInput['student'] = {
      ...(cfDefs?.length ? { customFields: pickCustomFieldValues(cfDefs, cf) } : {}),
      ...(form.studentCategoryId && form.studentCategoryId !== app.studentCategoryId ? { studentCategoryId: form.studentCategoryId } : {}),
    };
    try {
      const res = await enroll.mutateAsync({
        applicationId: app.id,
        classId: form.classId,
        sectionId: form.sectionId || undefined,
        termId: form.termId,
        rollNumber: form.rollNumber.trim(),
        enrollmentType: form.enrollmentType,
        enrollmentDate: form.enrollmentDate,
        enrollmentStatus: form.enrollmentStatus,
        ...(notes ? { notes } : {}),
        ...(Object.values(previousSchool).some(Boolean) ? { previousSchool } : {}),
        ...(Object.keys(student).length ? { student } : {}),
        ...(categoryChanged ? { confirmOverrides: true } : {}),
      });
      setDone(res);
      notify.success(`${app.applicantFirstName} ${app.applicantLastName} enrolled into ${[className, streamName].filter(Boolean).join(' — ') || 'the selected class'}`);
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      notify.error(Array.isArray(msg) ? msg.join('; ') : msg ?? 'Enrollment failed');
    }
  };

  const fullName = `${app.applicantFirstName} ${app.applicantLastName}`;

  // ── Confirmation view.
  if (done) {
    const profileId = done.studentProfileId ?? done.studentProfile?.id;
    const rows: Array<[string, string]> = [
      ['Learner', fullName],
      ['Admission no.', done.studentProfile?.admissionNo ?? '—'],
      ['Enrollment ref.', done.enrollment?.id ? done.enrollment.id.slice(0, 8).toUpperCase() : '—'],
      ['Academic year', yearName],
      ['Term', term?.name ?? '—'],
      ['Class', [className, streamName].filter(Boolean).join(' · ') || '—'],
      ['Enrollment type', typeMeta?.label ?? form.enrollmentType],
      ['Status', (done.enrollment?.status ?? form.enrollmentStatus).toLowerCase()],
      ['Effective from', fmtDate(done.enrollment?.admissionDate ?? form.enrollmentDate)],
    ];
    return (
      <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <DialogTitle>Learner enrolled</DialogTitle>
            <DialogDescription>
              {fullName} is on the {[className, streamName].filter(Boolean).join(' ')} roster and can be marked for attendance, timetable and assessments.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/30 p-3 text-sm">
            {rows.map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium first-letter:uppercase">{v}</dd></div>
            ))}
          </dl>
          <p className="flex gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No invoice was raised. Term fees are billed by the billing run, which skips learners already billed.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>Done</Button>
            {profileId && (
              <Button onClick={() => { onClose(); navigate(`/school/students/${profileId}`); }}>
                Open learner profile <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const facts: Array<[string, string]> = [
    ['Application no.', app.applicationNumber],
    ['Gender', app.applicantGender ?? '—'],
    ['Date of birth', app.applicantDob ? fmtDate(app.applicantDob) : '—'],
    ['Residence', a.residenceType ?? 'day'],
    ['Nationality', a.nationality ?? '—'],
    ['Previous enrollment', lastEnrollment ? `${lastEnrollment.academicYear?.name ?? ''} ${lastEnrollment.gradeLevel?.name ?? ''}`.trim() || '—' : 'None'],
  ];

  return (
    <>
      <Dialog open onOpenChange={(v) => { if (!v && !enroll.isPending) onClose(); }}>
        <DialogContent className="flex max-h-[92vh] max-w-3xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-6 pb-4 pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-primary">New enrollment</p>
            <DialogTitle className="text-xl">Enroll learner</DialogTitle>
            <DialogDescription>
              Register the learner into an academic year and assign their initial class placement.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {!!a.workflow?.skippedStages?.length && (
              <Notice tone="info">
                This workflow enrols directly; {a.workflow.skippedStages.map((s: string) => STAGE_LABELS[s] ?? s).join(', ')} will be recorded as skipped.
              </Notice>
            )}
            {blocked && (
              <Notice tone="warn">
                <p className="font-medium">This applicant cannot be enrolled yet:</p>
                <ul className="mt-1 list-disc pl-5">{eligibility!.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                {eligibility!.missing.some((m) => m.includes('application fee')) && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setFeeFor(app)}>Take fee payment</Button>
                )}
              </Notice>
            )}

            {/* 01 — Learner */}
            <Section n="01" title="Learner information">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {(app.applicantFirstName?.[0] ?? '') + (app.applicantLastName?.[0] ?? '')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{fullName}</p>
                      {confirmed ? (
                        <Badge className="bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"><UserCheck className="mr-1 h-3 w-3" />Existing pupil</Badge>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><UserPlus className="mr-1 h-3 w-3" />New learner</Badge>
                      )}
                      {sameYearEnrollment && <Badge className="bg-amber-100 text-amber-800">Already enrolled {yearName}</Badge>}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                      {facts.map(([k, v]) => (
                        <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="capitalize">{v}</dd></div>
                      ))}
                    </dl>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {confirmed
                  ? `Confirmed as ${confirmed.candidateName}. The existing record gets a new ${yearName} enrollment — no duplicate learner is created.`
                  : openMatches.length
                    ? `Possible existing pupil: ${openMatches.map((m) => m.candidateName).join(', ')}. Confirm or dismiss the match on the application before enrolling.`
                    : 'A learner record is created from the application. Details carry over and are not asked again.'}
              </p>
            </Section>

            {/* 02 — Academic enrollment */}
            <Section n="02" title="Academic enrollment">
              <div className="grid gap-4 sm:grid-cols-3">
                <F label="Academic year" required hint={yearClosed ? 'Closed — no new enrollments' : 'From the application'}>
                  <div className={`${field} flex items-center justify-between bg-muted/40`}>
                    <span>{yearName}</span>
                    {year?.status && <span className={`text-xs ${yearClosed ? 'text-rose-600' : 'text-muted-foreground'}`}>{year.status.toLowerCase()}</span>}
                  </div>
                </F>
                <F label="Term" required id="enrol-term" hint={yearTerms.length ? undefined : `Create the terms for ${yearName} first.`}>
                  <select id="enrol-term" className={field} value={form.termId} disabled={!yearTerms.length} onChange={(e) => set('termId', e.target.value)}>
                    <option value="">{yearTerms.length ? 'Choose term' : `No terms for ${yearName}`}</option>
                    {yearTerms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isCurrent ? ' (current)' : ''}</option>)}
                  </select>
                </F>
                <F label="Enrollment type" required id="enrol-type">
                  <select id="enrol-type" className={field} value={form.enrollmentType} onChange={(e) => set('enrollmentType', e.target.value as EnrollmentType)}>
                    {ENROLLMENT_TYPES.filter((t) => !t.returning || confirmed).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </F>
              </div>
            </Section>

            {/* 03 — Class placement */}
            <Section n="03" title="Class placement" aside="Effective-dated — transfers and promotions keep this history">
              <div className="grid gap-4 sm:grid-cols-3">
                {hasLevels && (
                  <F label="Academic level" required id="enrol-level">
                    <select id="enrol-level" className={field} value={form.levelId} onChange={(e) => setForm((f) => ({ ...f, levelId: e.target.value, classId: '', sectionId: '' }))}>
                      <option value="">Choose level</option>
                      {levelOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </F>
                )}
                <F label="Grade / class" required id="enrol-class" hint={selectedClass?.capacity ? `Capacity ${selectedClass.capacity} — enforced on save` : undefined}>
                  {/* Changing class clears a stream that belongs to the old class. */}
                  <select id="enrol-class" className={field} value={form.classId} disabled={hasLevels && !form.levelId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value, sectionId: '' }))}>
                    <option value="">{hasLevels && !form.levelId ? 'Choose a level first' : 'Choose class'}</option>
                    {levelClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </F>
                <F
                  label={labels.section}
                  required={streamRequired}
                  id="enrol-section"
                  hint={form.sectionId ? (classSections.find((x) => x.id === form.sectionId)?.capacity ? `Capacity ${classSections.find((x) => x.id === form.sectionId)!.capacity}` : undefined) : undefined}
                >
                  <select id="enrol-section" className={field} value={form.sectionId} disabled={!form.classId || !classSections.length} onChange={(e) => set('sectionId', e.target.value)}>
                    <option value="">
                      {!form.classId ? 'Choose a class first' : classSections.length ? (streamRequired ? `Choose ${labels.section.toLowerCase()}` : `No ${labels.section.toLowerCase()}`) : `Not streamed`}
                    </option>
                    {classSections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </F>
                <F
                  label="Enrollment date"
                  required
                  id="enrol-date"
                  hint={dateBeforeTerm ? `Placement starts ${fmtDate(term!.startDate)}, when ${term!.name} begins.` : undefined}
                >
                  <Input id="enrol-date" type="date" value={form.enrollmentDate} max={term?.endDate ? String(term.endDate).slice(0, 10) : undefined} onChange={(e) => set('enrollmentDate', e.target.value)} />
                </F>
                {eligibility?.capacity && form.classId === app.applyingForClassId && (
                  <div className="self-end pb-2 text-xs text-muted-foreground sm:col-span-2">
                    {eligibility.capacity.available} of {eligibility.capacity.capacity} admission seats available in this class.
                  </div>
                )}
              </div>
            </Section>

            {/* 04 — Enrollment details */}
            <Section n="04" title="Enrollment details">
              <div className="grid gap-4 sm:grid-cols-3">
                <F label="Enrollment status" required id="enrol-status" hint={form.enrollmentStatus === 'PENDING' ? 'Held — not yet counted as attending' : undefined}>
                  <select id="enrol-status" className={field} value={form.enrollmentStatus} onChange={(e) => set('enrollmentStatus', e.target.value as 'ACTIVE' | 'PENDING')}>
                    <option value="ACTIVE">Active</option>
                    <option value="PENDING">Pending</option>
                  </select>
                </F>
                <F label="Admission category" id="enrol-category" hint={categoryChanged ? 'Changes the category on the application' : undefined}>
                  <select id="enrol-category" className={field} value={form.studentCategoryId} onChange={(e) => set('studentCategoryId', e.target.value)}>
                    <option value="">Regular</option>
                    {(categories ?? []).filter((c) => c.isActive !== false).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </F>
                <F label="Roll number" required id="enrol-roll">
                  <Input id="enrol-roll" value={form.rollNumber} placeholder="E.g. 23" onChange={(e) => set('rollNumber', e.target.value)} />
                </F>
              </div>
            </Section>

            {/* 05 — Financial preview */}
            <Section n="05" title="Financial preview">
              <div className="rounded-lg border">
                {!selectedClass ? (
                  <p className="p-4 text-sm text-muted-foreground">Choose a class to preview the applicable fee structure.</p>
                ) : feePreview.length === 0 ? (
                  <p className="flex gap-2 p-4 text-sm text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    No fee structure for {yearName} targets {selectedClass.name} ({residence}){term ? ` in ${term.name}` : ''}. The learner will be skipped by the billing run until one exists.
                  </p>
                ) : (
                  <>
                    <ul className="divide-y text-sm">
                      {feePreview.map((s) => (
                        <li key={s.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                          <div>
                            <p className="font-medium">{s.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {s.published ? 'Published' : 'Draft — not billable yet'}
                              {s.dueDate ? ` · due ${fmtDate(s.dueDate)}` : ''}
                              {s.optional ? ` · optional items ${money(s.optional)}` : ''}
                            </p>
                          </div>
                          <span className="tabular-nums">{money(s.mandatory)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-3">
                      <span className="text-sm font-medium">Expected term fees</span>
                      <span className="text-lg font-semibold tabular-nums">{money(expectedFees)}</span>
                    </div>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Previewed from the fee structures, before category discounts, scholarships or sponsorships. Enrolling raises no
                invoice, receipt or journal — the term billing run does, once per learner.
              </p>
            </Section>

            {/* Optional, collapsible */}
            <div className="space-y-2">
              <Collapsible title="Previous school" subtitle="For new admissions and transfer-in learners" defaultOpen={form.enrollmentType === 'TRANSFER_IN' || !!form.prevName}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <F label="School name" id="prev-name"><Input id="prev-name" value={form.prevName} onChange={(e) => set('prevName', e.target.value)} /></F>
                  <F label="Location" id="prev-loc"><Input id="prev-loc" value={form.prevLocation} placeholder="E.g. Mukono" onChange={(e) => set('prevLocation', e.target.value)} /></F>
                  <F label="Last class / grade" id="prev-class"><Input id="prev-class" value={form.prevClass} placeholder="E.g. P.2" onChange={(e) => set('prevClass', e.target.value)} /></F>
                  <F label="Last academic year attended" id="prev-year"><Input id="prev-year" value={form.prevYear} placeholder="E.g. 2025" onChange={(e) => set('prevYear', e.target.value)} /></F>
                  <F label="Transfer certificate ref." id="prev-tc"><Input id="prev-tc" value={form.prevTcRef} onChange={(e) => set('prevTcRef', e.target.value)} /></F>
                </div>
              </Collapsible>

              <Collapsible title="Additional information" subtitle="Remarks, notes and document references">
                <div className="grid gap-4 sm:grid-cols-2">
                  <F label="Enrollment remarks" id="add-remarks"><Textarea id="add-remarks" value={form.remarks} onChange={(v) => set('remarks', v)} /></F>
                  <F label="Special admission notes" id="add-special"><Textarea id="add-special" value={form.specialNotes} onChange={(v) => set('specialNotes', v)} /></F>
                  <F label="Internal administrative notes" id="add-internal"><Textarea id="add-internal" value={form.internalNotes} onChange={(v) => set('internalNotes', v)} /></F>
                  <F label="Supporting document references" id="add-docs"><Textarea id="add-docs" value={form.documentRefs} placeholder="E.g. Birth cert. no., report card" onChange={(v) => set('documentRefs', v)} /></F>
                </div>
              </Collapsible>

              {!!cfDefs?.length && (
                <Collapsible
                  title="School fields"
                  subtitle={cfMissing.length ? `Still required: ${cfMissing.join(', ')}` : 'Pre-filled from the application'}
                  defaultOpen={cfMissing.length > 0}
                  warn={cfMissing.length > 0}
                >
                  <CustomFieldsSection entityType="student" values={cf} onChange={setCf} className="grid gap-4 sm:grid-cols-2" />
                </Collapsible>
              )}
            </div>

            {problems.length > 0 && (
              <Notice tone="error">
                <ul className="list-disc space-y-0.5 pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </Notice>
            )}
          </div>

          <DialogFooter className="border-t px-6 py-4">
            <Button variant="ghost" onClick={onClose} disabled={enroll.isPending}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={!ready || enroll.isPending}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> {enroll.isPending ? 'Enrolling…' : 'Enroll learner'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ApplicationFeeDialog application={feeFor} onClose={() => setFeeFor(null)} />
    </>
  );
}

/** Mirrors the billing run's targeting: every non-empty axis must match. */
function appliesTo(s: FeeStructure, classId: string, gradeLevelId: string, residence: string) {
  const f = s.applicableTo ?? {};
  if (f.classIds?.length && !f.classIds.includes(classId)) return false;
  if (f.gradeLevelIds?.length && !f.gradeLevelIds.includes(gradeLevelId)) return false;
  if (f.residenceTypes?.length && !f.residenceTypes.includes(residence)) return false;
  return true;
}

function Section({ n, title, aside, children }: { n: string; title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-1.5">
        <h3 className="text-sm font-semibold">
          <span className="mr-2 font-mono text-xs text-muted-foreground">{n}</span>—<span className="ml-2">{title}</span>
        </h3>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function F({ label, required, id, hint, children }: { label: string; required?: boolean; id?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}{required && <span className="text-rose-500"> *</span>}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Textarea({ id, value, placeholder, onChange }: { id: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return <textarea id={id} rows={2} className={field} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function Collapsible({ title, subtitle, defaultOpen, warn, children }: { title: string; subtitle?: string; defaultOpen?: boolean; warn?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
  return (
    <div className="rounded-lg border">
      <button type="button" className="flex w-full items-center gap-2 px-4 py-2.5 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-sm font-medium">{title}</span>
        {subtitle && <span className={`truncate text-xs ${warn ? 'text-rose-600' : 'text-muted-foreground'}`}>· {subtitle}</span>}
        <span className="ml-auto text-xs text-muted-foreground">Optional</span>
      </button>
      {open && <div className="border-t px-4 py-4">{children}</div>}
    </div>
  );
}

function Notice({ tone, children }: { tone: 'info' | 'warn' | 'error'; children: React.ReactNode }) {
  const cls = {
    info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
    warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
    error: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
  }[tone];
  return <div className={`rounded-md border p-3 text-sm ${cls}`}>{children}</div>;
}
