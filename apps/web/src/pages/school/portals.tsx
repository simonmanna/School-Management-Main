import { useState } from 'react';
import { TrendingUp, ClipboardList, FileBadge } from 'lucide-react';
import {
  useTerms, useClasses, useStudents, useStudentPortal, useTeacherPortal,
  useRolloverPlan,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolPortalsPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Portals & Promotion Gate</h1>
        <p className="text-sm text-muted-foreground">A8: student/parent/teacher portal reads off the result spine; rollover consults promotionRecommendation (repeats bucket).</p>
      </div>
      <Tabs defaultValue="student">
        <TabsList>
          <TabsTrigger value="student">Student / Parent</TabsTrigger>
          <TabsTrigger value="teacher">Teacher</TabsTrigger>
          <TabsTrigger value="rollover">Promotion & Rollover</TabsTrigger>
        </TabsList>
        <TabsContent value="student" className="pt-4"><StudentPortalTab/></TabsContent>
        <TabsContent value="teacher" className="pt-4"><TeacherPortalTab/></TabsContent>
        <TabsContent value="rollover" className="pt-4"><RolloverTab/></TabsContent>
      </Tabs>
    </div>
  );
}

function StudentPortalTab() {
  const { data: students } = useStudents({ pageSize: 100 });
  const [id, setId] = useState('');
  const { data: p } = useStudentPortal(id || undefined);
  return (
    <div className="space-y-3">
      <select className={sel + ' w-80'} value={id} onChange={(e) => setId(e.target.value)}>
        <option value="">Student…</option>{(students?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}
      </select>
      {p && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base">Published results</CardTitle></CardHeader>
            <CardContent>{p.publishedResults ? <div className="flex flex-wrap gap-2">
              <Badge>term {p.publishedResults.termId.slice(0,6)}</Badge>
              <Badge variant="secondary">mean {p.publishedResults.meanPercent != null ? Number(p.publishedResults.meanPercent) : '—'}%</Badge>
              <Badge variant="secondary">rank {p.publishedResults.classRank ?? '—'}</Badge>
              {p.publishedResults.promotionRecommendation && <Badge variant="outline">{p.publishedResults.promotionRecommendation}</Badge>}
            </div> : <p className="text-sm text-muted-foreground">No published result yet.</p>}</CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base">Certificates</CardTitle></CardHeader>
            <CardContent>{(p.certificates ?? []).map((c) => <div key={c.id} className="rounded border p-2 text-sm">{c.title} <Badge>{c.status}</Badge> {c.code && <span className="font-mono text-xs text-muted-foreground">{c.code.slice(0,8)}</span>}</div>)}
              {(p.certificates ?? []).length === 0 && <p className="text-sm text-muted-foreground">None issued.</p>}</CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><ClipboardList className="h-4 w-4" /> Assignments</CardTitle></CardHeader>
            <CardContent>{(p.assignments ?? []).map((a) => <div key={a.id} className="rounded border p-2 text-sm">{a.title} <Badge variant="secondary">{a.status}</Badge></div>)}
              {(p.assignments ?? []).length === 0 && <p className="text-sm text-muted-foreground">No assignments.</p>}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function TeacherPortalTab() {
  const [partnerId, setPartnerId] = useState('');
  const { data: p } = useTeacherPortal(partnerId || undefined);
  return (
    <div className="space-y-3">
      <Input className="w-80" placeholder="Teacher partner id" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} />
      {p && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><FileBadge className="h-4 w-4" /> Marking queue (spine)</CardTitle></CardHeader>
            <CardContent>{(p.markingQueue ?? []).map((m) => <div key={m.id} className="rounded border p-2 text-sm">{m.title} <Badge variant="destructive">{m.pending} pending</Badge></div>)}
              {(p.markingQueue ?? []).length === 0 && <p className="text-sm text-muted-foreground">Queue clear.</p>}</CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base">Classes</CardTitle></CardHeader>
            <CardContent>{(p.classes ?? []).map((c: any, i) => <div key={i} className="rounded border p-2 text-sm">{c.name ?? JSON.stringify(c).slice(0,60)}</div>)}
              {(p.classes ?? []).length === 0 && <p className="text-sm text-muted-foreground">No classes assigned.</p>}</CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function RolloverTab() {
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const [fromTermId, setFrom] = useState('');
  const [toTermId, setTo] = useState('');
  const plan = useRolloverPlan();
  const [result, setResult] = useState<{ plan: Array<{ studentProfileId: string; outcome: string; toClassId?: string | null }>; dryRun: boolean } | null>(null);

  const runDry = async () => {
    try { const r = await plan.mutateAsync({ fromTermId, toTermId, dryRun: true }); setResult(r as any); notify.success(`Plan: ${r.plan.length} students`); }
    catch { notify.error('Rollover plan failed — need results + recommendations'); }
  };
  const execute = async () => {
    try { const r = await plan.mutateAsync({ fromTermId, toTermId, dryRun: false }); setResult(r as any); notify.success(`Rolled over ${r.plan.length} students`); }
    catch { notify.error('Rollover failed'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <select className={sel + ' w-44'} value={fromTermId} onChange={(e) => setFrom(e.target.value)}><option value="">From term…</option>{(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select className={sel + ' w-44'} value={toTermId} onChange={(e) => setTo(e.target.value)}><option value="">To term…</option>{(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <Button size="sm" disabled={!fromTermId || !toTermId || plan.isPending} onClick={runDry}><TrendingUp className="h-4 w-4" /> Dry-run plan</Button>
        <Button size="sm" variant="ghost" disabled={!fromTermId || !toTermId || plan.isPending} onClick={execute}>Execute</Button>
      </div>
      {result && (
        <Card>
          <CardHeader><CardTitle className="text-base">Plan ({result.plan.length}) {result.dryRun ? <Badge variant="secondary">preview</Badge> : <Badge>committed</Badge>}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm"><thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Student</th><th className="px-2 py-1">Outcome</th><th className="px-2 py-1">To class</th></tr></thead>
              <tbody>{result.plan.slice(0, 50).map((e, i) => <tr key={i} className="border-b last:border-0">
                <td className="px-2 py-1">{e.studentProfileId.slice(0,6)}</td>
                <td className="px-2 py-1"><Badge variant={e.outcome === 'promoted' ? 'default' : e.outcome === 'repeated' ? 'destructive' : 'secondary'}>{e.outcome}</Badge></td>
                <td className="px-2 py-1">{e.toClassId ? (classes?.data ?? []).find((c) => c.id === e.toClassId)?.name ?? e.toClassId.slice(0,6) : '—'}</td>
              </tr>)}</tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
