import { useState } from 'react';
import { Lock, Snowflake, ShieldCheck, PenLine, Users } from 'lucide-react';
import {
  useCandidateSnapshot, useConfigurePaper, useFreezeCandidates,
  type ExamOpsOverview, type MarkingMode,
} from '@/features/school/exam-operations-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { Empty, apiMessage, fmtDate, fmtDateTime, num, selectClass } from './exam-ops-shared';

const MODE_LABEL: Record<MarkingMode, string> = {
  single: 'One marker',
  double: 'Two markers',
  blind_double: 'Two markers, blind',
};

const MODE_BLURB: Record<MarkingMode, string> = {
  single: 'One marker reads each script. Their mark is the mark.',
  double: 'Two markers read each script independently and the marks are agreed.',
  blind_double: 'Two markers read each script without seeing the candidate or each other’s mark.',
};

/** Step 2 — the papers this examination is made of, and how each is marked. */
export function ExamPapersPanel({
  overview,
  onOpenPaper,
}: {
  overview: ExamOpsOverview;
  onOpenPaper: (paperId: string, tab: string) => void;
}) {
  const configure = useConfigurePaper();
  const [editing, setEditing] = useState<string>('');
  const [mode, setMode] = useState<MarkingMode>('single');
  const [tolerance, setTolerance] = useState('5');
  const [moderation, setModeration] = useState(false);

  const startEdit = (p: ExamOpsOverview['papers'][number]) => {
    setEditing(p.id);
    setMode(p.markingMode);
    setTolerance(String(num(p.markToleranceMarks)));
    setModeration(p.moderationRequired);
  };

  const save = async (paperId: string) => {
    try {
      await configure.mutateAsync({
        examScheduleId: paperId,
        markingMode: mode,
        markToleranceMarks: Number(tolerance) || 0,
        moderationRequired: moderation,
      });
      setEditing('');
      notify.success('Marking set for this paper', { description: MODE_BLURB[mode] });
    } catch (e) {
      notify.error('Could not change how this paper is marked', { description: apiMessage(e, 'Try again.') });
    }
  };

  if (!overview.papers.length) {
    return <Empty>No papers yet. Add them in <strong>Exam Scheduling</strong>, then come back here.</Empty>;
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Papers</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Paper</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Room</TableHead>
              <TableHead>Invigilators</TableHead>
              <TableHead>Marking</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.papers.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.subjectName ?? 'Subject'}{p.paperNumber ? ` · Paper ${p.paperNumber}` : ''}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.className ?? 'class'} · out of {num(p.maxMarks)}{p.isResit ? ' · resit' : ''}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {fmtDate(p.date)}<div className="text-xs text-muted-foreground">{p.startTime} · {p.durationMinutes} min</div>
                </TableCell>
                <TableCell className="text-sm">
                  {p.venueName ?? <span className="text-muted-foreground">Not set</span>}
                  {p.venueCapacity != null && <div className="text-xs text-muted-foreground">seats {p.venueCapacity}</div>}
                </TableCell>
                <TableCell className="text-sm">
                  {p.invigilators.length
                    ? p.invigilators.map((i) => i.name).filter(Boolean).join(', ')
                    : <span className="text-amber-600">None assigned</span>}
                </TableCell>
                <TableCell className="text-sm">
                  {editing === p.id ? (
                    <div className="space-y-2">
                      <select className={selectClass} value={mode} onChange={(e) => setMode(e.target.value as MarkingMode)}>
                        {(['single', 'double', 'blind_double'] as MarkingMode[]).map((m) => (
                          <option key={m} value={m}>{MODE_LABEL[m]}</option>
                        ))}
                      </select>
                      {mode !== 'single' && (
                        <Input
                          type="number" min={0} className="w-28" value={tolerance}
                          onChange={(e) => setTolerance(e.target.value)}
                          placeholder="Tolerance"
                        />
                      )}
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={moderation} onChange={(e) => setModeration(e.target.checked)} />
                        Requires moderation
                      </label>
                      <div className="flex gap-1">
                        <Button size="sm" disabled={configure.isPending} onClick={() => save(p.id)}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing('')}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Badge variant="secondary">{MODE_LABEL[p.markingMode]}</Badge>
                      {p.markingMode !== 'single' && (
                        <div className="text-xs text-muted-foreground">agree within {num(p.markToleranceMarks)} marks</div>
                      )}
                      {p.moderationRequired && <div className="text-xs text-muted-foreground">moderation required</div>}
                    </>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <div>{p.attendanceRecorded} on the register</div>
                  <div>{p.scriptsAllocated} script read(s) allocated</div>
                  <div>{p.questionPapers.length} question paper(s)</div>
                  {p.marksLockedAt && <div className="flex items-center gap-1 text-foreground"><Lock className="h-3 w-3" /> locked</div>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onOpenPaper(p.id, 'register')}>
                      <ShieldCheck className="h-3.5 w-3.5" /> Register
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onOpenPaper(p.id, 'marking')}>
                      <PenLine className="h-3.5 w-3.5" /> Marking
                    </Button>
                    {editing !== p.id && !p.marksLockedAt && (
                      <Button size="sm" variant="ghost" onClick={() => startEdit(p)}>How it is marked</Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Step 3–4 — the candidate list, and freezing it. */
export function ExamCandidatesPanel({ overview }: { overview: ExamOpsOverview }) {
  const freeze = useFreezeCandidates();
  const [reason, setReason] = useState('');
  const [viewing, setViewing] = useState<string>('');
  const { data: snapshot } = useCandidateSnapshot(viewing || undefined);

  const active = overview.snapshots.find((s) => s.isActive) ?? null;
  const drifted = !!active && active.candidateCount !== overview.candidates.filter((c) => c.status !== 'withheld').length;

  const doFreeze = async () => {
    try {
      const out = await freeze.mutateAsync({ examId: overview.exam.id, reason: reason || undefined });
      setReason('');
      notify.success(`Candidate list frozen (version ${out.revision})`, {
        description: `${out.candidateCount} candidate(s). This is the list the examination is sat under.`,
      });
    } catch (e) {
      notify.error('Could not freeze the candidate list', { description: apiMessage(e, 'Register candidates first.') });
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Frozen candidate lists</CardTitle>
          {active && <Badge><Snowflake className="mr-1 h-3 w-3" /> Version {active.revision} in force</Badge>}
        </CardHeader>
        <CardContent className="space-y-3">
          {!overview.snapshots.length && (
            <p className="text-sm text-muted-foreground">
              Not frozen yet. Freezing records exactly who this examination is sat by — a candidate added later
              cannot quietly join a sitting that has already happened.
            </p>
          )}
          {drifted && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              The registration list has changed since it was frozen. Freeze it again so the two agree.
            </p>
          )}
          <div className="space-y-2">
            {overview.snapshots.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setViewing(s.id)}
                className={`flex w-full items-center justify-between rounded border p-2 text-left text-sm hover:bg-accent ${viewing === s.id ? 'bg-accent' : ''}`}
              >
                <span>
                  Version {s.revision} {s.isActive && <Badge className="ml-1">in force</Badge>}
                  <span className="block text-xs text-muted-foreground">
                    {fmtDateTime(s.frozenAt)}{s.reason ? ` · ${s.reason}` : ''}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{s.candidateCount} candidates</span>
              </button>
            ))}
          </div>
          <div className="space-y-2 border-t pt-3">
            <Input
              placeholder={overview.snapshots.length ? 'Why is the list being frozen again? (required)' : 'Note (optional)'}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              size="sm"
              disabled={freeze.isPending || (overview.snapshots.length > 0 && !reason.trim())}
              onClick={doFreeze}
            >
              <Snowflake className="h-4 w-4" /> {overview.snapshots.length ? 'Freeze again' : 'Freeze the candidate list'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            {viewing ? `Version ${snapshot?.revision ?? ''} candidates` : 'Registered candidates'}
          </CardTitle>
          {viewing && snapshot && (
            <Badge variant={snapshot.checksumVerified ? 'secondary' : 'destructive'}>
              {snapshot.checksumVerified ? 'Verified unchanged' : 'Checksum mismatch'}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="max-h-[28rem] overflow-y-auto">
          {viewing && snapshot ? (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Candidate</TableHead><TableHead>No.</TableHead><TableHead>Seat</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.entries.map((e: any) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm">{e.studentName ?? e.admissionNo ?? '—'}</TableCell>
                    <TableCell className="text-sm">{e.candidateNumber ?? '—'}</TableCell>
                    <TableCell className="text-sm">{e.seatNumber ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : overview.candidates.length ? (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Candidate</TableHead><TableHead>Admission no.</TableHead><TableHead>Seat</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {overview.candidates.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">{c.studentName ?? '—'}</TableCell>
                    <TableCell className="text-sm">{c.admissionNo ?? '—'}</TableCell>
                    <TableCell className="text-sm">{c.seatNumber ?? <span className="text-amber-600">unseated</span>}</TableCell>
                    <TableCell><Badge variant="secondary">{c.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty>
              <Users className="mx-auto mb-2 h-5 w-5" />
              No candidates registered yet. Register a class from <strong>Exam Operations → Venues &amp; seating</strong>.
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
