import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, CheckCircle2, FileText, Send } from 'lucide-react';
import {
  useExamTypes, useCreateExamType,
  useExams, useCreateExam, useExamAction,
  useExamSchedules, useCreateExamSchedule,
  useGradesByClass, useBulkGrades, useGradeAction,
  useReportCards, useGenerateReportCard, usePublishReportCard,
  useTerms, useClasses, useSubjects, useClassRoster, useStudents,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolExamsPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Examinations</h1>
        <p className="text-sm text-muted-foreground">Exam setup, grade entry and report cards.</p>
      </div>
      <Tabs defaultValue="gradebook">
        <TabsList>
          <TabsTrigger value="gradebook">Gradebook</TabsTrigger>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="reports">Report cards</TabsTrigger>
        </TabsList>
        <TabsContent value="gradebook" className="pt-4"><GradebookTab /></TabsContent>
        <TabsContent value="setup" className="pt-4"><SetupTab /></TabsContent>
        <TabsContent value="reports" className="pt-4"><ReportsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ─────────────── Gradebook ─────────────── */

function GradebookTab() {
  const { data: schedules } = useExamSchedules();
  const [scheduleId, setScheduleId] = useState('');
  const schedule = useMemo(() => (schedules?.data ?? []).find((s) => s.id === scheduleId), [schedules, scheduleId]);
  const { data: roster } = useClassRoster(schedule?.classId);
  const { data: grades } = useGradesByClass(scheduleId || undefined);
  const bulk = useBulkGrades();
  const action = useGradeAction();

  const [marks, setMarks] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const g of grades ?? []) next[g.studentProfileId] = String(Number(g.marksObtained));
    setMarks(next);
  }, [grades, scheduleId]);

  const status = grades?.[0]?.status;
  const maxMarks = schedule?.maxMarks ?? 100;

  const save = async () => {
    const entries = (roster ?? [])
      .filter((s) => marks[s.id] !== undefined && marks[s.id] !== '')
      .map((s) => ({ studentProfileId: s.id, marksObtained: Number(marks[s.id]), maxMarks: Number(maxMarks) }));
    if (!entries.length) { notify.error('Enter at least one mark'); return; }
    try {
      await bulk.mutateAsync({ examScheduleId: scheduleId, entries });
      notify.success(`Saved ${entries.length} mark(s)`);
    } catch { notify.error('Could not save marks'); }
  };
  const doAction = async (a: 'submit' | 'approve') => {
    try { await action.mutateAsync({ examScheduleId: scheduleId, action: a }); notify.success(`Grades ${a}d`); }
    catch { notify.error(`Could not ${a}`); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-72 space-y-1">
          <Label className="text-xs">Exam schedule (exam · class · subject)</Label>
          <select className={sel} value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
            <option value="">Select…</option>
            {(schedules?.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.schoolClass?.name ?? s.classId} · {s.subject?.name ?? s.subjectId} · {s.date?.slice(0, 10)}</option>
            ))}
          </select>
        </div>
        {scheduleId && status && <Badge>{status}</Badge>}
      </div>

      {scheduleId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Marks (out of {String(maxMarks)})</CardTitle>
            <div className="flex gap-2">
              <Button onClick={save} disabled={bulk.isPending}><Save className="h-4 w-4" /> Save</Button>
              <Button variant="ghost" onClick={() => doAction('submit')} disabled={action.isPending}><Send className="h-4 w-4" /> Submit</Button>
              <Button variant="ghost" onClick={() => doAction('approve')} disabled={action.isPending}><CheckCircle2 className="h-4 w-4" /> Approve</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground"><tr><th className="px-4 py-2">Adm.</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Marks</th><th className="px-4 py-2">Grade</th></tr></thead>
              <tbody>
                {(roster ?? []).map((s) => {
                  const g = (grades ?? []).find((x) => x.studentProfileId === s.id);
                  return (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="px-4 py-2 font-mono text-xs">{s.admissionNo}</td>
                      <td className="px-4 py-2">{s.partner?.name ?? '—'}</td>
                      <td className="px-4 py-2">
                        <Input type="number" className="h-8 w-24" value={marks[s.id] ?? ''} onChange={(e) => setMarks({ ...marks, [s.id]: e.target.value })} />
                      </td>
                      <td className="px-4 py-2">{g?.grade ?? '—'}</td>
                    </tr>
                  );
                })}
                {(roster ?? []).length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Select a schedule with a class roster.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ─────────────── Setup ─────────────── */

function SetupTab() {
  const { data: types } = useExamTypes();
  const { data: exams } = useExams();
  const { data: schedules } = useExamSchedules();
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const { data: subjects } = useSubjects();
  const createType = useCreateExamType();
  const createExam = useCreateExam();
  const examAction = useExamAction();
  const createSchedule = useCreateExamSchedule();

  const [tName, setTName] = useState(''); const [tWeight, setTWeight] = useState('');
  const [ex, setEx] = useState<Record<string, string>>({});
  const [sc, setSc] = useState<Record<string, string>>({ maxMarks: '100' });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader><CardTitle className="text-base">Exam types</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(types?.data ?? []).map((t) => <div key={t.id} className="rounded border p-2 text-sm">{t.name} · weight {Number(t.weight)}{t.isFinal ? ' · final' : ''}</div>)}
          <div className="flex gap-2">
            <Input placeholder="Name (Midterm)" value={tName} onChange={(e) => setTName(e.target.value)} />
            <Input type="number" placeholder="Weight" className="w-24" value={tWeight} onChange={(e) => setTWeight(e.target.value)} />
          </div>
          <Button size="sm" disabled={!tName || createType.isPending} onClick={async () => { await createType.mutateAsync({ name: tName, weight: Number(tWeight || 0) }); setTName(''); setTWeight(''); notify.success('Exam type added'); }}>
            <Plus className="h-4 w-4" /> Add type
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Exams</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(exams?.data ?? []).map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded border p-2 text-sm">
              <span>{e.name} <Badge>{e.status}</Badge></span>
              <span className="flex gap-1">
                {e.status !== 'published' && <Button size="sm" variant="ghost" onClick={() => examAction.mutate({ id: e.id, action: 'publish' })}>Publish</Button>}
                {e.status === 'published' && <Button size="sm" variant="ghost" onClick={() => examAction.mutate({ id: e.id, action: 'close' })}>Close</Button>}
              </span>
            </div>
          ))}
          <select className={sel} value={ex.termId ?? ''} onChange={(e) => setEx({ ...ex, termId: e.target.value })}>
            <option value="">Term…</option>{(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className={sel} value={ex.examTypeId ?? ''} onChange={(e) => setEx({ ...ex, examTypeId: e.target.value })}>
            <option value="">Type…</option>{(types?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className={sel} value={ex.classId ?? ''} onChange={(e) => setEx({ ...ex, classId: e.target.value })}>
            <option value="">Class…</option>{(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Input placeholder="Exam name" value={ex.name ?? ''} onChange={(e) => setEx({ ...ex, name: e.target.value })} />
          <Button size="sm" disabled={!ex.termId || !ex.examTypeId || !ex.name || createExam.isPending}
            onClick={async () => { await createExam.mutateAsync({ termId: ex.termId, examTypeId: ex.examTypeId, name: ex.name, startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), classes: ex.classId ? [ex.classId] : [] }); setEx({}); notify.success('Exam created'); }}>
            <Plus className="h-4 w-4" /> Create exam
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Schedules</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(schedules?.data ?? []).map((s) => <div key={s.id} className="rounded border p-2 text-xs">{s.schoolClass?.name} · {s.subject?.name} · {s.date?.slice(0, 10)}</div>)}
          <select className={sel} value={sc.examId ?? ''} onChange={(e) => setSc({ ...sc, examId: e.target.value })}>
            <option value="">Exam…</option>{(exams?.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <select className={sel} value={sc.classId ?? ''} onChange={(e) => setSc({ ...sc, classId: e.target.value })}>
            <option value="">Class…</option>{(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={sel} value={sc.subjectId ?? ''} onChange={(e) => setSc({ ...sc, subjectId: e.target.value })}>
            <option value="">Subject…</option>{(subjects?.data ?? []).map((sub) => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
          </select>
          <div className="flex gap-2">
            <Input type="date" value={sc.date ?? ''} onChange={(e) => setSc({ ...sc, date: e.target.value })} />
            <Input type="number" placeholder="max" className="w-20" value={sc.maxMarks ?? ''} onChange={(e) => setSc({ ...sc, maxMarks: e.target.value })} />
          </div>
          <Button size="sm" disabled={!sc.examId || !sc.classId || !sc.subjectId || !sc.date || createSchedule.isPending}
            onClick={async () => { await createSchedule.mutateAsync({ examId: sc.examId, classId: sc.classId, subjectId: sc.subjectId, date: sc.date, startTime: '09:00', maxMarks: Number(sc.maxMarks || 100) }); setSc({ maxMarks: '100' }); notify.success('Schedule added'); }}>
            <Plus className="h-4 w-4" /> Add schedule
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────── Report cards ─────────────── */

function ReportsTab() {
  const { data: students } = useStudents({ pageSize: 50 });
  const { data: terms } = useTerms();
  const [studentId, setStudentId] = useState('');
  const [termId, setTermId] = useState('');
  const { data: cards } = useReportCards(studentId || undefined);
  const generate = useGenerateReportCard();
  const publish = usePublishReportCard();

  const openPdf = async (id: string) => {
    try {
      const res = await api.get(`/school/report-cards/${id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, '_blank');
    } catch { notify.error('Could not open PDF'); }
  };

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 space-y-1">
          <Label className="text-xs">Student</Label>
          <select className={sel} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select…</option>{(students?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Term</Label>
          <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="">Select…</option>{(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <Button disabled={!studentId || !termId || generate.isPending}
          onClick={async () => { try { await generate.mutateAsync({ studentProfileId: studentId, termId }); notify.success('Report card generated'); } catch { notify.error('Generate failed — grades must be approved first'); } }}>
          <FileText className="h-4 w-4" /> Generate
        </Button>
      </div>

      {studentId && (
        <Card>
          <CardHeader><CardTitle className="text-base">Report cards</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(cards ?? []).length === 0 && <p className="text-sm text-muted-foreground">None yet. Generate one above.</p>}
            {(cards ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <span>Term {c.termId.slice(0, 6)}… {c.publishedAt ? <Badge>published</Badge> : <Badge variant="secondary">draft</Badge>}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={publish.isPending}
                    onClick={async () => {
                      const next = !c.publishedAt;
                      try { await publish.mutateAsync({ id: c.id, studentProfileId: studentId, publish: next }); notify.success(next ? 'Published to portals' : 'Unpublished'); }
                      catch { notify.error('Publish failed'); }
                    }}>
                    {c.publishedAt ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openPdf(c.id)}><FileText className="h-4 w-4" /> PDF</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
