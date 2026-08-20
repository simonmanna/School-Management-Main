import { useState } from 'react';
import { Download, Send, RefreshCw } from 'lucide-react';
import {
  useStudents,
  useTerms,
  useReportCards,
  useReportCardSettings,
  useGenerateReportCard,
  usePublishReportCard,
  type ReportCard,
  type ReportCardSettings,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolReportCardsPage() {
  const { data: students } = useStudents();
  const { data: terms } = useTerms();

  const [studentId, setStudentId] = useState('');
  const [termId, setTermId] = useState('');
  const { data: cards, refetch } = useReportCards(studentId || undefined);
  const { data: settings } = useReportCardSettings();
  const generate = useGenerateReportCard();
  const publish = usePublishReportCard();

  const card: ReportCard | undefined = (cards ?? []).find((c) => c.termId === termId) ?? (termId ? undefined : (cards ?? [])[0]);
  const payload = card?.payload;

  const doGenerate = async () => {
    if (!studentId || !termId) return;
    try {
      await generate.mutateAsync({ studentProfileId: studentId, termId });
      notify.success('Report card generated');
      refetch();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Generate failed — grades must be approved/computed first');
    }
  };

  const doPublish = async (next: boolean) => {
    if (!card) return;
    try {
      await publish.mutateAsync({ id: card.id, studentProfileId: studentId, publish: next });
      notify.success(next ? 'Published to portals' : 'Unpublished');
      refetch();
    } catch {
      notify.error('Publish failed');
    }
  };

  const openPdf = async (id: string) => {
    try {
      const res = await api.get(`/school/report-cards/${id}/pdf`, { responseType: 'blob' });
      window.open(URL.createObjectURL(res.data as Blob), '_blank');
    } catch {
      notify.error('Could not open PDF');
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Report Cards</h1>
        <p className="text-sm text-muted-foreground">Generate and view student report cards with exams &amp; assessments.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 space-y-1">
          <Label className="text-xs">Student</Label>
          <select className={sel} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select…</option>
            {(students?.data ?? []).map((s: any) => (
              <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Term</Label>
          <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="">Select…</option>
            {(terms?.data ?? []).map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <Button disabled={!studentId || !termId || generate.isPending} onClick={doGenerate}>
          <RefreshCw className="h-4 w-4" /> {card ? 'Regenerate' : 'Generate'}
        </Button>
        {card && (
          <>
            <Button variant="secondary" disabled={publish.isPending} onClick={() => doPublish(!card!.publishedAt)}>
              <Send className="h-4 w-4" /> {card.publishedAt ? 'Unpublish' : 'Publish'}
            </Button>
            <Button variant="ghost" onClick={() => openPdf(card.id)}>
              <Download className="h-4 w-4" /> PDF
            </Button>
          </>
        )}
      </div>

      {!studentId && <p className="text-sm text-muted-foreground">Choose a student and term to generate or view a report card.</p>}

      {studentId && !card && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          No report card yet for this term. Click <span className="font-medium">Generate</span> to build it from the student's exams &amp; assessments.
        </CardContent></Card>
      )}

      {studentId && payload && <ReportCardView card={card} payload={payload} student={students?.data?.find((s: any) => s.id === studentId)} settings={settings} />}
    </div>
  );
}

function ReportCardView({ card, payload, student, settings }: { card: ReportCard; payload: NonNullable<ReportCard['payload']>; student?: any; settings?: ReportCardSettings }) {
  const cfg = settings ?? ({} as Partial<ReportCardSettings>);
  const show = (k: keyof ReportCardSettings) => cfg[k] === undefined ? true : Boolean(cfg[k]);
  const color = (k: keyof ReportCardSettings, fallback: string) => (cfg[k] ? String(cfg[k]) : fallback);
  const sections = payload.sections ?? [];
  const allSubjects = sections.flatMap((s) => s.subjects);

  // Flatten the distinct exam/assessment column labels from data.
  const examCols = Array.from(new Set(allSubjects.flatMap((s) => (s.examScores ?? []).map((x) => x.examType))));

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        {/* Header */}
        <div className="border-b pb-3">
          <h2 className="text-lg font-bold" style={{ color: color('reportTitleColor', 'inherit') }}>School Report Card</h2>
          <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm md:grid-cols-3">
            <Info label="NAME" value={student?.partner?.name ?? ''} />
            <Info label="REG NO" value={student?.admissionNo ?? ''} />
            <Info label="GENDER" value={student?.gender ?? ''} />
            <Info label="CLASS" value={student?.classId ? className(student) : ''} />
            <Info label="TERM" value={payload.term?.name ?? payload.termName ?? ''} />
            {show('showTermStartDate') && payload.term?.startDate && <Info label="TERM START" value={String(payload.term.startDate)} />}
            {show('showTermEndDate') && payload.term?.endDate && <Info label="TERM END" value={String(payload.term.endDate)} />}
            {show('showFeesBalance') && <Info label="FEES BALANCE" value={student?.feesBalance ? String(student.feesBalance) : 'UGX 0'} />}
            {payload.rank != null && <Info label="CLASS RANK" value={`${payload.rank}`} />}
            {payload.meanPercent != null && <Info label="MEAN %" value={`${payload.meanPercent}`} />}
            {payload.gpa != null && <Info label="GPA" value={`${payload.gpa}`} />}
          </div>
        </div>

        {/* Subject tables (exams & assessments) */}
        {sections.map((sec, i) => (
          <div key={i}>
            <h3 className="mb-1 text-sm font-semibold">{sec.title}</h3>
            <div className="overflow-x-auto">
              <table className="w-full border text-sm">
                <thead className="bg-muted/50 text-left text-xs">
                  <tr>
                    <th className="border px-2 py-1 font-medium">SUBJECT</th>
                    {examCols.map((ec) => (
                      <th key={ec} className="border px-2 py-1 text-center font-medium">{ec}</th>
                    ))}
                    <th className="border px-2 py-1 text-center font-medium">%</th>
                    <th className="border px-2 py-1 text-center font-medium">GRADE</th>
                    <th className="border px-2 py-1 text-center font-medium">PTS</th>
                    <th className="border px-2 py-1 font-medium">COMMENT</th>
                  </tr>
                </thead>
                <tbody>
                  {sec.subjects.length === 0 && (
                    <tr><td colSpan={examCols.length + 5} className="border px-2 py-2 text-muted-foreground">No subjects recorded.</td></tr>
                  )}
                  {sec.subjects.map((s, j) => (
                    <tr key={j} className="border-b">
                      <td className="border px-2 py-1 font-medium">{s.subject}{s.subjectCode ? ` (${s.subjectCode})` : ''}</td>
                      {examCols.map((ec) => {
                        const sc = (s.examScores ?? []).find((x) => x.examType === ec);
                        return (
                          <td key={ec} className="border px-2 py-1 text-center">
                            {sc ? `${sc.marks}/${sc.maxMarks}` : '—'}
                          </td>
                        );
                      })}
                      <td className="border px-2 py-1 text-center">{s.totalPercent ?? '—'}</td>
                      <td className="border px-2 py-1 text-center font-semibold">{s.finalGrade ?? '—'}</td>
                      <td className="border px-2 py-1 text-center">{s.finalPoints ?? '—'}</td>
                      <td className="border px-2 py-1 text-xs text-muted-foreground">{s.remark ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* Summary */}
        {payload.summary && payload.summary.length > 0 && (
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm md:grid-cols-4">
            {payload.summary.map((s, i) => (
              <div key={i}><span className="text-muted-foreground">{s.label}: </span><span className="font-medium">{s.value}</span></div>
            ))}
          </div>
        )}

        {/* Comments */}
        {(show('showClassTeacherComment') && payload.classTeacherComment) || (show('showHeadTeacherComment') && payload.principalComment) ? (
          <div className="grid gap-2 border-t pt-3 text-sm md:grid-cols-2">
            {show('showClassTeacherComment') && payload.classTeacherComment && (
              <div><div className="text-xs font-semibold text-muted-foreground">CLASS TEACHER COMMENT</div><p>{payload.classTeacherComment}</p></div>
            )}
            {show('showHeadTeacherComment') && payload.principalComment && (
              <div><div className="text-xs font-semibold text-muted-foreground">HEAD TEACHER COMMENT</div><p>{payload.principalComment}</p></div>
            )}
          </div>
        ) : null}

        {show('showWatermark') && (
          <div className="pointer-events-none mt-3 text-center text-xs text-muted-foreground opacity-40">CONFIDENTIAL — SCHOOL REPORT</div>
        )}

        <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
          <span>{card.publishedAt ? <Badge>Published</Badge> : <Badge variant="secondary">Draft</Badge>}</span>
          <span>Generated {card.generatedAt ? new Date(card.generatedAt).toLocaleString() : ''}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs font-semibold text-muted-foreground">{label}: </span>
      <span>{value || '—'}</span>
    </div>
  );
}

function className(s: any): string {
  return s.currentClass?.name ?? s.className ?? s.classId ?? '';
}
