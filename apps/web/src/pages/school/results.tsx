import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Calculator, ShieldCheck, History, Send, Lock, FileText, GitBranch, GraduationCap, Sigma,
} from 'lucide-react';
import {
  useTerms, useRosters,
  useComputeResults, useResultSet, usePublishResultSet,
  useRequestAmendment, useAmendments, useApproveAmendment, useLockResultSet,
  useResultReadiness,
} from '@/features/school/api';
import { useResultRuns, useRejectAmendment } from '@/features/school/results-phase5-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';
import { WorkflowSteps } from './_components/exam-workflow';
import {
  ReadinessChecklist, recommendationLabel, rosterLabel, statusLabel, summarise,
  type Conflict,
} from './_components/result-readiness';
import { ResultExplanationPanel } from './_components/result-explanation';
import { ReportDocumentsPanel } from './_components/report-documents';
import { PromotionDecisionsPanel } from './_components/promotion-decisions';
import { Empty, apiMessage, fmtDateTime, selectClass } from './_components/exam-ops-shared';

/**
 * End-of-term results.
 *
 * Phase 5 turns this from one screen into the results office's whole desk:
 * work the results out, see what is blocking release, explain a number,
 * issue and release report documents, and decide promotions — all against the
 * same published result set, which stays the only source of a published number.
 */
