import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Loader2, Lock, Plus, SlidersHorizontal, Trash2, Unlock,
} from 'lucide-react';
import {
  useAcademicYears, useTerms, useClasses, useClassSubdivisions,
  useGradebookSheet, useGradebookCell, useCreateGradebookColumn,
  useDeleteGradebookColumn, useLockGradebookColumn, usePolicyComponents,
  type GradebookColumn, type GradebookStudent, currentTerminology } from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { notify } from '@/lib/notify';
import { EmptyState, Picker, selectClass, useDefaulted, useStickyState } from './_components/exam-workflow';
import { ContextBar } from './_components/context-bar';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const NON_SCORING = ['absent', 'exempt', 'excused', 'malpractice'];

/**
 * The gradebook — one class × term × subject spreadsheet. Every column is an
 * assessment; the final column is the weighted total, computed by the same
 * engine as the report card, so a teacher and a head teacher read one number.
 */
export function SchoolGradebookPage() {
  const { data: years } = useAcademicYears();
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();

  const [yearId, setYearId] = useStickyState('yearId');
  const [termId, setTermId] = useStickyState('termId');
  const [classId, setClassId] = useStickyState('classId');
  const [subjectId, setSubjectId] = useStickyState('gb.subjectId');
  const [streamId, setStreamId] = useStickyState('gb.streamId');
  const [adding, setAdding] = useState(false);

  const yearList = years?.data ?? [];
  const termList = useMemo(
    () => (terms?.data ?? []).filter((t) => !yearId || t.academicYearId === yearId),
    [terms, yearId],
  );
  useDefaulted(yearId, setYearId, yearList.find((y) => y.isCurrent)?.id ?? yearList[0]?.id);
  useDefaulted(termId, setTermId, termList.find((t) => t.isCurrent)?.id ?? termList[0]?.id);
  useDefaulted(classId, setClassId, classes?.data?.[0]?.id);

  const { data: streamList } = useClassSubdivisions(classId || undefined);

  const { data: sheet, isLoading, refetch } = useGradebookSheet({
    classId: classId || undefined,
    termId: termId || undefined,
    subjectId: subjectId || undefined,
    sectionId: streamId || undefined,
  });
  const cell = useGradebookCell();
  const deleteColumn = useDeleteGradebookColumn();
  const lockColumn = useLockGradebookColumn();

  // Keep the subject picker in sync with what the sheet resolved to.
  useEffect(() => {
    if (sheet?.subject && !subjectId) setSubjectId(sheet.subject.id);
  }, [sheet?.subject, subjectId, setSubjectId]);

  const [values, setValues] = useState<Record<string, string>>({}); // key: `${studentId}:${assessmentId}`
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!sheet) return;
    const v: Record<string, string> = {};
    for (const s of sheet.students) {
      for (const c of sheet.columns) {
        v[`${s.studentProfileId}:${c.assessmentId}`] = s.cells[c.assessmentId]?.marks != null ? String(s.cells[c.assessmentId]!.marks) : '';
      }
    }
    setValues(v);
    setStates({});
  }, [sheet]);

  const columns = sheet?.columns ?? [];
  const students = sheet?.students ?? [];
  const editableColumns = columns.filter((c) => c.editable);

  async function commitCell(student: GradebookStudent, col: GradebookColumn, raw: string) {
    const key = `${student.studentProfileId}:${col.assessmentId}`;
    const trimmed = raw.trim();
    const isClear = trimmed === '';
    const num = Number(trimmed);
    if (!isClear && (Number.isNaN(num) || num < 0 || num > col.maxScore)) {
      setStates((s) => ({ ...s, [key]: 'error' }));
      notify.error(`${student.name} · ${col.title}: 0–${col.maxScore}`);
      return;
    }
    setStates((s) => ({ ...s, [key]: 'saving' }));
    try {
      await cell.mutateAsync({
        studentProfileId: student.studentProfileId,
        assessmentId: col.assessmentId,
        marks: isClear ? null : num,
      });
      setStates((s) => ({ ...s, [key]: 'saved' }));
      // Refetch to refresh the weighted total column; focus has already moved on blur.
      refetch();
      setTimeout(() => setStates((s) => (s[key] === 'saved' ? { ...s, [key]: 'idle' } : s)), 1000);
    } catch (e: any) {
      setStates((s) => ({ ...s, [key]: 'error' }));
      notify.error(e?.response?.data?.message ?? 'Could not save');
    }
  }

  async function onDeleteColumn(col: GradebookColumn) {
    try {
      await deleteColumn.mutateAsync({ id: col.assessmentId });
      notify.success(`"${col.title}" removed`);
    } catch (e: any) {
      // 409 → offer force.
      if (e?.response?.status === 409 && confirm(`${e.response.data.message}\n\nDelete it and its marks anyway?`)) {
        await deleteColumn.mutateAsync({ id: col.assessmentId, force: true });
        notify.success(`"${col.title}" and its marks removed`);
      } else {
        notify.error(e?.response?.data?.message ?? 'Could not delete');
      }
    }
  }

  const ready = !!classId && !!termId;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Gradebook</h1>
          <p className="text-sm text-muted-foreground">
            Every assessment for a class, with the weighted term total — the same number that reaches the report card.
          </p>
          <div className="mt-2">
            <ContextBar
              year={yearList.find((y) => y.id === yearId)?.name}
              term={termList.find((t) => t.id === termId)?.name}
              className={(classes?.data ?? []).find((c) => c.id === classId)?.name}
              stream={streamList.find((x) => x.id === streamId)?.name}
              subject={sheet?.subject?.name}
            />
          </div>
        </div>
        {sheet?.subject && (
          <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add column</Button>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 pt-4">
          <Picker label="Year" value={yearId} onChange={(v) => { setYearId(v); setTermId(''); }}
            options={yearList.map((y) => ({ value: y.id, label: y.name }))} className="min-w-[120px]" />
          <Picker label="Term" value={termId} onChange={setTermId}
            options={termList.map((t) => ({ value: t.id, label: t.name }))} className="min-w-[120px]" />
          <Picker label="Class" value={classId} onChange={(v) => { setClassId(v); setSubjectId(''); setStreamId(''); }}
            options={(classes?.data ?? []).map((c) => ({ value: c.id, label: c.name }))} className="min-w-[130px]" />
          <Picker label="Subject" value={subjectId} onChange={setSubjectId}
            options={(sheet?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))} className="min-w-[160px]" />
          <Picker label={currentTerminology().section} value={streamId} onChange={setStreamId}
            options={streamList.map((s) => ({ value: s.id, label: s.name }))} placeholder={`All ${currentTerminology().sectionPlural.toLowerCase()}`} className="min-w-[120px]" />
        </CardContent>
      </Card>

      {ready && isLoading && <p className="text-sm text-muted-foreground">Loading gradebook…</p>}

      {ready && sheet && !sheet.subject && (
        <EmptyState title="This class takes no subjects yet" hint="Set up the teaching load or timetable, then the gradebook fills in." />
      )}

      {ready && sheet?.subject && (
        <>
          {/* Weighting banner */}
          {sheet.policy ? (
            !sheet.policy.weightsValid && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Weighting policy <strong>{sheet.policy.name}</strong> sums to {sheet.policy.weightsTotal}%, not 100%. Totals use the weights present.
              </div>
            )
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-muted-foreground/30 bg-muted/40 px-3 py-2 text-sm">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              No weighting policy for this class/subject — the total is an unweighted mean. Set weights in <strong>Weighting Policies</strong>.
            </div>
          )}

          {columns.length === 0 ? (
            <EmptyState
              icon={<Plus className="h-8 w-8" />}
              title="No columns yet"
              hint="Add a column — a CAT, a test, a homework — and start entering marks. Exam marks appear here automatically once the exam is set up."
              action={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add the first column</Button>}
            />
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    {/* Group header row */}
                    <tr className="border-b text-xs font-medium text-muted-foreground">
                      <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left" rowSpan={2}>Student</th>
                      {sheet.groups.map((g) => (
                        <th key={g.id} colSpan={g.columnIds.length} className="border-l px-2 py-1.5 text-center">
                          {g.name}{g.weight != null && <span className="ml-1 text-muted-foreground">· {g.weight}%</span>}
                        </th>
                      ))}
                      <th className="border-l px-3 py-2 text-center align-bottom" rowSpan={2}>Total</th>
                      <th className="px-2 py-2 text-center align-bottom" rowSpan={2}>Grade</th>
                    </tr>
                    {/* Column header row */}
                    <tr className="border-b text-xs font-medium text-muted-foreground">
                      {sheet.groups.flatMap((g) =>
                        g.columnIds.map((cid) => {
                          const col = columns.find((c) => c.assessmentId === cid)!;
                          return (
                            <th key={cid} className="min-w-[64px] border-l px-2 py-1.5 text-center align-bottom">
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="max-w-[90px] truncate" title={col.title}>{col.title}</span>
                                <span className="font-normal">/{col.maxScore}</span>
                                {col.editable && (
                                  <div className="flex gap-0.5">
                                    <button title={col.locked ? 'Unlock' : 'Lock'} onClick={() => lockColumn.mutate({ id: col.assessmentId, locked: !col.locked })} className="text-muted-foreground hover:text-foreground">
                                      {col.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                                    </button>
                                    <button title="Delete column" onClick={() => onDeleteColumn(col)} className="text-muted-foreground hover:text-destructive">
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                                {!col.editable && <Badge variant="secondary" className="text-[10px]">{col.sourceType.replace('_', ' ')}</Badge>}
                              </div>
                            </th>
                          );
                        }),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.studentProfileId} className="border-b last:border-0 hover:bg-accent/30">
                        <td className="sticky left-0 z-10 bg-card px-3 py-1.5">
                          <div className="font-medium">{s.name}</div>
                          <div className="text-xs text-muted-foreground">{s.admissionNo}{s.streamName ? ` · ${s.streamName}` : ''}</div>
                        </td>
                        {sheet.groups.flatMap((g) =>
                          g.columnIds.map((cid) => {
                            const col = columns.find((c) => c.assessmentId === cid)!;
                            const key = `${s.studentProfileId}:${cid}`;
                            const state = states[key] ?? 'idle';
                            const participation = s.cells[cid]?.participation ?? 'present';
                            return (
                              <td key={cid} className="border-l px-1 py-1 text-center">
                                {col.editable ? (
                                  <div className="flex items-center justify-center gap-1">
                                    <Input
                                      ref={(el) => { inputs.current[key] = el; }}
                                      type="number"
                                      className={[
                                        'h-7 w-14 px-1 text-center tabular-nums',
                                        state === 'error' ? 'border-destructive' : state === 'saved' ? 'border-emerald-500' : '',
                                      ].join(' ')}
                                      disabled={col.locked || NON_SCORING.includes(participation)}
                                      placeholder={NON_SCORING.includes(participation) ? participation.slice(0, 3).toUpperCase() : '–'}
                                      value={values[key] ?? ''}
                                      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                                      onBlur={(e) => {
                                        const orig = s.cells[cid]?.marks != null ? String(s.cells[cid]!.marks) : '';
                                        if (e.target.value.trim() !== orig) commitCell(s, col, e.target.value);
                                      }}
                                    />
                                    {state === 'saving' && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                                    {state === 'saved' && <Check className="h-3 w-3 text-emerald-600" />}
                                  </div>
                                ) : (
                                  <span className="tabular-nums">
                                    {s.cells[cid]?.marks != null ? s.cells[cid]!.marks
                                      : participation !== 'present' ? <span className="text-xs uppercase text-muted-foreground">{participation.slice(0, 3)}</span>
                                      : <span className="text-muted-foreground/40">·</span>}
                                  </span>
                                )}
                              </td>
                            );
                          }),
                        )}
                        <td className="border-l px-3 py-1.5 text-center font-semibold tabular-nums">
                          {s.finalPercent != null ? `${s.finalPercent}%` : '—'}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {s.grade ? <Badge variant="outline">{s.grade}</Badge> : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {students.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">No students in this class.</p>}
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            {editableColumns.length} editable column{editableColumns.length === 1 ? '' : 's'} · {columns.length - editableColumns.length} from exams/assignments/quizzes · {students.length} students
          </p>
        </>
      )}

      {sheet?.subject && classId && termId && (
        <AddColumnDialog
          open={adding}
          onClose={() => setAdding(false)}
          classId={classId}
          termId={termId}
          subjectId={sheet.subject.id}
          policyId={sheet.policy?.id}
          onCreated={() => { setAdding(false); refetch(); }}
        />
      )}
    </div>
  );
}

function AddColumnDialog({
  open, onClose, classId, termId, subjectId, policyId, onCreated,
}: { open: boolean; onClose: () => void; classId: string; termId: string; subjectId: string; policyId?: string; onCreated: () => void }) {
  const create = useCreateGradebookColumn();
  const { data: components } = usePolicyComponents(policyId);
  const [title, setTitle] = useState('');
  const [maxScore, setMaxScore] = useState('20');
  const [componentId, setComponentId] = useState('');

  useEffect(() => { if (open) { setTitle(''); setMaxScore('20'); setComponentId(''); } }, [open]);

  async function submit() {
    if (!title.trim()) return;
    try {
      await create.mutateAsync({
        classId, termId, subjectId,
        title: title.trim(),
        maxScore: Number(maxScore) || 100,
        componentId: componentId || undefined,
      });
      notify.success(`Column "${title.trim()}" added`);
      onCreated();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not add column');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a column</DialogTitle>
          <DialogDescription>A CAT, a test, a homework — anything you mark. It joins the weighted total.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label>
            <Input placeholder="e.g. CAT 2" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Out of</label>
            <Input type="number" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Counts under</label>
            <select className={selectClass} value={componentId} onChange={(e) => setComponentId(e.target.value)}>
              <option value="">Not weighted (ungraded column)</option>
              {(components ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {Number(c.weight)}%</option>
              ))}
            </select>
            {!policyId && <p className="mt-1 text-xs text-muted-foreground">No weighting policy yet — this column won't count toward the total until one exists.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!title.trim() || create.isPending}>Add column</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
