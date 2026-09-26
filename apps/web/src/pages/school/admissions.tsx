import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Mail, MoreHorizontal, Plus } from 'lucide-react';
import {
  useAdmissions,
  useAdmissionAction,
  useIssueAdmissionOffer,
  useAcceptAdmissionOffer,
  useDeclineAdmissionOffer,
  useAcademicYears,
  useClasses,
  type AdmissionApplication,
  type AdmissionAction } from '@/features/school/api';
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
import { ACTION_LABELS, NEEDS_REASON, statusMeta } from './_components/admission-status';
import { EnrollApplicationDialog } from './_components/enroll-application-dialog';
import { DecisionDialog } from './_components/DecisionDialog';
import { ApplicationFeeDialog, applicationFeeBadge } from './fees-integrity';

export function SchoolAdmissionsPage() {
  const [enrollFor, setEnrollFor] = useState<AdmissionApplication | null>(null);
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
  const act = useAdmissionAction();
  const issueOffer = useIssueAdmissionOffer();
  const acceptOffer = useAcceptAdmissionOffer();
  const declineOffer = useDeclineAdmissionOffer();

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

  // One enrollment dialog for every entry point (F18); details come from the application (F13).
  const openEnroll = (app: AdmissionApplication) => setEnrollFor(app);

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
                        disabled={busy}
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

                          // Non-modal: its items open dialogs, and a modal menu closing under a
                          // dialog left the whole page inert.
                          return (
                            <DropdownMenu modal={false}>
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

      <EnrollApplicationDialog app={enrollFor} onClose={() => setEnrollFor(null)} />

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
