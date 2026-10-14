import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Save, Users } from 'lucide-react';
import {
  useAllocationMatrix,
  useCopyAllocation,
  useSaveAllocation,
  useTerms,
  type AllocationRow,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/notify';
import { EmptyState, Picker, useDefaulted, useStickyState } from './_components/exam-workflow';

/**
 * Teacher Allocation — who teaches what, this term (review A7, Phase 1.4).
 *
 * The question a Director of Studies answers at the start of every term, as a
 * grid: classes and streams down, subjects across, a teacher in each cell, and
 * the class teacher of each class or stream. "Copy from last term" makes it a
 * one-click job when little has changed. The course-offering lifecycle that
 * used to be the only way to do this stays available under Course Offerings
 * for schools that run it.
 */
type CellKey = string; // `${classId}:${sectionId ?? ''}:${subjectId}`
const cellKey = (r: Pick<AllocationRow, 'classId' | 'sectionId'>, subjectId: string): CellKey => `${r.classId}:${r.sectionId ?? ''}:${subjectId}`;
const rowKey = (r: Pick<AllocationRow, 'classId' | 'sectionId'>) => `${r.classId}:${r.sectionId ?? ''}`;

export function SchoolTeachingAllocationPage() {
  const { data: terms } = useTerms();
  const termList = terms?.data ?? [];
  const [termId, setTermId] = useStickyState('allocation.termId');
  useDefaulted(termId, setTermId, termList.find((t) => t.isCurrent)?.id ?? termList[0]?.id);

  const { data: matrix, isLoading, isError } = useAllocationMatrix(termId || undefined);
  const save = useSaveAllocation();
  const copy = useCopyAllocation();

  const [cells, setCells] = useState<Record<CellKey, string>>({});
  const [teachers, setTeachers] = useState<Record<string, string>>({});
  useEffect(() => { setCells({}); setTeachers({}); }, [termId]);
  const dirty = Object.keys(cells).length + Object.keys(teachers).length;

  // The term before this one, to copy from.
  const previousTerm = useMemo(() => {
    const i = termList.findIndex((t) => t.id === termId);
    return i >= 0 ? termList[i + 1] : undefined; // newest first
  }, [termList, termId]);

  const staffOptions = matrix?.staff ?? [];
  const loadOf = useMemo(() => {
    // Lessons per teacher this term, as allocated (including unsaved edits).
    const n = new Map<string, number>();
    for (const level of matrix?.levels ?? []) {
      for (const r of level.rows) {
        for (const s of level.subjects) {
          const v = cells[cellKey(r, s.id)] ?? r.cells[s.id]?.teacherPartnerId ?? '';
          if (v) n.set(v, (n.get(v) ?? 0) + 1);
        }
      }
    }
    return n;
  }, [matrix, cells]);

  const doSave = async () => {
    if (!termId || !dirty) return;
    const cellRows = Object.entries(cells).map(([k, teacherPartnerId]) => {
      const [classId, sectionId, subjectId] = k.split(':');
      return { classId, sectionId: sectionId || null, subjectId, teacherPartnerId: teacherPartnerId || null };
    });
    const classTeacherRows = Object.entries(teachers).map(([k, staffProfileId]) => {
      const [classId, sectionId] = k.split(':');
      return { classId, sectionId: sectionId || null, staffProfileId: staffProfileId || null };
    });
    try {
      await save.mutateAsync({ termId, cells: cellRows, classTeachers: classTeacherRows });
      setCells({});
      setTeachers({});
      notify.success('Allocation saved', { description: 'Teachers now see these classes on My Teaching, and can enter their marks.' });
    } catch (e: any) {
      notify.error('Could not save the allocation', { description: e?.response?.data?.message ?? 'Try again.' });
    }
  };

  const doCopy = async () => {
    if (!termId || !previousTerm) return;
    try {
      const res = await copy.mutateAsync({ fromTermId: previousTerm.id, toTermId: termId });
      notify.success(`${res.copied} allocation${res.copied === 1 ? '' : 's'} copied from ${previousTerm.label ?? previousTerm.name}`, {
        description: res.kept ? `${res.kept} already set this term were kept.` : 'Change any that differ, then save.',
      });
    } catch (e: any) {
      notify.error('Could not copy the allocation', { description: e?.response?.data?.message ?? 'Try again.' });
    }
  };

  const sel = 'h-8 w-full min-w-[130px] rounded-md border bg-card px-2 text-xs';

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Users className="h-5 w-5" />Teacher Allocation</h1>
          <p className="text-sm text-muted-foreground">
            Who teaches each class and subject this term, and each class’s class teacher. Teachers see only what they are allocated here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!previousTerm || copy.isPending} onClick={() => void doCopy()}
            title={previousTerm ? `Copy every allocation from ${previousTerm.label ?? previousTerm.name}` : 'There is no earlier term'}>
            <Copy className="h-4 w-4" /> Copy from {previousTerm ? (previousTerm.label ?? previousTerm.name) : 'last term'}
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={() => void doSave()}>
            <Save className="h-4 w-4" /> {save.isPending ? 'Saving…' : dirty ? `Save ${dirty} change${dirty === 1 ? '' : 's'}` : 'Saved'}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <Picker label="Term" value={termId} onChange={setTermId} options={termList.map((t) => ({ value: t.id, label: t.label ?? t.name }))} className="min-w-[170px]" />
          <p className="pb-2 text-xs text-muted-foreground">
            Advanced: <Link to="/school/course-offerings" className="underline">course offerings</Link> for schools that run online courses per class.
          </p>
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Loading classes…</p>}
      {isError && <EmptyState title="Couldn’t load the allocation" hint="Check you can manage classes and subjects, then refresh." />}
      {matrix && matrix.levels.length === 0 && (
        <EmptyState title="No classes yet" hint="Add classes under Academic Management → Classes, then allocate their teachers here." />
      )}

      {matrix?.levels.map((level) => (
        <Card key={level.levelId ?? 'none'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{level.levelName}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {level.subjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No subjects for this level. Add them under Academic Management → Subjects.
              </p>
            ) : (
              <table className="w-full border-separate border-spacing-x-1 border-spacing-y-1 text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="sticky left-0 bg-card pr-2 font-medium">Class</th>
                    <th className="font-medium">Class teacher</th>
                    {level.subjects.map((s) => <th key={s.id} className="font-medium" title={s.name}>{s.code}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {level.rows.map((r) => {
                    const rk = rowKey(r);
                    return (
                      <tr key={rk}>
                        <td className="sticky left-0 whitespace-nowrap bg-card pr-2 font-medium">
                          {r.className}{r.sectionName ? ` ${r.sectionName}` : ''}
                        </td>
                        <td>
                          <select aria-label={`Class teacher of ${r.className} ${r.sectionName ?? ''}`} className={sel}
                            value={teachers[rk] ?? r.classTeacherId ?? ''}
                            onChange={(e) => setTeachers((t) => ({ ...t, [rk]: e.target.value }))}>
                            <option value="">—</option>
                            {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </td>
                        {level.subjects.map((s) => {
                          const k = cellKey(r, s.id);
                          const current = r.cells[s.id];
                          const value = cells[k] ?? current?.teacherPartnerId ?? '';
                          return (
                            <td key={s.id}>
                              <select aria-label={`${s.name} teacher for ${r.className} ${r.sectionName ?? ''}`}
                                className={`${sel} ${!value ? 'border-dashed text-muted-foreground' : ''}`}
                                title={current?.inherited && !(k in cells) ? 'Set for the whole class' : undefined}
                                value={value}
                                onChange={(e) => setCells((c) => ({ ...c, [k]: e.target.value }))}>
                                <option value="">Not allocated</option>
                                {staffOptions.map((st) => (
                                  <option key={st.id} value={st.id}>{st.name}{loadOf.get(st.id) ? ` (${loadOf.get(st.id)})` : ''}</option>
                                ))}
                              </select>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
