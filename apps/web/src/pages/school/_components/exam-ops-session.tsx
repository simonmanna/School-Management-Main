import { useEffect, useState } from 'react';
import { Save, AlertTriangle, Accessibility, CheckCircle2, XCircle } from 'lucide-react';
import {
  useDecideConsideration, useExamRegister, useRaiseIncident, useRecordAttendance,
  useRequestConsideration, useResolveIncident,
  type ExamAttendanceStatus, type ExamOpsOverview,
} from '@/features/school/exam-operations-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { Empty, apiMessage, fmtDate, fmtDateTime, selectClass } from './exam-ops-shared';

const STATUS: Array<{ value: ExamAttendanceStatus; label: string }> = [
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'absent', label: 'Absent' },
  { value: 'excused', label: 'Excused' },
  { value: 'malpractice', label: 'Malpractice' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

const INCIDENT_TYPES = [
  { value: 'malpractice', label: 'Malpractice' },
  { value: 'illness', label: 'Illness' },
  { value: 'disruption', label: 'Disruption' },
  { value: 'missing_script', label: 'Missing script' },
  { value: 'late_arrival', label: 'Late arrival' },
  { value: 'material_error', label: 'Error in the paper' },
  { value: 'other', label: 'Other' },
];

const CONSIDERATION_TYPES = [
  { value: 'extra_time', label: 'Extra time' },
  { value: 'separate_room', label: 'Separate room' },
  { value: 'reader', label: 'Reader' },
  { value: 'scribe', label: 'Scribe' },
  { value: 'rest_breaks', label: 'Rest breaks' },
  { value: 'enlarged_print', label: 'Enlarged print' },
  { value: 'alternative_format', label: 'Alternative format' },
  { value: 'aegrotat', label: 'Aegrotat (sat ill / could not sit)' },
  { value: 'exemption', label: 'Exemption from this paper' },
  { value: 'other', label: 'Other' },
];

/**
 * Step 9 — the register for one paper.
 *
 * An absence recorded here also marks the learner absent on their canonical
 * assessment, so the result engine excludes them explicitly. That is the whole
 * point: a blank row and an absence must never look the same to the calculation.
 */
export function ExamRegisterPanel({
  overview,
  paperId,
  onPaper,
}: {
  overview: ExamOpsOverview;
  paperId: string;
  onPaper: (id: string) => void;
}) {
  const { data: register, isLoading } = useExamRegister(paperId || undefined);
  const record = useRecordAttendance();
  const [draft, setDraft] = useState<Record<string, ExamAttendanceStatus>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  // A new paper is a new register: keep unsaved edits from leaking across papers.
  useEffect(() => { setDraft({}); setNotes({}); }, [paperId]);

  const locked = !!register?.paper.marksLockedAt;
  const dirty = Object.keys(draft).length > 0;

  const setAll = (status: ExamAttendanceStatus) => {
    if (!register) return;
    const next: Record<string, ExamAttendanceStatus> = {};
    for (const r of register.rows) if (!r.status) next[r.studentProfileId] = status;
    setDraft((d) => ({ ...next, ...d }));
  };

  const save = async () => {
    if (!register) return;
    const rows = Object.entries(draft).map(([studentProfileId, status]) => ({
      studentProfileId,
      status,
      note: notes[studentProfileId] || undefined,
    }));
    if (!rows.length) return;
    try {
      const out = await record.mutateAsync({ examScheduleId: register.paper.id, rows });
      setDraft({});
      notify.success(`Register saved — ${out.recorded} candidate(s)`, {
        description: 'Anyone marked absent is excluded from the results for this paper, not given a zero.',
      });
    } catch (e) {
      notify.error('Could not save the register', { description: apiMessage(e, 'Try again.') });
    }
  };

  return (
    <div className="space-y-4">
      <PaperPicker overview={overview} paperId={paperId} onPaper={onPaper} />
      {!paperId && <Empty>Choose a paper above.</Empty>}
      {paperId && isLoading && <Empty>Loading the register…</Empty>}

      {register && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">
                {register.paper.subjectName ?? 'Paper'} — {register.paper.className ?? 'class'}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {fmtDate(register.paper.date)} at {register.paper.startTime} · {register.paper.venueName ?? 'no room set'} ·
                {' '}{register.summary.recorded}/{register.summary.expected} recorded
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {locked && <Badge variant="secondary">Paper locked</Badge>}
              {!locked && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setAll('present')}>Mark the rest present</Button>
                  <Button size="sm" disabled={!dirty || record.isPending} onClick={save}>
                    <Save className="h-4 w-4" /> Save register ({Object.keys(draft).length})
                  </Button>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {register.rows.length === 0 ? (
              <Empty>No candidates for this paper’s class. Freeze the candidate list first.</Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Seat</TableHead>
                    <TableHead>Arrangements</TableHead>
                    <TableHead>Attendance</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {register.rows.map((r) => {
                    const value = draft[r.studentProfileId] ?? r.status ?? '';
                    return (
                      <TableRow key={r.studentProfileId}>
                        <TableCell className="text-sm">
                          {r.studentName ?? '—'}
                          <div className="text-xs text-muted-foreground">{r.candidateNumber ?? r.admissionNo ?? ''}</div>
                        </TableCell>
                        <TableCell className="text-sm">{r.seatNumber ?? '—'}</TableCell>
                        <TableCell className="text-xs">
                          {r.considerations.length
                            ? r.considerations.map((c) => (
                                <Badge key={c.id} variant="secondary" className="mr-1">
                                  {CONSIDERATION_TYPES.find((t) => t.value === c.type)?.label ?? c.type}
                                  {c.extraTimeMinutes ? ` +${c.extraTimeMinutes}m` : ''}
                                </Badge>
                              ))
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <select
                            className={`${selectClass} w-36`}
                            disabled={locked}
                            value={value}
                            onChange={(e) => setDraft((d) => ({ ...d, [r.studentProfileId]: e.target.value as ExamAttendanceStatus }))}
                          >
                            <option value="">Not recorded</option>
                            {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        </TableCell>
                        <TableCell>
                          <Input
                            className="w-48"
                            disabled={locked}
                            placeholder={r.note ?? 'Optional'}
                            value={notes[r.studentProfileId] ?? ''}
                            onChange={(e) => setNotes((n) => ({ ...n, [r.studentProfileId]: e.target.value }))}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Steps 9 and 4 — what went wrong in the hall, and who needed an arrangement. */
export function ExamIncidentsPanel({ overview }: { overview: ExamOpsOverview }) {
  const raise = useRaiseIncident();
  const resolve = useResolveIncident();
  const request = useRequestConsideration();
  const decide = useDecideConsideration();

  const [iType, setIType] = useState('malpractice');
  const [iSeverity, setISeverity] = useState<'low' | 'medium' | 'high'>('medium');
  const [iPaper, setIPaper] = useState('');
  const [iStudent, setIStudent] = useState('');
  const [iText, setIText] = useState('');

  const [cType, setCType] = useState('extra_time');
  const [cStudent, setCStudent] = useState('');
  const [cPaper, setCPaper] = useState('');
  const [cMinutes, setCMinutes] = useState('15');
  const [cReason, setCReason] = useState('');
  const [cExempt, setCExempt] = useState(false);

  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [uphold, setUphold] = useState<Record<string, boolean>>({});
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({});

  const candidates = overview.candidates;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Incidents</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={selectClass} value={iType} onChange={(e) => setIType(e.target.value)}>
              {INCIDENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select className={selectClass} value={iSeverity} onChange={(e) => setISeverity(e.target.value as 'low' | 'medium' | 'high')}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
            <select className={selectClass} value={iPaper} onChange={(e) => setIPaper(e.target.value)}>
              <option value="">Whole examination</option>
              {overview.papers.map((p) => <option key={p.id} value={p.id}>{p.subjectName} · {p.className}</option>)}
            </select>
            <select className={selectClass} value={iStudent} onChange={(e) => setIStudent(e.target.value)}>
              <option value="">No individual candidate</option>
              {candidates.map((c) => <option key={c.studentProfileId} value={c.studentProfileId}>{c.studentName ?? c.admissionNo}</option>)}
            </select>
          </div>
          <Input placeholder="What happened?" value={iText} onChange={(e) => setIText(e.target.value)} />
          <Button
            size="sm"
            disabled={!iText.trim() || raise.isPending}
            onClick={async () => {
              try {
                await raise.mutateAsync({
                  examId: overview.exam.id,
                  examScheduleId: iPaper || undefined,
                  studentProfileId: iStudent || undefined,
                  type: iType, severity: iSeverity, description: iText,
                });
                setIText(''); setIStudent('');
                notify.success('Incident recorded', { description: 'It must be closed before the results are finalised.' });
              } catch (e) {
                notify.error('Could not record the incident', { description: apiMessage(e, 'Try again.') });
              }
            }}
          >
            Record incident
          </Button>

          <div className="space-y-2 border-t pt-3">
            {overview.incidents.length === 0 && <p className="text-sm text-muted-foreground">Nothing recorded.</p>}
            {overview.incidents.map((i) => (
              <div key={i.id} className="rounded border p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {INCIDENT_TYPES.find((t) => t.value === i.type)?.label ?? i.type}
                    {i.studentName ? ` — ${i.studentName}` : ''}
                  </span>
                  <Badge variant={i.status === 'open' ? 'default' : 'secondary'}>{i.status.replace('_', ' ')}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{fmtDateTime(i.occurredAt)} · severity {i.severity}</p>
                <p className="mt-1">{i.description}</p>
                {i.resolution && <p className="mt-1 text-xs text-muted-foreground">Outcome: {i.resolution}</p>}
                {['open', 'under_review'].includes(i.status) && (
                  <div className="mt-2 space-y-2">
                    <Input
                      placeholder="What was decided?"
                      value={resolution[i.id] ?? ''}
                      onChange={(e) => setResolution((r) => ({ ...r, [i.id]: e.target.value }))}
                    />
                    {i.type === 'malpractice' && i.studentProfileId && i.examScheduleId && (
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={!!uphold[i.id]}
                          onChange={(e) => setUphold((u) => ({ ...u, [i.id]: e.target.checked }))}
                        />
                        Uphold — this candidate’s paper stops counting as a score
                      </label>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm" variant="outline"
                        disabled={!resolution[i.id]?.trim() || resolve.isPending}
                        onClick={async () => {
                          try {
                            await resolve.mutateAsync({ id: i.id, status: 'resolved', resolution: resolution[i.id], upholdMalpractice: !!uphold[i.id] });
                            notify.success('Incident closed');
                          } catch (e) {
                            notify.error('Could not close the incident', { description: apiMessage(e, 'Try again.') });
                          }
                        }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        disabled={!resolution[i.id]?.trim() || resolve.isPending}
                        onClick={async () => {
                          try {
                            await resolve.mutateAsync({ id: i.id, status: 'dismissed', resolution: resolution[i.id] });
                            notify.success('Incident dismissed');
                          } catch (e) {
                            notify.error('Could not dismiss the incident', { description: apiMessage(e, 'Try again.') });
                          }
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Dismiss
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Accessibility className="h-4 w-4" /> Access arrangements</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={selectClass} value={cStudent} onChange={(e) => setCStudent(e.target.value)}>
              <option value="">Candidate…</option>
              {candidates.map((c) => <option key={c.studentProfileId} value={c.studentProfileId}>{c.studentName ?? c.admissionNo}</option>)}
            </select>
            <select className={selectClass} value={cType} onChange={(e) => setCType(e.target.value)}>
              {CONSIDERATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select className={selectClass} value={cPaper} onChange={(e) => setCPaper(e.target.value)}>
              <option value="">Every paper</option>
              {overview.papers.map((p) => <option key={p.id} value={p.id}>{p.subjectName} · {p.className}</option>)}
            </select>
            {cType === 'extra_time' && (
              <Input type="number" min={1} placeholder="Extra minutes" value={cMinutes} onChange={(e) => setCMinutes(e.target.value)} />
            )}
          </div>
          <Input placeholder="Why is this needed?" value={cReason} onChange={(e) => setCReason(e.target.value)} />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={cExempt} onChange={(e) => setCExempt(e.target.checked)} />
            Exempt from the result — the paper is left out of the average rather than scored zero
          </label>
          <Button
            size="sm"
            disabled={!cStudent || !cReason.trim() || request.isPending}
            onClick={async () => {
              try {
                await request.mutateAsync({
                  examId: overview.exam.id,
                  studentProfileId: cStudent,
                  examScheduleId: cPaper || undefined,
                  type: cType,
                  extraTimeMinutes: cType === 'extra_time' ? Number(cMinutes) || undefined : undefined,
                  reason: cReason,
                  exemptsFromResult: cExempt,
                });
                setCReason(''); setCStudent(''); setCExempt(false);
                notify.success('Arrangement requested', { description: 'Someone other than you has to approve it.' });
              } catch (e) {
                notify.error('Could not request the arrangement', { description: apiMessage(e, 'Try again.') });
              }
            }}
          >
            Request arrangement
          </Button>

          <div className="space-y-2 border-t pt-3">
            {overview.considerations.length === 0 && <p className="text-sm text-muted-foreground">Nothing requested.</p>}
            {overview.considerations.map((c) => (
              <div key={c.id} className="rounded border p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {c.studentName ?? '—'} — {CONSIDERATION_TYPES.find((t) => t.value === c.type)?.label ?? c.type}
                    {c.extraTimeMinutes ? ` (+${c.extraTimeMinutes} min)` : ''}
                  </span>
                  <Badge variant={c.status === 'approved' ? 'default' : 'secondary'}>{c.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{c.reason}</p>
                {c.exemptsFromResult && <p className="text-xs text-muted-foreground">Exempts the paper from the result.</p>}
                {c.decisionNote && <p className="text-xs text-muted-foreground">Decision: {c.decisionNote}</p>}
                {c.status === 'requested' && (
                  <div className="mt-2 space-y-2">
                    <Input
                      placeholder="Note (required to refuse)"
                      value={decisionNote[c.id] ?? ''}
                      onChange={(e) => setDecisionNote((n) => ({ ...n, [c.id]: e.target.value }))}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm" variant="outline" disabled={decide.isPending}
                        onClick={async () => {
                          try {
                            await decide.mutateAsync({ id: c.id, status: 'approved', decisionNote: decisionNote[c.id] || undefined });
                            notify.success('Arrangement approved');
                          } catch (e) {
                            notify.error('Could not approve it', { description: apiMessage(e, 'An arrangement is decided by someone other than whoever asked for it.') });
                          }
                        }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button
                        size="sm" variant="ghost" disabled={!decisionNote[c.id]?.trim() || decide.isPending}
                        onClick={async () => {
                          try {
                            await decide.mutateAsync({ id: c.id, status: 'rejected', decisionNote: decisionNote[c.id] });
                            notify.success('Arrangement refused');
                          } catch (e) {
                            notify.error('Could not refuse it', { description: apiMessage(e, 'Try again.') });
                          }
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Refuse
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function PaperPicker({
  overview,
  paperId,
  onPaper,
}: {
  overview: ExamOpsOverview;
  paperId: string;
  onPaper: (id: string) => void;
}) {
  return (
    <select className={`${selectClass} max-w-md`} value={paperId} onChange={(e) => onPaper(e.target.value)}>
      <option value="">Choose a paper…</option>
      {overview.papers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.subjectName ?? 'Subject'}{p.paperNumber ? ` P${p.paperNumber}` : ''} · {p.className ?? ''} · {fmtDate(p.date)} {p.startTime}
        </option>
      ))}
    </select>
  );
}
