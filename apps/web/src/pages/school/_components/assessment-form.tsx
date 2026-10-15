import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Users } from 'lucide-react';
import { ASSESSMENT_KINDS, KIND_LABEL, useAssessmentBoard, useCreateAssessmentUnified, useRubrics, useWorkspaceExams } from '@/features/school/api';
import { useCanonicalCourseOfferings, useOfferingRoster } from '@/features/school/course-offering-api';
import { useCaptureCourseAssessmentRoster } from '@/features/school/assessment-phase4-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { notify } from '@/lib/notify';
import { selectClass } from './exam-workflow';

/**
 * A field-level error, connected to its input by `aria-describedby` so a screen
 * reader announces it with the field rather than leaving it to be found.
 */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} role="alert" className="text-xs text-destructive">{message}</p>;
}

export interface CreatedAssessmentContext {
  assessmentId: string;
  termId: string;
  classId?: string;
  subjectId?: string;
  kind: string;
}

/**
 * New assessment — one screen.
 *
 * It used to be a three-step wizard whose last step refused to finish until the
 * teacher had found and frozen a roster by hand, and whose first step asked
 * again for the course even when the board was already filtered to one class
 * and subject. Both are things the system knows: the course comes from those
 * filters, and the frozen learner list is captured on save. What is left here is
 * only what a person must decide — what kind of work it is, what it is called,
 * what it is out of, when it is due, and whether it counts.
 *
 * Everything rarer than that lives behind "More options", so the common case is
 * four fields and one button.
 */
