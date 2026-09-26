import { useState } from 'react';
import { useWorkingTerm } from '@/features/school/working-term';
import { Plus, Lock } from 'lucide-react';
import {
  useTerms, useClasses, useStudents,
  useRosters, useRosterMembers, useCaptureRoster, useFreezeRoster, useAddRosterMember, useRemoveRosterMember,
  useRubrics, useRubric, useCreateRubric, useForkRubric, useDeleteRubric,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';
import { AssessmentReconciliation } from './_components/assessment-reconciliation';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolAssessmentOpsPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Class lists, rubrics & assignments</h1>
        <p className="text-sm text-muted-foreground">Fix the list of pupils a term’s results are worked out against, keep marking rubrics, and set assignments for a whole class.</p>
      </div>
      <Tabs defaultValue="rosters">
        <TabsList>
          <TabsTrigger value="rosters">Class lists</TabsTrigger>
          <TabsTrigger value="rubrics">Rubrics</TabsTrigger>
          <TabsTrigger value="assign">Assignments</TabsTrigger>
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
        </TabsList>
        <TabsContent value="rosters" className="pt-4"><RostersTab /></TabsContent>
        <TabsContent value="rubrics" className="pt-4"><RubricsTab/></TabsContent>
        <TabsContent value="assign" className="pt-4"><AssignTab/></TabsContent>
        <TabsContent value="reconciliation" className="pt-4"><AssessmentReconciliation /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Class lists ── */
function RostersTab() {
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const { data: rosters } = useRosters();
  const capture = useCaptureRoster();
  const [termId, setTermId] = useWorkingTerm();
  const [classId, setClassId] = useState('');
  const [name, setName] = useState('');
  const [rosterId, setRosterId] = useState('');
  const { data: members } = useRosterMembers(rosterId || undefined);
  const freeze = useFreezeRoster();
  const addMember = useAddRosterMember();
  const removeMember = useRemoveRosterMember();
  const { data: students } = useStudents({ pageSize: 200 });
  const [addStudent, setAddStudent] = useState('');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Cohorts</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(rosters?.data ?? []).map((r) => (
            <button key={r.id} className="flex w-full items-center justify-between rounded border p-2 text-sm text-left hover:bg-accent" onClick={() => setRosterId(r.id)}>
              <span>{r.name ?? `${r.scopeType} ${r.classId?.slice(0,6)}`} <Badge variant="secondary">{r.frozenAt ? 'Frozen' : 'Draft'}</Badge></span>
              <span className="text-xs text-muted-foreground">{r.memberCount ?? '?'} members</span>
            </button>
          ))}
          <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">Term…</option>{(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Class (scope)…</option>{(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <Input placeholder="Name this class list" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" disabled={!termId || capture.isPending} onClick={async () => { await capture.mutateAsync({ termId, classId: classId||undefined, scopeType: classId ? 'class' : 'grade', name: name||undefined }); setName(''); notify.success('Class list saved', { description: 'Lock it before working out results, so the list cannot change underneath them.' }); }}> <Plus className="h-4 w-4" /> Save class list</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Members</CardTitle>
          {rosterId && <Button size="sm" variant="ghost" disabled={freeze.isPending} onClick={() => freeze.mutate(rosterId)}><Lock className="h-4 w-4" /> Freeze</Button>}
        </CardHeader>
        <CardContent className="space-y-2">
          {(members ?? []).map((m) => (
            <div key={m.studentProfileId} className="flex items-center justify-between rounded border p-2 text-sm">
              <span>{m.name} <span className="font-mono text-xs text-muted-foreground">{m.admissionNo ?? ''}</span></span>
              <div className="flex gap-1">
                <Badge variant="secondary">{m.status}</Badge>
                <Button size="sm" variant="ghost" onClick={() => removeMember.mutate({ rosterId: rosterId!, studentProfileId: m.studentProfileId })}>×</Button>
              </div>
            </div>
          ))}
          {rosterId && (
            <div className="flex gap-2">
              <select className={sel} value={addStudent} onChange={(e) => setAddStudent(e.target.value)}>
                <option value="">Add student…</option>
                {(students?.data ?? []).filter((s) => !(members ?? []).some((m) => m.studentProfileId === s.id)).map((s) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}
              </select>
              <Button size="sm" disabled={!addStudent} onClick={async () => { await addMember.mutateAsync({ rosterId: rosterId!, studentProfileId: addStudent }); setAddStudent(''); notify.success('Added'); }}>Add</Button>
            </div>
          )}
          {!rosterId && <p className="text-sm text-muted-foreground">Select a roster to manage members.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Rubrics ── */
function RubricsTab() {
  const { data: rubrics } = useRubrics();
  const [id, setId] = useState('');
  const { data: rubric } = useRubric(id || undefined);
  const create = useCreateRubric();
  const fork = useForkRubric();
  const del = useDeleteRubric();
  const [name, setName] = useState('');
  const [critJson, setCritJson] = useState('[\n  { "name": "Structure", "maxScore": 10, "weight": 1, "levels": [ { "label": "Poor", "score": 0 }, { "label": "Good", "score": 10 } ] }\n]');

  const doCreate = async () => {
    try {
      const criteria = JSON.parse(critJson);
      await create.mutateAsync({ name, criteria });
      setName(''); notify.success('Rubric created');
    } catch { notify.error('Criteria JSON invalid'); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Rubric bank</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(rubrics?.data ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <button className="text-left" onClick={() => setId(r.id)}>{r.name}</button>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => fork.mutate(r.id)}>Fork</Button>
                <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}>×</Button>
              </div>
            </div>
          ))}
          <Input placeholder="Rubric name" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className={sel + ' h-40 font-mono text-xs'} value={critJson} onChange={(e) => setCritJson(e.target.value)} />
          <Button size="sm" disabled={!name || create.isPending} onClick={doCreate}><Plus className="h-4 w-4" /> Create rubric</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Preview</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {rubric?.criteria?.map((c) => (
            <div key={c.id} className="rounded border p-2 text-sm">
              <div className="font-medium">{c.name} <span className="text-muted-foreground">/ {Number(c.maxScore)}</span></div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(c.levels ?? []).map((l, i) => <Badge key={i} variant="outline">{l.label}: {Number(l.score)}</Badge>)}
              </div>
            </div>
          ))}
          {!rubric && <p className="text-sm text-muted-foreground">Select a rubric to preview.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Assignments ── */
function AssignTab() { return <Card><CardContent className="p-6"><p className="mb-4 text-sm text-muted-foreground">Assignments, homework and rubric marking now use the unified Assessment Board.</p><Button asChild><a href="/school/assessments?new=1">Create an assessment</a></Button></CardContent></Card>; }
