import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  useAssessmentBoard, useClasses, useClassSubjects, useCreateAssessmentUnified,
  useStaff, useTerms, useWorkspaceExams, ASSESSMENT_KINDS, KIND_LABEL,
} from '@/features/school/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { notify } from '@/lib/notify';
import { Picker, selectClass } from './exam-workflow';

/**
 * One create form for every kind of assessment.
 *
 * The kind decides only the TAIL of the form. Everything above the divider is
 * identical whether the teacher is setting a CAT, a project or an end-of-term
 * paper, because from their side it is the same act — and making them choose a
 * subsystem first was the single biggest thing wrong with the old flow.
 *
 * Two kinds carry extra work behind them, and both are handled here rather than
 * on a separate screen:
 *   - exam: also creates the ExamSchedule rows, one per class ticked. This is
 *     what the old wizard's "choose classes" step was.
 *   - homework: also creates the HomeworkAssignment that collects submissions.
 */
export function CreateAssessmentDialog({
  termId: initialTerm,
  classId: initialClass,
  subjectId: initialSubject,
  onClose,
}: {
  termId?: string;
  classId?: string;
  subjectId?: string;
  onClose: () => void;
}) {
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const { data: staff } = useStaff({ pageSize: 200 });
  const create = useCreateAssessmentUnified();

  const [kind, setKind] = useState('cat');
  const [termId, setTermId] = useState(initialTerm ?? '');
  const [classId, setClassId] = useState(initialClass ?? '');
  const [subjectId, setSubjectId] = useState(initialSubject ?? '');
  const [title, setTitle] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [dueAt, setDueAt] = useState('');
  const [componentId, setComponentId] = useState('');
  const [teacherPartnerId, setTeacherPartnerId] = useState('');
  const [description, setDescription] = useState('');
  const [examId, setExamId] = useState('');
  const [classIds, setClassIds] = useState<string[]>([]);

  const { data: subjects } = useClassSubjects(classId || undefined);
  const { data: exams } = useWorkspaceExams(termId ? { termId } : {});
  // The board already resolves the policy for this class+subject, so the
  // component list here is the same one the list screen shows — no second
  // notion of "which buckets exist".
  const { data: board } = useAssessmentBoard({ termId, classId, subjectId });
  const components = board?.policy?.components ?? [];

  // Pre-select the weighting bucket that matches the kind, so a teacher who does
  // not think in buckets still lands in the right one.
  useEffect(() => {
    const match = components.find((c) => c.kind === kind);
    setComponentId(match?.id ?? '');
  }, [kind, components.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (classId && !classIds.includes(classId)) setClassIds([classId]);
  }, [classId]); // eslint-disable-line react-hooks/exhaustive-deps

  const termList = terms?.data ?? [];
  const classList = classes?.data ?? [];
  const staffList = useMemo(() => staff?.data ?? [], [staff]);

  const ready = termId && classId && subjectId && title.trim()
    && (kind !== 'exam' || examId)
    && (kind !== 'homework' || teacherPartnerId);

  async function onSubmit() {
    try {
      const res: any = await create.mutateAsync({
        kind,
        classId,
        subjectId,
        termId,
        title: title.trim(),
        maxScore: Number(maxScore) || 100,
        componentId: componentId || undefined,
        dueAt: dueAt || undefined,
        description: description || undefined,
        teacherPartnerId: teacherPartnerId || undefined,
        examId: kind === 'exam' ? examId : undefined,
        classIds: kind === 'exam' ? classIds : undefined,
      });
      notify.success(
        kind === 'exam'
          ? `Paper created for ${res?.created ?? 1} class(es).`
          : `"${title.trim()}" created.`,
      );
      onClose();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not create this assessment.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold">New assessment</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">What are you setting?</label>
            <div className="flex flex-wrap gap-1.5">
              {ASSESSMENT_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={[
                    'rounded-full border px-3 py-1.5 text-sm transition',
                    kind === k ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                  ].join(' ')}
                >
                  {KIND_LABEL[k] ?? k}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Picker label="Term" value={termId} onChange={setTermId} className=""
              options={termList.map((t) => ({ value: t.id, label: t.name }))} />
            <Picker label="Class" value={classId} onChange={setClassId} className=""
              options={classList.map((c) => ({ value: c.id, label: c.name }))} />
            <Picker label="Subject" value={subjectId} onChange={setSubjectId} className=""
              options={(subjects ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === 'exam' ? 'Mid-Term Examination' : kind === 'homework' ? 'Algebra exercise 3' : 'CAT 1'} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Out of</label>
              <Input inputMode="numeric" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {kind === 'homework' ? 'Due date' : 'Date'}
              </label>
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </div>
            <Picker
              label="Counts toward"
              value={componentId}
              onChange={setComponentId}
              placeholder="Not weighted"
              className=""
              options={components.map((c) => ({ value: c.id, label: `${c.name} · ${c.weight}%` }))}
            />
          </div>

          {/* ── the kind-specific tail ── */}
          {kind === 'exam' && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <Picker label="Which exam?" value={examId} onChange={setExamId} className=""
                options={(exams ?? []).map((e) => ({ value: e.id, label: e.name }))} />
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Which classes sit it? One paper is created per class.
                </label>
                <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                  {classList.map((c) => {
                    const on = classIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setClassIds((ids) => (on ? ids.filter((x) => x !== c.id) : [...ids, c.id]))}
                        className={[
                          'rounded-md border px-2 py-1 text-xs transition',
                          on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                        ].join(' ')}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {kind === 'homework' && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Set by</label>
                <select className={selectClass} value={teacherPartnerId} onChange={(e) => setTeacherPartnerId(e.target.value)}>
                  <option value="">Select a teacher…</option>
                  {staffList.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.partner?.name ?? s.employeeNo}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Instructions (optional)</label>
                <textarea
                  className="min-h-[70px] w-full rounded-md border bg-card p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!ready || create.isPending} onClick={onSubmit}>
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}
