import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, IdCard, Send, Upload } from 'lucide-react';
import { useClasses, useTerms } from '@/features/school/api';
import {
  downloadExport, useAssignCandidateNumbers, useCaReadiness, useCandidateReferences,
  useExportRuns, useExportTemplates, useImportIndexNumbers, useMarkExportSubmitted,
  useMissingReferences, usePreviewExport, useRunExport, useSeedDefaultTemplates, downloadExportXlsx,
  type CaCandidate, type ExamLevel,
} from '@/features/school/statutory-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';

const selectClass = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

const LEVELS: Array<{ value: ExamLevel; label: string; hint: string }> = [
  { value: 'PLE', label: 'PLE (P7)', hint: 'Primary Leaving Examination' },
  { value: 'UCE', label: 'UCE (S4)', hint: 'Uganda Certificate of Education' },
  { value: 'UACE', label: 'UACE (S6)', hint: 'Uganda Advanced Certificate of Education' },
];

/** Plain-language name for each machine finding, so the screen reads as advice. */
const FINDING_LABEL: Record<string, string> = {
  NO_CANDIDATE_REFERENCE: 'Not registered for the sitting',
  NO_CANDIDATE_NUMBER: 'No candidate number',
  NO_CENTRE_NUMBER: 'No centre number',
  DUPLICATE_CANDIDATE_NUMBER: 'Candidate number used twice',
  NO_SUBJECT_ACHIEVEMENT: 'No approved classroom score',
  NO_ACTIVITY_OF_INTEGRATION: 'No Activity of Integration',
  NO_PROJECT_WORK: 'No project score',
  MARKS_NOT_APPROVED: 'Marks entered but not approved',
  NO_PARTICIPATION: 'Neither a mark nor a reason',
  SCORE_OUT_OF_RANGE: 'A mark is above its maximum',
  NO_SUBJECT_CODE: 'Subject has no code',
  NO_PUBLISHED_RESULTS: 'No published results for this term',
};

const apiMessage = (err: unknown, fallback: string): string => {
  const res = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof res === 'string') return res;
  if (Array.isArray(res)) return res.join(', ');
  return fallback;
};

/**
 * Phase 6 — the national-submission desk.
 *
 * A CA file is refused wholesale for one bad row and the deadline does not
 * move, so the screen leads with what is NOT ready rather than with a download
 * button. Everything shown is computed server-side from the approved mark
 * store: nothing on this page can make a candidate look ready who is not.
 */
