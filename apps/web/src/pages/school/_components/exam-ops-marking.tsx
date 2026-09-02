import { useEffect, useState } from 'react';
import { EyeOff, Gavel, ListChecks, Scale, Send, Shuffle, Trash2 } from 'lucide-react';
import {
  useAllocateScripts, useDrawModerationSample, useMarkerDirectory, useModerationSamples,
  useReconcileScripts, useReconciliationBoard, useRecordModeration, useScriptWorklist,
  useSubmitScriptMark, useVoidAllocations,
  type ExamOpsOverview,
} from '@/features/school/exam-operations-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { Empty, apiMessage, num, selectClass } from './exam-ops-shared';
import { PaperPicker } from './exam-ops-session';

/**
 * Steps 9–10 — marking and moderation for one paper.
 *
 * Marker scores stay on the allocation until the script is agreed; the agreed
 * mark is what reaches the canonical mark ledger. Under blind marking the server
 * withholds the candidate's identity from the marker's worklist, so hiding it
 * here is a presentation of that decision rather than the decision itself.
 */
export function ExamMarkingPanel({
  overview,
  paperId,
  onPaper,
  mode,
}: {
  overview: ExamOpsOverview;
  paperId: string;
  onPaper: (id: string) => void;
  mode: 'marking' | 'moderation';
}) {
  return (
    <div className="space-y-4">
      <PaperPicker overview={overview} paperId={paperId} onPaper={onPaper} />
      {!paperId && <Empty>Choose a paper above.</Empty>}
      {paperId && mode === 'marking' && (
        <>
          <AllocationCard examScheduleId={paperId} />
          <div className="grid gap-4 xl:grid-cols-2">
            <WorklistCard examScheduleId={paperId} />
            <ReconciliationCard examScheduleId={paperId} />
          </div>
        </>
      )}
      {paperId && mode === 'moderation' && <ModerationCard examScheduleId={paperId} />}
    </div>
  );
}

