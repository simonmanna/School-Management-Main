import { useMemo, useRef, useState } from 'react';
import {
  Download, Eye, EyeOff, Lock, LockOpen, Pencil, Search, Upload, User,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useLmsEditCell, useLmsExportGrades, useLmsGradebook, useLmsImportGrades,
  useLmsOverrideGrade, useLmsSetGradeColumn, useLmsUserGrades,
} from '@/features/school/api';
import { notify } from '@/lib/notify';

interface Cell { studentAssessmentId: string; score: number | null; pct: number | null }
interface Row { studentProfileId: string; studentName: string; admissionNo: string | null; cells: Record<string, Cell>; total: number | null }
interface Item {
  id: string; activityType: string; assessmentId: string | null; dueAt: string | null;
  assessment?: { id: string; title: string; maxScore: number; hiddenFromStudents: boolean; lockedAt: string | null };
}

/**
 * The grader report (Moodle's Grader report + Single view).
 *
 * Every write here routes through the LMS gradebook service to the grade bridge
 * and finally `MarkingService`, the single permitted writer of a mark — this
 * panel never touches a score directly, and an import is the same path as a
 * typed cell, not a bulk shortcut around it.
 *
 * A plain cell edit corrects data entry. An OVERRIDE replaces a computed mark and
 * records why, which is a different act; they are deliberately separate controls.
 */
