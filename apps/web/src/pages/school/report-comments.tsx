import { useEffect, useMemo, useState } from 'react';
import { MessageSquareText, Save, Sparkles } from 'lucide-react';
import {
  useClasses,
  useSections,
  useSectionsForClass,
  useTerms,
  useReportCommentSheet,
  useSaveReportComments,
  type ReportCommentRow,
} from '@/features/school/api';
import { useMyStaffIdentity } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { notify } from '@/lib/notify';
import { EmptyState, Picker, useDefaulted, useStickyState } from './_components/exam-workflow';

/**
 * Report-card comments — the class teacher's and the head teacher's.
 *
 * Every Ugandan report card carries both, and until now there was no screen to
 * write either (review A2). One grid per class (or stream): each pupil with the
 * released result the comment is written against, the comment boxes the caller
 * may edit, and a comment bank so forty comments are minutes, not an evening.
 * A box the API would refuse is not shown as editable: the class teacher's
 * column for the class teacher of THAT class, the head teacher's for the head.
 */

type Band = 'excellent' | 'good' | 'fair' | 'weak' | 'nursery';

/** Suggested wording by performance band. A starting point — always editable. */
const BANK: Record<'classTeacher' | 'head', Record<Band, string[]>> = {
  classTeacher: {
    excellent: ['Excellent work this term. Keep it up.', 'A very good term. Well done — maintain this standard.'],
    good: ['Good work. Aim even higher next term.', 'A good term; a little more effort in the weaker subjects will help.'],
    fair: ['Fair performance. More effort and practice are needed.', 'Can do better with more concentration in class and revision at home.'],
    weak: ['Needs to work much harder. Extra support has been recommended.', 'Below expectation. Please follow up with revision at home.'],
    nursery: ['A happy learner who is making good progress.', 'Making steady progress — keep encouraging at home.', 'Enjoys learning through play and is developing well.'],
  },
  head: {
    excellent: ['Excellent results. Congratulations.', 'Outstanding. Keep shining.'],
    good: ['Good results. Keep improving.', 'A good term. Aim for the top.'],
    fair: ['Fair results. Work harder next term.', 'There is room to improve. More effort, please.'],
    weak: ['Poor performance. Parents, please follow up closely.', 'Must improve. The school will support — please work with us.'],
    nursery: ['A lovely term. Thank you for your support at home.', 'Good progress. We look forward to next term.'],
  },
};

function bandOf(r: ReportCommentRow): Band | null {
  if (r.gradingSystem === 'ECD') return 'nursery';
  if (r.division) {
    if (r.division === 'I') return 'excellent';
    if (r.division === 'II') return 'good';
    if (r.division === 'III') return 'fair';
    return 'weak';
  }
  if (r.meanPercent == null) return null;
  if (r.meanPercent >= 80) return 'excellent';
  if (r.meanPercent >= 65) return 'good';
  if (r.meanPercent >= 50) return 'fair';
  return 'weak';
}

function headline(r: ReportCommentRow): string {
  if (!r.released) return 'Results not released yet';
  if (r.gradingSystem === 'ECD') return 'Nursery (descriptors)';
  return [
    r.meanPercent != null ? `${r.meanPercent.toFixed(1)}%` : null,
    r.aggregate != null ? `Agg ${r.aggregate}` : null,
    r.division ? `Div ${r.division}` : null,
    r.position != null ? `Pos ${r.position}` : null,
  ].filter(Boolean).join(' · ') || '—';
}

type Draft = Record<string, { classTeacherComment?: string; principalComment?: string }>;

