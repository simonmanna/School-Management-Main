import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Send, CheckCircle2, XCircle, CalendarClock, LogOut, Mail, ThumbsUp, ThumbsDown } from 'lucide-react';
import {
  useAdmissions,
  useAdmissionAction,
  useEnrollAdmission,
  useIssueAdmissionOffer,
  useAcceptAdmissionOffer,
  useDeclineAdmissionOffer,
  useAdmissionEligibility,
  useAcademicYears,
  useClasses,
  useTerms,
  type AdmissionApplication,
  type AdmissionAction,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';
import { NEXT_ACTIONS, offerStage, statusMeta } from './_components/admission-status';
import { DecisionDialog } from './_components/DecisionDialog';

export function SchoolAdmissionsPage() {
  const [enrollFor, setEnrollFor] = useState<AdmissionApplication | null>(null);
  const [enrollForm, setEnrollForm] = useState<Record<string, string>>({});
  const [offerFor, setOfferFor] = useState<AdmissionApplication | null>(null);
  const [offerForm, setOfferForm] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<string>('');
  // Decision-reason dialog state (Task 1): replaces the legacy window.prompt.
  const [decision, setDecision] = useState<{ app: AdmissionApplication; action: AdmissionAction } | null>(null);

  const navigate = useNavigate();
  const { data, isLoading } = useAdmissions({ pageSize: 50 });
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const { data: terms } = useTerms();
  const act = useAdmissionAction();
  const enroll = useEnrollAdmission();
  const issueOffer = useIssueAdmissionOffer();
  const acceptOffer = useAcceptAdmissionOffer();
  const declineOffer = useDeclineAdmissionOffer();
  // Surfaces exactly why an applicant cannot be enrolled yet (documents, fee,
  // capacity) instead of letting the operator discover it from a failed POST.
  const { data: eligibility } = useAdmissionEligibility(enrollFor?.id);

  const allRows = useMemo(() => data?.data ?? [], [data]);
  const rows = useMemo(
    () => (statusFilter ? allRows.filter((a) => a.status === statusFilter) : allRows),
    [allRows, statusFilter],
  );
  const yearNameById = useMemo(
    () => Object.fromEntries((years?.data ?? []).map((y) => [y.id, y.name])),
    [years],
  );
  const classNameById = useMemo(
    () => Object.fromEntries((classes?.data ?? []).map((c) => [c.id, c.name])),
    [classes],
  );

  const openCreate = () => {
    // The full application form lives on its own page
    // (/school/applications/new) — we navigate there instead of opening the
    // inline dialog, so the admissions "New application" action and the
    // applications "New application" action are the same form.
    navigate('/school/applications/new');
  };

  const runAction = async (app: AdmissionApplication, action: AdmissionAction, needsNotes?: boolean) => {
    // Decision-grade actions (accept/reject/waitlist/withdraw) require a reason.
    // We collect it through the shared DecisionDialog instead of window.prompt;
    // the API also enforces the requirement, so bypassing the UI is impossible.
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

  const openOffer = (app: AdmissionApplication) => {
    const in14Days = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    setOfferFor(app);
    setOfferForm({
      expiresAt: in14Days,
      body: `We are pleased to offer ${app.applicantFirstName} ${app.applicantLastName} a place${
        app.applyingForClassId ? ` in ${classNameById[app.applyingForClassId] ?? 'the requested class'}` : ''
      }.`,
    });
  };

  const submitOffer = async () => {
    if (!offerFor) return;
    if (!offerForm.expiresAt) {
      notify.error('An offer expiry date is required');
      return;
    }
    try {
      await issueOffer.mutateAsync({
        id: offerFor.id,
        body: offerForm.body || undefined,
        expiresAt: new Date(`${offerForm.expiresAt}T23:59:59`).toISOString(),
      });
      notify.success('Offer issued');
      setOfferFor(null);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not issue offer');
    }
  };

  const respondToOffer = async (app: AdmissionApplication, accept: boolean) => {
    try {
      if (accept) await acceptOffer.mutateAsync(app.id);
      else await declineOffer.mutateAsync(app.id);
      notify.success(accept ? 'Offer accepted' : 'Offer declined');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not record the offer response');
    }
  };

  const openEnroll = (app: AdmissionApplication) => {
    const firstTerm = (terms?.data ?? [])[0]?.id ?? '';
    setEnrollFor(app);
    // Seeded from the APPLICATION being enrolled. This used to read the
    // new-application dialog's state (`form.applicantGender` / `form.applicantDob`),
    // so students were created with whatever was left over in that form.
    setEnrollForm({
      classId: app.applyingForClassId ?? (classes?.data ?? [])[0]?.id ?? '',
      termId: firstTerm,
      rollNumber: '',
      name: `${app.applicantFirstName} ${app.applicantLastName}`,
      gender: app.applicantGender ?? '',
      dateOfBirth: app.applicantDob ? String(app.applicantDob).slice(0, 10) : '',
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
          gender: (enrollForm.gender || undefined) as 'male' | 'female' | 'other' | undefined,
          dateOfBirth: enrollForm.dateOfBirth || undefined,
        },
      });
      notify.success('Student enrolled from application');
      setEnrollFor(null);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Enrollment failed');
    }
  };

  const busy = act.isPending || issueOffer.isPending || acceptOffer.isPending || declineOffer.isPending;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Admissions</h1>
          <p className="text-sm text-muted-foreground">Applications, review workflow, offers and enrollment.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border bg-card px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {[...new Set(allRows.map((a) => a.status))].map((s) => (
              <option key={s} value={s}>{statusMeta(s).label}</option>
            ))}
          </select>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New application
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
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
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    {statusFilter ? 'No applications in this status.' : 'No applications yet. Create the first one.'}
                  </td></tr>
                )}
                {rows.map((a) => {
                  const meta = statusMeta(a.status);
                  const stage = offerStage(a.status);
                  return (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 font-mono text-xs">{a.applicationNumber}</td>
                      <td className="px-4 py-2 font-medium">
                        {a.applicantFirstName} {a.applicantLastName}
                      </td>
                      <td className="px-4 py-2">{a.applyingForClassId ? classNameById[a.applyingForClassId] ?? '—' : '—'}</td>
                      <td className="px-4 py-2">{yearNameById[a.academicYearId] ?? '—'}</td>
                      <td className="px-4 py-2">
                        <Badge className={meta.cls}>{meta.label}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {(NEXT_ACTIONS[a.status] ?? []).map((n) => (
                            <Button
                              key={n.action}
                              variant={n.tone === 'success' ? 'default' : n.tone === 'danger' ? 'destructive' : 'secondary'}
                              size="sm"
                              disabled={busy}
                              onClick={() => runAction(a, n.action, n.needsNotes)}
                            >
                              {n.action === 'accept' && <CheckCircle2 className="h-3.5 w-3.5" />}
                              {n.action === 'reject' && <XCircle className="h-3.5 w-3.5" />}
                              {n.action === 'schedule_exam' && <CalendarClock className="h-3.5 w-3.5" />}
                              {n.action === 'review' && <Send className="h-3.5 w-3.5" />}
                              {n.action === 'withdraw' && <LogOut className="h-3.5 w-3.5" />}
                              {n.label}
                            </Button>
                          ))}
                          {stage === 'issue' && (
                            <Button variant="default" size="sm" disabled={busy} onClick={() => openOffer(a)}>
                              <Mail className="h-3.5 w-3.5" /> Issue offer
                            </Button>
                          )}
                          {stage === 'respond' && (
                            <>
                              <Button variant="default" size="sm" disabled={busy} onClick={() => respondToOffer(a, true)}>
                                <ThumbsUp className="h-3.5 w-3.5" /> Offer accepted
                              </Button>
                              <Button variant="destructive" size="sm" disabled={busy} onClick={() => respondToOffer(a, false)}>
                                <ThumbsDown className="h-3.5 w-3.5" /> Offer declined
                              </Button>
                            </>
                          )}
                          {stage === 'enroll' && (
                            <Button variant="default" size="sm" disabled={enroll.isPending} onClick={() => openEnroll(a)}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Enroll
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Issue offer dialog */}
      <Dialog open={!!offerFor} onOpenChange={(v) => { if (!v) setOfferFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue offer to {offerFor?.applicantFirstName} {offerFor?.applicantLastName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Offer expires on" required>
              <Input type="date" value={offerForm.expiresAt ?? ''} onChange={(e) => setOfferForm({ ...offerForm, expiresAt: e.target.value })} />
            </Field>
            <Field label="Offer letter text">
              <textarea
                className="w-full rounded-md border bg-card px-3 py-2 text-sm"
                rows={4}
                value={offerForm.body ?? ''}
                onChange={(e) => setOfferForm({ ...offerForm, body: e.target.value })}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              The offer cannot be accepted after the expiry date.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOfferFor(null)}>Cancel</Button>
            <Button onClick={submitOffer} disabled={issueOffer.isPending}>
              <Mail className="h-4 w-4" /> Issue offer
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
          {eligibility && eligibility.status === 'BLOCKED' && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">This applicant cannot be enrolled yet:</p>
              <ul className="mt-1 list-disc pl-5">
                {eligibility.missing.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          )}
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
            <Field label="Date of birth">
              <Input type="date" value={enrollForm.dateOfBirth ?? ''} onChange={(e) => setEnrollForm({ ...enrollForm, dateOfBirth: e.target.value })} />
            </Field>
            <Field label="Gender">
              <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={enrollForm.gender ?? ''} onChange={(e) => setEnrollForm({ ...enrollForm, gender: e.target.value })}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEnrollFor(null)}>Cancel</Button>
            <Button onClick={submitEnroll} disabled={enroll.isPending || eligibility?.status === 'BLOCKED'}>
              <CheckCircle2 className="h-4 w-4" /> Enroll student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
