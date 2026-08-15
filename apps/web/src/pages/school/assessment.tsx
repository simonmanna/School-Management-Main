import { useEffect, useState } from 'react';
import { Plus, Save, Send, ShieldCheck } from 'lucide-react';
import {
  useTerms, useClasses, useSubjects, useClassRoster,
  useAssessmentPolicies, useCreateAssessmentPolicy,
  useResolvePolicy, useAssessmentComponents, useValidateComponents, useCreateAssessmentComponent,
  useAssessments, useCreateAssessment, useAssessmentTransition,
  useMarksByAssessment, useRecordMark, useSetParticipation, useSubmitMarks, useMarkingApproval,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolAssessmentPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Assessment & Marks</h1>
        <p className="text-sm text-muted-foreground">A0→A1: policies, components, assessment instances, and segregation-of-duties marking.</p>
      </div>
      <Tabs defaultValue="policy">
        <TabsList>
          <TabsTrigger value="policy">Policy & weights</TabsTrigger>
          <TabsTrigger value="assess">Assessments</TabsTrigger>
          <TabsTrigger value="mark">Marks (SoD)</TabsTrigger>
        </TabsList>
        <TabsContent value="policy" className="pt-4"><PolicyTab /></TabsContent>
        <TabsContent value="assess" className="pt-4"><AssessTab/></TabsContent>
        <TabsContent value="mark" className="pt-4"><MarkTab/></TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Policy & components ── */
function PolicyTab() {
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const { data: subjects } = useSubjects();
  const { data: policies } = useAssessmentPolicies();
  const createPolicy = useCreateAssessmentPolicy();
  const [name, setName] = useState('');
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const policy = useResolvePolicy(subjectId || undefined, classId || undefined, undefined, termId || undefined);
  const components = useAssessmentComponents(policy.data?.id);
  const validate = useValidateComponents(policy.data?.id);
  const createComp = useCreateAssessmentComponent();
  const [cName, setCName] = useState('');
  const [cKind, setCKind] = useState('cat');
  const [cWeight, setCWeight] = useState('');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Policies</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(policies?.data ?? []).map((p) => (
            <div key={p.id} className="rounded border p-2 text-sm">{p.name}
              {p.termId && <span className="ml-2 text-muted-foreground">term {p.termId.slice(0,6)}</span>}
              {p.isActive ? <Badge className="ml-2">active</Badge> : <Badge variant="secondary" className="ml-2">inactive</Badge>}
            </div>
          ))}
          <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">Term…</option>{(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Class…</option>{(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className={sel} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">Subject…</option>{(subjects?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <Input placeholder="Policy name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" disabled={!name || createPolicy.isPending} onClick={async () => { await createPolicy.mutateAsync({ name, termId: termId||undefined, classId: classId||undefined, subjectId: subjectId||undefined }); setName(''); notify.success('Policy created'); }}> <Plus className="h-4 w-4" /> Add policy</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Components (weights must sum to 100)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {policy.data && (
            <>
              <p className="text-xs text-muted-foreground">Resolved policy: <span className="font-mono">{policy.data.id}</span></p>
              {(components.data ?? []).map((c) => <div key={c.id} className="flex items-center justify-between rounded border p-2 text-sm"><span>{c.name} · {c.kind}</span><Badge>w {Number(c.weight)}</Badge></div>)}
              {validate.data && <Badge variant={validate.data.valid ? 'default' : 'destructive'}>{validate.data.valid ? `weights ✓ ${validate.data.totalWeight}` : `weights ${validate.data.totalWeight} ✗ ${validate.data.message ?? ''}`}</Badge>}
              <div className="flex gap-2">
                <Input placeholder="Component name" value={cName} onChange={(e) => setCName(e.target.value)} />
                <select className={sel + ' w-32'} value={cKind} onChange={(e) => setCKind(e.target.value)}>
                  {['cat','exam','homework','classwork','practical','project','oral','attendance'].map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <Input type="number" placeholder="weight" className="w-20" value={cWeight} onChange={(e) => setCWeight(e.target.value)} />
              </div>
              <Button size="sm" disabled={!cName || !cWeight || createComp.isPending} onClick={async () => { await createComp.mutateAsync({ policyId: policy.data!.id, name: cName, kind: cKind, weight: Number(cWeight) }); setCName(''); setCWeight(''); notify.success('Component added'); }}> <Plus className="h-4 w-4" /> Add component</Button>
            </>
          )}
          {!policy.data && <p className="text-sm text-muted-foreground">Pick a term/class/subject to resolve (or create) a policy first.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Assessment instances ── */
function AssessTab() {
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const { data: subjects } = useSubjects();
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const { data: assessments } = useAssessments(classId || undefined, termId || undefined);
  const create = useCreateAssessment();
  const transition = useAssessmentTransition();
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [maxScore, setMaxScore] = useState('100');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <select className={sel + ' w-40'} value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">Term…</option>{(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select className={sel + ' w-40'} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Class…</option>{(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      {(assessments ?? []).map((a) => (
        <Card key={a.id}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{a.title} <Badge>{a.status}</Badge> {a.component ? <span className="text-xs text-muted-foreground">· {a.component.name}</span> : null}</CardTitle>
            <div className="flex gap-1">
              {['schedule','publish','open','close','grade','archive'].map((act) => (
                <Button key={act} size="sm" variant="ghost" disabled={transition.isPending} onClick={() => transition.mutate({ id: a.id, action: act as any })}>{act}</Button>
              ))}
            </div>
          </CardHeader>
        </Card>
      ))}
      {termId && classId && (
        <Card>
          <CardHeader><CardTitle className="text-base">New assessment</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <select className={sel + ' w-48'} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">Subject…</option>{(subjects?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <Input placeholder="Title" className="w-48" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input type="number" placeholder="max" className="w-20" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
            <Button size="sm" disabled={!subjectId || !title || create.isPending} onClick={async () => { await create.mutateAsync({ subjectId, classId, termId, title, maxScore: Number(maxScore) }); setTitle(''); notify.success('Assessment created'); }}> <Plus className="h-4 w-4" /> Create</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ── Marks with SoD ── */
function MarkTab() {
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const { data: assessments } = useAssessments(classId || undefined, termId || undefined);
  const [assessmentId, setAssessmentId] = useState('');
  useClassRoster(assessments?.find((a) => a.id === assessmentId)?.classId);
  const { data: marks } = useMarksByAssessment(assessmentId || undefined);
  const recordMark = useRecordMark();
  const setPart = useSetParticipation();
  const submit = useSubmitMarks();
  const approve = useMarkingApproval();
  const [vals, setVals] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const m of marks ?? []) if (m.score != null) next[m.studentAssessmentId] = String(m.score);
    setVals(next);
  }, [marks, assessmentId]);

  const save = async () => {
    const entries = (marks ?? []).filter((m) => vals[m.studentAssessmentId] !== undefined && vals[m.studentAssessmentId] !== '')
      .map((m) => recordMark.mutateAsync({ studentAssessmentId: m.studentAssessmentId, score: Number(vals[m.studentAssessmentId]) }));
    try { await Promise.all(entries); notify.success('Marks saved'); } catch { notify.error('Save failed'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <select className={sel + ' w-40'} value={termId} onChange={(e) => { setTermId(e.target.value); setAssessmentId(''); }}><option value="">Term…</option>{(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select className={sel + ' w-40'} value={classId} onChange={(e) => { setClassId(e.target.value); setAssessmentId(''); }}><option value="">Class…</option>{(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className={sel + ' w-64'} value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}><option value="">Assessment…</option>{(assessments ?? []).map((a) => <option key={a.id} value={a.id}>{a.title} · {a.status}</option>)}</select>
        {assessmentId && <Badge variant="secondary">Enter: school:grades:write · Approve: school:grades:approve (SoD)</Badge>}
      </div>
      {assessmentId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Mark entry</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={recordMark.isPending}><Save className="h-4 w-4" /> Save</Button>
              <Button size="sm" variant="ghost" onClick={() => submit.mutate(assessmentId)} disabled={submit.isPending}><Send className="h-4 w-4" /> Submit</Button>
              <Button size="sm" variant="ghost" onClick={() => approve.mutate({ assessmentId, action: 'approve' })} disabled={approve.isPending}><ShieldCheck className="h-4 w-4" /> Approve</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground"><tr><th className="px-4 py-2">Adm.</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Part.</th><th className="px-4 py-2">Score</th><th className="px-4 py-2">Status</th></tr></thead>
              <tbody>
                {(marks ?? []).map((m) => (
                  <tr key={m.studentAssessmentId} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{m.admissionNo ?? '—'}</td>
                    <td className="px-4 py-2">{m.studentName}</td>
                    <td className="px-4 py-2">
                      <select className={sel + ' w-32'} value={m.participation} onChange={(e) => setPart.mutate({ assessmentId, studentProfileId: m.studentProfileId, participation: e.target.value })}>
                        {['present','absent','exempt','excused','malpractice','special_consideration'].map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2"><Input type="number" className="h-8 w-24" value={vals[m.studentAssessmentId] ?? ''} onChange={(e) => setVals({ ...vals, [m.studentAssessmentId]: e.target.value })} /></td>
                    <td className="px-4 py-2"><Badge variant="secondary">{m.status}</Badge></td>
                  </tr>
                ))}
                {(marks ?? []).length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No marksheet yet — its cohort is derived from the assessment's roster.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
