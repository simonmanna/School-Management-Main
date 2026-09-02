import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, History, Save, Send, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuthStore } from '@/stores/auth.store';
import { saveAssessmentDraft, type DraftMarkRow } from '@/features/school/assessment-phase4-api';
import type { BoardSheet, BoardSheetStudent } from '@/features/school/api';
import { notify } from '@/lib/notify';

export const PARTICIPATION_OPTIONS = ['present', 'absent', 'exempt', 'missing', 'withdrawn', 'not_enrolled', 'special_consideration', 'excused', 'malpractice'];
const NO_SCORE = ['absent', 'exempt', 'withdrawn', 'not_enrolled', 'excused', 'malpractice'];
interface CellDraft { marks: string; participation: string; comment: string; expectedVersion: number }
interface PendingSave { key: string; rows: DraftMarkRow[] }
interface LocalDraft { protocol: 1; updatedAt: string; cells: Record<string, CellDraft>; pending: PendingSave | null }
interface ConflictRow { studentProfileId: string; version?: number; marks?: number | null; participation?: string; comment?: string }
const cellOf = (s: BoardSheetStudent): CellDraft => ({ marks: s.marks == null ? '' : String(s.marks), participation: s.participation, comment: s.comment ?? '', expectedVersion: s.version });

/** One explicit-save markbook. Local autosave never submits academic records. */
export function ProductionMarkbook({ sheet, onSaved, onSubmit, submitting, onEvidence }: {
  sheet: BoardSheet; onSaved: () => void; onSubmit: () => Promise<void>; submitting: boolean; onEvidence: (id: string) => void;
}) {
  const org = useAuthStore((s) => s.organization?.id);
  const user = useAuthStore((s) => s.user?.id);
  const permissions = useAuthStore((s) => s.permissions);
  const canEnter = permissions.some((p) => ['*', 'school:grades:write', 'school:grades:own', 'school:assignments:grade'].includes(p));
  const storageKey = `school:assessment-draft:v1:${org}:${user}:${sheet.assessment.id}`;
  const [baseline, setBaseline] = useState(sheet.students);
  const [cells, setCells] = useState<Record<string, CellDraft>>({});
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('Saved to server');
  const [recovered, setRecovered] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkComment, setBulkComment] = useState('');
  const [conflicts, setConflicts] = useState<ConflictRow[]>([]);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const busy = useRef(false);
  const a = sheet.assessment;
  const globalLocked = !canEnter || a.locked || ['draft', 'scheduled', 'archived'].includes(a.status) || !a.rosterFrozen;
  const rowLocked = (s: BoardSheetStudent) => globalLocked || ['approved', 'submitted'].includes(s.approvalStatus);

  useEffect(() => {
    setBaseline(sheet.students);
  }, [sheet.students]);
  useEffect(() => {
    setReady(false);
    try {
      const raw = localStorage.getItem(storageKey);
      const draft: LocalDraft | null = raw ? JSON.parse(raw) : null;
      if (draft?.protocol === 1) {
        setCells(draft.cells); setPending(draft.pending); setRecovered(true);
        setStatus(draft.pending ? 'Save queued — retry when connected' : 'Recovered unsaved draft');
      } else { setCells({}); setPending(null); }
    } catch { setStorageError(true); }
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!ready) return;
    try {
      if (!Object.keys(cells).length && !pending) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify({ protocol: 1, cells, pending, updatedAt: new Date().toISOString() } satisfies LocalDraft));
      setStorageError(false);
    } catch { setStorageError(true); }
  }, [cells, pending, ready, storageKey]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (Object.keys(cells).length || pending) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [cells, pending]);

  const visible = useMemo(() => baseline.filter((s) => `${s.name} ${s.admissionNo}`.toLowerCase().includes(search.toLowerCase())), [baseline, search]);
  const dirtyCount = Object.keys(cells).length;
  const resolved = baseline.filter((s) => s.marks != null || (NO_SCORE.includes(s.participation) && s.participation !== 'missing')).length;
  const canSubmit = !globalLocked && !dirtyCount && !pending && !saving && !submitting && resolved === baseline.length && baseline.length > 0 && baseline.some((s) => ['draft', 'rejected'].includes(s.approvalStatus));

  function edit(student: BoardSheetStudent, change: Partial<CellDraft>) {
    if (rowLocked(student) || pending || saving) return;
    setCells((old) => {
      const next = { ...(old[student.studentProfileId] ?? cellOf(student)), ...change };
      if (change.marks?.trim() && next.participation === 'missing') next.participation = 'present';
      if (NO_SCORE.includes(next.participation) || change.participation === 'missing') next.marks = '';
      return { ...old, [student.studentProfileId]: next };
    });
    setStatus('Unsaved changes — draft kept on this device');
  }

  async function save(retry?: PendingSave) {
    if (busy.current) return;
    let operation = retry ?? pending;
    if (!operation) {
      const rows: DraftMarkRow[] = [];
      for (const [studentProfileId, cell] of Object.entries(cells)) {
        const student = baseline.find((s) => s.studentProfileId === studentProfileId);
        if (!student || rowLocked(student)) { notify.error('A draft row is now locked or no longer on the roster. Review it before saving.'); return; }
        const marks = cell.marks.trim() === '' ? null : Number(cell.marks);
        if (marks != null && (!Number.isFinite(marks) || marks < 0 || marks > a.maxScore)) { notify.error(`${student.name}: enter a mark from 0 to ${a.maxScore}`); return; }
        rows.push({ studentProfileId, marks, participation: cell.participation, comment: cell.comment, expectedVersion: cell.expectedVersion });
      }
      if (!rows.length) return;
      operation = { key: crypto.randomUUID(), rows };
      // Persist the exact request and key BEFORE sending. A lost response can
      // then be replayed after a refresh without duplicating ledger writes.
      try { localStorage.setItem(storageKey, JSON.stringify({ protocol: 1, cells, pending: operation, updatedAt: new Date().toISOString() })); }
      catch { setStorageError(true); }
      setPending(operation);
    }
    busy.current = true; setSaving(true); setStatus('Saving draft…');
    try {
      const response = await saveAssessmentDraft(a.id, operation.rows, operation.key);
      setBaseline((rows) => rows.map((s) => ({ ...s, ...(response.rows.find((r) => r.studentProfileId === s.studentProfileId) ?? {}) })));
      setCells({}); setPending(null); setRecovered(false); setStatus(`Saved to server at ${new Date(response.savedAt).toLocaleTimeString()}`);
      onSaved();
    } catch (e: any) {
      const response = e?.response;
      if (response?.status === 409 && response.data?.conflicts?.length) {
        setConflicts(response.data.conflicts); setPending(null); setStatus('Conflict — your draft is preserved');
      } else if (response?.status >= 400 && response.status < 500) {
        setPending(null); setStatus('Save rejected — draft preserved'); notify.error(response.data?.message ?? 'Review these marks before retrying');
      } else { setStatus('Save queued — your draft is safe on this device'); }
    } finally { busy.current = false; setSaving(false); }
  }

  useEffect(() => {
    if (!pending) return;
    const retry = () => { void save(pending); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [pending]); // only a previously explicit save may replay; submission never does

  function paste(e: React.ClipboardEvent, index: number) {
    const lines = e.clipboardData.getData('text').replace(/\r/g, '').replace(/\n$/, '').split('\n');
    if (lines.length < 2 && !lines[0].includes('\t')) return;
    e.preventDefault();
    lines.forEach((line, offset) => {
      const student = visible[index + offset];
      if (!student) return;
      const [marks, participation, comment] = line.split('\t');
      edit(student, { marks: marks.trim(), participation: PARTICIPATION_OPTIONS.includes(participation) ? participation : 'present', ...(comment !== undefined ? { comment } : {}) });
    });
  }
  function resolveConflict(c: ConflictRow, keepLocal: boolean) {
    if (c.version === undefined) { onSaved(); setConflicts([]); return; }
    setBaseline((rows) => rows.map((s) => s.studentProfileId === c.studentProfileId ? { ...s, version: c.version!, marks: c.marks == null ? null : Number(c.marks), participation: c.participation ?? s.participation, comment: c.comment ?? '' } : s));
    setCells((old) => {
      const next = { ...old };
      if (keepLocal && next[c.studentProfileId]) next[c.studentProfileId] = { ...next[c.studentProfileId], expectedVersion: c.version! };
      else delete next[c.studentProfileId];
      return next;
    });
    setConflicts((rows) => rows.filter((r) => r.studentProfileId !== c.studentProfileId));
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
      <div aria-live="polite" className="text-sm"><span className="font-medium">{status}</span><p className="text-xs text-muted-foreground">{dirtyCount} unsaved row(s) · {resolved}/{baseline.length} resolved on server</p></div>
      <div className="flex gap-2">
        {!!dirtyCount && !pending && <Button variant="ghost" disabled={saving} onClick={() => { if (window.confirm('Discard this device’s unsaved draft? Server marks will not change.')) { setCells({}); setConflicts([]); setRecovered(false); setStatus('Unsaved draft discarded'); } }}>Discard local draft</Button>}
        <Button variant="outline" disabled={saving || (!dirtyCount && !pending) || !!conflicts.length} onClick={() => void save()}>{pending ? <WifiOff className="mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}{saving ? 'Saving…' : pending ? 'Retry queued save' : 'Save draft'}</Button>
        <Button disabled={!canSubmit} onClick={() => void onSubmit()}><Send className="mr-2 h-4 w-4" />{sheet.approvalStatus === 'rejected' ? 'Resubmit marks' : 'Submit marks'}</Button>
      </div>
    </div>
    {storageError && <p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">This browser could not preserve a local draft. Keep this page open until the server confirms your save.</p>}
    {recovered && <p className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">A draft from your previous session was recovered. Review it, then save or retry it. Nothing has been submitted for approval.</p>}
    {globalLocked && <p className="text-sm text-muted-foreground">{!a.rosterFrozen ? 'This legacy assessment needs a frozen roster before new marks can be entered.' : ['draft', 'scheduled'].includes(a.status) ? 'Publish the assessment before entering marks.' : 'This assessment is read-only.'}</p>}
    {sheet.approvalStatus === 'rejected' && <p role="alert" className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm">Returned for correction: {baseline.find((s) => s.rejectionReason)?.rejectionReason ?? 'Review the marks and resubmit.'}</p>}
    <div className="flex flex-wrap gap-2">
      <Input className="max-w-xs" aria-label="Find a learner" placeholder="Find a learner…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select aria-label="Bulk participation" className="rounded border bg-card px-2 text-sm" disabled={!selected.length || !!pending || saving} value="" onChange={(e) => { for (const s of baseline.filter((r) => selected.includes(r.studentProfileId))) edit(s, { participation: e.target.value }); }}><option value="">Set participation ({selected.length})</option>{PARTICIPATION_OPTIONS.map((p) => <option key={p} value={p}>{p.replaceAll('_', ' ')}</option>)}</select>
      <Input className="max-w-xs" aria-label="Bulk feedback" placeholder="Comment for selected learners" value={bulkComment} onChange={(e) => setBulkComment(e.target.value)} />
      <Button variant="outline" disabled={!selected.length || !!pending || saving} onClick={() => { for (const s of baseline.filter((r) => selected.includes(r.studentProfileId))) edit(s, { comment: bulkComment }); }}>Apply comment</Button>
    </div>
    <p className="text-xs text-muted-foreground">Enter/↑/↓ moves between learners. Paste marks, or spreadsheet columns: mark → participation → comment. Blank cells stay blank.</p>
    <div className="max-h-[65vh] overflow-auto rounded-lg border"><table className="w-full min-w-[850px] text-sm">
      <thead className="sticky top-0 z-10 bg-muted"><tr><th className="p-2"><input type="checkbox" aria-label="Select visible learners" checked={visible.length > 0 && visible.every((s) => selected.includes(s.studentProfileId))} onChange={(e) => setSelected(e.target.checked ? visible.filter((s) => !rowLocked(s)).map((s) => s.studentProfileId) : [])} /></th><th className="p-2 text-left">Learner</th><th className="p-2 text-left">Mark / {a.maxScore}</th><th className="p-2 text-left">Participation</th><th className="p-2 text-left">Feedback</th><th className="p-2 text-left">Status</th><th className="p-2"><span className="sr-only">Evidence</span></th></tr></thead>
      <tbody>{visible.map((s, index) => {
        const cell = cells[s.studentProfileId] ?? cellOf(s);
        const locked = rowLocked(s) || saving || !!pending;
        const invalid = cell.marks !== '' && (!Number.isFinite(Number(cell.marks)) || Number(cell.marks) < 0 || Number(cell.marks) > a.maxScore);
        return <tr key={s.studentProfileId} className={`border-t ${cells[s.studentProfileId] ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}`}>
          <td className="p-2"><input type="checkbox" aria-label={`Select ${s.name}`} disabled={locked} checked={selected.includes(s.studentProfileId)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, s.studentProfileId] : ids.filter((id) => id !== s.studentProfileId))} /></td>
          <td className="p-2"><span className="font-medium">{s.name}</span><div className="text-xs text-muted-foreground">{s.admissionNo}</div></td>
          <td className="p-2"><input aria-label={`Mark for ${s.name}`} aria-invalid={invalid} ref={(el) => { inputs.current[s.studentProfileId] = el; }} className={`h-9 w-24 rounded border bg-card px-2 tabular-nums disabled:opacity-60 ${invalid ? 'border-destructive' : ''}`} inputMode="decimal" disabled={locked || NO_SCORE.includes(cell.participation)} value={cell.marks} placeholder="—" onChange={(e) => edit(s, { marks: e.target.value })} onPaste={(e) => paste(e, index)} onKeyDown={(e) => { if (['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); const target = visible[index + (e.key === 'ArrowUp' ? -1 : 1)]; if (target) inputs.current[target.studentProfileId]?.focus(); } }} /></td>
          <td className="p-2"><select aria-label={`Participation for ${s.name}`} className="h-9 rounded border bg-card px-2 text-sm disabled:opacity-60" disabled={locked} value={cell.participation} onChange={(e) => edit(s, { participation: e.target.value })}>{PARTICIPATION_OPTIONS.map((p) => <option key={p} value={p}>{p.replaceAll('_', ' ')}</option>)}</select></td>
          <td className="p-2"><Input aria-label={`Feedback for ${s.name}`} disabled={locked} value={cell.comment} onChange={(e) => edit(s, { comment: e.target.value })} maxLength={4000} /></td>
          <td className="p-2 text-xs text-muted-foreground">{s.approvalStatus === 'approved' && <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-600" />}{cells[s.studentProfileId] ? 'Unsaved draft' : s.approvalStatus}</td>
          <td className="p-2"><Button variant="ghost" size="sm" aria-label={`Evidence for ${s.name}`} onClick={() => onEvidence(s.studentProfileId)}><History className="h-4 w-4" /></Button></td>
        </tr>;
      })}{!visible.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No learners match your search.</td></tr>}</tbody>
    </table></div>
    <Dialog open={!!conflicts.length} onOpenChange={() => {}}><DialogContent className="max-h-[80vh] max-w-3xl overflow-auto"><DialogHeader><DialogTitle>Resolve concurrent changes</DialogTitle><DialogDescription>No rows from this batch were saved. Compare each conflict; keeping your draft only prepares a new save.</DialogDescription></DialogHeader>{conflicts.map((c) => <div key={c.studentProfileId} className="space-y-2 rounded border p-3"><strong>{baseline.find((s) => s.studentProfileId === c.studentProfileId)?.name}</strong><div className="grid grid-cols-2 gap-4 text-sm"><div>Your draft: {cells[c.studentProfileId]?.marks || 'blank'} · {cells[c.studentProfileId]?.participation}<p className="text-muted-foreground">{cells[c.studentProfileId]?.comment}</p></div><div>Server: {c.marks ?? 'blank'} · {c.participation}<p className="text-muted-foreground">{c.comment}</p></div></div><div className="flex gap-2"><Button variant="outline" onClick={() => resolveConflict(c, false)}>Use server value</Button><Button disabled={c.version === undefined} onClick={() => resolveConflict(c, true)}>Keep my draft</Button></div></div>)}</DialogContent></Dialog>
  </div>;
}
