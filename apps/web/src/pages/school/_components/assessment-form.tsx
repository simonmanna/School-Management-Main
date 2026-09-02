import { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ASSESSMENT_KINDS, KIND_LABEL, useAssessmentBoard, useCreateAssessmentUnified, useRosters, useRosterMembers, useRubrics, useWorkspaceExams } from '@/features/school/api';
import { useCanonicalCourseOfferings } from '@/features/school/course-offering-api';
import { useCaptureCourseAssessmentRoster } from '@/features/school/assessment-phase4-api';
import { useCourseCoverage } from '@/features/school/teaching-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { notify } from '@/lib/notify';
import { selectClass } from './exam-workflow';

/** Course → delivery → frozen audience. The same wizard for every assessment kind. */
export function CreateAssessmentDialog({ termId, classId, subjectId, courseOfferingId, onClose }: {
  termId?: string; classId?: string; subjectId?: string; courseOfferingId?: string; onClose: () => void;
}) {
  const navigate = useNavigate();
  const { data: offerings = [], isLoading } = useCanonicalCourseOfferings({ termId: courseOfferingId ? undefined : termId });
  const choices = useMemo(() => offerings.filter((o) => ['PUBLISHED', 'ACTIVE'].includes(o.status)), [offerings]);
  const [offeringId, setOfferingId] = useState(courseOfferingId ?? '');
  const offering = choices.find((o) => o.id === offeringId);
  const [step, setStep] = useState(0);
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
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [rosterId, setRosterId] = useState('');
  const [capturedCount, setCapturedCount] = useState<number | null>(null);
  const { data: board } = useAssessmentBoard({ termId: offering?.termId, classId: offering?.classId ?? undefined, subjectId: offering?.subjectId ?? undefined });
  const { data: coverage } = useCourseCoverage(offeringId);
  const { data: rosters } = useRosters();
  const { data: members } = useRosterMembers(rosterId || undefined);
  const { data: rubrics } = useRubrics();
  const { data: exams } = useWorkspaceExams(offering ? { termId: offering.termId } : {});
  const capture = useCaptureCourseAssessmentRoster();
  const create = useCreateAssessmentUnified();
  const rosterChoices = (rosters?.data ?? []).filter((r) => r.frozenAt && r.termId === offering?.termId && (!r.classId || r.classId === offering?.classId) && (!r.subjectId || r.subjectId === offering?.subjectId));
  const count = members?.length ?? capturedCount;
  const validScore = Number.isFinite(Number(maxScore)) && Number(maxScore) > 0;
  const ready = !!offering && !!title.trim() && validScore && (kind !== 'exam' || !!examId) && (gradingMode !== 'rubric' || !!rubricId);
  const components = (board?.policy?.components ?? []).filter((c) => c.kind === kind);
  const selectedComponent = components.find((c) => c.id === componentId);
  const toDate = (value: string) => value ? new Date(value).toISOString() : undefined;

  async function captureRoster() {
    try { const r = await capture.mutateAsync(offeringId); setRosterId(r.id); setCapturedCount(r.memberCount); notify.success(`Frozen snapshot captured: ${r.memberCount} learners`); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not capture the course roster'); }
  }
  async function createDraft() {
    if (!offering) return;
    try {
      const result: any = await create.mutateAsync({
        kind, courseOfferingId: offering.id, rosterId, classId: offering.classId ?? undefined, subjectId: offering.subjectId ?? undefined, termId: offering.termId,
        title: title.trim(), maxScore: Number(maxScore), description: description || undefined, componentId: componentId || undefined,
        openAt: toDate(openAt), dueAt: toDate(dueAt), closeAt: toDate(closeAt), learningOutcomeIds: outcomes,
        gradingMode: kind === 'exam' ? 'points' : gradingMode, rubricId: gradingMode === 'rubric' ? rubricId : undefined,
        allowLate, latePenaltyPercent: Number(penalty), maxAttempts: Number(attempts), examId: kind === 'exam' ? examId : undefined,
      });
      notify.success('Assessment draft created. Review and publish it when ready.'); onClose();
      navigate(`/school/assessments/${result.assessment.id}/mark`);
    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not create this assessment'); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !create.isPending) onClose(); }}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>New assessment</DialogTitle><DialogDescription>Set work in its teaching context, define how it is assessed, then confirm the frozen learner list.</DialogDescription></DialogHeader>
    <ol className="grid grid-cols-3 gap-2 text-sm">{['Course & purpose', 'Delivery & scoring', 'Audience & review'].map((label, i) => <li key={label} className={`rounded border px-3 py-2 ${step === i ? 'border-primary bg-primary/5 font-medium' : 'text-muted-foreground'}`}><span className="mr-2">{i < step ? '✓' : i + 1}</span>{label}</li>)}</ol>
    {step === 0 && <div className="space-y-4">
      <label className="block space-y-1 text-sm"><span>Course offering</span><select className={selectClass} value={offeringId} onChange={(e) => { setOfferingId(e.target.value); setRosterId(''); setOutcomes([]); setComponentId(''); }}><option value="">{isLoading ? 'Loading courses…' : 'Select a published course…'}</option>{choices.map((o) => <option key={o.id} value={o.id}>{o.name}{o.classId === classId && o.subjectId === subjectId ? ' · current context' : ''}</option>)}</select></label>
      {!isLoading && !choices.length && <p className="rounded border p-3 text-sm text-muted-foreground">Publish a staffed course with an enrolled audience in Curriculum & Courses before creating an assessment.</p>}
      {offering && <p className="text-xs text-muted-foreground">{offering.programme?.name} · {offering.term?.name} · {offering.subject?.name} · {offering.teachers.map((t) => t.teacher?.partner?.name).filter(Boolean).join(', ')}</p>}
      <fieldset><legend className="mb-2 text-sm">Assessment kind</legend><div className="flex flex-wrap gap-2">{ASSESSMENT_KINDS.map((k) => <button type="button" key={k} aria-pressed={kind === k} className={`rounded-full border px-3 py-1.5 text-sm ${kind === k ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'}`} onClick={() => { setKind(k); setComponentId(''); }}>{KIND_LABEL[k]}</button>)}</div></fieldset>
      <label className="block space-y-1 text-sm"><span>Title</span><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Fractions — weekly learning check" /></label>
      {!!coverage?.outcomes.length && <fieldset className="space-y-2"><legend className="text-sm">Curriculum outcomes (optional)</legend><div className="max-h-36 space-y-2 overflow-auto rounded border p-3">{coverage.outcomes.map((o) => <label key={o.id} className="flex gap-2 text-sm"><input type="checkbox" checked={outcomes.includes(o.id)} onChange={(e) => setOutcomes((ids) => e.target.checked ? [...ids, o.id] : ids.filter((id) => id !== o.id))} />{o.title}</label>)}</div></fieldset>}
    </div>}
    {step === 1 && <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm"><span>Maximum score</span><Input type="number" min="1" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} /></label><label className="space-y-1 text-sm"><span>Counts toward</span><select className={selectClass} value={componentId} onChange={(e) => setComponentId(e.target.value)}><option value="">Formative — not weighted in results</option>{components.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.weight}%</option>)}</select></label></div>
      {kind === 'exam' ? <label className="block space-y-1 text-sm"><span>Exam event</span><select className={selectClass} value={examId} onChange={(e) => setExamId(e.target.value)}><option value="">Select exam event…</option>{(exams ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label> : <>
        <label className="block space-y-1 text-sm"><span>{kind === 'observation' ? 'Observation checklist / marking method' : 'Marking method'}</span><select className={selectClass} value={gradingMode} onChange={(e) => setGradingMode(e.target.value as typeof gradingMode)}><option value="points">Points</option><option value="rubric">Rubric / observation checklist</option><option value="complete_incomplete">Complete / incomplete</option></select></label>
        {gradingMode === 'rubric' && <label className="block space-y-1 text-sm"><span>Versioned rubric</span><select className={selectClass} value={rubricId} onChange={(e) => setRubricId(e.target.value)}><option value="">Select rubric…</option>{(rubrics?.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
      </>}
      <label className="block space-y-1 text-sm"><span>Instructions / evidence requirements</span><textarea className="min-h-24 w-full rounded border bg-card p-2 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Explain what learners should submit or what the observer should record." /></label>
      <div className="grid gap-3 sm:grid-cols-3">{[['Opens', openAt, setOpenAt], ['Due', dueAt, setDueAt], ['Closes', closeAt, setCloseAt]].map(([label, value, setter]) => <label key={label as string} className="space-y-1 text-sm"><span>{label as string}</span><Input type="datetime-local" value={value as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)} /></label>)}</div>
      {kind !== 'exam' && <div className="flex flex-wrap items-end gap-4 rounded border p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowLate} onChange={(e) => setAllowLate(e.target.checked)} />Allow late submissions</label><label className="space-y-1 text-sm"><span>Late penalty %</span><Input className="w-24" type="number" min="0" max="100" disabled={!allowLate} value={penalty} onChange={(e) => setPenalty(e.target.value)} /></label><label className="space-y-1 text-sm"><span>Attempts</span><Input className="w-24" type="number" min="1" max="20" value={attempts} onChange={(e) => setAttempts(e.target.value)} /></label></div>}
    </div>}
    {step === 2 && <div className="space-y-4">
      <div className="rounded-lg border bg-muted/20 p-4"><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{offering?.name} · {KIND_LABEL[kind]} · {maxScore} points</p><p className="mt-2 text-xs text-muted-foreground">{selectedComponent ? `${selectedComponent.name} — ${selectedComponent.weight}% component` : 'Formative assessment — no term-result weighting'} · {outcomes.length} curriculum outcome(s)</p></div>
      <label className="block space-y-1 text-sm"><span>Frozen assessment roster</span><select className={selectClass} value={rosterId} onChange={(e) => { setRosterId(e.target.value); setCapturedCount(null); }}><option value="">Choose a frozen snapshot…</option>{rosterChoices.map((r) => <option key={r.id} value={r.id}>{r.name ?? r.id}</option>)}</select></label>
      <Button variant="outline" disabled={capture.isPending} onClick={() => void captureRoster()}><ClipboardList className="mr-2 h-4 w-4" />{capture.isPending ? 'Capturing…' : 'Capture & freeze current course roster'}</Button>
      {rosterId && <p className="flex items-center gap-2 text-sm text-emerald-700"><Lock className="h-4 w-4" />{count ?? 'Loading'} learner(s) in the frozen snapshot</p>}
      <p className="text-sm text-muted-foreground">Learners who later move class or withdraw remain in this assessment’s history. This creates a draft; publication, submission and release are separate, explicit actions.</p>
    </div>}
    <div className="flex justify-between border-t pt-4"><Button variant="ghost" onClick={() => step ? setStep(step - 1) : onClose()} disabled={create.isPending}>{step ? 'Back' : 'Cancel'}</Button>{step < 2 ? <Button disabled={step === 0 ? !offering || !title.trim() : !ready} onClick={() => setStep(step + 1)}>Continue</Button> : <Button disabled={!ready || !rosterId || create.isPending} onClick={() => void createDraft()}><CheckCircle2 className="mr-2 h-4 w-4" />{create.isPending ? 'Creating…' : 'Create assessment draft'}</Button>}</div>
  </DialogContent></Dialog>;
}
