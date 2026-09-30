import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useTerms, useRosters, useResultSets, useExams,
  useAnalyticsOverview, useGradeDistribution, useSubjectPerformance, useCaVsExam, useAtRisk,
  useAssignmentMetrics, useExamAttendance,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';
const lbl = 'flex min-w-0 flex-col gap-1';
const lblText = 'text-xs font-medium text-muted-foreground';

export function SchoolAnalyticsPage() {
  const { data: terms } = useTerms();
  const [termId, setTermId] = useState('');
  const { data: rosters } = useRosters();
  const [rosterId, setRosterId] = useState('');
  const { data: sets } = useResultSets(termId || undefined);
  const [resultSetId, setResultSetId] = useState('');
  const { data: exams } = useExams();
  const [examId, setExamId] = useState('');

  const termRosters = (rosters?.data ?? []).filter((r) => !termId || r.termId === termId);
  const roster = termRosters.find((r) => r.id === rosterId);
  const rosterName = (id?: string | null) => {
    const r = (rosters?.data ?? []).find((x) => x.id === id);
    return r ? (r.name ?? `${r.scopeType} ${r.classId?.slice(0, 6)}`) : null;
  };
  // A result set belongs to one class list; narrow the versions to the chosen one.
  const visibleSets = (sets ?? []).filter((s) => !roster || s.rosterId === roster.id || (!!roster.classId && s.scopeId === roster.classId));
  const termExams = (exams?.data ?? []).filter((e) => !termId || e.termId === termId);

  const pickRoster = (id: string) => {
    setRosterId(id);
    const r = termRosters.find((x) => x.id === id);
    const match = (sets ?? []).filter((s) => !r || s.rosterId === r.id || (!!r.classId && s.scopeId === r.classId));
    // Jump to the newest published version for that class, else clear so stale charts don't linger.
    setResultSetId((match.find((s) => s.status === 'published') ?? match[0])?.id ?? '');
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Academic Analytics</h1>
        <p className="text-sm text-muted-foreground">Performance across the school, read from a released set of results.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={lbl}>
          <span className={lblText}>Term</span>
          <select className={sel} value={termId} onChange={(e) => { setTermId(e.target.value); setRosterId(''); setResultSetId(''); setExamId(''); }}>
            <option value="">Select term…</option>{(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className={lbl}>
          <span className={lblText}>Class list</span>
          <select className={sel} value={rosterId} onChange={(e) => pickRoster(e.target.value)}>
            <option value="">All class lists</option>{termRosters.map((r) => <option key={r.id} value={r.id}>{r.name ?? `${r.scopeType} ${r.classId?.slice(0,6)}`}</option>)}
          </select>
        </label>
        <label className={lbl}>
          <span className={lblText}>Results version</span>
          <select className={sel} value={resultSetId} onChange={(e) => setResultSetId(e.target.value)}>
            <option value="">{termId ? (visibleSets.length ? 'Select results version…' : 'No results for this selection') : 'Pick a term first'}</option>
            {visibleSets.map((s) => <option key={s.id} value={s.id}>{roster ? '' : `${rosterName(s.rosterId) ?? s.scopeType} · `}rev {s.revision} · {s.status}</option>)}
          </select>
        </label>
        <label className={lbl}>
          <span className={lblText}>Exam (attendance)</span>
          <select className={sel} value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">Select exam…</option>{termExams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
      </div>

      {resultSetId ? (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="grade">Grade dist.</TabsTrigger>
            <TabsTrigger value="subject">Subject perf.</TabsTrigger>
            <TabsTrigger value="diagnostic">CA vs Exam</TabsTrigger>
            <TabsTrigger value="predictive">At-risk</TabsTrigger>
            <TabsTrigger value="operational">Operational</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="pt-4"><OverviewTab resultSetId={resultSetId} /></TabsContent>
          <TabsContent value="grade" className="pt-4"><GradeTab resultSetId={resultSetId} /></TabsContent>
          <TabsContent value="subject" className="pt-4"><SubjectTab resultSetId={resultSetId} /></TabsContent>
          <TabsContent value="diagnostic" className="pt-4"><CaExamTab resultSetId={resultSetId} /></TabsContent>
          <TabsContent value="predictive" className="pt-4"><AtRiskTab resultSetId={resultSetId} /></TabsContent>
          <TabsContent value="operational" className="pt-4"><OperationalTab examId={examId} classId={roster?.classId ?? ''} termId={termId} /></TabsContent>
        </Tabs>
      ) : <p className="text-sm text-muted-foreground">Choose a result set to render the tiers.</p>}
    </div>
  );
}

function OverviewTab({ resultSetId }: { resultSetId: string }) {
  const { data, isLoading } = useAnalyticsOverview(resultSetId);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">No overview.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card><CardHeader><CardTitle className="text-base">Cohort</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">
        <Badge>{data.studentCount} students</Badge><Badge variant="secondary">rev {data.resultSetRevision}</Badge>
        <Badge variant="secondary">mean {data.meanPercent}%</Badge><Badge variant="secondary">pass {data.passRate}%</Badge>
        <Badge variant="secondary">eligible {data.eligibleRate}%</Badge><Badge variant="destructive">at-risk {data.atRiskCount}</Badge>
      </CardContent></Card>
      <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-base">Grade distribution</CardTitle></CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.gradeDistribution}>
              <XAxis dataKey="grade" /><YAxis /><Tooltip />
              <Bar dataKey="count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function GradeTab({ resultSetId }: { resultSetId: string }) {
  const { data } = useGradeDistribution(resultSetId);
  return (
    <Card><CardHeader><CardTitle className="text-base">Grade distribution</CardTitle></CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data?.distribution ?? []}><XAxis dataKey="grade" /><YAxis /><Tooltip /><Bar dataKey="count" fill="#22c55e" /></BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function SubjectTab({ resultSetId }: { resultSetId: string }) {
  const { data } = useSubjectPerformance(resultSetId);
  return (
    <Card><CardHeader><CardTitle className="text-base">Subject performance (mean %)</CardTitle></CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data?.subjects ?? []}><XAxis dataKey="subjectId" tick={{ fontSize: 10 }} /><YAxis /><Tooltip /><Bar dataKey="mean" fill="#3b82f6" /><Bar dataKey="passRate" fill="#eab308" /></BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function CaExamTab({ resultSetId }: { resultSetId: string }) {
  const { data } = useCaVsExam(resultSetId);
  return (
    <Card><CardHeader><CardTitle className="text-base">CA vs Exam divergence (flagged &gt; {data?.threshold})</CardTitle></CardHeader>
      <CardContent>
        {(data?.flagged ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No large CA/exam divergences.</p> :
          <table className="w-full text-sm"><thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Student</th><th className="px-2 py-1">Subject</th><th className="px-2 py-1">CA</th><th className="px-2 py-1">Exam</th><th className="px-2 py-1">Gap</th></tr></thead>
            <tbody>{(data!.flagged ?? []).map((f, i) => <tr key={i} className="border-b last:border-0"><td className="px-2 py-1">{f.studentName ?? f.admissionNo ?? '—'}</td><td className="px-2 py-1">{f.subjectName ?? '—'}</td><td className="px-2 py-1">{f.caScore}</td><td className="px-2 py-1">{f.examScore}</td><td className="px-2 py-1"><Badge variant="destructive">{f.gap}</Badge></td></tr>)}</tbody></table>}
      </CardContent>
    </Card>
  );
}

function AtRiskTab({ resultSetId }: { resultSetId: string }) {
  const { data } = useAtRisk(resultSetId);
  return (
    <Card><CardHeader><CardTitle className="text-base">Predictive — at-risk register (with rules, not bare scores)</CardTitle></CardHeader>
      <CardContent>
        {(data?.register ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No at-risk students.</p> :
          <table className="w-full text-sm"><thead className="border-b text-left text-muted-foreground"><tr><th className="px-2 py-1">Student</th><th className="px-2 py-1">Mean%</th><th className="px-2 py-1">Failing</th><th className="px-2 py-1">Rule(s)</th></tr></thead>
            <tbody>{(data!.register ?? []).map((r, i) => <tr key={i} className="border-b last:border-0"><td className="px-2 py-1">{r.studentName ?? r.admissionNo ?? '—'}</td><td className="px-2 py-1">{r.meanPercent}</td><td className="px-2 py-1">{r.failingSubjects}</td><td className="px-2 py-1">{r.reasons.map((x) => <Badge key={x} variant="outline" className="mr-1">{x}</Badge>)}</td></tr>)}</tbody></table>}
      </CardContent>
    </Card>
  );
}

function OperationalTab({ examId, classId, termId }: { examId: string; classId: string; termId: string }) {
  const examAtt = useExamAttendance(examId || undefined);
  const assign = useAssignmentMetrics(classId || undefined, termId || undefined);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Exam attendance</CardTitle></CardHeader>
        <CardContent>{examAtt.data ? <div className="flex flex-wrap gap-2">
          <Badge>{examAtt.data.total} candidates</Badge><Badge variant="secondary">sat {examAtt.data.attendanceRate}%</Badge><Badge variant="destructive">absent {examAtt.data.absenceRate}%</Badge>
        </div> : <p className="text-sm text-muted-foreground">Select an exam.</p>}</CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="text-base">Assignment completion</CardTitle></CardHeader>
        <CardContent>{assign.data ? <div className="flex flex-wrap gap-2">
          <Badge>{assign.data.totalAssigned} assigned</Badge><Badge variant="secondary">submitted {assign.data.submissionRate}%</Badge><Badge variant="secondary">graded {assign.data.gradedRate}%</Badge><Badge variant="destructive">missing {assign.data.missingRate}%</Badge>
        </div> : <p className="text-sm text-muted-foreground">Pick a term and class list.</p>}</CardContent>
      </Card>
    </div>
  );
}
