import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, ClipboardList, Layers, Lock, Trash2, Wand2 } from 'lucide-react';
import {
  useWorkspaceExams, useExamCoverage, useApplyExamClasses, useRemoveExamClass, useClassSubjects,
  useAcademicYears, useTerms, type CoverageClass,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import {
  EmptyState, Picker, Progress, WorkflowSteps, useDefaulted, useStickyState,
} from './_components/exam-workflow';

/**
 * Step 2 — which classes sit this exam.
 *
 * Ticking a class creates one exam paper per subject that class takes. That
 * fan-out used to be manual: an exam schedule per class per subject, created by
 * hand, which is where most schools gave up.
 */
export function SchoolExamClassesPage() {
  const navigate = useNavigate();
  const { data: years } = useAcademicYears();
  const { data: terms } = useTerms();

  const [yearId, setYearId] = useStickyState('yearId');
  const [termId, setTermId] = useStickyState('termId');
  const [examId, setExamId] = useStickyState('examId');
  const [, setClassId] = useStickyState('classId');

  const yearList = years?.data ?? [];
  const termList = useMemo(
    () => (terms?.data ?? []).filter((t) => !yearId || t.academicYearId === yearId),
    [terms, yearId],
  );
  useDefaulted(yearId, setYearId, yearList.find((y) => y.isCurrent)?.id ?? yearList[0]?.id);
  useDefaulted(termId, setTermId, termList.find((t) => t.isCurrent)?.id ?? termList[0]?.id);

  const { data: exams } = useWorkspaceExams(termId ? { termId } : {});
  useDefaulted(examId, setExamId, exams?.[0]?.id);

  const { data: coverage, isLoading } = useExamCoverage(examId || undefined);
  const apply = useApplyExamClasses();
  const remove = useRemoveExamClass();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [maxMarks, setMaxMarks] = useState('100');
  const [search, setSearch] = useState('');

  // A different exam is a different question — start the selection fresh.
  useEffect(() => { setSelected(new Set()); setExpanded(null); }, [examId]);

  const classes = useMemo(() => coverage?.classes ?? [], [coverage]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter((c) => c.className.toLowerCase().includes(q) || (c.gradeLevelName ?? '').toLowerCase().includes(q));
  }, [classes, search]);

  const applied = classes.filter((c) => c.applied);
  const notApplied = visible.filter((c) => !c.applied);

  function toggle(classId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  }

  async function applySelected() {
    if (!examId || selected.size === 0) return;
    try {
      const res = await apply.mutateAsync({
        examId,
        classIds: [...selected],
        maxMarks: Number(maxMarks) || 100,
      });
      setSelected(new Set());
      notify.success(
        res.created > 0
          ? `Added ${res.created} paper${res.created === 1 ? '' : 's'}`
          : 'Those classes were already set up — nothing to add',
      );
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not apply the exam to those classes');
    }
  }

  async function removeClass(c: CoverageClass) {
    if (!examId) return;
    try {
      await remove.mutateAsync({ examId, classId: c.classId });
      notify.success(`${c.className} removed from this exam`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not remove the class');
    }
  }

  function enterMarks(c: CoverageClass) {
    setClassId(c.classId);
    navigate('/school/enter-marks');
  }

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Choose classes</h1>
        <p className="text-sm text-muted-foreground">
          Tick the classes that sit this exam. Each class gets one paper per subject it takes.
        </p>
      </div>

      <WorkflowSteps current={2} />

      <Card>
        <CardContent className="flex flex-wrap gap-3 pt-4">
          <Picker label="Academic year" value={yearId} onChange={(v) => { setYearId(v); setTermId(''); setExamId(''); }}
            options={yearList.map((y) => ({ value: y.id, label: y.name }))} className="min-w-[160px]" />
          <Picker label="Term" value={termId} onChange={(v) => { setTermId(v); setExamId(''); }}
            options={termList.map((t) => ({ value: t.id, label: t.name }))} className="min-w-[160px]" />
          <Picker label="Exam" value={examId} onChange={setExamId}
            options={(exams ?? []).map((e) => ({ value: e.id, label: e.name }))} className="min-w-[220px] flex-1" />
          <div className="min-w-[140px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Search class</label>
            <Input className="h-9" placeholder="e.g. S.1" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {!examId && (
        <EmptyState
          icon={<Layers className="h-8 w-8" />}
          title="Pick an exam first"
          hint="Choose an exam above, or go back to step 1 to create one."
        />
      )}

      {examId && isLoading && <p className="text-sm text-muted-foreground">Loading classes…</p>}

      {examId && !isLoading && (
        <>
          {/* Classes already on this exam */}
          <div>
            <h2 className="mb-2 text-sm font-semibold">
              On this exam <span className="font-normal text-muted-foreground">({applied.length})</span>
            </h2>
            {applied.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No classes yet. Tick some below and press “Add to exam”.
              </p>
            ) : (
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                        <th className="w-8 px-3 py-2" />
                        <th className="px-3 py-2">Class</th>
                        <th className="px-3 py-2">Students</th>
                        <th className="px-3 py-2">Papers</th>
                        <th className="px-3 py-2">Marks entered</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {applied.map((c) => (
                        <Fragment key={c.classId}>
                          <tr className="border-b last:border-0 hover:bg-accent/40">
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                aria-label={expanded === c.classId ? 'Hide subjects' : 'Show subjects'}
                                onClick={() => setExpanded(expanded === c.classId ? null : c.classId)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                {expanded === c.classId ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                            </td>
                            <td className="px-3 py-2">
                              <span className="font-medium">{c.className}</span>
                              {c.gradeLevelName && <span className="ml-2 text-xs text-muted-foreground">{c.gradeLevelName}</span>}
                            </td>
                            <td className="px-3 py-2 tabular-nums">{c.studentCount}</td>
                            <td className="px-3 py-2">
                              {c.paperCount}
                              {c.lockedPaperCount > 0 && (
                                <Badge variant="secondary" className="ml-2">
                                  <Lock className="h-3 w-3" /> {c.lockedPaperCount} locked
                                </Badge>
                              )}
                            </td>
                            <td className="px-3 py-2"><Progress done={c.marksEntered} total={c.marksExpected} /></td>
                            <td className="px-3 py-2">
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => enterMarks(c)}>
                                  <ClipboardList className="h-4 w-4" /> Enter marks
                                </Button>
                                <Button
                                  size="sm" variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  disabled={remove.isPending}
                                  title={c.marksEntered > 0 ? 'Has marks — delete the marks first' : 'Remove this class from the exam'}
                                  onClick={() => removeClass(c)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                          {expanded === c.classId && (
                            <tr className="border-b bg-muted/30 last:border-0">
                              <td />
                              <td colSpan={5} className="px-3 py-3">
                                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                  {c.subjects.map((s) => (
                                    <div key={s.examScheduleId} className="flex items-center justify-between rounded border bg-card px-3 py-2">
                                      <div>
                                        <div className="text-sm">{s.subjectName}</div>
                                        <div className="text-xs text-muted-foreground">out of {s.maxMarks}</div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {s.locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                                        <Progress done={s.marksEntered} total={s.marksExpected} />
                                      </div>
                                    </div>
                                  ))}
                                  {c.subjects.length === 0 && (
                                    <p className="text-sm text-muted-foreground">No papers.</p>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Classes available to add */}
          <div>
            <h2 className="mb-2 text-sm font-semibold">
              Add classes <span className="font-normal text-muted-foreground">({notApplied.length} available)</span>
            </h2>
            {notApplied.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Every class is already on this exam.
              </p>
            ) : (
              <Card>
                <CardContent className="p-3">
                  <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {notApplied.map((c) => (
                      <label
                        key={c.classId}
                        className={[
                          'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition',
                          selected.has(c.classId) ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                        ].join(' ')}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selected.has(c.classId)}
                          onChange={() => toggle(c.classId)}
                        />
                        <span className="flex-1 truncate">{c.className}</span>
                        <span className="text-xs text-muted-foreground">{c.studentCount}</span>
                      </label>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <ClassSubjectHint classId={[...selected][0]} count={selected.size} />
        </>
      )}

      {/* Sticky action bar — the selection is worthless if the button scrolls away. */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-lg">
          <div className="text-sm">
            <strong>{selected.size}</strong> class{selected.size === 1 ? '' : 'es'} selected
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Each paper out of</label>
              <Input type="number" className="h-9 w-20" value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} />
            </div>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button onClick={applySelected} disabled={apply.isPending}>
              <Wand2 className="h-4 w-4" /> Add to exam
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Tells the user what "one paper per subject the class takes" will actually
 * produce, before they press the button — the fan-out is otherwise invisible.
 */
function ClassSubjectHint({ classId, count }: { classId?: string; count: number }) {
  const { data: subjects } = useClassSubjects(classId);
  if (!classId || count === 0) return null;
  const n = subjects?.length ?? 0;
  return (
    <p className="text-xs text-muted-foreground">
      {n > 0
        ? <>Each selected class will get <strong>{n} paper{n === 1 ? '' : 's'}</strong> — one per subject it takes.</>
        : 'Subjects are taken from the teaching load and timetable. If neither is set up, every subject is used.'}
    </p>
  );
}