/** Hand the scripts out. Only candidates who actually sat get one. */
function AllocationCard({ examScheduleId }: { examScheduleId: string }) {
  const { data: markers } = useMarkerDirectory();
  const allocate = useAllocateScripts();
  const voidAll = useVoidAllocations();
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState('');

  useEffect(() => { setChosen([]); }, [examScheduleId]);

  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><ListChecks className="h-4 w-4" /> Allocate scripts</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {!markers?.length ? (
          <Empty>No staff with a login were found to mark with. Link staff records to user accounts first.</Empty>
        ) : (
          <>
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded border p-2">
              {markers.map((m) => (
                <label key={m.userId} className={`flex items-center gap-2 rounded border px-2 py-1 text-sm ${chosen.includes(m.userId) ? 'bg-accent' : ''}`}>
                  <input type="checkbox" checked={chosen.includes(m.userId)} onChange={() => toggle(m.userId)} />
                  <span>{m.name}{m.departmentName ? <span className="text-xs text-muted-foreground"> · {m.departmentName}</span> : null}</span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!chosen.length || allocate.isPending}
                onClick={async () => {
                  try {
                    const out = await allocate.mutateAsync({ examScheduleId, markerIds: chosen });
                    notify.success(`${out.created} script read(s) allocated`, {
                      description: `${out.scripts} candidate(s) sat this paper. ${out.skipped ? `${out.skipped} already allocated.` : ''}`,
                    });
                  } catch (e) {
                    notify.error('Could not allocate scripts', { description: apiMessage(e, 'Record the register first.') });
                  }
                }}
              >
                <Shuffle className="h-4 w-4" /> Allocate to {chosen.length} marker(s)
              </Button>
              <Input className="w-64" placeholder="Reason, to void the allocation" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button
                size="sm" variant="ghost"
                disabled={!reason.trim() || voidAll.isPending}
                onClick={async () => {
                  try {
                    const out = await voidAll.mutateAsync({ examScheduleId, reason });
                    setReason('');
                    notify.success(`${out.voided} allocation(s) voided`);
                  } catch (e) {
                    notify.error('Could not void the allocation', { description: apiMessage(e, 'Agreed marks cannot be voided.') });
                  }
                }}
              >
                <Trash2 className="h-4 w-4" /> Void allocation
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The marker's worklist. Blind papers arrive here without a name. */
function WorklistCard({ examScheduleId }: { examScheduleId: string }) {
  const { data: markers } = useMarkerDirectory();
  const [markerId, setMarkerId] = useState('');
  const { data: worklist } = useScriptWorklist(examScheduleId, markerId || undefined);
  const submit = useSubmitScriptMark();
  const [scores, setScores] = useState<Record<string, string>>({});

  useEffect(() => { setScores({}); }, [examScheduleId, markerId]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Marking</CardTitle>
        <div className="flex items-center gap-2">
          {worklist?.blind && <Badge variant="secondary"><EyeOff className="mr-1 h-3 w-3" /> Blind</Badge>}
          <select className={`${selectClass} w-56`} value={markerId} onChange={(e) => setMarkerId(e.target.value)}>
            <option value="">My scripts</option>
            {(markers ?? []).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {!worklist?.rows.length ? (
          <Empty>No scripts allocated to this marker yet.</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Script</TableHead><TableHead>Read</TableHead>
                <TableHead>Mark</TableHead><TableHead>Status</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {worklist.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">
                    <span className="font-mono">{r.anonymousCode}</span>
                    {r.studentName && <div className="text-xs text-muted-foreground">{r.studentName}</div>}
                  </TableCell>
                  <TableCell className="text-xs capitalize">{r.role}</TableCell>
                  <TableCell>
                    <Input
                      type="number" min={0} max={Number(r.maxScore)} className="w-24"
                      disabled={r.status === 'reconciled'}
                      value={scores[r.id] ?? (r.score != null ? String(num(r.score)) : '')}
                      onChange={(e) => setScores((s) => ({ ...s, [r.id]: e.target.value }))}
                    />
                    <span className="text-xs text-muted-foreground">/ {num(r.maxScore)}</span>
                  </TableCell>
                  <TableCell><Badge variant={r.status === 'reconciled' ? 'default' : 'secondary'}>{r.status}</Badge></TableCell>
                  <TableCell>
                    <Button
                      size="sm" variant="ghost"
                      disabled={r.status === 'reconciled' || submit.isPending}
                      onClick={async () => {
                        const raw = scores[r.id] ?? (r.score != null ? String(r.score) : '');
                        try {
                          await submit.mutateAsync({
                            allocationId: r.id,
                            score: raw === '' ? null : Number(raw),
                            expectedVersion: r.version,
                          });
                          notify.success(`Mark recorded for ${r.anonymousCode}`);
                        } catch (e) {
                          notify.error('Could not record that mark', { description: apiMessage(e, 'Someone else may have marked it since you loaded this.') });
                        }
                      }}
                    >
                      <Send className="h-3.5 w-3.5" /> Submit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** Agree the mark. Two reads outside tolerance need a third before anything posts. */
function ReconciliationCard({ examScheduleId }: { examScheduleId: string }) {
  const { data: board } = useReconciliationBoard(examScheduleId);
  const reconcile = useReconcileScripts();
  const [note, setNote] = useState('');

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base flex items-center gap-2"><Gavel className="h-4 w-4" /> Agreed marks</CardTitle>
        {board && (
          <div className="flex flex-wrap gap-1 text-xs">
            <Badge variant="secondary">{board.summary.reconciled}/{board.summary.scripts} agreed</Badge>
            {board.summary.needsThirdRead > 0 && <Badge>{board.summary.needsThirdRead} need a third read</Badge>}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!board?.rows.length ? (
          <Empty>No scripts to agree yet.</Empty>
        ) : (
          <>
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Script</TableHead><TableHead>1st</TableHead><TableHead>2nd</TableHead>
                    <TableHead>Diff</TableHead><TableHead>Agreed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {board.rows.map((r) => (
                    <TableRow key={r.studentProfileId}>
                      <TableCell className="text-sm">
                        {r.studentName ?? '—'}
                        <div className="font-mono text-xs text-muted-foreground">{r.anonymousCode}</div>
                      </TableCell>
                      <TableCell className="text-sm">{num(r.first?.score ?? null)}</TableCell>
                      <TableCell className="text-sm">{r.second ? num(r.second.score) : '—'}</TableCell>
                      <TableCell className="text-sm">
                        {r.difference ?? '—'}
                        {r.withinTolerance === false && <div className="text-xs text-amber-600">outside tolerance</div>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.reconciled
                          ? <Badge>{num(r.agreedScore)}</Badge>
                          : r.needsThirdRead
                            ? <span className="text-xs text-amber-600">third read needed</span>
                            : num(r.agreedScore)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Input className="w-64" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button
                size="sm"
                disabled={reconcile.isPending || board.summary.scripts === board.summary.reconciled}
                onClick={async () => {
                  try {
                    const out = await reconcile.mutateAsync({ examScheduleId, note: note || undefined });
                    setNote('');
                    notify.success(`${out.agreed} mark(s) agreed and posted`, {
                      description: out.blocked.length
                        ? `${out.blocked.length} script(s) could not be agreed yet — ${out.blocked[0].detail}`
                        : 'These are now the canonical marks for this paper.',
                    });
                  } catch (e) {
                    notify.error('Could not agree these marks', { description: apiMessage(e, 'Try again.') });
                  }
                }}
              >
                <Gavel className="h-4 w-4" /> Agree submitted marks
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Draw a sample, re-mark it, and let a real difference become an adjustment. */
function ModerationCard({ examScheduleId }: { examScheduleId: string }) {
  const { data: samples } = useModerationSamples(examScheduleId);
  const draw = useDrawModerationSample();
  const record = useRecordModeration();
  const [method, setMethod] = useState<'random' | 'stratified' | 'boundary' | 'manual'>('stratified');
  const [size, setSize] = useState('');
  const [seed, setSeed] = useState('');
  const [open, setOpen] = useState('');
  const [scores, setScores] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');

  const sample = (samples ?? []).find((s) => s.id === open) ?? null;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Scale className="h-4 w-4" /> Moderation samples</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={selectClass} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="stratified">Across the mark range</option>
              <option value="boundary">Near grade boundaries</option>
              <option value="random">Random</option>
              <option value="manual">First N scripts</option>
            </select>
            <Input type="number" min={1} placeholder="How many (default 10%)" value={size} onChange={(e) => setSize(e.target.value)} />
            <Input placeholder="Seed (optional — repeats the same draw)" value={seed} onChange={(e) => setSeed(e.target.value)} />
          </div>
          <Button
            size="sm"
            disabled={draw.isPending}
            onClick={async () => {
              try {
                const out = await draw.mutateAsync({
                  examScheduleId, method,
                  sampleSize: size ? Number(size) : undefined,
                  seed: seed || undefined,
                });
                setOpen(out.id);
                notify.success(`${out.sampleSize} script(s) drawn for moderation`);
              } catch (e) {
                notify.error('Could not draw a sample', { description: apiMessage(e, 'Agree the marks for this paper first.') });
              }
            }}
          >
            <Shuffle className="h-4 w-4" /> Draw a sample
          </Button>

          <div className="space-y-2 border-t pt-3">
            {!samples?.length && <p className="text-sm text-muted-foreground">No samples drawn yet.</p>}
            {(samples ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setOpen(s.id); setScores({}); }}
                className={`flex w-full items-center justify-between rounded border p-2 text-left text-sm hover:bg-accent ${open === s.id ? 'bg-accent' : ''}`}
              >
                <span>
                  {s.sampleSize} script(s) · {s.method}
                  <span className="block text-xs text-muted-foreground">
                    tolerance {num(s.toleranceMarks)} {s.seed ? `· seed ${s.seed.slice(0, 12)}` : ''}
                  </span>
                </span>
                <Badge variant={['agreed', 'adjusted'].includes(s.status) ? 'default' : 'secondary'}>{s.status}</Badge>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Moderator’s re-marks</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!sample ? (
            <Empty>Pick a sample to record the moderator’s marks.</Empty>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Script</TableHead><TableHead>Original</TableHead>
                    <TableHead>Moderated</TableHead><TableHead>Difference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sample.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="text-sm">
                        {i.studentName ?? '—'}
                        <div className="font-mono text-xs text-muted-foreground">{i.anonymousCode ?? ''}</div>
                      </TableCell>
                      <TableCell className="text-sm">{num(i.originalScore)}</TableCell>
                      <TableCell>
                        <Input
                          type="number" min={0} className="w-24"
                          disabled={['agreed', 'adjusted'].includes(sample.status)}
                          value={scores[i.studentProfileId] ?? (i.moderatedScore != null ? String(num(i.moderatedScore)) : '')}
                          onChange={(e) => setScores((s) => ({ ...s, [i.studentProfileId]: e.target.value }))}
                        />
                      </TableCell>
                      <TableCell className="text-sm">
                        {i.delta != null ? num(i.delta) : '—'}
                        {i.withinTolerance === false && <div className="text-xs text-amber-600">outside tolerance</div>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {!['agreed', 'adjusted'].includes(sample.status) && (
                <div className="space-y-2 border-t pt-3">
                  <Input placeholder="Moderator’s note" value={note} onChange={(e) => setNote(e.target.value)} />
                  <Button
                    size="sm"
                    disabled={record.isPending || Object.keys(scores).length === 0}
                    onClick={async () => {
                      const items = Object.entries(scores)
                        .filter(([, v]) => v !== '')
                        .map(([studentProfileId, v]) => ({ studentProfileId, moderatedScore: Number(v) }));
                      try {
                        const out = await record.mutateAsync({ sampleId: sample.id, items, note: note || undefined });
                        setNote('');
                        notify.success('Moderation recorded', {
                          description: out.adjusted
                            ? `${out.adjusted} mark(s) adjusted on the ledger — the original marker's score is kept.`
                            : 'Every re-mark was within tolerance; no marks changed.',
                        });
                      } catch (e) {
                        notify.error('Could not record the moderation', { description: apiMessage(e, 'Try again.') });
                      }
                    }}
                  >
                    Record moderation
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    A re-mark outside tolerance is applied as a moderation adjustment on the ledger. The marker’s original score is never overwritten.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