export function CreateAssessmentDialog({ termId, classId, subjectId, courseOfferingId, onClose, onCreated }: {
  termId?: string; classId?: string; subjectId?: string; courseOfferingId?: string;
  onClose: () => void; onCreated?: (created: CreatedAssessmentContext) => void;
}) {
  const { data: offerings = [], isLoading } = useCanonicalCourseOfferings({ termId: courseOfferingId ? undefined : termId });
  const choices = useMemo(() => offerings.filter((o) => ['PUBLISHED', 'ACTIVE'].includes(o.status)), [offerings]);
  const [offeringId, setOfferingId] = useState(courseOfferingId ?? '');
  const offering = choices.find((o) => o.id === offeringId);

  // The board already points at a class and a subject. Re-asking for the course
  // is the step teachers abandoned the form on, so it is answered for them
  // whenever the filters identify exactly one published course.
  useEffect(() => {
    if (offeringId || !choices.length) return;
    const exact = choices.filter((o) => (!classId || o.classId === classId) && (!subjectId || o.subjectId === subjectId));
    const pick = exact.length === 1 ? exact[0] : choices.length === 1 ? choices[0] : null;
    if (pick) setOfferingId(pick.id);
  }, [choices, offeringId, classId, subjectId]);

  const [kind, setKind] = useState('cat');
  const [title, setTitle] = useState('');
  const [maxScore, setMaxScore] = useState('100');
  const [description, setDescription] = useState('');
  const [openAt, setOpenAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [closeAt, setCloseAt] = useState('');
  const [componentId, setComponentId] = useState('');
  const [gradingMode, setGradingMode] = useState<'points' | 'rubric' | 'complete_incomplete'>('points');
  const [rubricId, setRubricId] = useState('');
  const [allowLate, setAllowLate] = useState(false);
  const [penalty, setPenalty] = useState('0');
  const [attempts, setAttempts] = useState('1');
  const [examId, setExamId] = useState('');

  const { data: board } = useAssessmentBoard({ termId: offering?.termId, classId: offering?.classId ?? undefined, subjectId: offering?.subjectId ?? undefined });
  const { data: courseRoster } = useOfferingRoster(offeringId || undefined);
  const { data: rubrics } = useRubrics();
  const { data: exams } = useWorkspaceExams(offering ? { termId: offering.termId } : {});
  const capture = useCaptureCourseAssessmentRoster();
  const create = useCreateAssessmentUnified();

  const learners = (courseRoster ?? []).filter((e: any) => e.status === 'ENROLLED').length;
  const validScore = Number.isFinite(Number(maxScore)) && Number(maxScore) > 0;

  /**
   * Errors keyed by field.
   *
   * The server also rejects an out-of-order date sequence, but it did so after
   * submission, as one toast, with nothing pointing at which of the three
   * fields was wrong — so the operator's only recourse was to guess and resubmit.
   */
  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    if (!validScore) out.maxScore = 'Enter a maximum score greater than zero.';
    if (kind === 'exam' && !examId) out.examId = 'Choose the exam event this paper belongs to.';
    if (kind !== 'exam' && gradingMode === 'rubric' && !rubricId) out.rubricId = 'Choose the rubric this work is marked against.';
    const t = (v: string) => (v ? new Date(v).getTime() : null);
    const [open, due, close] = [t(openAt), t(dueAt), t(closeAt)];
    if (open != null && due != null && due < open) out.dueAt = 'Due cannot be before the assessment opens.';
    if (due != null && close != null && close < due) out.closeAt = 'Closes cannot be before the due date.';
    if (open != null && close != null && close < open) out.closeAt = 'Closes cannot be before the assessment opens.';
    const penaltyN = Number(penalty);
    if (allowLate && (!Number.isFinite(penaltyN) || penaltyN < 0 || penaltyN > 100)) {
      out.penalty = 'A late penalty is a percentage between 0 and 100.';
    }
    const attemptsN = Number(attempts);
    if (!Number.isInteger(attemptsN) || attemptsN < 1 || attemptsN > 20) out.attempts = 'Allow between 1 and 20 attempts.';
    return out;
  }, [validScore, kind, examId, gradingMode, rubricId, openAt, dueAt, closeAt, allowLate, penalty, attempts]);

  const ready = !!offering && !!title.trim() && Object.keys(errors).length === 0;
  const components = (board?.policy?.components ?? []).filter((c) => c.kind === kind);
  const toDate = (value: string) => value ? new Date(value).toISOString() : undefined;
  const busy = create.isPending || capture.isPending;

  /**
   * Create, freezing the learner list as part of the same action.
   *
   * The server requires a frozen roster, because a mark must belong to the class
   * as it stood on the day — but which snapshot to use was never a decision the
   * teacher could usefully make, and a fresh capture is what they chose every
   * time. Capture also reconciles compulsory course membership from placements,
   * so a late admission is in rather than silently missing.
   */
  async function createAssessment() {
    if (!offering) return;
    try {
      const roster = await capture.mutateAsync(offering.id);
      const result: any = await create.mutateAsync({
        kind, courseOfferingId: offering.id, rosterId: roster.id, classId: offering.classId ?? undefined,
        subjectId: offering.subjectId ?? undefined, termId: offering.termId,
        title: title.trim(), maxScore: Number(maxScore), description: description || undefined, componentId: componentId || undefined,
        // Formative work never reaches a term result; an exam paper binds to the policy's exam component.
        contribution: componentId || kind === 'exam' ? 'summative' : 'formative',
        openAt: toDate(openAt), dueAt: toDate(dueAt), closeAt: toDate(closeAt),
        gradingMode: kind === 'exam' ? 'points' : gradingMode, rubricId: gradingMode === 'rubric' ? rubricId : undefined,
        allowLate, latePenaltyPercent: Number(penalty), maxAttempts: Number(attempts), examId: kind === 'exam' ? examId : undefined,
      });
      notify.success(`${title.trim()} created with ${roster.memberCount} learner(s). Review and publish it when ready.`);
      onCreated?.({
        assessmentId: result.assessment.id, termId: offering.termId,
        classId: offering.classId ?? undefined, subjectId: offering.subjectId ?? undefined, kind,
      });
      onClose();
    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not create this assessment'); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>New assessment</DialogTitle><DialogDescription>Name the work, say what it is out of, and create it. The learner list is frozen for you.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <label className="block space-y-1 text-sm"><span>Course</span><select className={selectClass} value={offeringId} onChange={(e) => { setOfferingId(e.target.value); setComponentId(''); }}><option value="">{isLoading ? 'Loading courses…' : 'Select a published course…'}</option>{choices.map((o) => <option key={o.id} value={o.id}>{o.name}{o.classId === classId && o.subjectId === subjectId ? ' · current filter' : ''}</option>)}</select></label>
      {!isLoading && !choices.length && <p className="rounded border p-3 text-sm text-muted-foreground">Publish a staffed course with an enrolled audience in Curriculum &amp; Courses before creating an assessment.</p>}
      {offering && <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{learners} learner(s) on this course · {offering.term?.name} · {offering.teachers.map((t) => t.teacher?.partner?.name).filter(Boolean).join(', ') || 'No named teacher'}</p>}
      {!!offering?.rosterDrift && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{offering.rosterDrift} learner(s) are placed in this class but not on the course roster. Creating this assessment brings the compulsory ones in; an elective needs them enrolled explicitly in Curriculum &amp; Courses.</p>}

      <fieldset><legend className="mb-2 text-sm">Kind</legend><div className="flex flex-wrap gap-2">{ASSESSMENT_KINDS.map((k) => <button type="button" key={k} aria-pressed={kind === k} className={`rounded-full border px-3 py-1.5 text-sm ${kind === k ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'}`} onClick={() => { setKind(k); setComponentId(''); }}>{KIND_LABEL[k]}</button>)}</div></fieldset>

      <label className="block space-y-1 text-sm"><span>Title</span><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Fractions — weekly learning check" /></label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm"><span>Out of</span><Input type="number" min="1" value={maxScore} aria-invalid={!!errors.maxScore} aria-describedby={errors.maxScore ? 'assessment-err-maxScore' : undefined} onChange={(e) => setMaxScore(e.target.value)} /><FieldError id="assessment-err-maxScore" message={errors.maxScore} /></label>
        <label className="space-y-1 text-sm"><span>Due</span><Input type="datetime-local" value={dueAt} aria-invalid={!!errors.dueAt} aria-describedby={errors.dueAt ? 'assessment-err-dueAt' : undefined} onChange={(e) => setDueAt(e.target.value)} /><FieldError id="assessment-err-dueAt" message={errors.dueAt} /></label>
        <label className="space-y-1 text-sm"><span>Counts toward</span><select className={selectClass} value={componentId} onChange={(e) => setComponentId(e.target.value)}><option value="">{kind === 'exam' ? 'The exam component (automatic)' : 'Nothing — practice only'}</option>{components.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.weight}%</option>)}</select></label>
      </div>

      {kind === 'exam' && <label className="block space-y-1 text-sm"><span>Exam event</span><select className={selectClass} value={examId} aria-invalid={!!errors.examId} aria-describedby={errors.examId ? 'assessment-err-examId' : undefined} onChange={(e) => setExamId(e.target.value)}><option value="">Select exam event…</option>{(exams ?? []).filter((e) => e.status !== 'closed' && !(e.papers ?? []).some((p) => p.classId === offering?.classId && p.subjectId === offering?.subjectId)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select><FieldError id="assessment-err-examId" message={errors.examId} /></label>}

      <details className="rounded border">
        <summary className="cursor-pointer px-3 py-2 text-sm">More options — instructions, marking method, open and close dates, late work</summary>
        <div className="space-y-4 border-t p-3">
          <label className="block space-y-1 text-sm"><span>Instructions / evidence requirements</span><textarea className="min-h-20 w-full rounded border bg-card p-2 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Explain what learners should submit or what the observer should record." /></label>
          {kind !== 'exam' && <>
            <label className="block space-y-1 text-sm"><span>{kind === 'observation' ? 'Observation checklist / marking method' : 'Marking method'}</span><select className={selectClass} value={gradingMode} onChange={(e) => setGradingMode(e.target.value as typeof gradingMode)}><option value="points">Points</option><option value="rubric">Rubric / observation checklist</option><option value="complete_incomplete">Complete / incomplete</option></select></label>
            {gradingMode === 'rubric' && <label className="block space-y-1 text-sm"><span>Versioned rubric</span><select className={selectClass} value={rubricId} aria-invalid={!!errors.rubricId} aria-describedby={errors.rubricId ? 'assessment-err-rubricId' : undefined} onChange={(e) => setRubricId(e.target.value)}><option value="">Select rubric…</option>{(rubrics?.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select><FieldError id="assessment-err-rubricId" message={errors.rubricId} /></label>}
          </>}
          <div className="grid gap-3 sm:grid-cols-2">{([['Opens', 'openAt', openAt, setOpenAt], ['Closes', 'closeAt', closeAt, setCloseAt]] as const).map(([label, key, value, setter]) => <label key={key} className="space-y-1 text-sm"><span>{label}</span><Input type="datetime-local" value={value} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `assessment-err-${key}` : undefined} onChange={(e) => setter(e.target.value)} /><FieldError id={`assessment-err-${key}`} message={errors[key]} /></label>)}</div>
          {kind !== 'exam' && <div className="flex flex-wrap items-end gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowLate} onChange={(e) => setAllowLate(e.target.checked)} />Allow late submissions</label><label className="space-y-1 text-sm"><span>Late penalty %</span><Input className="w-24" type="number" min="0" max="100" disabled={!allowLate} value={penalty} aria-invalid={!!errors.penalty} aria-describedby={errors.penalty ? 'assessment-err-penalty' : undefined} onChange={(e) => setPenalty(e.target.value)} /><FieldError id="assessment-err-penalty" message={errors.penalty} /></label><label className="space-y-1 text-sm"><span>Attempts</span><Input className="w-24" type="number" min="1" max="20" value={attempts} aria-invalid={!!errors.attempts} aria-describedby={errors.attempts ? 'assessment-err-attempts' : undefined} onChange={(e) => setAttempts(e.target.value)} /><FieldError id="assessment-err-attempts" message={errors.attempts} /></label></div>}
        </div>
      </details>

      <p className="text-xs text-muted-foreground">Creating freezes today’s learner list, so learners who later move class or withdraw stay in this assessment’s history. This creates a draft; publishing, submitting and releasing marks remain separate actions.</p>
    </div>
    <div className="flex justify-between border-t pt-4"><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button disabled={!ready || busy} onClick={() => void createAssessment()}><CheckCircle2 className="mr-2 h-4 w-4" />{busy ? 'Creating…' : 'Create assessment'}</Button></div>
  </DialogContent></Dialog>;
}
