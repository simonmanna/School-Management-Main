import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCanonicalCourseOfferings } from '@/features/school/course-offering-api';
import { useRosters, type BoardSheet } from '@/features/school/api';
import { useCaptureCourseAssessmentRoster } from '@/features/school/assessment-phase4-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { notify } from '@/lib/notify';

export function AssessmentContextRepair({ sheet, onSaved }: { sheet: BoardSheet; onSaved: () => void }) {
  const a = sheet.assessment;
  const { data: offerings = [] } = useCanonicalCourseOfferings();
  const { data: rosters } = useRosters();
  const [courseId, setCourseId] = useState(a.courseOfferingId ?? '');
  const [rosterId, setRosterId] = useState('');
  const [reason, setReason] = useState('');
  const capture = useCaptureCourseAssessmentRoster();
  const course = offerings.find((o) => o.id === courseId);
  const save = useMutation({ mutationFn: () => api.post(`/school/assessment-board/${a.id}/context`, { courseOfferingId: courseId, rosterId, reason, expectedVersion: a.version }),
    onSuccess: () => { notify.success('Historical context reconciled'); onSaved(); }, onError: (e: any) => notify.error(e.response?.data?.message ?? 'Could not reconcile') });
  return <section className="space-y-3 rounded-lg border border-amber-400 bg-amber-50/30 p-4"><h2 className="font-semibold">Reconcile historical assessment context</h2><p className="text-sm text-muted-foreground">Choose the original course and a complete frozen roster. Existing learner evidence is preserved; a roster excluding any recorded learner will be rejected.</p>
    <div className="grid gap-3 md:grid-cols-2"><select aria-label="Historical course" className="rounded border bg-card p-2 text-sm" value={courseId} onChange={(e) => { setCourseId(e.target.value); setRosterId(''); }}><option value="">Choose course…</option>{offerings.filter((o) => o.classId === a.class.id && o.subjectId === a.subject.id && ['PUBLISHED', 'ACTIVE'].includes(o.status)).map((o) => <option key={o.id} value={o.id}>{o.name} · {o.term?.name}</option>)}</select>
    <select aria-label="Historical frozen roster" className="rounded border bg-card p-2 text-sm" value={rosterId} onChange={(e) => setRosterId(e.target.value)}><option value="">Choose frozen roster…</option>{(rosters?.data ?? []).filter((r) => r.frozenAt && r.termId === course?.termId && (!r.classId || r.classId === course?.classId)).map((r) => <option key={r.id} value={r.id}>{r.name ?? r.id}</option>)}</select></div>
    <Button variant="outline" disabled={!courseId || capture.isPending} onClick={async () => { try { const r = await capture.mutateAsync(courseId); setRosterId(r.id); } catch (e: any) { notify.error(e.response?.data?.message ?? 'Capture failed'); } }}>Capture current official course enrollment</Button>
    <Input aria-label="Reconciliation reason" placeholder="Reason and evidence for this historical binding" value={reason} onChange={(e) => setReason(e.target.value)} />
    <Button disabled={!courseId || !rosterId || !reason.trim() || save.isPending} onClick={() => save.mutate()}>Confirm historical binding</Button>
  </section>;
}

export function AssessmentReconciliation() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['school', 'assessment-reconciliation'], queryFn: async () => (await api.get<{ total: number; reasons: Array<{ reason: string; _count: number }>; exceptions: Array<{ id: string; sourceEntity: string; sourceId: string; reason: string }> }>('/school/assessment-board/reconciliation')).data });
  const [sourceId, setSourceId] = useState(''); const [assessmentId, setAssessmentId] = useState(''); const [reason, setReason] = useState('');
  const reconcile = useMutation({ mutationFn: () => api.post(`/school/assessment-board/legacy-homework/${sourceId}/reconcile`, { assessmentId, reason }), onSuccess: () => { notify.success('Legacy evidence reconciled'); qc.invalidateQueries({ queryKey: ['school', 'assessment-reconciliation'] }); }, onError: (e: any) => notify.error(e.response?.data?.message ?? 'Reconciliation failed') });
  return <div className="space-y-4"><h2 className="text-lg font-semibold">Migration reconciliation</h2><p className="text-sm text-muted-foreground">Legacy records are retained. Resolve course/roster exceptions in the assessment workspace. Map orphaned homework only after verifying a published target and every learner on its roster.</p>{isLoading ? <p>Loading exceptions…</p> : isError ? <p role="alert">Could not load reconciliation. Assessment-management permission is required.</p> : <><p>{data?.total ?? 0} unresolved exceptions · displaying up to 200</p><div className="max-h-96 overflow-auto rounded border"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Record</th><th>Exception</th><th>Action</th></tr></thead><tbody>{data?.exceptions.map((e) => <tr key={e.id} className="border-t"><td className="p-2">{e.sourceEntity}<p className="font-mono text-xs">{e.sourceId}</p></td><td>{e.reason.replaceAll('_', ' ')}</td><td>{e.sourceEntity === 'Assessment' ? <Link className="underline" to={`/school/assessments/${e.sourceId}/mark`}>Review context</Link> : e.sourceEntity === 'HomeworkAssignment' ? <Button size="sm" variant="outline" onClick={() => setSourceId(e.sourceId)}>Map homework</Button> : 'Resolve its homework mapping'}</td></tr>)}</tbody></table></div></>}
    <div className="grid gap-3 rounded border p-4"><h3 className="font-medium">Reconcile legacy homework evidence</h3><Input aria-label="Legacy homework ID" placeholder="Legacy homework ID" value={sourceId} onChange={(e) => setSourceId(e.target.value)} /><Input aria-label="Target assessment ID" placeholder="Verified published target assessment ID" value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)} /><Input aria-label="Mapping reason" placeholder="Mapping reason and supporting evidence" value={reason} onChange={(e) => setReason(e.target.value)} /><Button disabled={!sourceId || !assessmentId || !reason.trim() || reconcile.isPending} onClick={() => reconcile.mutate()}>Validate and map evidence</Button></div>
  </div>;
}
