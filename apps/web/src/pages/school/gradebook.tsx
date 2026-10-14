import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ClipboardList, Plus, SlidersHorizontal } from 'lucide-react';
import {
  useAcademicYears, useTerms, useClasses, useClassSubdivisions,
  useGradebookSheet, useTeacherOverview, currentTerminology } from '@/features/school/api';
import { useMyStaffIdentity } from '@/features/hr/api';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Picker, useDefaulted, useStickyState } from './_components/exam-workflow';
import { ContextBar } from './_components/context-bar';

/**
 * The gradebook — one class × term × subject spreadsheet. Every column is an
 * assessment; the final column is the weighted total, computed by the same
 * engine as the report card, so a teacher and a head teacher read one number.
 *
 * Read-only view: marks are entered, and assessments created, on the
 * Assessment Board (the API answers 410 to the old gradebook writes). Each
 * column header opens that assessment's marking screen.
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

  const yearList = years?.data ?? [];
  const termList = useMemo(
    () => (terms?.data ?? []).filter((t) => !yearId || t.academicYearId === yearId),
    [terms, yearId],
  );
  useDefaulted(yearId, setYearId, yearList.find((y) => y.isCurrent)?.id ?? yearList[0]?.id);
  useDefaulted(termId, setTermId, termList.find((t) => t.isCurrent)?.id ?? termList[0]?.id);
  // Open on a class the teacher teaches. The school's first class is refused
  // by the class scope for most teachers, which left a blank sheet on arrival.
  const seesAllClasses = useAuthStore((s) => s.hasPermission(PERMISSIONS.school.manageAssessments) || s.hasPermission(PERMISSIONS.school.approveGrades));
  const { data: me } = useMyStaffIdentity();
  const { data: myTeaching } = useTeacherOverview(seesAllClasses ? undefined : me?.staffProfileId ?? undefined);
  const ownClassIds = useMemo(() => new Set((myTeaching?.classes ?? []).map((c) => c.classId)), [myTeaching]);
  useDefaulted(classId, setClassId, seesAllClasses ? classes?.data?.[0]?.id : myTeaching?.classes[0]?.classId);
  const classOptions = (classes?.data ?? []).filter((c) => seesAllClasses || ownClassIds.has(c.id));

  const { data: streamList } = useClassSubdivisions(classId || undefined);

  const { data: sheet, isLoading, isError } = useGradebookSheet({
    classId: classId || undefined,
    termId: termId || undefined,
    subjectId: subjectId || undefined,
    sectionId: streamId || undefined,
  });

  // Keep the subject picker in sync with what the sheet resolved to.
  useEffect(() => {
    if (sheet?.subject && !subjectId) setSubjectId(sheet.subject.id);
  }, [sheet?.subject, subjectId, setSubjectId]);

  const columns = sheet?.columns ?? [];
  const students = sheet?.students ?? [];
  const ready = !!classId && !!termId;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Gradebook</h1>
          <p className="text-sm text-muted-foreground">
            Every assessment for a class, with the weighted term total — the same number that reaches the report card.
            Open a column to enter or change its marks.
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
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/school/assessments"><ClipboardList className="h-4 w-4" /> Assessments</Link>
          </Button>
          <Button asChild>
            <Link to="/school/assessments?new=1"><Plus className="h-4 w-4" /> New assessment</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 pt-4">
          <Picker label="Year" value={yearId} onChange={(v) => { setYearId(v); setTermId(''); }}
            options={yearList.map((y) => ({ value: y.id, label: y.name }))} className="min-w-[120px]" />
          <Picker label="Term" value={termId} onChange={setTermId}
            options={termList.map((t) => ({ value: t.id, label: t.name }))} className="min-w-[120px]" />
          <Picker label="Class" value={classId} onChange={(v) => { setClassId(v); setSubjectId(''); setStreamId(''); }}
            options={classOptions.map((c) => ({ value: c.id, label: c.name }))} className="min-w-[130px]" />
          <Picker label="Subject" value={subjectId} onChange={setSubjectId}
            options={(sheet?.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))} className="min-w-[160px]" />
          <Picker label={currentTerminology().section} value={streamId} onChange={setStreamId}
            options={streamList.map((s) => ({ value: s.id, label: s.name }))} placeholder={`All ${currentTerminology().sectionPlural.toLowerCase()}`} className="min-w-[120px]" />
        </CardContent>
      </Card>

      {ready && isLoading && <p className="text-sm text-muted-foreground">Loading gradebook…</p>}

      {!seesAllClasses && myTeaching && myTeaching.classes.length === 0 && (
        <EmptyState title="No classes allocated to you yet" hint="Ask the academic office to add you under Academic Management › Teaching Allocation." />
      )}

      {ready && isError && (
        <EmptyState
          title="Couldn't open this gradebook"
          hint="You may not teach this class, or the server didn't answer. Pick one of your own classes above, or refresh the page."
        />
      )}

      {ready && sheet && !sheet.subject && (
        <EmptyState title="This class takes no subjects yet" hint="Allocate its subjects and teachers under Academic Management › Teaching Allocation, then the gradebook fills in." />
      )}

      {ready && sheet?.subject && (
        <>
          {/* Weighting banner */}
          {sheet.policy ? (
            !sheet.policy.weightsValid && (
              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Weighting <strong>{sheet.policy.name}</strong> adds up to {sheet.policy.weightsTotal}%, not 100%. Totals use the weights present.
              </div>
            )
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-muted-foreground/30 bg-muted/40 px-3 py-2 text-sm">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              No weighting applies to this class/subject — the total is a plain average. Set one up in{' '}
              <Link to="/school/assessment" className="font-medium underline">Assessment Weighting</Link>.
            </div>
          )}

          {columns.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-8 w-8" />}
              title="No assessments yet"
              hint="Create a CAT, a test or a homework on the Assessment Board. Exam marks appear here automatically once the exam is set up."
              action={<Button asChild><Link to="/school/assessments?new=1"><Plus className="h-4 w-4" /> New assessment</Link></Button>}
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
                              <Link
                                to={`/school/assessments/${col.assessmentId}/mark`}
                                title={`Open marking for ${col.title}`}
                                className="flex flex-col items-center gap-0.5 hover:text-foreground"
                              >
                                <span className="max-w-[90px] truncate underline-offset-2 hover:underline">{col.title}</span>
                                <span className="font-normal">/{col.maxScore}</span>
                                {col.sourceType !== 'manual' && (
                                  <Badge variant="secondary" className="text-[10px]">{col.sourceType.replace('_', ' ')}</Badge>
                                )}
                              </Link>
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
                            const participation = s.cells[cid]?.participation ?? 'present';
                            return (
                              <td key={cid} className="border-l px-2 py-1.5 text-center">
                                <span className="tabular-nums">
                                  {s.cells[cid]?.marks != null ? s.cells[cid]!.marks
                                    : participation !== 'present' ? <span className="text-xs uppercase text-muted-foreground">{participation.slice(0, 3)}</span>
                                    : <span className="text-muted-foreground/40">·</span>}
                                </span>
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
            {columns.length} assessment{columns.length === 1 ? '' : 's'} · {students.length} students
          </p>
        </>
      )}
    </div>
  );
}