export function SchoolReportCommentsPage() {
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const { data: me } = useMyStaffIdentity();

  const [termId, setTermId] = useStickyState('termId');
  const [classId, setClassId] = useStickyState('comments.classId');
  const [sectionId, setSectionId] = useState('');
  const termList = terms?.data ?? [];
  useDefaulted(termId, setTermId, termList.find((t) => t.isCurrent)?.id ?? termList[0]?.id);

  // A class teacher's own classes first — the class they are most likely here for.
  const { data: allSections } = useSections();
  const classOptions = useMemo(() => {
    const all = classes?.data ?? [];
    const me_ = me?.staffProfileId;
    const isMine = (c: (typeof all)[number]) =>
      !!me_ && (c.homeroomTeacher?.id === me_ || (allSections?.data ?? []).some((s) => s.classId === c.id && s.classTeacherId === me_));
    const mine = all.filter(isMine);
    const rest = all.filter((c) => !mine.includes(c));
    return [...mine.map((c) => ({ value: c.id, label: `${c.name} (my class)` })), ...rest.map((c) => ({ value: c.id, label: c.name }))];
  }, [classes, allSections, me]);
  useDefaulted(classId, setClassId, classOptions.find((o) => o.label.endsWith('(my class)'))?.value);
  const { data: streams } = useSectionsForClass(classId || undefined);
  // A stream class teacher opens on their own stream.
  const myStream = (streams ?? []).find((st) => !!me?.staffProfileId && st.classTeacherId === me.staffProfileId)?.id ?? '';
  useEffect(() => setSectionId(myStream), [classId, myStream]);

  const { data: sheet, isLoading, isError } = useReportCommentSheet({ classId, termId, sectionId });
  const save = useSaveReportComments();
  const [draft, setDraft] = useState<Draft>({});
  useEffect(() => setDraft({}), [classId, termId, sectionId]);

  const rows = sheet?.rows ?? [];
  const valueOf = (r: ReportCommentRow, key: 'classTeacherComment' | 'principalComment') =>
    draft[r.studentProfileId]?.[key] ?? r[key] ?? '';
  const edit = (id: string, key: 'classTeacherComment' | 'principalComment', value: string) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));
  const dirty = Object.keys(draft).length;

  const suggestEmpty = (key: 'classTeacherComment' | 'principalComment') => {
    const bank = key === 'classTeacherComment' ? BANK.classTeacher : BANK.head;
    let filled = 0;
    const next: Draft = { ...draft };
    rows.forEach((r, i) => {
      if (r.cardPublished || valueOf(r, key).trim()) return;
      if (key === 'classTeacherComment' && r.classCommentEditable === false) return;
      const band = bandOf(r);
      if (!band) return;
      const options = bank[band];
      next[r.studentProfileId] = { ...next[r.studentProfileId], [key]: options[i % options.length] };
      filled += 1;
    });
    setDraft(next);
    notify.info(filled ? `Suggested ${filled} comment${filled === 1 ? '' : 's'} — read them, edit any, then save.` : 'Nothing to suggest: every box already has a comment, or results are not released.');
  };

  const doSave = async () => {
    if (!termId || !dirty) return;
    const items = Object.entries(draft).map(([studentProfileId, v]) => ({ studentProfileId, ...v }));
    try {
      const res = await save.mutateAsync({ termId, items });
      setDraft({});
      if (res.refused.length) {
        notify.error(`${res.saved} saved, ${res.refused.length} not saved`, { description: res.refused[0].reason });
      } else {
        notify.success(`${res.saved} comment${res.saved === 1 ? '' : 's'} saved`, {
          description: 'They print on the report cards the next time the class set is built.',
        });
      }
    } catch (e: any) {
      notify.error('Could not save the comments', { description: e?.response?.data?.message ?? 'Try again.' });
    }
  };

  const canClass = !!sheet?.canWriteClass;
  const canHead = !!sheet?.canWriteHead;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><MessageSquareText className="h-5 w-5" />Report Comments</h1>
          <p className="text-sm text-muted-foreground">
            The class teacher’s and head teacher’s comments for each pupil’s report card. Use the suggestions as a start, then make each one personal.
          </p>
        </div>
        <Button disabled={!dirty || save.isPending} onClick={() => void doSave()}>
          <Save className="h-4 w-4" /> {save.isPending ? 'Saving…' : dirty ? `Save ${dirty} change${dirty === 1 ? '' : 's'}` : 'Saved'}
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <Picker label="Term" value={termId} onChange={setTermId} options={termList.map((t) => ({ value: t.id, label: t.label ?? t.name }))} className="min-w-[170px]" />
          <Picker label="Class" value={classId} onChange={setClassId} options={classOptions} className="min-w-[180px]" />
          <Picker label="Stream" value={sectionId} onChange={setSectionId} placeholder="Whole class" options={(streams ?? []).map((s) => ({ value: s.id, label: s.name }))} className="min-w-[150px]" />
        </CardContent>
      </Card>

      {(!classId || !termId) && <EmptyState title="Choose a term and a class" hint="Your own class is listed first." />}
      {classId && termId && isLoading && <p className="text-sm text-muted-foreground">Loading pupils…</p>}
      {classId && termId && isError && (
        <EmptyState title="You can’t open this class’s comments" hint="Only the class teacher of this class (or the head teacher / Director of Studies) can. Choose your own class." />
      )}

      {sheet && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base">{rows.length} pupil{rows.length === 1 ? '' : 's'}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {canClass && (
                <Button size="sm" variant="outline" onClick={() => suggestEmpty('classTeacherComment')}>
                  <Sparkles className="h-4 w-4" /> Suggest class teacher comments
                </Button>
              )}
              {canHead && (
                <Button size="sm" variant="outline" onClick={() => suggestEmpty('principalComment')}>
                  <Sparkles className="h-4 w-4" /> Suggest head teacher comments
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {!canClass && !canHead && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                You can read these comments but not change them. The class teacher writes the class teacher’s comment; the head teacher writes theirs.
              </p>
            )}
            {rows.length === 0 && <p className="text-sm text-muted-foreground">No pupils were placed in this class that term.</p>}
            {rows.map((r, i) => (
              <div key={r.studentProfileId} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[minmax(180px,1fr)_2fr_2fr]">
                <div className="min-w-0">
                  <p className="truncate font-medium">{i + 1}. {r.name ?? 'Pupil'}</p>
                  <p className="text-xs text-muted-foreground">{r.admissionNo ?? ''}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant={r.released ? 'secondary' : 'outline'}>{headline(r)}</Badge>
                    {r.cardPublished && <Badge>Released to family</Badge>}
                  </div>
                </div>
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">Class teacher’s comment</span>
                  <Textarea
                    rows={2}
                    maxLength={1000}
                    value={valueOf(r, 'classTeacherComment')}
                    disabled={!canClass || r.cardPublished || r.classCommentEditable === false}
                    title={r.cardPublished ? 'This card is released. Unpublish it on Report Cards to change its comments.' : r.classCommentEditable === false ? 'Only this pupil’s own class teacher writes this comment.' : undefined}
                    onChange={(e) => edit(r.studentProfileId, 'classTeacherComment', e.target.value)}
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="text-muted-foreground">Head teacher’s comment</span>
                  <Textarea
                    rows={2}
                    maxLength={1000}
                    value={valueOf(r, 'principalComment')}
                    disabled={!canHead || r.cardPublished}
                    title={r.cardPublished ? 'This card is released. Unpublish it on Report Cards to change its comments.' : undefined}
                    onChange={(e) => edit(r.studentProfileId, 'principalComment', e.target.value)}
                  />
                </label>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