export function SchoolStatutoryPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'readiness';
  const level = (params.get('level') ?? 'UCE') as ExamLevel;
  const termId = params.get('term') ?? '';
  const year = Number(params.get('year') ?? new Date().getFullYear());

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const { data: terms } = useTerms();
  const termOptions = terms?.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">National submissions</h1>
        <p className="text-sm text-muted-foreground">
          Candidate numbers, continuous-assessment readiness and the files the school sends to the board.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Examination</span>
            <select className={selectClass} value={level} onChange={(e) => setParam('level', e.target.value)}>
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>{l.label} — {l.hint}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Term</span>
            <select className={selectClass} value={termId} onChange={(e) => setParam('term', e.target.value)}>
              <option value="">Choose a term…</option>
              {termOptions.map((t: { id: string; name: string }) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Sitting year</span>
            <Input type="number" value={year} onChange={(e) => setParam('year', e.target.value)} />
          </label>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setParam('tab', v)}>
        <TabsList>
          <TabsTrigger value="readiness">Readiness</TabsTrigger>
          <TabsTrigger value="candidates">Candidate numbers</TabsTrigger>
          <TabsTrigger value="exports">Files &amp; submissions</TabsTrigger>
        </TabsList>

        <TabsContent value="readiness" className="pt-4">
          <ReadinessPanel termId={termId} level={level} year={year} />
        </TabsContent>
        <TabsContent value="candidates" className="pt-4">
          <CandidatesPanel level={level} year={year} />
        </TabsContent>
        <TabsContent value="exports" className="pt-4">
          <ExportsPanel termId={termId} level={level} year={year} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── readiness ────────────────────────────────────────────────────────────────

function ReadinessPanel({ termId, level, year }: { termId: string; level: ExamLevel; year: number }) {
  const { data, isLoading } = useCaReadiness({ termId, level, registrationYear: year });
  const [onlyBlocked, setOnlyBlocked] = useState(true);

  if (!termId) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Choose a term to see what is outstanding.</CardContent></Card>;
  }
  if (isLoading) {
    return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Checking every candidate…</CardContent></Card>;
  }
  if (!data) return null;

  const shown = onlyBlocked ? data.candidates.filter((c) => !c.ready) : data.candidates;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Candidates" value={data.summary.candidates} />
        <Stat label="Ready to submit" value={data.summary.ready} tone={data.summary.ready > 0 ? 'good' : undefined} />
        <Stat label="Not ready" value={data.summary.blocked} tone={data.summary.blocked > 0 ? 'bad' : 'good'} />
        <Stat label="Warnings" value={data.summary.warningFindings} />
      </div>

      {data.note && (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">{data.note}</CardContent></Card>
      )}

      {Object.keys(data.summary.byCode).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">What is holding the submission up</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Object.entries(data.summary.byCode)
              .sort((a, b) => b[1] - a[1])
              .map(([code, count]) => (
                <Badge key={code} variant="outline" className="gap-1">
                  {FINDING_LABEL[code] ?? code}
                  <span className="font-semibold">{count}</span>
                </Badge>
              ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Candidates{' '}
            <span className="text-sm font-normal text-muted-foreground">
              {data.requires.activitiesOfIntegration ? '· Activities of Integration required' : ''}
              {data.requires.projectWork ? ' · project work required' : ''}
            </span>
          </CardTitle>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyBlocked} onChange={(e) => setOnlyBlocked(e.target.checked)} />
            Show only those not ready
          </label>
        </CardHeader>
        <CardContent className="space-y-3">
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {onlyBlocked ? 'Every candidate is ready.' : 'No candidate sits this examination in the selected term.'}
            </p>
          ) : (
            shown.map((c) => <CandidateRow key={c.studentProfileId} candidate={c} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CandidateRow({ candidate }: { candidate: CaCandidate }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border">
      <button className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left" onClick={() => setOpen((v) => !v)}>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{candidate.name ?? candidate.admissionNo}</div>
          <div className="truncate text-xs text-muted-foreground">
            {[candidate.candidateNumber ? `Candidate ${candidate.candidateNumber}` : 'No candidate number',
              candidate.className, candidate.streamName].filter(Boolean).join(' · ')}
          </div>
        </div>
        <Badge variant={candidate.ready ? 'secondary' : 'destructive'}>
          {candidate.ready ? 'Ready' : `${candidate.findings.filter((f) => f.severity === 'blocking').length} to fix`}
        </Badge>
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          {candidate.findings.length > 0 && (
            <ul className="space-y-1 text-sm">
              {candidate.findings.map((f, i) => (
                <li key={i} className="flex items-start gap-2">
                  {f.severity === 'blocking'
                    ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                  <span><span className="font-medium">{FINDING_LABEL[f.code] ?? f.code}</span> — {f.detail}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Subject</th><th>Code</th><th>Achievement</th>
                  <th>Integration</th><th>Project</th><th>CA</th><th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {candidate.subjects.map((s) => (
                  <tr key={s.subjectId} className="border-t">
                    <td className="py-1">{s.subjectName}</td>
                    <td>{s.subjectCode ?? '—'}</td>
                    <td>{s.subjectAchievement ?? '—'}</td>
                    <td>{s.activityOfIntegration ?? '—'}</td>
                    <td>{s.projectScore ?? '—'}</td>
                    <td>{s.caPercent ?? '—'}</td>
                    <td>{s.pendingCount > 0 ? <span className="text-destructive">{s.pendingCount}</span> : '0'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── candidate numbers ────────────────────────────────────────────────────────

function CandidatesPanel({ level, year }: { level: ExamLevel; year: number }) {
  const { data: classes } = useClasses();
  const { data: references } = useCandidateReferences({ level, registrationYear: year });
  const { data: missing } = useMissingReferences(level, year);
  const assign = useAssignCandidateNumbers();
  const importIndex = useImportIndexNumbers();

  const [centreNumber, setCentreNumber] = useState('');
  const [prefix, setPrefix] = useState('');
  const [startAt, setStartAt] = useState(1);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [paste, setPaste] = useState('');
  const [exceptions, setExceptions] = useState<Array<{ candidateNumber: string; indexNumber: string; reason: string }>>([]);

  const runAssign = async () => {
    try {
      const res = await assign.mutateAsync({
        level, registrationYear: year, classIds: classIds.length ? classIds : undefined,
        centreNumber: centreNumber || undefined, prefix: prefix || undefined, startAt,
      });
      notify.success(`${res.assigned} candidate number(s) assigned`, `${res.skipped} learner(s) already held one and were left alone.`);
    } catch (err) {
      notify.error('Could not assign numbers', apiMessage(err, 'The server refused the request.'));
    }
  };

  /**
   * The board returns index numbers as a two-column list. Parsing a paste is
   * the difference between an office typing 300 numbers and pasting them, and
   * every unmatched row comes back as an exception rather than being dropped.
   */
  const runImport = async () => {
    const rows = paste
      .split(/\r?\n/)
      .map((line) => line.split(/[,\t;]/).map((c) => c.trim()))
      .filter((cells) => cells.length >= 2 && cells[0] && cells[1])
      .map((cells) => ({ candidateNumber: cells[0], indexNumber: cells[1] }));
    if (rows.length === 0) {
      notify.error('Nothing to import', 'Paste two columns: candidate number, then index number.');
      return;
    }
    try {
      const res = await importIndex.mutateAsync({ level, registrationYear: year, rows });
      setExceptions(res.exceptions);
      notify.success(`${res.matched} index number(s) recorded`, res.exceptions.length ? `${res.exceptions.length} row(s) could not be matched.` : undefined);
    } catch (err) {
      notify.error('Import failed', apiMessage(err, 'The server refused the request.'));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><IdCard className="h-4 w-4" /> Assign candidate numbers</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Centre number</span>
              <Input value={centreNumber} onChange={(e) => setCentreNumber(e.target.value)} placeholder="e.g. U0123" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Prefix (optional)</span>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Start at</span>
              <Input type="number" value={startAt} onChange={(e) => setStartAt(Number(e.target.value))} />
            </label>
          </div>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Classes (leave empty for every class)</span>
            <select
              multiple
              className={`${selectClass} h-32`}
              value={classIds}
              onChange={(e) => setClassIds([...e.target.selectedOptions].map((o) => o.value))}
            >
              {(classes?.data ?? []).map((c: { id: string; name: string }) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            A learner who already holds a number keeps it. Re-running this fills the gaps rather than renumbering the class.
          </p>
          <Button onClick={runAssign} disabled={assign.isPending}>Assign numbers</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Upload className="h-4 w-4" /> Record index numbers from the board</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <textarea
            className="h-32 w-full rounded-md border bg-card px-3 py-2 font-mono text-xs"
            placeholder={'001, U0123/001\n002, U0123/002'}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Rows match on candidate number, never on name — two learners with the same name is ordinary, and a name match would
            file one candidate&apos;s national results against the other.
          </p>
          <Button onClick={runImport} disabled={importIndex.isPending}>Record index numbers</Button>
          {exceptions.length > 0 && (
            <div className="rounded-md border border-destructive/40 p-3">
              <div className="mb-2 text-sm font-medium text-destructive">{exceptions.length} row(s) not applied</div>
              <ul className="space-y-1 text-xs">
                {exceptions.map((e, i) => (
                  <li key={i}>{e.candidateNumber} → {e.indexNumber}: {e.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {(missing?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Not yet registered ({missing!.length})</CardTitle></CardHeader>
          <CardContent className="max-h-64 overflow-y-auto text-sm">
            <ul className="space-y-1">
              {missing!.map((m) => (
                <li key={m.studentProfileId} className="flex justify-between border-b py-1">
                  <span>{m.student?.name ?? m.studentProfileId}</span>
                  <span className="text-muted-foreground">{m.student?.className ?? m.gradeLevel?.name ?? ''}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Registered candidates ({references?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1">Candidate</th><th>Class</th><th>Centre</th><th>Candidate no.</th><th>Index no.</th><th>Status</th></tr>
            </thead>
            <tbody>
              {(references ?? []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-1">{r.student?.name ?? r.studentProfileId}</td>
                  <td>{r.student?.className ?? '—'}</td>
                  <td>{r.centreNumber ?? '—'}</td>
                  <td>{r.candidateNumber ?? '—'}</td>
                  <td>{r.indexNumber ?? '—'}</td>
                  <td><Badge variant={r.status === 'confirmed' ? 'secondary' : 'outline'}>{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── exports ──────────────────────────────────────────────────────────────────

function ExportsPanel({ termId, level, year }: { termId: string; level: ExamLevel; year: number }) {
  const { data: templates } = useExportTemplates();
  const { data: runs } = useExportRuns();
  const seed = useSeedDefaultTemplates();
  const preview = usePreviewExport();
  const run = useRunExport();
  const markSubmitted = useMarkExportSubmitted();

  const [templateId, setTemplateId] = useState('');
  const [reason, setReason] = useState('');

  const active = useMemo(() => (templates ?? []).filter((t) => t.isActive), [templates]);
  const chosen = active.find((t) => t.id === templateId);

  const dto = { templateId, termId: termId || undefined, level, registrationYear: year };

  const doPreview = async () => {
    try { await preview.mutateAsync(dto); }
    catch (err) { notify.error('Preview failed', apiMessage(err, 'The server refused the request.')); }
  };

  const doRun = async (allowIncomplete: boolean) => {
    try {
      const result = await run.mutateAsync({ ...dto, allowIncomplete, reason: allowIncomplete ? reason : undefined });
      downloadExport(result);
      notify.success(`${result.rowCount} row(s) exported`, `Run ${result.runId.slice(0, 8)} · checksum ${result.checksum.slice(0, 12)}…`);
    } catch (err) {
      notify.error('Export refused', apiMessage(err, 'Clear the readiness findings, or export with a reason on the record.'));
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="h-4 w-4" /> Produce a file</CardTitle>
          {active.length === 0 && (
            <Button variant="outline" size="sm" onClick={() => seed.mutate()} disabled={seed.isPending}>
              Add the Uganda starting layouts
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Layout</span>
            <select className={selectClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Choose a layout…</option>
              {active.map((t) => (
                <option key={t.id} value={t.id}>{t.name} — v{t.version}</option>
              ))}
            </select>
          </label>
          {chosen && (
            <p className="text-xs text-muted-foreground">
              {chosen.description} · {chosen.columns.length} column(s) · board {chosen.board}
              {chosen.level ? ` · ${chosen.level}` : ''}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={doPreview} disabled={!templateId || preview.isPending}>Preview</Button>
            <Button onClick={() => doRun(false)} disabled={!templateId || run.isPending}>
              <Download className="mr-1 h-4 w-4" /> Produce and download
            </Button>
            <Button
              variant="outline"
              disabled={!templateId || run.isPending}
              onClick={async () => {
                try {
                  await downloadExportXlsx(dto);
                  notify.success('Excel copy produced', 'Same rows and checksum as the CSV. Send the CSV to the board.');
                } catch (err) {
                  notify.error('Export refused', apiMessage(err, 'Clear the readiness findings first.'));
                }
              }}
            >
              <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel copy
            </Button>
          </div>

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm">Submit an incomplete file (agreed with the board)</summary>
            <div className="mt-2 space-y-2">
              <Input placeholder="Why is a partial submission being sent?" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="destructive" size="sm" onClick={() => doRun(true)} disabled={!templateId || !reason || run.isPending}>
                Produce anyway
              </Button>
              <p className="text-xs text-muted-foreground">
                The reason and every outstanding finding are recorded on the run, and the blocked candidates are left out of the file
                rather than exported with blank scores — a board reads a blank as a zero.
              </p>
            </div>
          </details>

          {preview.data && (
            <div className="overflow-x-auto rounded-md border">
              <div className="border-b px-3 py-2 text-xs text-muted-foreground">
                {preview.data.rowCount} row(s) · showing {preview.data.rows.length}
              </div>
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>{preview.data.columns.map((c) => <th key={c} className="px-2 py-1">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.data.rows.map((row, i) => (
                    <tr key={i} className="border-t">{row.map((cell, j) => <td key={j} className="px-2 py-1">{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Files produced</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(runs ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No file has been produced yet.</p>
          ) : (
            (runs ?? []).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{r.template?.name ?? r.scope} <span className="text-xs text-muted-foreground">v{r.templateVersion}</span></div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.generatedAt).toLocaleString()} · {r.rowCount} row(s) · checksum {r.checksum.slice(0, 12)}…
                    {r.warnings.length > 0 ? ` · ${r.warnings.length} finding(s)` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {r.status === 'submitted' ? (
                    <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Sent · {r.submissionReference}</Badge>
                  ) : r.status === 'superseded' ? (
                    <Badge variant="outline">Superseded</Badge>
                  ) : (
                    <SubmitButton onSubmit={(ref) => markSubmitted.mutate({ id: r.id, submissionReference: ref })} />
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SubmitButton({ onSubmit }: { onSubmit: (ref: string) => void }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState('');
  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Send className="mr-1 h-3 w-3" /> Mark as sent</Button>;
  }
  return (
    <div className="flex items-center gap-2">
      <Input className="h-8 w-48" placeholder="Board acknowledgement" value={ref} onChange={(e) => setRef(e.target.value)} />
      <Button size="sm" disabled={!ref} onClick={() => { onSubmit(ref); setOpen(false); }}>Save</Button>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold ${tone === 'bad' ? 'text-destructive' : tone === 'good' ? 'text-emerald-600' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
