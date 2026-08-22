import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Check, ClipboardList, Loader2, Plus, Trash2,
} from 'lucide-react';
import {
  useTerms, useClasses, useStaff, useClassSubjects,
  useHomeworkByClass, useHomeworkDetail, useCreateHomework, useDeleteHomework,
  useGradeHomeworkSubmission, useSubmitHomeworkOnBehalf,
  type HomeworkItem,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { notify } from '@/lib/notify';
import { EmptyState, Picker, Progress, selectClass, useDefaulted, useStickyState, fmtDate } from './_components/exam-workflow';

/**
 * Homework — set work, see who has handed it in, mark it.
 *
 * Replaces the raw-UUID debug form. Grading routes through the fixed bridge, so
 * a homework mark now reaches the gradebook and the report card instead of
 * dead-ending on the submission row.
 */
export function SchoolHomeworkPage() {
  const { data: classes } = useClasses();
  const [classId, setClassId] = useStickyState('hw.classId');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useDefaulted(classId, setClassId, classes?.data?.[0]?.id);
  const { data: homework, isLoading } = useHomeworkByClass(classId || undefined);

  if (openId) {
    return <HomeworkDetailView id={openId} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Homework &amp; Tasks</h1>
          <p className="text-sm text-muted-foreground">Set work for a class, track who has handed it in, and mark it.</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={!classId}><Plus className="h-4 w-4" /> New homework</Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 pt-4">
          <Picker
            label="Class"
            value={classId}
            onChange={setClassId}
            options={(classes?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            className="min-w-[200px]"
          />
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && (homework ?? []).length === 0 && (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="No homework for this class yet"
          hint="Set a piece of homework — a reading, an exercise, a project — and it appears here to track and mark."
          action={<Button onClick={() => setCreating(true)} disabled={!classId}><Plus className="h-4 w-4" /> Set the first homework</Button>}
        />
      )}

      {(homework ?? []).length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(homework ?? []).map((h) => (
            <HomeworkCard key={h.id} hw={h} onOpen={() => setOpenId(h.id)} />
          ))}
        </div>
      )}

      {classId && (
        <CreateHomeworkDialog open={creating} classId={classId} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />
      )}
    </div>
  );
}