export function GradebookPanel({ courseId, canEdit }: { courseId: string; canEdit: boolean }) {
  const { data, isLoading, refetch } = useLmsGradebook(courseId);
  const editCell = useLmsEditCell();
  const exportGrades = useLmsExportGrades();
  const importGrades = useLmsImportGrades();
  const overrideGrade = useLmsOverrideGrade();
  const setColumn = useLmsSetGradeColumn();

  const [q, setQ] = useState('');
  const [single, setSingle] = useState<Row | null>(null);
  const [override, setOverride] = useState<{ row: Row; item: Item; cell: Cell } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const items: Item[] = (data as any)?.items ?? [];
  const students: Row[] = (data as any)?.students ?? [];

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return students;
    return students.filter(
      (s) =>
        s.studentName.toLowerCase().includes(needle) ||
        (s.admissionNo ?? '').toLowerCase().includes(needle),
    );
  }, [students, q]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading gradebook…</p>;

  if (items.length === 0) {
    return (
      <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
        No gradable activities yet. Add an assignment or a quiz.
      </CardContent></Card>
    );
  }

  /** Download the server-rendered CSV. Same numbers the table shows. */
  async function doExport() {
    try {
      const csv = await exportGrades.mutateAsync(courseId);
      const blob = new Blob([typeof csv === 'string' ? csv : JSON.stringify(csv)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gradebook-${courseId.slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Export failed');
    }
  }

  /**
   * Import an edited copy of the export.
   *
   * The file identifies a pupil by `studentProfileId` and a column by its title;
   * the ids the server writes against (`studentAssessmentId`) are resolved here
   * from the report already on screen. A row whose pupil or column is not in this
   * course is skipped rather than guessed at, and the count of skips is reported.
   */
  async function doImport(text: string) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) { notify.error('That file has no data rows'); return; }
    const header = lines[0].split(',').map((h) => h.trim());
    const titleToAssessment = new Map(
      items.filter((i) => i.assessmentId).map((i) => [i.assessment?.title ?? i.id, i.assessmentId!]),
    );
    const byStudent = new Map(students.map((s) => [s.studentProfileId, s]));

    const rows: { studentAssessmentId: string; score: number }[] = [];
    let skipped = 0;
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      const student = byStudent.get(cols[0]?.trim());
      if (!student) { skipped++; continue; }
      for (let c = 1; c < header.length; c++) {
        const assessmentId = titleToAssessment.get(header[c]);
        const raw = cols[c]?.trim();
        if (!assessmentId || raw === undefined || raw === '') continue;
        const score = Number(raw);
        if (Number.isNaN(score)) { skipped++; continue; }
        const cell = student.cells[assessmentId];
        if (!cell) { skipped++; continue; }
        if (cell.score === score) continue;
        rows.push({ studentAssessmentId: cell.studentAssessmentId, score });
      }
    }
    if (rows.length === 0) {
      notify.error(skipped > 0 ? `Nothing to import — ${skipped} value(s) could not be matched` : 'No changed marks in that file');
      return;
    }
    try {
      await importGrades.mutateAsync({ courseId, rows });
      await refetch();
      notify.success(`Imported ${rows.length} mark(s)${skipped > 0 ? `, skipped ${skipped}` : ''}`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Import failed');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Find a pupil…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" onClick={doExport} disabled={exportGrades.isPending}>
          <Download className="mr-1 h-4 w-4" />Export CSV
        </Button>
        {canEdit && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                await doImport(await file.text());
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={importGrades.isPending}>
              <Upload className="mr-1 h-4 w-4" />Import CSV
            </Button>
          </>
        )}
      </div>

      <Card><CardContent className="overflow-x-auto py-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="sticky left-0 z-10 bg-card py-2 pr-4">Student</th>
              {items.map((it) => (
                <th key={it.id} className="whitespace-nowrap px-3 py-2 align-bottom">
                  <span className="block">{it.assessment?.title ?? it.activityType}</span>
                  <span className="block font-normal tabular-nums">/ {it.assessment?.maxScore ?? 100}</span>
                  {canEdit && it.assessment && (
                    <span className="mt-1 flex gap-1">
                      <button
                        type="button"
                        title={it.assessment.hiddenFromStudents ? 'Show to pupils' : 'Hide from pupils'}
                        className="rounded p-0.5 hover:bg-muted"
                        onClick={async () => {
                          try {
                            await setColumn.mutateAsync({ courseId, assessmentId: it.assessment!.id, hidden: !it.assessment!.hiddenFromStudents });
                            await refetch();
                          } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
                        }}
                      >
                        {it.assessment.hiddenFromStudents
                          ? <EyeOff className="h-3.5 w-3.5 text-amber-600" />
                          : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        title={it.assessment.lockedAt ? 'Unlock column' : 'Lock column'}
                        className="rounded p-0.5 hover:bg-muted"
                        onClick={async () => {
                          try {
                            await setColumn.mutateAsync({ courseId, assessmentId: it.assessment!.id, locked: !it.assessment!.lockedAt });
                            await refetch();
                          } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
                        }}
                      >
                        {it.assessment.lockedAt
                          ? <Lock className="h-3.5 w-3.5 text-amber-600" />
                          : <LockOpen className="h-3.5 w-3.5" />}
                      </button>
                    </span>
                  )}
                </th>
              ))}
              <th className="px-3 py-2">Total</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.studentProfileId} className="border-b hover:bg-muted/30">
                <td className="sticky left-0 z-10 bg-card py-2 pr-4">
                  <span className="block">{s.studentName}</span>
                  {s.admissionNo && <span className="text-xs text-muted-foreground">{s.admissionNo}</span>}
                </td>
                {items.map((it) => {
                  const cell = it.assessmentId ? s.cells[it.assessmentId] : null;
                  const locked = Boolean(it.assessment?.lockedAt);
                  return (
                    <td key={it.id} className="px-3 py-2 tabular-nums">
                      {canEdit && cell && !locked ? (
                        <span className="flex items-center gap-1">
                          <input
                            type="number"
                            defaultValue={cell.score ?? ''}
                            className="h-8 w-16 rounded border bg-background px-1 text-right text-sm tabular-nums"
                            max={it.assessment?.maxScore ?? undefined}
                            min={0}
                            onBlur={async (e) => {
                              const next = e.target.value === '' ? null : Number(e.target.value);
                              if (next === null || next === cell.score) return;
                              try {
                                await editCell.mutateAsync({ courseId, studentAssessmentId: cell.studentAssessmentId, score: next });
                                await refetch();
                              } catch (err: any) {
                                notify.error(err?.response?.data?.message ?? 'Could not save the mark');
                                e.target.value = String(cell.score ?? '');
                              }
                            }}
                          />
                          <button
                            type="button"
                            title="Override with a reason"
                            className="rounded p-1 text-muted-foreground hover:bg-muted"
                            onClick={() => setOverride({ row: s, item: it, cell })}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </span>
                      ) : (
                        <span className={locked ? 'text-muted-foreground' : ''}>{cell?.score ?? '—'}</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2 font-medium tabular-nums">{s.total ?? '—'}</td>
                <td className="px-2 py-2">
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Single view" onClick={() => setSingle(s)}>
                    <User className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={items.length + 3} className="py-6 text-center text-muted-foreground">
                  {students.length === 0 ? 'No enrolled students. Sync the roster.' : 'No pupil matches that search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent></Card>

      {single && (
        <SingleView courseId={courseId} row={single} onClose={() => setSingle(null)} />
      )}

      {override && (
        <OverrideDialog
          target={override}
          busy={overrideGrade.isPending}
          onClose={() => setOverride(null)}
          onSave={async (score, reason) => {
            try {
              await overrideGrade.mutateAsync({
                courseId, studentAssessmentId: override.cell.studentAssessmentId, score, reason,
              });
              await refetch();
              notify.success('Override recorded');
              setOverride(null);
            } catch (e: any) {
              notify.error(e?.response?.data?.message ?? 'Override failed');
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Single view — one pupil's marks down the page.
 *
 * Reads the pupil-facing endpoint on purpose, so a teacher sees exactly what the
 * family sees, including "not released yet" where a mark is entered but not
 * approved. A blank here means withheld, never zero.
 */
function SingleView({ courseId, row, onClose }: { courseId: string; row: Row; onClose: () => void }) {
  const { data, isLoading } = useLmsUserGrades(courseId, row.studentProfileId);
  const grades: any[] = (data as any)?.grades ?? [];
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.studentName}</DialogTitle>
        </DialogHeader>
        {row.admissionNo && <p className="-mt-2 text-xs text-muted-foreground">{row.admissionNo}</p>}
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && grades.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No marks for this pupil yet.</p>
        )}
        <ul className="divide-y">
          {grades.map((g) => (
            <li key={g.assessmentId} className="flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{g.title}</span>
              {g.released && g.score != null ? (
                <>
                  <span className="tabular-nums">{g.score}/{g.maxScore}</span>
                  {g.percentage != null && <Badge variant="secondary">{g.percentage}%</Badge>}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">Not released yet</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          This is the pupil and parent view — a mark appears only once it has been approved and released.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function OverrideDialog({
  target, busy, onSave, onClose,
}: {
  target: { row: Row; item: Item; cell: Cell };
  busy: boolean;
  onSave: (score: number, reason: string) => void;
  onClose: () => void;
}) {
  const [score, setScore] = useState(String(target.cell.score ?? ''));
  const [reason, setReason] = useState('');
  const max = target.item.assessment?.maxScore ?? 100;
  const numeric = Number(score);
  const valid = score.trim() !== '' && !Number.isNaN(numeric) && numeric >= 0 && numeric <= max;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Override mark</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-sm text-muted-foreground">
          {target.row.studentName} — {target.item.assessment?.title ?? target.item.activityType}
        </p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Score (max {max})</Label>
            <Input type="number" min={0} max={max} value={score} onChange={(e) => setScore(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reason</Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this mark replaces the computed one — this is stored with the override."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || busy} onClick={() => onSave(numeric, reason.trim())}>
            Save override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
