import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';
import {
  useAcademicYears,
  useAdmissionEligibility,
  useClasses,
  useEnrollAdmission,
  useSections,
  useStudentCategories,
  useTerminology,
  useTerms,
  type AdmissionApplication,
} from '@/features/school/api';
import { STAGE_LABELS } from './admission-status';
import { ApplicationFeeDialog } from '../fees-integrity';

/**
 * The one way an accepted application becomes a pupil (F18). Admissions and the
 * front-desk Applications list used to carry their own dialogs with different
 * rules — one offered terms of any year. Both open this.
 *
 * The pupil's details come from the application on the server (F13); the
 * dialog shows what will carry over rather than asking for it again, and only
 * asks where the pupil sits.
 */
export function EnrollApplicationDialog({ app, onClose }: { app: AdmissionApplication | null; onClose: () => void }) {
  const navigate = useNavigate();
  const labels = useTerminology();
  const { data: terms } = useTerms();
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const { data: sections } = useSections();
  const { data: categories } = useStudentCategories();
  const { data: eligibility } = useAdmissionEligibility(app?.id);
  const enroll = useEnrollAdmission();
  const [feeFor, setFeeFor] = useState<AdmissionApplication | null>(null);
  const [form, setForm] = useState({ classId: '', sectionId: '', termId: '', rollNumber: '' });

  // Only terms of the year the family applied for — the API refuses any other,
  // so the picker never offers one.
  const yearTerms = useMemo(
    () => (terms?.data ?? []).filter((t) => app && t.academicYearId === app.academicYearId),
    [terms?.data, app],
  );
  const classSections = (sections?.data ?? []).filter((x: any) => x.classId === form.classId);
  const yearName = (years?.data ?? []).find((y: any) => y.id === app?.academicYearId)?.name ?? 'that academic year';

  useEffect(() => {
    if (!app) return;
    setForm({
      classId: app.applyingForClassId ?? '',
      sectionId: '',
      termId: (yearTerms.find((t) => t.isCurrent) ?? yearTerms[0])?.id ?? '',
      rollNumber: '',
    });
  }, [app?.id, yearTerms.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!app) return null;
  const a: any = app;
  const facts: Array<[string, string]> = [
    ['Name', `${app.applicantFirstName} ${app.applicantLastName}`],
    ['Date of birth', app.applicantDob ? String(app.applicantDob).slice(0, 10) : '—'],
    ['Gender', app.applicantGender ?? '—'],
    ['Residence', a.residenceType ?? 'day'],
    ['Category', (categories ?? []).find((c: any) => c.id === a.studentCategoryId)?.name ?? '—'],
    ['Nationality', a.nationality ?? '—'],
  ];
  const blocked = eligibility?.status === 'BLOCKED';
  const ready = !!form.classId && !!form.termId && !!form.rollNumber.trim() && !blocked;

  const submit = async () => {
    try {
      const res: any = await enroll.mutateAsync({
        applicationId: app.id,
        classId: form.classId,
        sectionId: form.sectionId || undefined,
        termId: form.termId,
        rollNumber: form.rollNumber.trim(),
      });
      const placed = [
        (classes?.data ?? []).find((c) => c.id === form.classId)?.name,
        classSections.find((x: any) => x.id === form.sectionId)?.name,
      ].filter(Boolean).join(' — ');
      const profileId: string | null = res?.studentProfileId ?? res?.studentProfile?.id ?? null;
      notify.success(
        `${app.applicantFirstName} ${app.applicantLastName} enrolled into ${placed || 'the selected class'}`,
        profileId ? { action: { label: 'Open pupil', onClick: () => navigate(`/school/students/${profileId}`) } } : undefined,
      );
      onClose();
    } catch (e: any) {
      const msg = e?.response?.data?.message;
      notify.error(Array.isArray(msg) ? msg.join('; ') : msg ?? 'Enrollment failed');
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(v) => { if (!v && !enroll.isPending) onClose(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Enroll {app.applicantFirstName} {app.applicantLastName}</DialogTitle>
            <DialogDescription>The pupil record is created from the application. Choose where they sit.</DialogDescription>
          </DialogHeader>

          {!!(app as any).workflow?.skippedStages?.length && (
            <div className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
              This workflow enrols directly; {(app as any).workflow.skippedStages.map((s: string) => STAGE_LABELS[s] ?? s).join(', ')} will be recorded as skipped.
            </div>
          )}
          {blocked && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">This applicant cannot be enrolled yet:</p>
              <ul className="mt-1 list-disc pl-5">{eligibility!.missing.map((m) => <li key={m}>{m}</li>)}</ul>
              {eligibility!.missing.some((m) => m.includes('application fee')) && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setFeeFor(app)}>Take fee payment</Button>
              )}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="capitalize">{v}</dd></div>
            ))}
          </dl>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="enrol-term" className="text-xs">Term <span className="text-rose-500">*</span></Label>
              <select id="enrol-term" className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={form.termId} disabled={!yearTerms.length} onChange={(e) => setForm({ ...form, termId: e.target.value })}>
                <option value="">{yearTerms.length ? '—' : `No terms for ${yearName}`}</option>
                {yearTerms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isCurrent ? ' (current)' : ''}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">{yearTerms.length ? `Terms of ${yearName}, the year applied for.` : `Create the terms for ${yearName} first.`}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="enrol-roll" className="text-xs">Roll number <span className="text-rose-500">*</span></Label>
              <Input id="enrol-roll" value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="enrol-class" className="text-xs">Class <span className="text-rose-500">*</span></Label>
              {/* Changing class clears a stream that belongs to the old class. */}
              <select id="enrol-class" className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value, sectionId: '' })}>
                <option value="">—</option>
                {(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="enrol-section" className="text-xs">{labels.section}</Label>
              <select id="enrol-section" className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={form.sectionId} disabled={!form.classId || !classSections.length} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}>
                <option value="">{!form.classId ? 'Choose a class first' : classSections.length ? `No ${labels.section.toLowerCase()}` : `This class has no ${labels.sectionPlural.toLowerCase()}`}</option>
                {classSections.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose} disabled={enroll.isPending}>Cancel</Button>
            <Button onClick={() => void submit()} disabled={!ready || enroll.isPending}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> {enroll.isPending ? 'Enrolling…' : 'Enroll pupil'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ApplicationFeeDialog application={feeFor} onClose={() => setFeeFor(null)} />
    </>
  );
}
