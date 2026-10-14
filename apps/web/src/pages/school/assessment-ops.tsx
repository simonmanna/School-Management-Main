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
import { ConfirmButton } from './_components/confirm-button';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolAssessmentOpsPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Class Lists &amp; Rubrics</h1>
        <p className="text-sm text-muted-foreground">Lock the list of pupils each class's term results are worked out against, and keep the rubrics teachers mark with.</p>
      </div>
      <Tabs defaultValue="rosters">
        <TabsList>
          <TabsTrigger value="rosters">Class lists</TabsTrigger>
          <TabsTrigger value="rubrics">Rubrics</TabsTrigger>
          {/* One-off data repair for assessments migrated from the old homework
              and gradebook screens. Kept reachable, but last and plainly named. */}
          <TabsTrigger value="reconciliation">Migration repair</TabsTrigger>
        </TabsList>
        <TabsContent value="rosters" className="pt-4"><RostersTab /></TabsContent>
        <TabsContent value="rubrics" className="pt-4"><RubricsTab/></TabsContent>
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
  const selected = (rosters?.data ?? []).find((r) => r.id === rosterId);
  const locked = !!selected?.frozenAt;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Class lists</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(rosters?.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No class lists yet. Each class needs one, locked, before its term results can be worked out.</p>
          )}
          {(rosters?.data ?? []).map((r) => (
            <button key={r.id} className="flex w-full items-center justify-between rounded border p-2 text-sm text-left hover:bg-accent" onClick={() => setRosterId(r.id)}>
              <span>{r.name ?? `${(classes?.data ?? []).find((c) => c.id === r.classId)?.name ?? 'Whole grade'} · ${(terms?.data ?? []).find((t) => t.id === r.termId)?.name ?? ''}`} <Badge variant="secondary">{r.frozenAt ? 'Locked' : 'Draft'}</Badge></span>
              <span className="text-xs text-muted-foreground">{(r as any).memberCount ?? (r as any).members?.length ?? 0} pupils</span>
            </button>
          ))}
          <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">Term…</option>{(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.label ?? t.name}</option>)}</select>
          <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Class…</option>{(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <Input placeholder="Name this class list" value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" disabled={!termId || capture.isPending} onClick={async () => {
            try {
              const saved: any = await capture.mutateAsync({ termId, classId: classId||undefined, scopeType: classId ? 'class' : 'grade', name: name||undefined });
              setName(''); if (saved?.id) setRosterId(saved.id);
              notify.success('Class list saved', { description: 'Lock it before working out results, so the list cannot change underneath them.' });
            } catch (e: any) {
              notify.error('Could not save the class list', { description: e?.response?.data?.message ?? 'Try again.' });
            }
          }}> <Plus className="h-4 w-4" /> Save class list</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Pupils on this list</CardTitle>
          {rosterId && !locked && (
            <ConfirmButton
              variant="ghost"
              disabled={freeze.isPending}
              title="Lock this class list?"
              description="Term results are worked out against a locked list, so it can't change underneath them. Check every pupil is on it first: a locked list can't be edited."
              confirmLabel="Lock list"
              onConfirm={() => freeze.mutate(rosterId, {
                onSuccess: () => notify.success('Class list locked', { description: 'It can now be used to work out results.' }),
                onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Could not lock this class list'),
              })}
            >
              <Lock className="h-4 w-4" /> Lock list
            </ConfirmButton>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {(members ?? []).map((m) => (
            <div key={m.studentProfileId} className="flex items-center justify-between rounded border p-2 text-sm">
              <span>{m.name} <span className="font-mono text-xs text-muted-foreground">{m.admissionNo ?? ''}</span></span>
              <div className="flex gap-1">
                <Badge variant="secondary">{m.status}</Badge>
                {!locked && (
                  <Button
                    size="sm" variant="ghost" aria-label={`Remove ${m.name}`}
                    onClick={() => removeMember.mutate(
                      { rosterId: rosterId!, studentProfileId: m.studentProfileId },
                      { onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Could not remove this pupil') },
                    )}
                  >×</Button>
                )}
              </div>
            </div>
          ))}
          {rosterId && !locked && (
            <div className="flex gap-2">
              <select className={sel} value={addStudent} onChange={(e) => setAddStudent(e.target.value)}>
                <option value="">Add student…</option>
                {(students?.data ?? []).filter((s) => !(members ?? []).some((m) => m.studentProfileId === s.id)).map((s) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}
              </select>
              <Button size="sm" disabled={!addStudent} onClick={async () => {
                try { await addMember.mutateAsync({ rosterId: rosterId!, studentProfileId: addStudent }); setAddStudent(''); notify.success('Pupil added'); }
                catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not add this pupil'); }
              }}>Add</Button>
            </div>
          )}
          {locked && <p className="text-xs text-muted-foreground">Locked: this list is used for term results and can't be changed.</p>}
          {!rosterId && <p className="text-sm text-muted-foreground">Choose a class list on the left to see its pupils.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Rubrics ── */
interface DraftLevel { label: string; score: string }
interface DraftCriterion { name: string; maxScore: string; weight: string; levels: DraftLevel[] }

/** Nursery descriptors (ADR-031 ECD built-ins) as the starting point. */
const blankCriterion = (): DraftCriterion => ({
  name: '',
  maxScore: '4',
  weight: '1',
  levels: [
    { label: 'Support', score: '1' },
    { label: 'Beginning', score: '2' },
    { label: 'Developing', score: '3' },
    { label: 'Confident', score: '4' },
  ],
});

/** Field-level problems, in words a teacher can act on (audit F15). */
function rubricProblems(name: string, criteria: DraftCriterion[]): string[] {
  const out: string[] = [];
  if (!name.trim()) out.push('Give the rubric a name.');
  if (criteria.length === 0) out.push('Add at least one criterion.');
  criteria.forEach((c, i) => {
    const n = `Criterion ${i + 1}${c.name.trim() ? ` (${c.name.trim()})` : ''}`;
    const max = Number(c.maxScore);
    if (!c.name.trim()) out.push(`${n}: needs a name.`);
    if (!(max > 0)) out.push(`${n}: the top score must be above 0.`);
    if (!(Number(c.weight) > 0)) out.push(`${n}: the weight must be above 0.`);
    if (c.levels.length < 2) out.push(`${n}: needs at least two levels.`);
    c.levels.forEach((l, j) => {
      const sc = Number(l.score);
      if (!l.label.trim()) out.push(`${n}, level ${j + 1}: needs a descriptor.`);
      if (l.score === '' || Number.isNaN(sc) || sc < 0) out.push(`${n}, level ${j + 1}: score must be 0 or more.`);
      else if (max > 0 && sc > max) out.push(`${n}, level ${j + 1}: score ${sc} is above the top score ${max}.`);
    });
  });
  return out;
}

function RubricsTab() {
  const { data: rubrics } = useRubrics();
  const [id, setId] = useState('');
  const { data: rubric } = useRubric(id || undefined);
  const create = useCreateRubric();
  const fork = useForkRubric();
  const del = useDeleteRubric();
  const [name, setName] = useState('');
  const [criteria, setCriteria] = useState<DraftCriterion[]>([blankCriterion()]);
  const [tried, setTried] = useState(false);
  const problems = rubricProblems(name, criteria);

  const setCrit = (i: number, patch: Partial<DraftCriterion>) =>
    setCriteria((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const setLevel = (i: number, j: number, patch: Partial<DraftLevel>) =>
    setCriteria((cs) => cs.map((c, k) => (k === i ? { ...c, levels: c.levels.map((l, m) => (m === j ? { ...l, ...patch } : l)) } : c)));

  const doCreate = async () => {
    setTried(true);
    if (problems.length) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        criteria: criteria.map((c) => ({
          name: c.name.trim(),
          maxScore: Number(c.maxScore),
          weight: Number(c.weight),
          levels: c.levels.map((l) => ({ label: l.label.trim(), score: Number(l.score) })),
        })),
      } as any);
      setName(''); setCriteria([blankCriterion()]); setTried(false);
      notify.success('Rubric created');
    } catch (e: any) {
      // Show what the server said, not a guess about JSON.
      const msg = e?.response?.data?.message;
      notify.error(Array.isArray(msg) ? msg.join(' ') : msg ?? 'Could not create the rubric');
    }
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
                <Button size="sm" variant="ghost" onClick={() => fork.mutate(r.id)}>Duplicate</Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${r.name}`} onClick={() => { if (window.confirm(`Delete the rubric "${r.name}"?`)) del.mutate(r.id); }}>×</Button>
              </div>
            </div>
          ))}
          <div className="space-y-3 rounded border p-3">
            <Input placeholder="Rubric name, e.g. Top Class — Language" value={name} onChange={(e) => setName(e.target.value)} />
            {criteria.map((c, i) => (
              <div key={i} className="space-y-2 rounded border p-2">
                <div className="flex gap-2">
                  <Input placeholder="What is assessed, e.g. Listening" value={c.name} onChange={(e) => setCrit(i, { name: e.target.value })} />
                  <Input className="w-24" inputMode="decimal" title="Top score" placeholder="Top" value={c.maxScore} onChange={(e) => setCrit(i, { maxScore: e.target.value })} />
                  <Input className="w-20" inputMode="decimal" title="Weight" placeholder="Weight" value={c.weight} onChange={(e) => setCrit(i, { weight: e.target.value })} />
                  <Button size="sm" variant="ghost" aria-label="Remove criterion" onClick={() => setCriteria((cs) => cs.filter((_, k) => k !== i))}>×</Button>
                </div>
                {c.levels.map((l, j) => (
                  <div key={j} className="flex gap-2 pl-4">
                    <Input placeholder="Descriptor" value={l.label} onChange={(e) => setLevel(i, j, { label: e.target.value })} />
                    <Input className="w-24" inputMode="decimal" placeholder="Score" value={l.score} onChange={(e) => setLevel(i, j, { score: e.target.value })} />
                    <Button size="sm" variant="ghost" aria-label="Remove level" onClick={() => setCrit(i, { levels: c.levels.filter((_, m) => m !== j) })}>×</Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="ml-4" onClick={() => setCrit(i, { levels: [...c.levels, { label: '', score: '' }] })}>Add level</Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setCriteria((cs) => [...cs, blankCriterion()])}><Plus className="h-4 w-4" /> Add criterion</Button>
            {tried && problems.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-destructive">
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            <Button size="sm" disabled={create.isPending} onClick={() => void doCreate()}><Plus className="h-4 w-4" /> Create rubric</Button>
          </div>
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
