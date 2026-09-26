import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Mail, MoreHorizontal, Plus } from 'lucide-react';
import {
  useAdmissions,
  useAdmissionAction,
  useEnrollAdmission, useSections,
  useIssueAdmissionOffer,
  useAcceptAdmissionOffer,
  useDeclineAdmissionOffer,
  useAdmissionEligibility,
  useAcademicYears,
  useClasses,
  useTerms,
  type AdmissionApplication,
  type AdmissionAction, useTerminology } from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { notify } from '@/lib/notify';
import { ACTION_LABELS, NEEDS_REASON, STAGE_LABELS, statusMeta } from './_components/admission-status';
import { DecisionDialog } from './_components/DecisionDialog';
import { ApplicationFeeDialog, applicationFeeBadge } from './fees-integrity';

export function SchoolAdmissionsPage() {
  const labels = useTerminology();
  const [enrollFor, setEnrollFor] = useState<AdmissionApplication | null>(null);
  const [enrollForm, setEnrollForm] = useState<Record<string, string>>({});
  const [offerFor, setOfferFor] = useState<AdmissionApplication | null>(null);
  const [offerForm, setOfferForm] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<string>('');
  // Decision-reason dialog state (Task 1): replaces the legacy window.prompt.
  const [decision, setDecision] = useState<{ app: AdmissionApplication; action: AdmissionAction } | null>(null);
  const [feeFor, setFeeFor] = useState<AdmissionApplication | null>(null);

  const navigate = useNavigate();
  const { data, isLoading } = useAdmissions({ pageSize: 50 });
  const { data: years } = useAcademicYears();
  const { data: classes } = useClasses();
  const { data: terms } = useTerms();
  const act = useAdmissionAction();
  const enroll = useEnrollAdmission();
  const { data: allSections } = useSections();
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

  // Streams of the class being enrolled into. Section is unique per class, so
  // this list has to follow the class picker rather than being global.
  const enrollSections = (allSections?.data ?? []).filter((x: any) => x.classId === enrollForm.classId);

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
    // Only terms of the year the family applied for. The enrollment's academic
    // year is derived from the term, while the admission seat is counted against
    // the application's year, so a 2027 applicant seated in a 2026 term consumed
    // a 2027 seat and got a 2026 placement. The API refuses this; the selector
    // should never offer it. Within that year, prefer the current term.
    const all = (terms?.data ?? []).filter((t) => t.academicYearId === app.academicYearId);
    const firstTerm = (all.find((t) => t.isCurrent) ?? all[0])?.id ?? '';
    setEnrollFor(app);
    // Seeded from the APPLICATION being enrolled. This used to read the
    // new-application dialog's state (`form.applicantGender` / `form.applicantDob`),
    // so students were created with whatever was left over in that form.
    setEnrollForm({
      classId: app.applyingForClassId ?? (classes?.data ?? [])[0]?.id ?? '',
      sectionId: '',
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
      const res = await enroll.mutateAsync({
        applicationId: enrollFor.id,
        classId: enrollForm.classId,
        // The subdivision the school actually teaches in. The API has accepted
        // this since the module was built; the dialog never sent it, so every
        // pupil admitted through the pipeline landed with no stream.
        sectionId: enrollForm.sectionId || undefined,
        termId: enrollForm.termId,
        rollNumber: enrollForm.rollNumber,
        student: {
          name: enrollForm.name,
          gender: (enrollForm.gender || undefined) as 'male' | 'female' | 'other' | undefined,
          dateOfBirth: enrollForm.dateOfBirth || undefined,
        },
      });
      // Say where the pupil landed and offer the next step. The dialog used to
      // close on a bare "enrolled" toast, leaving the operator to find the new
      // pupil themselves through the students list.
      const placed = [
        (classes?.data ?? []).find((c) => c.id === enrollForm.classId)?.name,
        enrollSections.find((x: any) => x.id === enrollForm.sectionId)?.name,
      ].filter(Boolean).join(' — ');
      const termName = (terms?.data ?? []).find((t) => t.id === enrollForm.termId)?.name ?? '';
      const profileId = (res as any)?.profile?.id ?? (res as any)?.studentProfileId ?? null;
      notify.success(
        `${enrollForm.name} enrolled into ${placed || 'the selected class'}${termName ? ` for ${termName}` : ''}`,
        profileId
          ? { action: { label: 'Open pupil', onClick: () => navigate(`/school/students/${profileId}`) } }
          : undefined,
      );
      setEnrollFor(null);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Enrollment failed');
    }
  };

  // Enrollment is only ever offered terms of the applicant's own academic year.
  const enrollTerms = useMemo(
    () => (terms?.data ?? []).filter((t) => t.academicYearId === enrollFor?.academicYearId),
    [terms?.data, enrollFor?.academicYearId],
  );
  const enrollYearName = enrollFor ? (yearNameById[enrollFor.academicYearId] ?? 'that academic year') : '';

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
                  <th className="px-4 py-2 font-medium">Fee</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    {statusFilter ? 'No applications in this status.' : 'No applications yet. Create the first one.'}
                  </td></tr>
                )}
                {rows.map((a) => {
                  const meta = statusMeta(a.status);
                  // The backend resolves which actions this application's workflow
                  // permits. The UI must not reconstruct skip logic from stage modes.
                  const wf = a.workflow;

                  /**
                   * One action button. `issue_offer`, `accept_offer` and `decline_offer`
                   * have dedicated endpoints (they create or settle an OfferLetter), so
                   * they route to their dialogs rather than the generic /review action.
                   */
                  const specialActions = new Set(['issue_offer', 'accept_offer', 'decline_offer', 'enroll']);
                  
                  const isSpecialAction = (action: AdmissionAction) => specialActions.has(action);

                  const renderAction = (action: AdmissionAction, kind: 'required' | 'optional' | 'terminal') => {
                    const label = ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
                    const onSelect = () => {
                      if (action === 'issue_offer') return openOffer(a);
                      if (action === 'accept_offer') return respondToOffer(a, true);
                      if (action === 'decline_offer') return respondToOffer(a, false);
                      if (action === 'enroll') return openEnroll(a);
                      return runAction(a, action, NEEDS_REASON.includes(action));
                    };
                    return (
                      <DropdownMenuItem
                        key={kind + '-' + action}
                        disabled={busy || (action === 'enroll' && enroll.isPending)}
                        onSelect={onSelect}
                        className={kind === 'optional' ? 'opacity-80' : ''}
                      >
                        {label}
                        {kind === 'optional' && <span className="ml-1 opacity-60">(optional)</span>}
                      </DropdownMenuItem>
                    );
                  };

                  const renderDropdownAction = (action: AdmissionAction, kind: 'required' | 'optional' | 'terminal') => {
                    const label = ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
                    const onSelect = () => {
                      runAction(a, action, NEEDS_REASON.includes(action));
                    };
                    return (
                      <DropdownMenuItem
                        key={kind + '-' + action}
                        disabled={busy}
                        onSelect={onSelect}
                        className={kind === 'optional' ? 'opacity-80' : ''}
                      >
                        {label}
                        {kind === 'optional' && <span className="ml-1 opacity-60">(optional)</span>}
                      </DropdownMenuItem>
                    );
                  };

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
                      <td className="px-4 py-2">
                        <button type="button" onClick={() => setFeeFor(a)} title="Application fee">
                          {applicationFeeBadge(a.feeStatus)}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {(() => {
                          const required = (wf?.requiredActions ?? []).filter((a) => !isSpecialAction(a));
                          const optional = (wf?.optionalActions ?? []).filter((a) => !isSpecialAction(a));
                          const terminal = (wf?.alwaysAvailable ?? [])
                            .filter((action) => action !== 'request_documents' && !isSpecialAction(action));
                          const dropdownActions = [...required, ...optional, ...terminal];
                          
                          const specialRequired = (wf?.requiredActions ?? []).filter(isSpecialAction);
                          const specialOptional = (wf?.optionalActions ?? []).filter(isSpecialAction);
                          const specialTerminal = (wf?.alwaysAvailable ?? [])
                            .filter((action) => action !== 'request_documents' && isSpecialAction(action));
                          const specialActionsList = [...specialRequired, ...specialOptional, ...specialTerminal];

                          return (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" disabled={busy}>
                                  <MoreHorizontal className="h-3.5 w-3.5 mr-1" /> Actions
                                  <ChevronDown className="h-3.5 w-3.5 ml-1" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" sideOffset={5}>
                                <DropdownMenuLabel>Workflow Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => navigate(`/school/applications/${a.id}`)}>
                                  View
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => navigate(`/school/applications/${a.id}?mode=edit`)}>
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setFeeFor(a)}>
                                  Application fee…
                                </DropdownMenuItem>
                                {dropdownActions.map((action) => renderDropdownAction(action, 
                                  (wf?.requiredActions ?? []).includes(action) ? 'required' :
                                  (wf?.optionalActions ?? []).includes(action) ? 'optional' : 'terminal'
                                ))}
                                {specialActionsList.map((action) => renderAction(action, 
                                  (wf?.requiredActions ?? []).includes(action) ? 'required' :
                                  (wf?.optionalActions ?? []).includes(action) ? 'optional' : 'terminal'
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          );
                        })()}
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
          {!!enrollFor?.workflow?.skippedStages?.length && (
            <div className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
              This admission workflow enrols directly. No offer or acceptance record will be
              created for{' '}
              <strong>
                {enrollFor.workflow.skippedStages
                  .map((s) => STAGE_LABELS[s] ?? s)
                  .join(', ')}
              </strong>
              , and the applicant&apos;s timeline will record them as skipped.
            </div>
          )}
          {eligibility && eligibility.status === 'BLOCKED' && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">This applicant cannot be enrolled yet:</p>
              <ul className="mt-1 list-disc pl-5">
                {eligibility.missing.map((m) => <li key={m}>{m}</li>)}
              </ul>
              {eligibility.missing.some((m) => m.includes('application fee')) && enrollFor && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setFeeFor(enrollFor)}>
                  Take fee payment
                </Button>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Class" required>
              <select className="w-full rounded-md border bg-card px-3 py-2 text-sm" value={enrollForm.classId ?? ''} onChange={(e) => setEnrollForm({ ...enrollForm, classId: e.target.value })}>
                <option value="">—</option>
                {(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label={labels.section}>
              <select
                className="w-full rounded-md border bg-card px-3 py-2 text-sm"
                value={enrollForm.sectionId ?? ''}
                disabled={!enrollForm.classId || enrollSections.length === 0}
                onChange={(e) => setEnrollForm({ ...enrollForm, sectionId: e.target.value })}
              >
                <option value="">
                  {!enrollForm.classId ? 'Choose a class first' : enrollSections.length ? 'No stream' : 'This class has no streams'}
                </option>
                {enrollSections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <Field label="Term" required>
              <select
                className="w-full rounded-md border bg-card px-3 py-2 text-sm"
                value={enrollForm.termId ?? ''}
                disabled={enrollTerms.length === 0}
                onChange={(e) => setEnrollForm({ ...enrollForm, termId: e.target.value })}
              >
                <option value="">{enrollTerms.length ? '—' : `No terms defined for ${enrollYearName}`}</option>
                {enrollTerms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isCurrent ? ' (current)' : ''}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                {enrollTerms.length
                  ? `Terms of ${enrollYearName}, the year this application is for.`
                  : `Create the terms for ${enrollYearName} before enrolling this applicant.`}
              </p>
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

      <ApplicationFeeDialog application={feeFor} onClose={() => setFeeFor(null)} />

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
