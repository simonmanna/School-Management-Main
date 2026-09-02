import { useEffect, useState } from 'react';
import { CheckCircle2, Inbox, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAssessmentEvidence, useAssessmentInbox, useRecordAssessmentWork } from '@/features/school/assessment-phase4-api';
import { useGradeAssignment, type BoardSheet } from '@/features/school/api';
import { notify } from '@/lib/notify';
import { FileList } from '@/features/school/lms/file-upload';
import { useAuthStore } from '@/stores/auth.store';

export function AssignmentInbox({ sheet, onSaved }: { sheet: BoardSheet; onSaved: () => void }) {
  const { data, isLoading, isError, refetch } = useAssessmentInbox(sheet.assessment.id);
  const grade = useGradeAssignment();
  const submit = useRecordAssessmentWork();
  const [studentId, setStudentId] = useState('');
  const [score, setScore] = useState('');
  const [complete, setComplete] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [content, setContent] = useState('');
  const [rubricScores, setRubricScores] = useState<Record<string, string>>({});
  const permissions = useAuthStore((s) => s.permissions);
  const canEnter = permissions.some((p) => ['*', 'school:grades:write', 'school:grades:own', 'school:assignments:grade'].includes(p));
  const student = sheet.students.find((s) => s.studentProfileId === studentId);
  const { data: evidence } = useAssessmentEvidence(sheet.assessment.id, studentId || undefined);
  const selectedSubmissions = data?.submissions.filter((s) => s.studentAssessmentId === student?.studentAssessmentId) ?? [];
  const locked = !canEnter || !sheet.assessment.rosterFrozen || sheet.assessment.locked || ['draft', 'scheduled', 'archived'].includes(sheet.assessment.status) || ['submitted', 'approved'].includes(student?.approvalStatus ?? '');
  useEffect(() => {
    setScore(student?.marks == null ? '' : String(student.marks)); setFeedback(student?.comment ?? '');
    setComplete(student?.marks === sheet.assessment.maxScore); setContent(''); setRubricScores({});
  }, [studentId, student?.version]);
  useEffect(() => { if (evidence?.rubricScores) setRubricScores(Object.fromEntries(evidence.rubricScores.map((r: any) => [r.criterionId, String(r.score)]))); }, [evidence]);
  async function saveGrade() {
    if (!data?.assignment || !student) return;
    try {
      const criteria = data.rubric?.criteria ?? [];
      if (data.assignment.gradingMode === 'rubric' && criteria.some((c) => rubricScores[c.id] == null || rubricScores[c.id] === '')) { notify.error('Score each rubric criterion before saving'); return; }
      await grade.mutateAsync({ assignmentId: data.assignment.id, studentProfileId: studentId, expectedVersion: student.version, feedback,
        rawScore: data.assignment.gradingMode === 'points' ? Number(score) : undefined, complete,
        rubricScores: data.assignment.gradingMode === 'rubric' ? criteria.map((c) => ({ criterionId: c.id, score: Number(rubricScores[c.id]) })) : undefined,
      });
      notify.success('Draft grade saved. Submit the completed markbook separately.'); onSaved(); void refetch();
    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not save this grade'); }
  }
  async function recordSubmission() {
    if (!data?.assignment) return;
    try { await submit.mutateAsync({ assignmentId: data.assignment.id, studentProfileId: studentId, content: content || 'Work received on paper / observed in class' }); notify.success('Submission recorded'); onSaved(); void refetch(); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not record this submission'); }
  }
  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading submission inbox…</p>;
  if (isError) return <p role="alert" className="p-6 text-sm">Could not load submissions. <button className="underline" onClick={() => void refetch()}>Retry</button></p>;
  if (!data?.assignment) return <p className="p-6 text-sm text-muted-foreground">This assessment has no assignment delivery record. Exam marks are entered in the markbook.</p>;
  return <div className="space-y-4">
    <div className="rounded-lg border bg-muted/20 p-4"><h2 className="flex items-center gap-2 font-medium"><Inbox className="h-4 w-4" /> Submission inbox & evidence</h2><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{data.assignment.instructions || 'Record handed-in work or observed evidence, then save the draft grade.'}</p><p className="mt-2 text-xs text-muted-foreground">Up to {data.assignment.maxAttempts} attempt(s) · {data.assignment.allowLate ? `Late work allowed (${data.assignment.latePenaltyPercent}% penalty)` : 'Late work not allowed'}{data.rubric && ` · ${data.rubric.name} v${data.rubric.version}`}</p></div>
    <div className="grid gap-4 lg:grid-cols-[minmax(230px,1fr)_2fr]"><div className="max-h-[65vh] space-y-1 overflow-auto rounded-lg border p-2">{sheet.students.map((s) => {
      const submissions = data.submissions.filter((r) => r.studentAssessmentId === s.studentAssessmentId);
      return <button key={s.studentProfileId} onClick={() => setStudentId(s.studentProfileId)} className={`flex w-full items-center justify-between gap-2 rounded p-3 text-left text-sm ${studentId === s.studentProfileId ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-accent'}`}><span>{s.name}<span className="block text-xs text-muted-foreground">{submissions.length ? `${submissions.length} attempt(s)` : 'No submission'} · {s.approvalStatus}</span></span>{submissions[0]?.isLate && <Badge variant="outline">Late</Badge>}{s.marks != null && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}</button>;
    })}</div><div className="space-y-4 rounded-lg border p-4">{!student ? <p className="py-12 text-center text-sm text-muted-foreground">Select a learner to inspect their work and mark it.</p> : <>
      <h3 className="font-medium">{student.name}</h3>
      {selectedSubmissions.map((s) => <article key={s.id} className="space-y-2 rounded border bg-muted/20 p-3 text-sm"><div className="flex justify-between"><strong>Attempt {s.attemptNo}</strong><span className="text-xs text-muted-foreground">{s.submittedAt ? new Date(s.submittedAt).toLocaleString() : 'Not submitted'}{s.isLate ? ' · Late' : ''}</span></div><p className="whitespace-pre-wrap">{s.content || 'No text content'}</p>{!!s.attachments?.length && <FileList files={s.attachments.filter((f: any) => f && typeof f === 'object' && f.id).map((f: any) => ({ id: f.id, filename: f.filename ?? f.name ?? 'Attachment', contentType: f.contentType ?? '', byteSize: f.byteSize ?? 0 }))} empty="Legacy attachment references retained; resolve their file mappings before download." />}</article>)}
      {selectedSubmissions.length < data.assignment.maxAttempts && !locked && <div className="space-y-2 rounded border border-dashed p-3"><label className="block text-sm">Paper submission / observation note<textarea className="mt-1 min-h-20 w-full rounded border bg-card p-2" value={content} onChange={(e) => setContent(e.target.value)} /></label><Button variant="outline" disabled={submit.isPending} onClick={() => void recordSubmission()}>{selectedSubmissions.length ? 'Record another attempt' : 'Record work received'}</Button></div>}
      <fieldset disabled={locked || grade.isPending} className="space-y-3"><legend className="mb-2 text-sm font-medium">{data.assignment.gradingMode === 'rubric' ? 'Rubric / observation checklist' : 'Draft grade'}</legend>
        {data.assignment.gradingMode === 'rubric' ? data.rubric?.criteria.map((c) => <label key={c.id} className="flex items-center justify-between gap-3 rounded border p-3 text-sm"><span>{c.name}<span className="block text-xs text-muted-foreground">{c.description} · weight {c.weight} · max {c.maxScore}</span></span>{c.levels.length ? <select className="rounded border bg-card px-2 py-2" value={rubricScores[c.id] ?? ''} onChange={(e) => setRubricScores((old) => ({ ...old, [c.id]: e.target.value }))}><option value="">Not observed / choose level</option>{c.levels.map((l) => <option key={l.id} value={String(l.score)}>{l.label} ({l.score})</option>)}</select> : <Input className="w-24" type="number" min="0" max={c.maxScore} value={rubricScores[c.id] ?? ''} onChange={(e) => setRubricScores((old) => ({ ...old, [c.id]: e.target.value }))} />}</label>) : data.assignment.gradingMode === 'complete_incomplete' ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} />Complete</label> : <label className="block text-sm">Score / {sheet.assessment.maxScore}<Input type="number" min="0" max={sheet.assessment.maxScore} value={score} onChange={(e) => setScore(e.target.value)} /></label>}
        <label className="block text-sm">Feedback / observation evidence<textarea className="mt-1 min-h-24 w-full rounded border bg-card p-2" maxLength={4000} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></label>
      </fieldset><Button disabled={locked || grade.isPending || (data.assignment.gradingMode === 'points' && score.trim() === '')} onClick={() => void saveGrade()}><Save className="mr-2 h-4 w-4" />Save draft grade</Button><p className="text-xs text-muted-foreground">Feedback and marks remain hidden until approved and explicitly released.</p>
    </>}</div></div>
  </div>;
}

export function LearnerEvidenceDialog({ assessmentId, studentId, name, onClose }: { assessmentId: string; studentId: string; name: string; onClose: () => void }) {
  const { data, isLoading, isError } = useAssessmentEvidence(assessmentId, studentId);
  const events = data ? [
    ...(data.approvalHistory ?? []).map((h: any) => ({ id: h.id, at: h.createdAt, title: `Approval workflow · ${h.newValues?.action ?? h.action}`, detail: h.newValues?.reason ?? '' })),
    ...(data.history ?? []).map((h: any) => ({ id: h.id, at: h.changedAt, title: `Mark ${h.oldScore ?? 'blank'} → ${h.newScore ?? 'blank'}`, detail: `Source: ${h.source}` })),
    ...(data.assignmentSubmissions ?? []).map((s: any) => ({ id: s.id, at: s.submittedAt, title: `Submission · attempt ${s.attemptNo}${s.isLate ? ' (late)' : ''}`, detail: s.content })),
    ...(data.submittedAt ? [{ id: 'submitted', at: data.submittedAt, title: 'Marks submitted for approval', detail: '' }] : []),
    ...(data.approvedAt ? [{ id: 'approved', at: data.approvedAt, title: 'Marks approved', detail: '' }] : []),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))) : [];
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[85vh] max-w-2xl overflow-auto"><DialogHeader><DialogTitle>{name} — evidence timeline</DialogTitle><DialogDescription>Submission attempts, mark revisions and approval evidence from the canonical learner record.</DialogDescription></DialogHeader>{isLoading ? <p>Loading evidence…</p> : isError ? <p role="alert">Evidence is not available for this learner yet.</p> : <><p className="rounded border p-3 text-sm">Current: {data?.effectiveScore ?? 'No score'} / {data?.maxScore} · {data?.participation} · {data?.approvalStatus}</p>{data?.feedback && <p className="whitespace-pre-wrap rounded bg-muted/30 p-3 text-sm">{data.feedback}</p>}<ol className="space-y-3 border-l pl-4">{events.map((event) => <li key={event.id} className="space-y-1"><p className="text-xs text-muted-foreground">{event.at ? new Date(event.at).toLocaleString() : 'Undated'}</p><p className="text-sm font-medium">{event.title}</p>{event.detail && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{event.detail}</p>}</li>)}</ol>{!events.length && <p className="text-sm text-muted-foreground">No evidence has been recorded yet.</p>}</>}</DialogContent></Dialog>;
}
