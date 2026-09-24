import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Check, ChevronLeft, ChevronRight, ClipboardList,
  FileSpreadsheet, Loader2, Lock, Search, Unlock,
} from 'lucide-react';
import {
  useAcademicYears, useTerms, useClassSubdivisions, useClassSubjects,
  useWorkspaceExams, useMarkSheet, useSaveMark, useLockMarks, useExamCoverage,
  type MarkSheetStudent, currentTerminology } from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import { enqueue } from '@/features/school/offline-queue';
import {
  EmptyState, Picker, Progress, WorkflowSteps, selectClass, useDefaulted, useStickyState,
} from './_components/exam-workflow';
import { OfflineBanner } from './_components/offline-banner';
import { ContextBar } from './_components/context-bar';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const NON_SCORING = ['absent', 'exempt', 'excused', 'malpractice'];

/**
 * Step 3 — type the marks.
 *
 * The whole screen is built around one loop: click a box, type a number, press
 * Enter. Saving happens on its own; there is no Save button to forget. Every
 * student in the class is listed whether or not a mark exists, and the subject
 * can be advanced without going back to a filter screen.
 */
export function SchoolEnterMarksPage() {
  const navigate = useNavigate();
  const { data: years } = useAcademicYears();
  const { data: terms } = useTerms();

  const [yearId, setYearId] = useStickyState('yearId');
  const [termId, setTermId] = useStickyState('termId');
  const [examId, setExamId] = useStickyState('examId');
  const [classId, setClassId] = useStickyState('classId');
  const [subjectId, setSubjectId] = useStickyState('subjectId');
  const [streamId, setStreamId] = useStickyState('streamId');

  const yearList = years?.data ?? [];
  const termList = useMemo(
    () => (terms?.data ?? []).filter((t) => !yearId || t.academicYearId === yearId),
    [terms, yearId],
  );
  useDefaulted(yearId, setYearId, yearList.find((y) => y.isCurrent)?.id ?? yearList[0]?.id);
  useDefaulted(termId, setTermId, termList.find((t) => t.isCurrent)?.id ?? termList[0]?.id);

  const { data: exams } = useWorkspaceExams(termId ? { termId } : {});
  useDefaulted(examId, setExamId, exams?.[0]?.id);

  // Only classes that actually sit this exam — picking one that doesn't is a dead end.
  const { data: coverage } = useExamCoverage(examId || undefined);
  const examClasses = useMemo(
    () => (coverage?.classes ?? []).filter((c) => c.applied),
    [coverage],
  );
  useDefaulted(classId, setClassId, examClasses[0]?.classId);

  const { data: subjects } = useClassSubjects(classId || undefined);
  const paperSubjects = useMemo(() => {
    const papers = examClasses.find((c) => c.classId === classId)?.subjects ?? [];
    if (papers.length > 0) return papers.map((p) => ({ id: p.subjectId, name: p.subjectName, code: p.subjectCode }));
    return (subjects ?? []).map((s) => ({ id: s.id, name: s.name, code: s.code }));
  }, [examClasses, classId, subjects]);
  useDefaulted(subjectId, setSubjectId, paperSubjects[0]?.id);

  const { data: streamList } = useClassSubdivisions(classId || undefined);

  const sheetParams = {
    examId: examId || undefined,
    classId: classId || undefined,
    subjectId: subjectId || undefined,
    sectionId: streamId || undefined,
  };
  const { data: sheet, isLoading, refetch } = useMarkSheet(sheetParams);
  const saveMark = useSaveMark();
  const lock = useLockMarks();

  const [values, setValues] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const [participation, setParticipation] = useState<Record<string, string>>({});
  const [grades, setGrades] = useState<Record<string, string | null>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Reseed whenever the paper changes — never carry one subject's marks into another.
  useEffect(() => {
    if (!sheet) return;
    const v: Record<string, string> = {};
    const p: Record<string, string> = {};
    const g: Record<string, string | null> = {};
    for (const s of sheet.students) {
      v[s.studentProfileId] = s.marks != null ? String(s.marks) : '';
      p[s.studentProfileId] = s.participation;
      g[s.studentProfileId] = s.grade;
    }
    setValues(v);
    setParticipation(p);
    setGrades(g);
    setStates({});
  }, [sheet]);

  const students = useMemo(() => sheet?.students ?? [], [sheet]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q));
  }, [students, search]);

  const maxMarks = sheet?.maxMarks ?? 100;
  const locked = sheet?.locked ?? false;
  const entered = useMemo(
    () => students.filter((s) => {
      const v = values[s.studentProfileId];
      return (v !== undefined && v !== '') || NON_SCORING.includes(participation[s.studentProfileId] ?? 'present');
    }).length,
    [students, values, participation],
  );

  const subjectIndex = paperSubjects.findIndex((s) => s.id === subjectId);

  async function commit(s: MarkSheetStudent, raw: string, part?: string) {
    if (!examId || !classId || !subjectId || locked) return;
    const id = s.studentProfileId;
    const trimmed = raw.trim();
    const isClear = trimmed === '';
    const num = Number(trimmed);

    if (!isClear && (Number.isNaN(num) || num < 0 || num > maxMarks)) {
      setStates((st) => ({ ...st, [id]: 'error' }));
      notify.error(`${s.name}: mark must be between 0 and ${maxMarks}`);
      return;
    }

    setStates((st) => ({ ...st, [id]: 'saving' }));
    try {
      const res = await saveMark.mutateAsync({
        examId, classId, subjectId,
        studentProfileId: id,
        marks: isClear ? null : num,
        participation: part ?? participation[id] ?? 'present',
        maxMarks,
        // The version this sheet was loaded with. If a colleague has saved the
        // same cell since, the server refuses rather than letting whoever typed
        // last quietly win.
        expectedVersion: versions[id] ?? s.version,
      });
      // Track the new version so a second edit in the same session is not
      // rejected against a version we ourselves superseded.
      const nextVersion = (res as { version?: number } | undefined)?.version;
      if (typeof nextVersion === 'number') setVersions((v) => ({ ...v, [id]: nextVersion }));
      setGrades((g) => ({ ...g, [id]: (res as any)?.grade ?? null }));
      setStates((st) => ({ ...st, [id]: 'saved' }));
      setTimeout(() => setStates((st) => (st[id] === 'saved' ? { ...st, [id]: 'idle' } : st)), 1200);
    } catch (e: any) {
      setStates((st) => ({ ...st, [id]: 'error' }));
      const status = e?.response?.status;
      if (!status || status >= 500) {
        // No server. Keep the mark on the device rather than making the teacher
        // remember which cells did not save.
        await enqueue({
          key: `mark:${examId}:${classId}:${subjectId}:${id}`,
          kind: 'mark',
          endpoint: '/school/marks/entry',
          payload: {
            examId, classId, subjectId,
            studentProfileId: id,
            marks: isClear ? null : num,
            participation: part ?? participation[id] ?? 'present',
            maxMarks,
          },
          label: `${s.name}'s mark`,
        });
        setStates((st) => ({ ...st, [id]: 'saved' }));
        notify.warning('Saved on this device — no connection', {
          description: 'Marks will be sent automatically when the server is reachable.',
        });
      } else if (status === 409) {
        // Someone else edited this paper. Refetching is the fix, and saying so
        // is far more useful than repeating the server's version numbers.
        notify.error(`${s.name}'s mark was changed by someone else`, {
          description: 'Reloading this sheet so you can see the current marks.',
        });
        void refetch();
      } else {
        notify.error(e?.response?.data?.message ?? `Could not save ${s.name}'s mark`);
      }
    }
  }

  function focusNext(index: number) {
    const next = visible[index + 1];
    if (next) inputs.current[next.studentProfileId]?.focus();
  }

  /** Paste a whole column from a spreadsheet — one value per student, in order. */
  function onPaste(e: React.ClipboardEvent, startIndex: number) {
    const text = e.clipboardData.getData('text');
    const parts = text.split(/[\s,;\t\r\n]+/).map((t) => t.trim()).filter(Boolean);
    if (parts.length < 2) return;
    e.preventDefault();

    const patch: Record<string, string> = {};
    const targets: Array<{ student: MarkSheetStudent; raw: string }> = [];
    parts.forEach((raw, i) => {
      const student = visible[startIndex + i];
      if (!student) return;
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0 || n > maxMarks) return;
      patch[student.studentProfileId] = raw;
      targets.push({ student, raw });
    });
    if (targets.length === 0) return;

    setValues((v) => ({ ...v, ...patch }));
    notify.success(`Pasted ${targets.length} marks — saving…`);
    // Sequential so a 40-row paste does not open 40 connections at once.
    (async () => {
      for (const t of targets) await commit(t.student, t.raw);
      notify.success('All pasted marks saved');
    })();
  }

  async function toggleLock() {
    if (!examId || !classId || !subjectId) return;
    try {
      await lock.mutateAsync({ examId, classId, subjectId, locked: !locked });
      await refetch();
      notify.success(locked ? 'Mark entry unlocked' : 'Mark entry locked for this paper');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not change the lock');
    }
  }

  const ready = !!examId && !!classId && !!subjectId;

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Enter marks</h1>
        <p className="text-sm text-muted-foreground">
          Pick the paper, then type each mark and press Enter. Marks save themselves.
        </p>
        <div className="mt-2">
          <ContextBar
            year={yearList.find((y) => y.id === yearId)?.name}
            term={termList.find((t) => t.id === termId)?.name}
            className={sheet?.class?.name}
            stream={streamList.find((x) => x.id === streamId)?.name}
            subject={sheet?.subject?.name}
          />
        </div>
      </div>

      <WorkflowSteps current={3} />
      <OfflineBanner />

      <Card>
        <CardContent className="flex flex-wrap gap-3 pt-4">
          <Picker label="Year" value={yearId} onChange={(v) => { setYearId(v); setTermId(''); setExamId(''); }}
            options={yearList.map((y) => ({ value: y.id, label: y.name }))} className="min-w-[120px]" />
          <Picker label="Term" value={termId} onChange={(v) => { setTermId(v); setExamId(''); }}
            options={termList.map((t) => ({ value: t.id, label: t.name }))} className="min-w-[120px]" />
          <Picker label="Exam" value={examId} onChange={(v) => { setExamId(v); setClassId(''); setSubjectId(''); }}
            options={(exams ?? []).map((e) => ({ value: e.id, label: e.name }))} className="min-w-[170px]" />
          <Picker label="Class" value={classId} onChange={(v) => { setClassId(v); setSubjectId(''); setStreamId(''); }}
            options={examClasses.map((c) => ({ value: c.classId, label: c.className }))}
            placeholder={examClasses.length === 0 ? 'No classes on this exam' : 'Select…'}
            className="min-w-[130px]" />
          <Picker label="Subject" value={subjectId} onChange={setSubjectId}
            options={paperSubjects.map((s) => ({ value: s.id, label: s.name }))} className="min-w-[160px]" />
          <Picker label={currentTerminology().section} value={streamId} onChange={setStreamId}
            options={streamList.map((s) => ({ value: s.id, label: s.name }))}
            placeholder={`All ${currentTerminology().sectionPlural.toLowerCase()}`} className="min-w-[120px]" />
        </CardContent>
      </Card>

      {examClasses.length === 0 && examId && (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="This exam has no classes yet"
          hint="Go back to step 2 and tick the classes that sit it."
          action={<Button onClick={() => navigate('/school/exam-workspace/classes')}>Choose classes <ArrowRight className="h-4 w-4" /></Button>}
        />
      )}

      {ready && isLoading && <p className="text-sm text-muted-foreground">Loading marksheet…</p>}

      {ready && sheet && (
        <>
          {/* Paper header: what am I marking, how far along, and the subject pager. */}
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">
                    {sheet.class.name} · {sheet.subject.name}
                  </h2>
                  {locked && <Badge variant="secondary"><Lock className="h-3 w-3" /> Locked</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">
                  {sheet.exam.name} · out of {maxMarks}
                  {streamId && streamList.find((s) => s.id === streamId) && <> · {streamList.find((s) => s.id === streamId)!.name} stream</>}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Progress done={entered} total={sheet.total} />
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" disabled={subjectIndex <= 0}
                    onClick={() => setSubjectId(paperSubjects[subjectIndex - 1].id)}>
                    <ChevronLeft className="h-4 w-4" /> Previous
                  </Button>
                  <Button size="sm" variant="outline" disabled={subjectIndex < 0 || subjectIndex >= paperSubjects.length - 1}
                    onClick={() => setSubjectId(paperSubjects[subjectIndex + 1].id)}>
                    Next subject <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <Button size="sm" variant={locked ? 'default' : 'outline'} onClick={toggleLock} disabled={lock.isPending}>
                  {locked ? <><Unlock className="h-4 w-4" /> Unlock</> : <><Lock className="h-4 w-4" /> Lock paper</>}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => navigate('/school/exam-results')}>
                  <FileSpreadsheet className="h-4 w-4" /> Results
                </Button>
              </div>
            </CardContent>
          </Card>

          {locked && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Mark entry is locked for this paper. Unlock it above to make changes.
            </div>
          )}

          {students.length === 0 ? (
            <EmptyState
              title="No students in this class"
              hint="Admit or assign students to this class first, then come back to enter their marks."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b px-4 py-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    className="h-8 flex-1 bg-transparent text-sm outline-none"
                    placeholder="Search this class by name or admission number…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground">
                    {entered} of {sheet.total} entered
                  </span>
                </div>

                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                      <th className="w-10 px-4 py-2">#</th>
                      <th className="px-4 py-2">Student</th>
                      <th className="w-32 px-4 py-2">Admission no.</th>
                      {streamList.length > 0 && <th className="w-28 px-4 py-2">{currentTerminology().section}</th>}
                      <th className="w-32 px-4 py-2">Mark</th>
                      <th className="w-16 px-4 py-2">Grade</th>
                      <th className="w-40 px-4 py-2">If not marked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((s, i) => {
                      const id = s.studentProfileId;
                      const state = states[id] ?? 'idle';
                      const part = participation[id] ?? 'present';
                      return (
                        <tr key={id} className="border-b last:border-0 hover:bg-accent/30">
                          <td className="px-4 py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                          <td className="px-4 py-1.5 font-medium">{s.name}</td>
                          <td className="px-4 py-1.5 text-muted-foreground">{s.admissionNo}</td>
                          {streamList.length > 0 && (
                            <td className="px-4 py-1.5 text-muted-foreground">{s.streamName ?? '—'}</td>
                          )}
                          <td className="px-4 py-1.5">
                            <div className="flex items-center gap-2">
                              <Input
                                ref={(el) => { inputs.current[id] = el; }}
                                type="number"
                                inputMode="decimal"
                                min={0}
                                max={maxMarks}
                                disabled={locked || NON_SCORING.includes(part)}
                                className={[
                                  'h-8 w-20 tabular-nums',
                                  state === 'error' ? 'border-destructive' : '',
                                  state === 'saved' ? 'border-emerald-500' : '',
                                ].join(' ')}
                                placeholder={NON_SCORING.includes(part) ? part.slice(0, 3).toUpperCase() : '—'}
                                value={values[id] ?? ''}
                                onChange={(e) => setValues((v) => ({ ...v, [id]: e.target.value }))}
                                onBlur={(e) => {
                                  const original = s.marks != null ? String(s.marks) : '';
                                  if (e.target.value.trim() !== original) commit(s, e.target.value);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    (e.target as HTMLInputElement).blur();
                                    focusNext(i);
                                  }
                                  if (e.key === 'ArrowDown') { e.preventDefault(); focusNext(i); }
                                  if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    const prev = visible[i - 1];
                                    if (prev) inputs.current[prev.studentProfileId]?.focus();
                                  }
                                }}
                                onPaste={(e) => onPaste(e, i)}
                              />
                              <span className="w-4">
                                {state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                                {state === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                                {state === 'error' && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-1.5">
                            {grades[id] ? <Badge variant="outline">{grades[id]}</Badge> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-1.5">
                            <select
                              className={selectClass + ' h-8 text-xs'}
                              disabled={locked}
                              value={part}
                              onChange={(e) => {
                                const next = e.target.value;
                                setParticipation((p) => ({ ...p, [id]: next }));
                                if (NON_SCORING.includes(next)) {
                                  setValues((v) => ({ ...v, [id]: '' }));
                                  commit(s, '', next);
                                } else {
                                  commit(s, values[id] ?? '', next);
                                }
                              }}
                            >
                              <option value="present">Sat the paper</option>
                              <option value="absent">Absent</option>
                              <option value="exempt">Exempt</option>
                              <option value="excused">Excused</option>
                              <option value="malpractice">Malpractice</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {visible.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No student matches “{search}”.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm">
            <span className="text-muted-foreground">
              Tip: paste a column of marks from a spreadsheet into the first box to fill the whole class.
            </span>
            <div className="flex gap-2">
              {subjectIndex >= 0 && subjectIndex < paperSubjects.length - 1 && (
                <Button variant="outline" onClick={() => setSubjectId(paperSubjects[subjectIndex + 1].id)}>
                  Next subject <ArrowRight className="h-4 w-4" />
                </Button>
              )}
              <Button onClick={() => navigate('/school/exam-results')}>
                See results <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
