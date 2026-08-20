import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useSubjects, useLessonPlanCoverage } from '@/features/school/api';

export function SchoolLmsCoveragePage() {
  const { data: subjects } = useSubjects();
  const [subjectId, setSubjectId] = useState('');
  const [termId, setTermId] = useState('');
  const { data, isFetching } = useLessonPlanCoverage(subjectId || undefined, termId || undefined);

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><GitBranch className="h-5 w-5" /><h1 className="text-xl font-semibold">Curriculum Coverage</h1></div>
      <Card><CardHeader><CardTitle className="text-base">Select subject</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div><Label>Subject</Label><select className="rounded-md border bg-card px-3 py-2 text-sm" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">—</option>{subjects?.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><Label>Term (optional)</Label><Input value={termId} onChange={(e) => setTermId(e.target.value)} placeholder="term uuid" /></div>
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Planned · Delivered · Assessed · Mastered</CardTitle></CardHeader>
        <CardContent className="pt-4">
          {!subjectId && <p className="text-sm text-muted-foreground">Pick a subject to see four-way coverage.</p>}
          {subjectId && (
            isFetching ? <p className="text-sm text-muted-foreground">Loading…</p> :
            <div className="grid grid-cols-4 gap-3 text-center">
              {[['Planned', data?.planned], ['Delivered', data?.delivered], ['Assessed', data?.assessed], ['Mastered', data?.mastered]].map(([label, val]: any) => (
                <div key={label} className="rounded-md border p-3">
                  <div className="text-2xl font-semibold">{val ?? 0}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <Badge variant="outline" className="mt-1">{pct(val ?? 0, data?.total ?? 0)}%</Badge>
                </div>
              ))}
            </div>
          )}
          {subjectId && data && <p className="mt-3 text-xs text-muted-foreground">Total objectives in scope: {data.total}</p>}
        </CardContent></Card>
    </div>
  );
}
