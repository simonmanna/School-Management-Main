import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Lock, Send } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { useBoardSheet, useSubmitAssessmentMarks, KIND_LABEL } from '@/features/school/api';
import { useAssessmentLifecycle } from '@/features/school/assessment-phase4-api';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';
import { ProductionMarkbook } from './_components/production-markbook';
import { AssignmentInbox, LearnerEvidenceDialog } from './_components/assignment-inbox';
import { AssessmentContextRepair } from './_components/assessment-reconciliation';

export function SchoolAssessmentMarkPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const { data: sheet, isLoading, isError, refetch } = useBoardSheet(assessmentId);
  const submit = useSubmitAssessmentMarks();
  const lifecycle = useAssessmentLifecycle();
  const permissions = useAuthStore((s) => s.permissions);
  const canManage = permissions.some((p) => ['*', PERMISSIONS.school.manageAssessments, PERMISSIONS.school.ownGrades, PERMISSIONS.school.enterGrades].includes(p));
  const canRelease = permissions.some((p) => ['*', PERMISSIONS.school.manageAssessments, PERMISSIONS.school.approveGrades].includes(p));
  const canReconcile = permissions.includes('*') || permissions.includes(PERMISSIONS.school.manageAssessments);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  if (isLoading) return <p className="py-10 text-center text-sm text-muted-foreground">Loading assessment workspace…</p>;
  if (isError) return <div role="alert" className="space-y-3 py-10 text-center"><p>Could not load this assessment. Your local draft is still preserved.</p><Button variant="outline" onClick={() => void refetch()}>Retry</Button></div>;
  if (!sheet) return <p className="py-10 text-center">Assessment not found.</p>;
  const a = sheet.assessment;
  async function action(name: string) {
    try { await lifecycle.mutateAsync({ id: a.id, action: name, expectedVersion: a.version }); notify.success(`Assessment ${name.replaceAll('_', ' ')} action completed`); void refetch(); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not complete this action'); }
  }
  async function onSubmit() {
    try { const result: any = await submit.mutateAsync(a.id); notify.success(`${result.updated} learner outcome(s) sent for approval`); void refetch(); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not submit these marks'); }
  }
  return <div className="space-y-4">
    <Link to={`/school/assessments${a.courseOfferingId ? `?courseOfferingId=${a.courseOfferingId}` : ''}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Assessment Board</Link>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-2 flex flex-wrap gap-2"><Badge variant="outline">{KIND_LABEL[a.kind] ?? a.kind}</Badge><Badge variant="secondary">{a.status}</Badge>{a.rosterFrozen && <Badge variant="outline"><Lock className="mr-1 h-3 w-3" />Frozen roster · {sheet.total} learners</Badge>}{sheet.approvalStatus === 'approved' && <Badge variant="outline" className="text-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" />Approved</Badge>}</div><h1 className="text-2xl font-semibold">{a.title}</h1><p className="text-sm text-muted-foreground">{a.courseName ?? `${a.subject.name} · ${a.class.name}`} · {a.maxScore} points{a.dueAt ? ` · due ${new Date(a.dueAt).toLocaleString()}` : ''}</p></div>
    {(canManage || canRelease) && <div className="flex flex-wrap gap-2">{canManage && ['draft', 'scheduled'].includes(a.status) && <Button disabled={lifecycle.isPending || !a.rosterFrozen} onClick={() => void action('publish')}><Send className="mr-2 h-4 w-4" />Publish assessment</Button>}{canManage && a.status === 'published' && <Button variant="outline" disabled={lifecycle.isPending} onClick={() => void action('open')}>Open submissions</Button>}{canManage && ['published', 'open'].includes(a.status) && <Button variant="outline" disabled={lifecycle.isPending} onClick={() => void action('close')}>Close submissions</Button>}{canRelease && sheet.approvalStatus === 'approved' && <><Button variant="outline" disabled={lifecycle.isPending || !!a.feedbackReleaseAt} onClick={() => void action('release_feedback')}>{a.feedbackReleaseAt ? 'Feedback released' : 'Release feedback'}</Button><Button variant="outline" disabled={lifecycle.isPending || !!a.marksReleaseAt} onClick={() => void action('release_marks')}>{a.marksReleaseAt ? 'Marks released' : 'Release marks'}</Button></>}</div>}</div>
    <p className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">{a.component ? `Counts toward ${a.component.name} (${a.component.weight}%).` : 'Formative assessment — not attached to a term-result weighting component.'} Feedback: {a.feedbackReleaseAt ? 'released' : 'hidden'} · Marks: {a.marksReleaseAt ? 'released' : 'hidden'}.</p>
    {canReconcile && (!a.courseOfferingId || !a.rosterId) && <AssessmentContextRepair sheet={sheet} onSaved={() => void refetch()} />}
    <Tabs defaultValue="markbook"><TabsList><TabsTrigger value="markbook">Markbook</TabsTrigger>{a.assignmentId && <TabsTrigger value="inbox">Submissions & rubric</TabsTrigger>}</TabsList><TabsContent value="markbook"><Card><CardContent className="p-4"><ProductionMarkbook key={a.id} sheet={sheet} onSaved={() => void refetch()} onSubmit={onSubmit} submitting={submit.isPending} onEvidence={setEvidenceId} /></CardContent></Card></TabsContent>{a.assignmentId && <TabsContent value="inbox"><AssignmentInbox sheet={sheet} onSaved={() => void refetch()} /></TabsContent>}</Tabs>
    {evidenceId && <LearnerEvidenceDialog assessmentId={a.id} studentId={evidenceId} name={sheet.students.find((s) => s.studentProfileId === evidenceId)?.name ?? 'Learner'} onClose={() => setEvidenceId(null)} />}
  </div>;
}
