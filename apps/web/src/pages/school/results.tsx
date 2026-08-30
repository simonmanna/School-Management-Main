import { useState } from 'react';
import { Calculator, ShieldCheck, History, Send, Lock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  useTerms, useRosters,
  useComputeResults, useResultSets, useResultSet, usePublishResultSet,
  useRequestAmendment, useAmendments, useApproveAmendment, useLockResultSet,
  useResultReadiness,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolResultsPage() {
  const { data: terms } = useTerms();
  const [termId, setTermId] = useState('');
  const { data: rosters } = useRosters();
  const [rosterId, setRosterId] = useState('');
  const { data: sets } = useResultSets(termId || undefined);
  const compute = useComputeResults();
  const [setId, setSetId] = useState('');
  const { data: detail } = useResultSet(setId || undefined);
  const { data: readiness } = useResultReadiness(setId || undefined);
  const publish = usePublishResultSet();
  const lock = useLockResultSet();
  const requestAmd = useRequestAmendment();
  const { data: amendments } = useAmendments(setId || undefined);
  const approveAmd = useApproveAmendment();
  const [reason, setReason] = useState('');

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Result Spine</h1>
        <p className="text-sm text-muted-foreground">A3: compute from approved marks, pin to a revision, publish immutably, amend → new revision.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Compute a result set</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <select className={sel + ' w-44'} value={termId} onChange={(e) => { setTermId(e.target.value); setRosterId(''); }}><option value="">Term…</option>{(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select className={sel + ' w-56'} value={rosterId} onChange={(e) => setRosterId(e.target.value)}><option value="">Cohort (roster)…</option>{(rosters?.data ?? []).filter((r) => !termId || r.termId === termId).map((r) => <option key={r.id} value={r.id}>{r.name ?? `${r.scopeType} ${r.classId?.slice(0,6)}`}</option>)}</select>
          <Button size="sm" disabled={!termId || !rosterId || compute.isPending} onClick={async () => { try { const r = await compute.mutateAsync({ termId, rosterId }); setSetId(r.id); notify.success(`Computed revision ${r.revision}`); } catch { notify.error('Compute failed — marks must be approved (SoD) + weights 100'); } }}>
            <Calculator className="h-4 w-4" /> Compute
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Result sets</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(sets ?? []).map((s) => (
              <button key={s.id} className="flex w-full items-center justify-between rounded border p-2 text-sm text-left hover:bg-accent" onClick={() => setSetId(s.id)}>
                <span>rev {s.revision} <Badge variant={s.status === 'published' ? 'default' : 'secondary'}>{s.status}</Badge></span>
                <span className="text-xs text-muted-foreground">{s.studentCount ?? '?'} students · {s.coveragePct != null ? `${Number(s.coveragePct)}%` : ''}</span>
              </button>
            ))}
            {(sets ?? []).length === 0 && <p className="text-sm text-muted-foreground">No result sets for this term yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Detail</CardTitle>
            {detail && (
              <div className="flex gap-1">
                {detail.resultSet.status === 'locked' && <Badge><Lock className="h-3 w-3" /> Locked</Badge>}
                {detail.resultSet.status === 'published' && <Button size="sm" variant="ghost" disabled={lock.isPending} onClick={() => lock.mutate(detail.resultSet.id)}><Lock className="h-4 w-4" /> Lock</Button>}
                {detail.resultSet.status !== 'published' && detail.resultSet.status !== 'locked' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={publish.isPending || !readiness?.ready}
                    onClick={() => publish.mutate(detail.resultSet.id)}
                    title={readiness && !readiness.ready ? 'Resolve the items below before publishing' : 'Publish results'}
                  >
                    <ShieldCheck className="h-4 w-4" /> Publish
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {detail ? (
              <>
                {/* Readiness gate — shown before publish so missing marks/approvals are visible up front. */}
                {readiness && detail.resultSet.status !== 'published' && detail.resultSet.status !== 'locked' && (
                  <ReadinessChecklist readiness={readiness} />
                )}
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge>rev {detail.resultSet.revision}</Badge>
                  <Badge variant="secondary">coverage {detail.resultSet.coveragePct != null ? `${Number(detail.resultSet.coveragePct)}%` : '—'}</Badge>
                  <Badge variant="secondary">weights100 {detail.resultSet.weightsSum100 ? '✓' : '✗'}</Badge>
                  <Badge variant="secondary">allApproved {detail.resultSet.allApproved ? '✓' : '✗'}</Badge>
                  {detail.resultSet.checksum && <span className="font-mono text-muted-foreground">{detail.resultSet.checksum.slice(0,12)}…</span>}
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Subject results (per student, CA + exam → final)</p>
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Subject</th><th className="px-2 py-1">CA</th><th className="px-2 py-1">Exam</th><th className="px-2 py-1">Final</th><th className="px-2 py-1">Grade</th></tr></thead>
                    <tbody>
                      {(detail.subjects ?? []).slice(0, 8).map((s, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-2 py-1">{s.subjectName ?? s.subjectId.slice(0,6)}</td>
                          <td className="px-2 py-1">{s.caScore != null ? Number(s.caScore) : '—'}</td>
                          <td className="px-2 py-1">{s.examScore != null ? Number(s.examScore) : '—'}</td>
                          <td className="px-2 py-1 font-medium">{s.finalPercent != null ? Number(s.finalPercent) : '—'}</td>
                          <td className="px-2 py-1">{s.grade ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Term results (top of class)</p>
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Student</th><th className="px-2 py-1">Mean%</th><th className="px-2 py-1">Rank</th><th className="px-2 py-1">Eligible</th><th className="px-2 py-1">Recommend</th></tr></thead>
                    <tbody>
                      {(detail.students ?? []).slice(0, 8).map((t, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-2 py-1">{t.studentName ?? t.admissionNo ?? t.studentProfileId.slice(0,6)}</td>
                          <td className="px-2 py-1">{t.meanPercent != null ? Number(t.meanPercent) : '—'}</td>
                          <td className="px-2 py-1">{t.classRank ?? '—'}</td>
                          <td className="px-2 py-1">{t.eligible ? '✓' : '✗'}</td>
                          <td className="px-2 py-1">{t.promotionRecommendation ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2">
                  <Input placeholder="Amendment reason (new revision)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button size="sm" variant="ghost" disabled={!reason || requestAmd.isPending} onClick={async () => { await requestAmd.mutateAsync({ resultSetId: detail.resultSet.id, reason }); setReason(''); notify.success('Amendment requested'); }}><Send className="h-4 w-4" /> Amend</Button>
                </div>
              </>
            ) : <p className="text-sm text-muted-foreground">Select a result set to view.</p>}
          </CardContent>
        </Card>
      </div>

      {setId && amendments && amendments.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Amendments</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {amendments.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <span>{a.reason} <Badge variant="secondary">{a.status}</Badge></span>
                {a.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => approveAmd.mutate(a.id)}>Approve</Button>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * The "what is ready, what is missing" gate shown above the Publish button.
 * Surfaces the server's publish-gate checks as a plain-language checklist so an
 * administrator never discovers missing marks or approvals after publishing.
 */
function ReadinessChecklist({ readiness }: { readiness: { ready: boolean; summary: any; conflicts: Array<{ code: string; detail: string }> } }) {
  const s = readiness.summary ?? {};
  const rows: { label: string; ok: boolean }[] = [
    { label: 'Academic roster frozen', ok: !!s.rosterFrozen },
    { label: `Students covered (${s.studentsCovered ?? 0}/${s.studentsExpected ?? 0})`, ok: (s.studentsCovered ?? 0) === (s.studentsExpected ?? 0) && (s.studentsExpected ?? 0) > 0 },
    { label: `Marks approved (${s.marksApproved ?? 0}/${s.marksTotal ?? 0})`, ok: (s.marksApproved ?? 0) === (s.marksTotal ?? 0) && (s.marksTotal ?? 0) > 0 },
    { label: 'No segregation-of-duties violations', ok: (s.sodViolations ?? 0) === 0 },
    { label: 'Result checksums present', ok: !!s.hasChecksums },
  ];

  return (
    <div className={`rounded-md border p-3 text-sm ${readiness.ready ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
      <div className="mb-2 flex items-center gap-2 font-medium">
        {readiness.ready
          ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Ready to publish</>
          : <><AlertTriangle className="h-4 w-4 text-amber-600" /> Not ready to publish yet</>}
      </div>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            {r.ok
              ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
            <span className={r.ok ? 'text-muted-foreground' : ''}>{r.label}</span>
          </li>
        ))}
      </ul>
      {!readiness.ready && readiness.conflicts?.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {readiness.conflicts.length} item{readiness.conflicts.length === 1 ? '' : 's'} need attention before results can be published.
        </p>
      )}
    </div>
  );
}
