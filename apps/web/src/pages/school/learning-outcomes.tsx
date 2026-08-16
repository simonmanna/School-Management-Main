import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  useLearningOutcomes, useCreateLearningOutcome, useRecordOutcomeAchievement, useOutcomeAchievements,
  useStudents, useTerms, useSubjects,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';
const LEVELS = ['not_met', 'approaching', 'met', 'exceeded'] as const;
const LEVEL_LABEL: Record<string, string> = { not_met: 'Not met', approaching: 'Approaching', met: 'Met', exceeded: 'Exceeded' };

export function SchoolLearningOutcomesPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Learning Outcomes</h1>
        <p className="text-sm text-muted-foreground">P1-B: define assessable outcomes (per subject/topic/competency) and record each student's achievement per term — the basis of competency reports.</p>
      </div>
      <Tabs defaultValue="define">
        <TabsList>
          <TabsTrigger value="define">Define outcomes</TabsTrigger>
          <TabsTrigger value="record">Record achievement</TabsTrigger>
        </TabsList>
        <TabsContent value="define" className="pt-4"><DefineTab /></TabsContent>
        <TabsContent value="record" className="pt-4"><RecordTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function DefineTab() {
  const { data: outcomes } = useLearningOutcomes();
  const { data: subjects } = useSubjects();
  const create = useCreateLearningOutcome();
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [expected, setExpected] = useState('');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Add outcome</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Outcome title (e.g. Solve quadratic equations)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <select className={sel} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Subject (optional)…</option>{(subjects?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Input placeholder="Expected level (e.g. proficient)" value={expected} onChange={(e) => setExpected(e.target.value)} />
          <Button size="sm" disabled={!title || create.isPending} onClick={async () => { await create.mutateAsync({ title, subjectId: subjectId || undefined, expectedLevel: expected || undefined }); setTitle(''); setExpected(''); notify.success('Outcome added'); }}><Plus className="h-4 w-4" /> Add outcome</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Outcomes</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {(outcomes?.data ?? []).map((o: any) => (
            <div key={o.id} className="rounded border p-2 text-sm">
              <div className="font-medium">{o.title}</div>
              <div className="text-xs text-muted-foreground">{o.expectedLevel ? `Expected: ${o.expectedLevel}` : 'No expected level set'}</div>
            </div>
          ))}
          {(outcomes?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No outcomes yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function RecordTab() {
  const { data: outcomes } = useLearningOutcomes();
  const { data: students } = useStudents({ pageSize: 100 });
  const { data: terms } = useTerms();
  const [studentId, setStudentId] = useState('');
  const [termId, setTermId] = useState('');
  const { data: achievements } = useOutcomeAchievements(studentId || undefined, termId || undefined);
  const record = useRecordOutcomeAchievement();
  const [level, setLevel] = useState<typeof LEVELS[number]>('not_met');

  const existing = new Map((achievements ?? []).map((a: any) => [a.learningOutcomeId, a]));

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 space-y-1">
          <label className="text-xs">Student</label>
          <select className={sel} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select…</option>{(students?.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs">Term</label>
          <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="">Select…</option>{(terms?.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {studentId && termId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Achievement per outcome</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(outcomes?.data ?? []).map((o: any) => {
              const a = existing.get(o.id);
              return (
                <div key={o.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                  <span className="flex-1">{o.title}</span>
                  <Badge variant={a ? 'default' : 'secondary'}>{a ? LEVEL_LABEL[a.level] : '—'}</Badge>
                  <select className={sel + ' w-40'} value={a?.level ?? level} onChange={async (e) => {
                    const lvl = e.target.value as typeof LEVELS[number];
                    setLevel(lvl);
                    try { await record.mutateAsync({ studentProfileId: studentId, learningOutcomeId: o.id, termId, level: lvl }); notify.success('Saved'); }
                    catch { notify.error('Save failed'); }
                  }}>
                    {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                  </select>
                </div>
              );
            })}
            {(outcomes?.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">Define outcomes first.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