function HomeworkCard({ hw, onOpen }: { hw: HomeworkItem; onOpen: () => void }) {
  const submissions = hw.submissions ?? [];
  const submitted = submissions.filter((s) => s.status !== 'not_submitted').length;
  const graded = submissions.filter((s) => s.status === 'graded').length;
  const overdue = new Date(hw.dueDate) < new Date();
  return (
    <Card className="cursor-pointer transition hover:border-primary" onClick={onOpen}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{hw.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{hw.subject?.name ?? 'Subject'}</span>
          <span>·</span>
          <span className={overdue ? 'text-amber-600' : ''}>due {fmtDate(hw.dueDate)}</span>
        </div>
        <div className="flex items-center gap-2">
          {hw.maxScore != null && <Badge variant="outline">/{hw.maxScore}</Badge>}
          <Badge variant="secondary">{submitted} handed in</Badge>
          {graded > 0 && <Badge className="bg-emerald-600 hover:bg-emerald-600">{graded} marked</Badge>}
        </div>
        <Button size="sm" variant="secondary" className="w-full">Open &amp; mark</Button>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Detail / grading ─────────────────────────── */

function HomeworkDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, isLoading } = useHomeworkDetail(id);
  const grade = useGradeHomeworkSubmission();
  const submitOnBehalf = useSubmitHomeworkOnBehalf();
  const del = useDeleteHomework();

  const [scores, setScores] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({});

  useEffect(() => {
    if (!data) return;
    const s: Record<string, string> = {};
    for (const r of data.students) s[r.studentProfileId] = r.score != null ? String(r.score) : '';
    setScores(s);
    setStates({});
  }, [data]);

  const max = data?.homework.maxScore ?? 100;

  async function commit(studentProfileId: string, submissionId: string | null, raw: string) {
    const trimmed = raw.trim();
    if (trimmed === '') return;
    const num = Number(trimmed);
    if (Number.isNaN(num) || num < 0 || num > max) {
      setStates((s) => ({ ...s, [studentProfileId]: 'error' }));
      notify.error(`Mark must be 0–${max}`);
      return;
    }
    setStates((s) => ({ ...s, [studentProfileId]: 'saving' }));
    try {
      // A student who handed in on paper has no submission row yet — create one,
      // then grade it. Otherwise the mark has nowhere to attach.
      let sid = submissionId;
      if (!sid) {
        const created: any = await submitOnBehalf.mutateAsync({ assignmentId: id, studentProfileId });
        sid = created?.id ?? null;
      }
      if (!sid) throw new Error('no submission');
      await grade.mutateAsync({ submissionId: sid, score: num });
      setStates((s) => ({ ...s, [studentProfileId]: 'saved' }));
      setTimeout(() => setStates((s) => (s[studentProfileId] === 'saved' ? { ...s, [studentProfileId]: 'idle' } : s)), 1000);
    } catch (e: any) {
      setStates((s) => ({ ...s, [studentProfileId]: 'error' }));
      notify.error(e?.response?.data?.message ?? 'Could not save mark');
    }
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!data) return <div className="p-6 text-sm text-muted-foreground">Homework not found.</div>;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Back to homework</Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-lg">{data.homework.title}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {data.homework.subject} · {data.homework.className} · due {fmtDate(data.homework.dueDate)} · out of {max}
            </p>
            {data.homework.description && <p className="mt-2 max-w-2xl text-sm">{data.homework.description}</p>}
          </div>
          <Button
            variant="ghost" size="sm" className="text-destructive hover:text-destructive"
            onClick={async () => {
              if (!confirm('Delete this homework?')) return;
              await del.mutateAsync(id);
              notify.success('Homework deleted');
              onBack();
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 text-sm">
            <Progress done={data.graded} total={data.total} />
            <span className="text-muted-foreground">{data.submitted} handed in · {data.graded} marked · {data.total} students</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                <th className="w-10 px-4 py-2">#</th>
                <th className="px-4 py-2">Student</th>
                <th className="w-32 px-4 py-2">Status</th>
                <th className="w-28 px-4 py-2">Mark</th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((r, i) => {
                const state = states[r.studentProfileId] ?? 'idle';
                return (
                  <tr key={r.studentProfileId} className="border-b last:border-0 hover:bg-accent/30">
                    <td className="px-4 py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-4 py-1.5">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.admissionNo}</div>
                    </td>
                    <td className="px-4 py-1.5">
                      {r.status === 'not_submitted' ? <Badge variant="secondary">Not handed in</Badge>
                        : r.status === 'graded' ? <Badge className="bg-emerald-600 hover:bg-emerald-600">Marked</Badge>
                        : r.status === 'late' ? <Badge variant="destructive">Late</Badge>
                        : <Badge variant="outline">Handed in</Badge>}
                    </td>
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          className={[
                            'h-8 w-20 tabular-nums',
                            state === 'error' ? 'border-destructive' : state === 'saved' ? 'border-emerald-500' : '',
                          ].join(' ')}
                          value={scores[r.studentProfileId] ?? ''}
                          onChange={(e) => setScores((s) => ({ ...s, [r.studentProfileId]: e.target.value }))}
                          onBlur={(e) => {
                            const orig = r.score != null ? String(r.score) : '';
                            if (e.target.value.trim() !== orig) commit(r.studentProfileId, r.submissionId, e.target.value);
                          }}
                        />
                        {state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                        {state === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────── Create ─────────────────────────── */

function CreateHomeworkDialog({
  open, classId, onClose, onCreated,
}: { open: boolean; classId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { data: terms } = useTerms();
  const { data: staff } = useStaff();
  const { data: subjects } = useClassSubjects(classId);
  const create = useCreateHomework();

  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [termId, setTermId] = useState('');
  const [dueDate, setDueDate] = useState(today);
  const [maxScore, setMaxScore] = useState('10');
  const [description, setDescription] = useState('');

  const teachers = useMemo(() => (staff?.data ?? []).filter((s) => (s as any).staffCategory !== 'non_teaching'), [staff]);
  const currentTerm = useMemo(() => {
    const list = terms?.data ?? [];
    return list.find((t) => t.isCurrent)?.id ?? list[0]?.id ?? '';
  }, [terms]);

  useEffect(() => {
    if (open) {
      setTitle(''); setDescription(''); setMaxScore('10'); setDueDate(today);
      setSubjectId(subjects?.[0]?.id ?? '');
      setTeacherId(teachers[0]?.id ?? '');
      setTermId(currentTerm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    if (!title.trim() || !subjectId || !teacherId) return;
    try {
      const created: any = await create.mutateAsync({
        classId, subjectId, teacherPartnerId: teacherId, title: title.trim(),
        dueDate, termId: termId || undefined, maxScore: Number(maxScore) || undefined,
        description: description || undefined,
      });
      notify.success(`"${created.title}" set`);
      onCreated(created.id);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not create homework');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New homework</DialogTitle>
          <DialogDescription>Set a piece of work for this class. Marks flow into the gradebook.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label>
            <Input placeholder="e.g. Fractions exercise 1–10" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Subject</label>
              <select className={selectClass} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">Select…</option>
                {(subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Teacher</label>
              <select className={selectClass} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                <option value="">Select…</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.partner?.name ?? (t as any).employeeNo}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Term</label>
              <select className={selectClass} value={termId} onChange={(e) => setTermId(e.target.value)}>
                <option value="">—</option>
                {(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Due</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Out of</label>
              <Input type="number" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Instructions (optional)</label>
            <textarea
              className="min-h-[70px] w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should the students do?"
            />
          </div>
          {termId === '' && <p className="text-xs text-amber-600">Tip: set a term so the marks land in the right gradebook.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!title.trim() || !subjectId || !teacherId || create.isPending}>Set homework</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