export function SchoolResultsPage() {
  const [params, setParams] = useSearchParams();
  const { data: terms } = useTerms();
  const termId = params.get('term') ?? '';
  const setId = params.get('set') ?? '';
  const tab = params.get('tab') ?? 'runs';

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k === 'term') next.delete('set');
    setParams(next, { replace: true });
  };

  const { data: rosters } = useRosters();
  const [rosterId, setRosterId] = useState('');
  const { data: sets } = useResultRuns(termId || undefined);
  const compute = useComputeResults();
  const { data: detail } = useResultSet(setId || undefined);
  const { data: readiness } = useResultReadiness(setId || undefined);
  const publish = usePublishResultSet();
  const lock = useLockResultSet();
  const requestAmd = useRequestAmendment();
  const { data: amendments } = useAmendments(setId || undefined);
  const approveAmd = useApproveAmendment();
  const rejectAmd = useRejectAmendment();
  const [reason, setReason] = useState('');
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});

  const termName = (terms?.data ?? []).find((t) => t.id === termId)?.name;

  // Pupil names for the blocker list. The gate returns ids; the result set we
  // already loaded carries the names, so no extra request is needed.
  const nameById = new Map<string, string>();
  for (const t of detail?.students ?? []) {
    if (t.studentProfileId) nameById.set(t.studentProfileId, t.studentName ?? t.admissionNo ?? '');
  }

  const published = detail?.resultSet.status === 'published' || detail?.resultSet.status === 'locked';

  const doPublish = async (id: string) => {
    try {
      await publish.mutateAsync(id);
      notify.success('Results released to parents', {
        description: termName ? `${termName} results are now visible in the parent portal.` : undefined,
        action: { label: 'Issue report cards', onClick: () => setParam('tab', 'documents') },
      });
    } catch (e: unknown) {
      // The server returns the full blocker list on a failed publish. Showing
      // "publish failed" and dropping it is how an administrator ends up
      // guessing; the checklist re-renders with the same codes.
      const body = (e as { response?: { data?: { conflicts?: Conflict[]; message?: string } } })?.response?.data;
      const first = body?.conflicts?.[0];
      notify.error(
        first ? summarise([first], nameById).title : 'Could not release these results',
        { description: first ? summarise(body!.conflicts!, nameById).blurb : String(body?.message ?? 'Try again.') },
      );
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">End of term results{termName ? ` — ${termName}` : ''}</h1>
            <p className="text-sm text-muted-foreground">
              Work out each pupil’s results from approved marks, check what is outstanding, release them, then issue report cards and decide promotions.
            </p>
          </div>
          <select className={`${selectClass} w-56`} value={termId} onChange={(e) => setParam('term', e.target.value)}>
            <option value="">Term…</option>
            {(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <WorkflowSteps current={5} />
      </div>

      {!termId && <Empty>Choose a term to see its result runs.</Empty>}

      {termId && (
        <Tabs value={tab} onValueChange={(v) => setParam('tab', v)}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="runs"><GitBranch className="mr-1 h-4 w-4" /> Result runs</TabsTrigger>
            <TabsTrigger value="explain"><Sigma className="mr-1 h-4 w-4" /> Explain a result</TabsTrigger>
            <TabsTrigger value="documents"><FileText className="mr-1 h-4 w-4" /> Report cards</TabsTrigger>
            <TabsTrigger value="promotion"><GraduationCap className="mr-1 h-4 w-4" /> Promotion</TabsTrigger>
            <TabsTrigger value="amendments"><History className="mr-1 h-4 w-4" /> Amendments</TabsTrigger>
          </TabsList>

          {/* ── Runs: compute, check, release ── */}
          <TabsContent value="runs" className="space-y-4 pt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Work out results</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap items-end gap-3">
                <select className={`${selectClass} w-64`} value={rosterId} onChange={(e) => setRosterId(e.target.value)}>
                  <option value="">Class list…</option>
                  {(rosters?.data ?? []).filter((r) => !termId || r.termId === termId).map((r) => (
                    <option key={r.id} value={r.id}>{rosterLabel(r)}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!termId || !rosterId || compute.isPending}
                  onClick={async () => {
                    try {
                      const r = await compute.mutateAsync({ termId, rosterId });
                      setParam('set', r.id);
                      notify.success(`Results worked out (version ${r.revision})`, {
                        description: 'Check the list below, then release them to parents.',
                      });
                    } catch (e) {
                      notify.error('Could not work out results', {
                        description: apiMessage(e, 'Every mark must be approved first, and the class list must be locked.'),
                      });
                    }
                  }}
                >
                  <Calculator className="h-4 w-4" /> Work out results
                </Button>
                {(rosters?.data ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No class lists yet — <Link className="underline" to="/school/assessment-ops">create one</Link> before working out results.
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base">Result versions</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(sets ?? []).map((s) => (
                    <button
                      key={s.id}
                      className={`flex w-full items-center justify-between rounded border p-2 text-left text-sm hover:bg-accent ${setId === s.id ? 'bg-accent' : ''}`}
                      onClick={() => setParam('set', s.id)}
                    >
                      <span>
                        Version {s.revision} <Badge variant={s.status === 'published' ? 'default' : 'secondary'}>{statusLabel(s.status)}</Badge>
                        <span className="block text-xs text-muted-foreground">
                          {s.scopeName ?? s.scopeType} · worked out {fmtDateTime(s.computedAt)}
                          {s.amendmentCount > 0 ? ` · ${s.amendmentCount} change request(s)` : ''}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">{s.studentCount} pupils</span>
                    </button>
                  ))}
                  {(sets ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nothing worked out for this term yet.</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Detail</CardTitle>
                  {detail && (
                    <div className="flex gap-1">
                      {detail.resultSet.status === 'locked' && <Badge><Lock className="h-3 w-3" /> Final</Badge>}
                      {detail.resultSet.status === 'published' && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setParam('tab', 'documents')}>
                            <FileText className="h-4 w-4" /> Report cards
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={lock.isPending}
                            onClick={async () => {
                              await lock.mutateAsync(detail.resultSet.id);
                              notify.success('Results marked final', { description: 'They can no longer be changed, only amended on the record.' });
                            }}
                          >
                            <Lock className="h-4 w-4" /> Mark final
                          </Button>
                        </>
                      )}
                      {!published && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={publish.isPending || !readiness?.ready}
                          onClick={() => doPublish(detail.resultSet.id)}
                          title={readiness && !readiness.ready ? 'Clear the items listed below first' : 'Release these results to parents'}
                        >
                          <ShieldCheck className="h-4 w-4" /> Release to parents
                        </Button>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail ? (
                    <>
                      {readiness && !published && <ReadinessChecklist readiness={readiness} nameById={nameById} />}
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge>Version {detail.resultSet.revision}</Badge>
                        <Badge variant="secondary">
                          {detail.resultSet.coveragePct != null ? `${Number(detail.resultSet.coveragePct)}% of pupils covered` : 'Coverage —'}
                        </Badge>
                        {detail.resultSet.outputChecksum && (
                          <Badge variant="secondary" title="Output checksum — proves this run is reproducible">
                            #{String(detail.resultSet.outputChecksum).slice(0, 8)}
                          </Badge>
                        )}
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Term results (top of class)</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="border-b text-left text-muted-foreground">
                              <tr><th className="px-2 py-1">Pupil</th><th className="px-2 py-1">Average</th><th className="px-2 py-1">Position</th><th className="px-2 py-1">Next class</th><th /></tr>
                            </thead>
                            <tbody>
                              {(detail.students ?? []).slice(0, 10).map((t, i) => (
                                <tr key={i} className="border-b last:border-0">
                                  <td className="px-2 py-1">{t.studentName ?? t.admissionNo ?? '—'}</td>
                                  <td className="px-2 py-1">{t.meanPercent != null ? `${Number(t.meanPercent)}%` : '—'}</td>
                                  <td className="px-2 py-1">{t.classRank ?? '—'}</td>
                                  <td className="px-2 py-1">{recommendationLabel(t.promotionRecommendation)}</td>
                                  <td className="px-2 py-1">
                                    <Button
                                      size="sm" variant="ghost"
                                      onClick={() => { setParam('tab', 'explain'); setParam('student', t.studentProfileId); }}
                                    >
                                      Why?
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Input placeholder="Why are these results being changed?" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <Button
                          size="sm" variant="ghost"
                          disabled={!reason || requestAmd.isPending}
                          onClick={async () => {
                            try {
                              await requestAmd.mutateAsync({ resultSetId: detail.resultSet.id, reason });
                              setReason('');
                              notify.success('Change requested', { description: 'Approving it works the results out again as a new version.' });
                            } catch (e) {
                              notify.error('Could not request a change', { description: apiMessage(e, 'A change request only applies to released results.') });
                            }
                          }}
                        >
                          <Send className="h-4 w-4" /> Request change
                        </Button>
                      </div>
                    </>
                  ) : <p className="text-sm text-muted-foreground">Pick a version on the left to see it.</p>}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Explain ── */}
          <TabsContent value="explain" className="pt-4">
            <ResultExplanationPanel
              resultSetId={setId}
              students={(detail?.students ?? []).map((s) => ({
                studentProfileId: s.studentProfileId,
                name: s.studentName ?? s.admissionNo ?? s.studentProfileId,
              }))}
              studentProfileId={params.get('student') ?? ''}
              onStudent={(id) => setParam('student', id)}
            />
          </TabsContent>

          {/* ── Report documents ── */}
          <TabsContent value="documents" className="pt-4">
            <ReportDocumentsPanel termId={termId} resultSetId={setId} published={published} />
          </TabsContent>

          {/* ── Promotion ── */}
          <TabsContent value="promotion" className="pt-4">
            <PromotionDecisionsPanel resultSetId={setId} published={published} terms={(terms?.data ?? []).map((t) => ({ id: t.id, name: t.name }))} />
          </TabsContent>

          {/* ── Amendments ── */}
          <TabsContent value="amendments" className="pt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Requested changes</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {!setId && <Empty>Pick a result version on the Result runs tab.</Empty>}
                {setId && (amendments ?? []).length === 0 && <p className="text-sm text-muted-foreground">No changes have been requested for this version.</p>}
                {(amendments ?? []).map((a) => (
                  <div key={a.id} className="rounded border p-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{a.reason}</span>
                      <Badge variant={a.status === 'applied' ? 'default' : 'secondary'}>{a.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Requested {fmtDateTime(a.createdAt)}</p>
                    {a.status === 'requested' && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm" variant="outline" disabled={approveAmd.isPending}
                          onClick={async () => {
                            try {
                              await approveAmd.mutateAsync(a.id);
                              notify.success('Change approved', { description: 'The results were worked out again as a new version; the old one is kept.' });
                            } catch (e) {
                              notify.error('Could not approve the change', { description: apiMessage(e, 'Try again.') });
                            }
                          }}
                        >
                          Approve and recompute
                        </Button>
                        <Input
                          className="w-64"
                          placeholder="Reason for refusing"
                          value={rejectNote[a.id] ?? ''}
                          onChange={(e) => setRejectNote((n) => ({ ...n, [a.id]: e.target.value }))}
                        />
                        <Button
                          size="sm" variant="ghost"
                          disabled={!rejectNote[a.id]?.trim() || rejectAmd.isPending}
                          onClick={async () => {
                            try {
                              await rejectAmd.mutateAsync({ id: a.id, decisionNote: rejectNote[a.id] });
                              notify.success('Change refused', { description: 'The refusal and its reason are on the record.' });
                            } catch (e) {
                              notify.error('Could not refuse the change', { description: apiMessage(e, 'A change is decided by someone other than whoever asked for it.') });
                            }
                          }}
                        >
                          Refuse
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
