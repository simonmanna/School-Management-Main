import { useMemo, useState } from 'react';
import { Plus, FilePlus2, Send, CheckCircle2, XCircle, CalendarClock, LogOut } from 'lucide-react';
import {
  useAdmissions,
  useCreateAdmission,
  useAdmissionAction,
  useEnrollAdmission,
  useAcademicYears,
  useClasses,
  useTerms,
  type AdmissionApplication,
  type AdmissionStatus,
  type CreateAdmissionInput,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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

/** Actions available from each status (mirrors the backend FSM). */
const NEXT_ACTIONS: Record<AdmissionStatus, Array<{ action: 'review' | 'accept' | 'reject' | 'schedule_exam' | 'withdraw'; label: string; tone: 'default' | 'success' | 'danger' }>> = {
  submitted: [{ action: 'review', label: 'Start review', tone: 'default' }],
  under_review: [
    { action: 'accept', label: 'Accept', tone: 'success' },
    { action: 'reject', label: 'Reject', tone: 'danger' },
    { action: 'schedule_exam', label: 'Schedule exam', tone: 'default' },
  ],
  exam_scheduled: [
    { action: 'accept', label: 'Accept', tone: 'success' },
    { action: 'reject', label: 'Reject', tone: 'danger' },
  ],
  accepted: [],
  enrolled: [],
  rejected: [],
  withdrawn: [],
};

export function SchoolAdmissionsPage() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [enrollFor, setEnrollFor] = useState<AdmissionApplication | null>(null);
  const [enrollForm, setEnrollForm] = useState<Record<string, string>>({});
  const [actionNotes] = useState<Record<string, string>>({});

  const { data, isLoading } = useAdmissions({ pageSize: 50 });
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const { data: terms } = useTerms();
  const create = useCreateAdmission();
  const act = useAdmissionAction();
  const enroll = useEnrollAdmission();

  const rows = useMemo(() => data?.data ?? [], [data]);
  const yearNameById = useMemo(
    () => Object.fromEntries((years?.data ?? []).map((y) => [y.id, y.name])),
    [years],
  );
  const classNameById = useMemo(
    () => Object.fromEntries((classes?.data ?? []).map((c) => [c.id, c.name])),
    [classes],
  );

  const openCreate = () => {
    const firstYear = (years?.data ?? [])[0]?.id ?? '';
    setForm({ academicYearId: firstYear });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.academicYearId || !form.applicantFirstName || !form.applicantLastName) {
      notify.error('Academic year, first and last name are required');
      return;
    }
    const dto: CreateAdmissionInput = {
      academicYearId: form.academicYearId,
      applicantFirstName: form.applicantFirstName,
      applicantLastName: form.applicantLastName,
      applicantDob: form.applicantDob || undefined,
      applicantGender: (form.applicantGender || undefined) as CreateAdmissionInput['applicantGender'],
      applyingForClassId: form.applyingForClassId || undefined,
    };
    try {
      await create.mutateAsync(dto);
      notify.success('Application submitted');
      setOpen(false);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not create application');
    }
  };

  const runAction = async (app: AdmissionApplication, action: 'review' | 'accept' | 'reject' | 'schedule_exam' | 'withdraw') => {
    try {
      await act.mutateAsync({ id: app.id, action, notes: actionNotes[app.id] || undefined });
      notify.success(`Application ${action.replace('_', ' ')}`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Action failed');
    }
  };

  const openEnroll = (app: AdmissionApplication) => {
    const firstTerm = (terms?.data ?? [])[0]?.id ?? '';
    setEnrollFor(app);
    setEnrollForm({
      classId: app.applyingForClassId ?? (classes?.data ?? [])[0]?.id ?? '',
      termId: firstTerm,
      rollNumber: '',
      name: `${app.applicantFirstName} ${app.applicantLastName}`,
    });
  };

  const submitEnroll = async () => {
    if (!enrollFor || !enrollForm.classId || !enrollForm.termId || !enrollForm.rollNumber || !enrollForm.name) {
      notify.error('Class, term, roll number and name are required');
      return;
    }
    try {
      await enroll.mutateAsync({
        applicationId: enrollFor.id,
        classId: enrollForm.classId,
        termId: enrollForm.termId,
        rollNumber: enrollForm.rollNumber,
        student: {
          name: enrollForm.name,
          gender: (form.applicantGender || undefined) as 'male' | 'female' | 'other' | undefined,
          dateOfBirth: form.applicantDob || undefined,
        },
      });
      notify.success('Student enrolled from application');
      setEnrollFor(null);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Enrollment failed');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Admissions</h1>
          <p className="text-sm text-muted-foreground">Applications, review workflow and enrollment.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> New application
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Application no.</th>
                <th className="px-4 py-2 font-medium">Applicant</th>
                <th className="px-4 py-2 font-medium">Applying for</th>
                <th className="px-4 py-2 font-medium">Academic year</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No applications yet. Create the first one.</td></tr>
              )}
              {rows.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2 font-mono text-xs">{a.applicationNumber}</td>
                  <td className="px-4 py-2 font-medium">
                    {a.applicantFirstName} {a.applicantLastName}
                  </td>
                  <td className="px-4 py-2">{a.applyingForClassId ? classNameById[a.applyingForClassId] ?? '—' : '—'}</td>
                  <td className="px-4 py-2">{yearNameById[a.academicYearId] ?? '—'}</td>
                  <td className="px-4 py-2">
                    <Badge className={STATUS_META[a.status]?.cls ?? 'bg-slate-100 text-slate-700'}>
                      {STATUS_META[a.status]?.label ?? a.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {NEXT_ACTIONS[a.status]?.map((n) => (
                        <Button
                          key={n.action}
                          variant={n.tone === 'success' ? 'default' : n.tone === 'danger' ? 'destructive' : 'secondary'}
                          size="sm"
                          disabled={act.isPending}
                          onClick={() => runAction(a, n.action)}
                        >
                          {n.action === 'accept' && <CheckCircle2 className="h-3.5 w-3.5" />}
                          {n.action === 'reject' && <XCircle className="h-3.5 w-3.5" />}
                          {n.action === 'schedule_exam' && <CalendarClock className="h-3.5 w-3.5" />}
                          {n.action === 'review' && <Send className="h-3.5 w-3.5" />}
                          {n.action === 'withdraw' && <LogOut className="h-3.5 w-3.5" />}
                          {n.label}
                        </Button>
                      ))}
                      {a.status === 'accepted' && (
                        <Button variant="default" size="sm" disabled={enroll.isPending} onClick={() => openEnroll(a)}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Enroll
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Create application dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New admission application</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Academic year" required>
              <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={form.academicYearId ?? ''} onChange={(e) => setForm({ ...form, academicYearId: e.target.value })}>
                <option value="">—</option>
                {(years?.data ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </Field>
            <Field label="Applying for class">
              <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={form.applyingForClassId ?? ''} onChange={(e) => setForm({ ...form, applyingForClassId: e.target.value })}>
                <option value="">—</option>
                {(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="First name" required>
              <Input value={form.applicantFirstName ?? ''} onChange={(e) => setForm({ ...form, applicantFirstName: e.target.value })} />
            </Field>
            <Field label="Last name" required>
              <Input value={form.applicantLastName ?? ''} onChange={(e) => setForm({ ...form, applicantLastName: e.target.value })} />
            </Field>
            <Field label="Date of birth">
              <Input type="date" value={form.applicantDob ?? ''} onChange={(e) => setForm({ ...form, applicantDob: e.target.value })} />
            </Field>
            <Field label="Gender">
              <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={form.applicantGender ?? ''} onChange={(e) => setForm({ ...form, applicantGender: e.target.value })}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending}>
              <FilePlus2 className="h-4 w-4" /> Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enroll dialog */}
      <Dialog open={!!enrollFor} onOpenChange={(v) => { if (!v) setEnrollFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enroll {enrollFor?.applicantFirstName} {enrollFor?.applicantLastName}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Class" required>
              <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={enrollForm.classId ?? ''} onChange={(e) => setEnrollForm({ ...enrollForm, classId: e.target.value })}>
                <option value="">—</option>
                {(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Term" required>
              <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={enrollForm.termId ?? ''} onChange={(e) => setEnrollForm({ ...enrollForm, termId: e.target.value })}>
                <option value="">—</option>
                {(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Student name" required>
              <Input value={enrollForm.name ?? ''} onChange={(e) => setEnrollForm({ ...enrollForm, name: e.target.value })} />
            </Field>
            <Field label="Roll number" required>
              <Input value={enrollForm.rollNumber ?? ''} onChange={(e) => setEnrollForm({ ...enrollForm, rollNumber: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEnrollFor(null)}>Cancel</Button>
            <Button onClick={submitEnroll} disabled={enroll.isPending}>
              <CheckCircle2 className="h-4 w-4" /> Enroll student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}{required && <span className="text-rose-500"> *</span>}</Label>
      {children}
    </div>
  );
}
