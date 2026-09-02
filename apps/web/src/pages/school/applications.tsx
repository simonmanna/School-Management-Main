import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Send, CheckCircle2, XCircle, CalendarClock, Eye, Pencil, ChevronDown } from 'lucide-react';
import {
  useAdmissions,
  useAdmissionAction,
  useEnrollAdmission,
  useAcademicYears,
  useClasses,
  useTerms,
  type AdmissionApplication,
  type AdmissionAction,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { notify } from '@/lib/notify';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
// Single source of truth for the lifecycle. This page previously carried its own
// copy of STATUS_META/NEXT_ACTIONS, identical to admissions.tsx and covering only
// 7 of the 15 backend states.
import { ACTION_LABELS, NEEDS_REASON, statusMeta } from './_components/admission-status';

/** Handled by the admissions pipeline page, which owns the offer dialogs.
 *  `enroll` is intentionally NOT here — once a student is accepted we want a
 *  short, direct enroll path from this list (skipping offer/details). */
const OFFER_STAGE_ACTIONS = ['issue_offer', 'accept_offer', 'decline_offer', 'request_documents'];

/** Per-action icon for the Actions dropdown. */
const ACTION_ICON: Partial<Record<AdmissionAction, React.ReactNode>> = {
  accept: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />,
  reject: <XCircle className="h-3.5 w-3.5 text-rose-600" />,
  withdraw: <XCircle className="h-3.5 w-3.5 text-rose-600" />,
  waitlist: <XCircle className="h-3.5 w-3.5 text-amber-600" />,
  schedule_exam: <CalendarClock className="h-3.5 w-3.5" />,
  schedule_interview: <CalendarClock className="h-3.5 w-3.5" />,
  review: <Send className="h-3.5 w-3.5" />,
  screen: <Send className="h-3.5 w-3.5" />,
};
import { DecisionDialog } from './_components/DecisionDialog';

export function SchoolApplicationsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useAdmissions({ pageSize: 50 });
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const act = useAdmissionAction();
  const enroll = useEnrollAdmission();
  const { data: terms } = useTerms();
  const [decision, setDecision] = useState<{ app: AdmissionApplication; action: AdmissionAction } | null>(null);
  const [enrollFor, setEnrollFor] = useState<AdmissionApplication | null>(null);
  const [enrollForm, setEnrollForm] = useState<{ classId: string; sectionId: string; termId: string; rollNumber: string }>({ classId: '', sectionId: '', termId: '', rollNumber: '' });

  const rows = useMemo(() => data?.data ?? [], [data]);
  const yearNameById = useMemo(() => Object.fromEntries((years?.data ?? []).map((y) => [y.id, y.name])), [years]);
  const classNameById = useMemo(() => Object.fromEntries((classes?.data ?? []).map((c) => [c.id, c.name])), [classes]);

  const runAction = async (app: AdmissionApplication, action: AdmissionAction, needsNotes?: boolean) => {
    // Decision-grade actions (accept/reject/waitlist/withdraw) require a reason.
    // Collected via the shared DecisionDialog instead of window.prompt; the API
    // also enforces the requirement, so bypassing the UI is impossible.
    if (needsNotes) {
      setDecision({ app, action });
      return;
    }
    try {
      await act.mutateAsync({ id: app.id, action });
      notify.success(`Application ${action.replace(/_/g, ' ')}`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Action failed');
    }
  };

  const confirmDecision = async (reason: string, notes: string) => {
    if (!decision) return;
    const { app, action } = decision;
    setDecision(null);
    try {
      await act.mutateAsync({ id: app.id, action, notes: reason || notes });
      notify.success(`Application ${action.replace(/_/g, ' ')}`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Action failed');
    }
  };

  // Direct, short enroll path for an accepted applicant: pre-fill from the
  // application and ask only for the essentials (term + roll number). Skips the
  // full offer/details flow.
  const openEnroll = (app: AdmissionApplication) => {
    const allTerms = terms?.data ?? [];
    const firstTerm = (allTerms.find((t: any) => t.isCurrent) ?? allTerms[0])?.id ?? '';
    setEnrollFor(app);
    setEnrollForm({
      classId: app.applyingForClassId ?? (classes?.data ?? [])[0]?.id ?? '',
      sectionId: '',
      termId: firstTerm,
      rollNumber: '',
    });
  };

  const submitEnroll = async () => {
    if (!enrollFor || !enrollForm.classId || !enrollForm.termId || !enrollForm.rollNumber) {
      notify.error('Class, term and roll number are required');
      return;
    }
    try {
      await enroll.mutateAsync({
        applicationId: enrollFor.id,
        classId: enrollForm.classId,
        sectionId: enrollForm.sectionId || undefined,
        termId: enrollForm.termId,
        rollNumber: enrollForm.rollNumber,
        student: {
          name: `${enrollFor.applicantFirstName} ${enrollFor.applicantLastName}`,
          gender: (enrollFor.applicantGender || undefined) as 'male' | 'female' | 'other' | undefined,
          dateOfBirth: enrollFor.applicantDob ? String(enrollFor.applicantDob).slice(0, 10) : undefined,
        },
      });
      notify.success(`${enrollFor.applicantFirstName} ${enrollFor.applicantLastName} enrolled`);
      setEnrollFor(null);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Enrollment failed');
    }
  };
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Applications</h1>
          <p className="text-sm text-muted-foreground">Front-desk student applications linked to Admissions.</p>
        </div>
        <Button onClick={() => navigate('/school/applications/new')}>
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
                <tr
                  key={a.id}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                  onClick={() => navigate(`/school/applications/${a.id}?mode=view`)}
                >
                  <td className="px-4 py-2 font-mono text-xs">{a.applicationNumber}</td>
                  <td className="px-4 py-2 font-medium">{a.applicantFirstName} {a.applicantLastName}</td>
                  <td className="px-4 py-2">{a.applyingForClassId ? classNameByIdExists(classNameById, a.applyingForClassId) : '—'}</td>
                  <td className="px-4 py-2">{yearNameById[a.academicYearId] ?? '—'}</td>
                  <td className="px-4 py-2">
                    <Badge className={statusMeta(a.status).cls}>{statusMeta(a.status).label}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/school/applications/${a.id}?mode=view`)}
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate(`/school/applications/${a.id}?mode=edit`)}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm">
                            Actions <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {/* Offered actions come from the backend workflow resolver on
                              each row, so a school that skips a stage never sees its
                              buttons. Offer/enrolment actions live on the admissions
                              pipeline page, which has the dialogs they need. */}
                          {(() => {
                            const actions = [
                              ...(a.workflow?.requiredActions ?? []),
                              ...(a.workflow?.optionalActions ?? []),
                              ...(a.workflow?.alwaysAvailable ?? []),
                            ].filter((action) => !OFFER_STAGE_ACTIONS.includes(action));
                            if (actions.length === 0) {
                              return <DropdownMenuItem disabled>No actions available</DropdownMenuItem>;
                            }
                            return actions.map((action) => (
                              <DropdownMenuItem
                                key={action}
                                className={
                                  action === 'reject' || action === 'withdraw'
                                    ? 'text-rose-600 focus:text-rose-600'
                                    : action === 'accept'
                                      ? 'text-emerald-700 focus:text-emerald-700'
                                      : ''
                                }
                                onSelect={() => {
                                  // Defer so the dropdown fully unmounts (and releases
                                  // its focus/pointer scope) before we open a modal
                                  // dialog or fire the mutation — otherwise two Radix
                                  // layers fight over focus and the UI freezes.
                                  setTimeout(() => {
                                    if (action === 'enroll') openEnroll(a);
                                    else runAction(a, action, NEEDS_REASON.includes(action));
                                  }, 0);
                                }}
                              >
                                {ACTION_ICON[action]}
                                {ACTION_LABELS[action] ?? action.replace(/_/g, ' ')}
                              </DropdownMenuItem>
                            ));
                          })()}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Decision-reason dialog (Task 1) */}
      <DecisionDialog
        open={!!decision}
        action={decision?.action}
        applicantName={decision ? `${decision.app.applicantFirstName} ${decision.app.applicantLastName}` : undefined}
        reasonRequired
        submitting={act.isPending}
        onCancel={() => setDecision(null)}
        onConfirm={confirmDecision}
      />

      {/* Direct enroll dialog — short path for accepted applicants. */}
      <Dialog open={!!enrollFor} onOpenChange={(o) => { if (!o) setEnrollFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enroll student</DialogTitle>
            <DialogDescription>
              {enrollFor ? `Enroll ${enrollFor.applicantFirstName} ${enrollFor.applicantLastName} directly. Details are carried over from the application.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Class</span>
              <select
                className="w-full rounded-md border bg-card px-3 py-2 text-sm"
                value={enrollForm.classId}
                onChange={(e) => setEnrollForm({ ...enrollForm, classId: e.target.value })}
              >
                <option value="">Select a class</option>
                {(classes?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Section (optional)</span>
              <select
                className="w-full rounded-md border bg-card px-3 py-2 text-sm"
                value={enrollForm.sectionId}
                onChange={(e) => setEnrollForm({ ...enrollForm, sectionId: e.target.value })}
              >
                <option value="">No section</option>
                {(classes?.data ?? []).flatMap((c: any) => (c.sections ?? [])).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Term</span>
              <select
                className="w-full rounded-md border bg-card px-3 py-2 text-sm"
                value={enrollForm.termId}
                onChange={(e) => setEnrollForm({ ...enrollForm, termId: e.target.value })}
              >
                <option value="">Select a term</option>
                {(terms?.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Roll number</span>
              <Input
                value={enrollForm.rollNumber}
                onChange={(e) => setEnrollForm({ ...enrollForm, rollNumber: e.target.value })}
                placeholder="E.g. 001"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEnrollFor(null)}>Cancel</Button>
            <Button onClick={submitEnroll} disabled={enroll.isPending}>
              {enroll.isPending ? 'Enrolling…' : 'Enroll'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function classNameByIdExists(map: Record<string, string>, id?: string | null) {
  if (!id) return '—';
  return map[id] ?? '—';
}
