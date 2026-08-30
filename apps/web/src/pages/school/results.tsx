import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Calculator, ShieldCheck, History, Send, Lock, AlertTriangle, CheckCircle2, FileText, Users } from 'lucide-react';
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
import { WorkflowSteps } from './_components/exam-workflow';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

/** Server publish-gate conflict. `runPublishGate` is the only authority for these. */
type Conflict = { code: string; studentProfileId?: string; detail: string };

export function SchoolResultsPage() {
  const navigate = useNavigate();
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

  const termName = (terms?.data ?? []).find((t) => t.id === termId)?.name;

  // Pupil names for the blocker list. The gate returns ids; the result set we
  // already loaded carries the names, so no extra request is needed.
  const nameById = new Map<string, string>();
  for (const t of detail?.students ?? []) {
    if (t.studentProfileId) nameById.set(t.studentProfileId, t.studentName ?? t.admissionNo ?? '');
  }

  const doPublish = async (id: string) => {
    try {
      await publish.mutateAsync(id);
      notify.success('Results released to parents', {
        description: termName ? `${termName} results are now visible in the parent portal.` : undefined,
        action: { label: 'Report cards', onClick: () => navigate('/school/report-cards') },
      });
    } catch (e: unknown) {
      // The server returns the full blocker list on a failed publish. Showing
      // "publish failed" and dropping it is how an administrator ends up
      // guessing; the checklist below re-renders with the same codes.
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
        <div>
          <h1 className="text-xl font-semibold">
            End of term results{termName ? ` — ${termName}` : ''}
          </h1>
          <p className="text-sm text-muted-foreground">
            Work out each pupil’s results from approved marks, check what is still outstanding, then release them to parents.
          </p>
        </div>
        <WorkflowSteps current={5} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Work out results</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <select className={sel + ' w-44'} value={termId} onChange={(e) => { setTermId(e.target.value); setRosterId(''); }}>
            <option value="">Term…</option>
            {(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className={sel + ' w-64'} value={rosterId} onChange={(e) => setRosterId(e.target.value)}>
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
                setSetId(r.id);
                notify.success(`Results worked out (version ${r.revision})`, {
                  description: 'Check the list below, then release them to parents.',
                });
              } catch (e: unknown) {
                const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
                notify.error('Could not work out results', {
                  description: typeof msg === 'string' ? msg
                    : 'Every mark must be approved first, and the class list must be locked.',
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
              <button key={s.id} className="flex w-full items-center justify-between rounded border p-2 text-sm text-left hover:bg-accent" onClick={() => setSetId(s.id)}>
                <span>Version {s.revision} <Badge variant={s.status === 'published' ? 'default' : 'secondary'}>{statusLabel(s.status)}</Badge></span>
                <span className="text-xs text-muted-foreground">{s.studentCount ?? '?'} pupils</span>
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
                    <Button size="sm" variant="ghost" onClick={() => navigate('/school/report-cards')}>
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
                {detail.resultSet.status !== 'published' && detail.resultSet.status !== 'locked' && (
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
                {readiness && detail.resultSet.status !== 'published' && detail.resultSet.status !== 'locked' && (
                  <ReadinessChecklist readiness={readiness} nameById={nameById} />
                )}
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge>Version {detail.resultSet.revision}</Badge>
                  <Badge variant="secondary">
                    {detail.resultSet.coveragePct != null ? `${Number(detail.resultSet.coveragePct)}% of pupils covered` : 'Coverage —'}
                  </Badge>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Subject results (coursework + exam → final)</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Subject</th><th className="px-2 py-1">Coursework</th><th className="px-2 py-1">Exam</th><th className="px-2 py-1">Final</th><th className="px-2 py-1">Grade</th></tr></thead>
                      <tbody>
                        {(detail.subjects ?? []).slice(0, 8).map((s, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-2 py-1">{s.subjectName ?? '—'}</td>
                            <td className="px-2 py-1">{s.caScore != null ? Number(s.caScore) : '—'}</td>
                            <td className="px-2 py-1">{s.examScore != null ? Number(s.examScore) : '—'}</td>
                            <td className="px-2 py-1 font-medium">{s.finalPercent != null ? Number(s.finalPercent) : '—'}</td>
                            <td className="px-2 py-1">{s.grade ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Term results (top of class)</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Pupil</th><th className="px-2 py-1">Average</th><th className="px-2 py-1">Position</th><th className="px-2 py-1">Next class</th></tr></thead>
                      <tbody>
                        {(detail.students ?? []).slice(0, 8).map((t, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-2 py-1">{t.studentName ?? t.admissionNo ?? '—'}</td>
                            <td className="px-2 py-1">{t.meanPercent != null ? `${Number(t.meanPercent)}%` : '—'}</td>
                            <td className="px-2 py-1">{t.classRank ?? '—'}</td>
                            <td className="px-2 py-1">{recommendationLabel(t.promotionRecommendation)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input placeholder="Why are these results being changed?" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button size="sm" variant="ghost" disabled={!reason || requestAmd.isPending} onClick={async () => { await requestAmd.mutateAsync({ resultSetId: detail.resultSet.id, reason }); setReason(''); notify.success('Change requested', { description: 'Approving it works the results out again as a new version.' }); }}><Send className="h-4 w-4" /> Request change</Button>
                </div>
              </>
            ) : <p className="text-sm text-muted-foreground">Pick a version on the left to see it.</p>}
          </CardContent>
        </Card>
      </div>

      {setId && amendments && amendments.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" /> Requested changes</CardTitle></CardHeader>
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

// ── blocker translation ──────────────────────────────────────────────────────

/**
 * Turn the publish gate's codes into something a deputy head can act on.
 *
 * The gate stays the single authority for WHETHER results may be released —
 * this only translates its answer. Every rule lives in `runPublishGate`; nothing
 * here re-decides anything, it just says who and offers the screen that fixes it.
 */
function summarise(conflicts: Conflict[], nameById: Map<string, string>) {
  const code = conflicts[0]?.code ?? '';
  const pupils = [...new Set(conflicts.map((c) => c.studentProfileId).filter(Boolean) as string[])]
    .map((id) => nameById.get(id) || 'a pupil');
  const n = pupils.length;
  const who = n === 0 ? '' : n <= 3 ? pupils.join(', ') : `${pupils.slice(0, 3).join(', ')} and ${n - 3} more`;

  switch (code) {
    case 'MARKS_NOT_APPROVED':
      return {
        title: n === 1 ? '1 pupil has marks waiting for approval' : `${n} pupils have marks waiting for approval`,
        blurb: who ? `Waiting on: ${who}.` : 'Some marks have not been signed off yet.',
        cta: { label: 'Review approvals', to: '/school/approvals' },
      };
    case 'STUDENT_NOT_COVERED':
      return {
        title: n === 1 ? '1 pupil has no result' : `${n} pupils have no result`,
        blurb: who ? `No marks were found for: ${who}.` : 'Some pupils on the class list have no marks at all.',
        cta: { label: 'Enter marks', to: '/school/enter-marks' },
      };
    case 'SOD_VIOLATION':
      return {
        title: 'Someone approved their own marks',
        blurb: who ? `Affects: ${who}. Marks must be approved by someone other than whoever entered them.` : 'Marks must be approved by someone other than whoever entered them.',
        cta: { label: 'Review approvals', to: '/school/approvals' },
      };
    case 'ROSTER_NOT_FROZEN':
      return {
        title: 'The class list is not locked yet',
        blurb: 'Lock the class list so the results cannot change underneath you.',
        cta: { label: 'Open class lists', to: '/school/assessment-ops' },
      };
    case 'NO_ROSTER':
      return {
        title: 'No class list attached',
        blurb: 'These results were worked out without a class list, so there is nothing to check them against.',
        cta: { label: 'Open class lists', to: '/school/assessment-ops' },
      };
    case 'MISSING_CHECKSUM':
      return {
        title: 'These results are incomplete',
        blurb: 'Work the results out again — the last run did not finish properly.',
        cta: null,
      };
    default:
      return { title: 'Something is blocking release', blurb: conflicts[0]?.detail ?? '', cta: null };
  }
}

function ReadinessChecklist({
  readiness,
  nameById,
}: {
  readiness: { ready: boolean; summary: Record<string, unknown>; conflicts: Conflict[] };
  nameById: Map<string, string>;
}) {
  const s = (readiness.summary ?? {}) as Record<string, number | boolean>;
  const rows: { label: string; ok: boolean }[] = [
    { label: 'Class list locked', ok: !!s.rosterFrozen },
    {
      label: `Every pupil has a result (${Number(s.studentsCovered ?? 0)}/${Number(s.studentsExpected ?? 0)})`,
      ok: Number(s.studentsCovered ?? 0) === Number(s.studentsExpected ?? 0) && Number(s.studentsExpected ?? 0) > 0,
    },
    {
      label: `Marks approved (${Number(s.marksApproved ?? 0)}/${Number(s.marksTotal ?? 0)})`,
      ok: Number(s.marksApproved ?? 0) === Number(s.marksTotal ?? 0) && Number(s.marksTotal ?? 0) > 0,
    },
    { label: 'Nobody approved their own marks', ok: Number(s.sodViolations ?? 0) === 0 },
    { label: 'Results worked out in full', ok: !!s.hasChecksums },
  ];

  // Group the gate's conflicts by code so five unapproved pupils read as one
  // instruction, not five lines.
  const groups = new Map<string, Conflict[]>();
  for (const c of readiness.conflicts ?? []) {
    const list = groups.get(c.code) ?? [];
    list.push(c);
    groups.set(c.code, list);
  }

  return (
    <div className={`rounded-md border p-3 text-sm ${readiness.ready ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
      <div className="mb-2 flex items-center gap-2 font-medium">
        {readiness.ready
          ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Ready to release</>
          : <><AlertTriangle className="h-4 w-4 text-amber-600" /> Not ready to release yet</>}
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

      {groups.size > 0 && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {[...groups.values()].map((list, i) => {
            const g = summarise(list, nameById);
            return (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{g.title}</p>
                  {g.blurb && <p className="text-xs text-muted-foreground">{g.blurb}</p>}
                </div>
                {g.cta && (
                  <Button asChild size="sm" variant="outline">
                    <Link to={g.cta.to}><Users className="h-3.5 w-3.5" /> {g.cta.label}</Link>
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── small label helpers ──────────────────────────────────────────────────────

function rosterLabel(r: { name?: string | null; scopeType?: string; className?: string | null; classId?: string | null }) {
  if (r.name) return r.name;
  if (r.className) return r.className;
  return r.scopeType === 'class' ? 'Whole class' : (r.scopeType ?? 'Class list');
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    draft: 'Draft',
    computing: 'Working out',
    computed: 'Ready to check',
    approved: 'Approved',
    published: 'Released',
    locked: 'Final',
    archived: 'Superseded',
  };
  return map[status] ?? status;
}

function recommendationLabel(v?: string | null) {
  const map: Record<string, string> = { promote: 'Promote', repeat: 'Repeat', graduate: 'Graduate', review: 'Review' };
  return v ? (map[v] ?? v) : '—';
}
