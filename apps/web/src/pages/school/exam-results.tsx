import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Download, FileText, Lock, Printer, Unlock,
} from 'lucide-react';
import {
  useAcademicYears, useTerms, useStreams, useWorkspaceExams, useExamCoverage,
  useResultGrid, useLockMarks, type ResultGrid,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import {
  EmptyState, Picker, Progress, WorkflowSteps, useDefaulted, useStickyState,
} from './_components/exam-workflow';

type SortKey = 'position' | 'name';

/**
 * Step 4 — the results sheet: students down, subjects across, totals and
 * positions on the right. Computed from the marks that were just typed, so
 * there is no separate "compute results" step to forget about.
 */
export function SchoolExamResultsPage() {
  const navigate = useNavigate();
  const { data: years } = useAcademicYears();
  const { data: terms } = useTerms();

  const [yearId, setYearId] = useStickyState('yearId');
  const [termId, setTermId] = useStickyState('termId');
  const [examId, setExamId] = useStickyState('examId');
  const [classId, setClassId] = useStickyState('classId');
  const [streamId, setStreamId] = useStickyState('streamId');
  const [sort, setSort] = useState<SortKey>('position');

  const yearList = years?.data ?? [];
  const termList = useMemo(
    () => (terms?.data ?? []).filter((t) => !yearId || t.academicYearId === yearId),
    [terms, yearId],
  );
  useDefaulted(yearId, setYearId, yearList.find((y) => y.isCurrent)?.id ?? yearList[0]?.id);
  useDefaulted(termId, setTermId, termList.find((t) => t.isCurrent)?.id ?? termList[0]?.id);

  const { data: exams } = useWorkspaceExams(termId ? { termId } : {});
  useDefaulted(examId, setExamId, exams?.[0]?.id);

  const { data: coverage } = useExamCoverage(examId || undefined);
  const examClasses = useMemo(() => (coverage?.classes ?? []).filter((c) => c.applied), [coverage]);
  useDefaulted(classId, setClassId, examClasses[0]?.classId);

  const { data: streams } = useStreams(classId || undefined);
  const streamList = (streams?.data ?? []).filter((s) => !classId || s.classId === classId);

  const { data: grid, isLoading, refetch } = useResultGrid({
    examId: examId || undefined,
    classId: classId || undefined,
    streamId: streamId || undefined,
  });
  const lock = useLockMarks();

  const rows = useMemo(() => {
    const list = [...(grid?.students ?? [])];
    if (sort === 'position') {
      // Unmarked students sink to the bottom rather than claiming position 0.
      list.sort((a, b) => (a.position || Infinity) - (b.position || Infinity) || a.name.localeCompare(b.name));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [grid, sort]);

  const allLocked = !!grid && grid.paperCount > 0 && grid.lockedPaperCount === grid.paperCount;
  const missing = grid ? Math.max(0, grid.marksExpected - grid.marksEntered) : 0;

  async function toggleLockAll() {
    if (!examId || !classId) return;
    try {
      const res = await lock.mutateAsync({ examId, classId, locked: !allLocked });
      await refetch();
      notify.success(allLocked ? `Unlocked ${res.updated} papers` : `Locked ${res.updated} papers — marks can no longer be edited`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not change the lock');
    }
  }

  function exportCsv() {
    if (!grid) return;
    const header = ['#', 'Student', 'Admission no.', ...grid.subjects.map((s) => s.name), 'Total', 'Average', '%', 'Grade', 'Position'];
    const lines = rows.map((r, i) => [
      i + 1,
      r.name,
      r.admissionNo,
      ...grid.subjects.map((s) => {
        const cell = r.cells[s.subjectId];
        if (cell?.marks != null) return cell.marks;
        return cell && cell.participation !== 'present' ? cell.participation.toUpperCase() : '';
      }),
      r.total ?? '',
      r.average ?? '',
      r.percentage ?? '',
      r.grade ?? '',
      r.position || '',
    ]);
    const csv = [header, ...lines]
      .map((row) => row.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(','))
      .join('\r\n');

    const className = examClasses.find((c) => c.classId === classId)?.className ?? 'class';
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${grid.exam.name} - ${className}.csv`.replace(/[\\/:*?"<>|]/g, '-');
    a.click();
    URL.revokeObjectURL(url);
    notify.success('Results exported');
  }

  const ready = !!examId && !!classId;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Results</h1>
          <p className="text-sm text-muted-foreground">
            Every subject for the class, with totals, grades and positions.
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="ghost" onClick={() => navigate('/school/enter-marks')}>
            <ArrowLeft className="h-4 w-4" /> Back to marks
          </Button>
          <Button variant="outline" onClick={() => navigate('/school/report-cards')}>
            <FileText className="h-4 w-4" /> Report cards
          </Button>
        </div>
      </div>

      <div className="print:hidden"><WorkflowSteps current={4} /></div>

      <Card className="print:hidden">
        <CardContent className="flex flex-wrap gap-3 pt-4">
          <Picker label="Year" value={yearId} onChange={(v) => { setYearId(v); setTermId(''); setExamId(''); }}
            options={yearList.map((y) => ({ value: y.id, label: y.name }))} className="min-w-[130px]" />
          <Picker label="Term" value={termId} onChange={(v) => { setTermId(v); setExamId(''); }}
            options={termList.map((t) => ({ value: t.id, label: t.name }))} className="min-w-[130px]" />
          <Picker label="Exam" value={examId} onChange={(v) => { setExamId(v); setClassId(''); }}
            options={(exams ?? []).map((e) => ({ value: e.id, label: e.name }))} className="min-w-[190px]" />
          <Picker label="Class" value={classId} onChange={(v) => { setClassId(v); setStreamId(''); }}
            options={examClasses.map((c) => ({ value: c.classId, label: c.className }))} className="min-w-[140px]" />
          <Picker label="Stream" value={streamId} onChange={setStreamId}
            options={streamList.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="All streams" className="min-w-[130px]" />
          <Picker label="Order by" value={sort} onChange={(v) => setSort(v as SortKey)}
            options={[{ value: 'position', label: 'Position' }, { value: 'name', label: 'Student name' }]}
            placeholder="Position" className="min-w-[130px]" />
        </CardContent>
      </Card>

      {!ready && (
        <EmptyState title="Choose an exam and a class" hint="Results appear as soon as marks exist." />
      )}

      {ready && isLoading && <p className="text-sm text-muted-foreground">Loading results…</p>}

      {ready && grid && grid.subjects.length === 0 && (
        <EmptyState
          title="This class has no papers for this exam"
          hint="Go back to step 2 and add the class to the exam."
          action={<Button onClick={() => navigate('/school/exam-workspace/classes')}>Choose classes</Button>}
        />
      )}

      {ready && grid && grid.subjects.length > 0 && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
              <div>
                <h2 className="font-semibold">
                  {examClasses.find((c) => c.classId === classId)?.className} · {grid.exam.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {grid.classSize} students · {grid.paperCount} subjects
                  {allLocked && <> · <span className="text-muted-foreground">locked</span></>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 print:hidden">
                <Progress done={grid.marksEntered} total={grid.marksExpected} />
                <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</Button>
                <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
                <Button size="sm" variant={allLocked ? 'default' : 'outline'} onClick={toggleLockAll} disabled={lock.isPending}>
                  {allLocked ? <><Unlock className="h-4 w-4" /> Unlock marks</> : <><Lock className="h-4 w-4" /> Lock marks</>}
                </Button>
              </div>
            </CardContent>
          </Card>

          {missing > 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm print:hidden">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <strong>{missing}</strong> mark{missing === 1 ? '' : 's'} still missing.
                Totals and positions only count the subjects that are marked.
              </span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => navigate('/school/enter-marks')}>
                Finish entering
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm print:hidden">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              All marks are in. Lock them to stop further edits, then generate report cards.
            </div>
          )}

          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                    <th className="sticky left-0 z-10 bg-card px-3 py-2">#</th>
                    <th className="sticky left-8 z-10 min-w-[180px] bg-card px-3 py-2">Student</th>
                    {grid.subjects.map((s) => (
                      <th key={s.subjectId} className="px-2 py-2 text-center" title={`${s.name} (out of ${s.maxMarks})`}>
                        {s.code || s.name.slice(0, 4).toUpperCase()}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Avg</th>
                    <th className="px-3 py-2 text-center">Grade</th>
                    <th className="px-3 py-2 text-right">Pos</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.studentProfileId} className="border-b last:border-0 hover:bg-accent/30">
                      <td className="sticky left-0 z-10 bg-card px-3 py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="sticky left-8 z-10 bg-card px-3 py-1.5">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.admissionNo}{r.streamName ? ` · ${r.streamName}` : ''}
                        </div>
                      </td>
                      {grid.subjects.map((s) => {
                        const cell = r.cells[s.subjectId];
                        return (
                          <td key={s.subjectId} className="px-2 py-1.5 text-center tabular-nums">
                            {cell?.marks != null ? (
                              <span>{cell.marks}</span>
                            ) : cell && cell.participation !== 'present' ? (
                              <span className="text-xs uppercase text-muted-foreground">{cell.participation.slice(0, 3)}</span>
                            ) : (
                              <span className="text-muted-foreground/40">·</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">{r.total ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.average ?? '—'}</td>
                      <td className="px-3 py-1.5 text-center">
                        {r.grade ? <Badge variant="outline">{r.grade}</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">{r.position || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {rows.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No students in this class{streamId ? ' and stream' : ''}.
                </p>
              )}
            </CardContent>
          </Card>

          <ClassSummary grid={grid} />
        </>
      )}
    </div>
  );
}

/** The four numbers a head teacher looks for before signing anything off. */
function ClassSummary({ grid }: { grid: ResultGrid }) {
  const marked = grid.students.filter((s) => s.total != null);
  if (marked.length === 0) return null;

  const averages = marked.map((s) => s.percentage ?? 0);
  const mean = averages.reduce((a, b) => a + b, 0) / averages.length;
  const best = marked.reduce((a, b) => ((b.total ?? 0) > (a.total ?? 0) ? b : a));
  const passed = averages.filter((p) => p >= 50).length;

  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <SummaryTile label="Students marked" value={`${marked.length} of ${grid.classSize}`} />
      <SummaryTile label="Class average" value={`${mean.toFixed(1)}%`} />
      <SummaryTile label="At or above 50%" value={`${passed} (${Math.round((passed / marked.length) * 100)}%)`} />
      <SummaryTile label="Top of the class" value={best.name} sub={`${best.total} marks`} />
    </div>
  );
}

function SummaryTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-lg font-semibold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
