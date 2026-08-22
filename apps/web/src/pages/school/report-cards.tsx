import { useMemo, useState } from 'react';
import { Download, Printer, Send, RefreshCw, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  useStudents,
  useTerms,
  useReportCards,
  useReportCardSettings,
  useDefaultGradingScale,
  useSchoolProfile,
  useGenerateReportCard,
  usePublishReportCard,
  type ReportCard,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import {
  ReportCardPreview,
  SAMPLE_PREVIEW_DATA,
  pageDimensions,
  type ReportCardPreviewData,
} from './_components/report-card-preview';

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

/**
 * The on-screen report card. Rendered by the same component the Report Card
 * Studio previews and the PDF renderer mirrors, so what an administrator
 * designs is what a parent sees here and what comes out of the printer.
 */
function ReportCardView({
  card,
  payload,
  student,
  settings,
}: {
  card: ReportCard;
  payload: NonNullable<ReportCard['payload']>;
  student?: any;
  settings?: Record<string, any>;
}) {
  const { data: school } = useSchoolProfile();
  const { data: scale } = useDefaultGradingScale();

  const data = useMemo<ReportCardPreviewData>(() => ({
    school: school
      ? {
          name: school.name ?? SAMPLE_PREVIEW_DATA.school.name,
          motto: (school as any).motto ?? undefined,
          address: (school as any).address ?? undefined,
          phone: (school as any).phone ?? undefined,
          email: (school as any).email ?? undefined,
          website: (school as any).website ?? undefined,
          logoUrl: (school as any).logoUrl ?? undefined,
        }
      : SAMPLE_PREVIEW_DATA.school,
    student: {
      name: student?.partner?.name ?? '—',
      admissionNo: student?.admissionNo ?? '—',
      gender: student?.gender ?? '—',
      className: student?.currentClass?.name ?? student?.className ?? '—',
      stream: student?.currentStream?.name ?? '—',
      dateOfBirth: student?.dateOfBirth ?? undefined,
      house: student?.house ?? undefined,
    },
    term: {
      name: payload.term?.name ?? payload.termName ?? '—',
      startDate: payload.term?.startDate,
      endDate: payload.term?.endDate,
    },
    sections: (payload.sections ?? []).map((sec) => ({
      title: sec.title,
      subjects: (sec.subjects ?? []).map((s) => ({
        subject: s.subject,
        subjectCode: s.subjectCode,
        examScores: (s.examScores ?? []).map((x) => ({ examType: x.examType, marks: x.marks, maxMarks: x.maxMarks })),
        totalPercent: s.totalPercent ?? 0,
        finalGrade: s.finalGrade ?? undefined,
        finalPoints: s.finalPoints ?? undefined,
        remark: s.remark ?? undefined,
      })),
    })),
    summary: payload.summary ?? [],
    stats: {
      gpa: payload.gpa ?? undefined,
      rank: payload.rank ?? undefined,
      meanPercent: payload.meanPercent ?? undefined,
      division: payload.division ?? undefined,
      aggregate: (payload.summary ?? []).find((x) => /aggregate/i.test(x.label))?.value,
    },
    comments: {
      classTeacher: payload.classTeacherComment ?? undefined,
      headTeacher: payload.principalComment ?? undefined,
    },
    // Attendance is not part of the report card payload; the block hides
    // itself when there is nothing to show.
    attendance: { present: 0, absent: 0, late: 0, total: 0 },
    gradeBands: (scale?.bands ?? []).map((b) => ({ min: b.min, max: b.max, grade: b.grade, remark: b.remark })),
    eligible: payload.eligible ?? undefined,
  }), [payload, student, school, scale]);

  const print = () => {
    const node = document.querySelector('[data-report-card-page]');
    if (!node) return;
    const w = window.open('', '_blank', 'width=900,height=1200');
    if (!w) {
      notify.error('Allow pop-ups to print this report card');
      return;
    }
    const page = pageDimensions(settings ?? {});
    w.document.write(
      `<!doctype html><html><head><title>${data.student.name} — ${data.term.name}</title>` +
      `<style>@page{size:${page.w}mm ${page.h}mm;margin:0}body{margin:0}</style>` +
      `</head><body>${node.outerHTML}</body></html>`,
    );
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {card.publishedAt ? <Badge>Published</Badge> : <Badge variant="secondary">Draft</Badge>}
            <span>Generated {card.generatedAt ? new Date(card.generatedAt).toLocaleString() : '—'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={print}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/school/report-card-settings">
                <Settings2 className="h-4 w-4" /> Design
              </Link>
            </Button>
          </div>
        </div>

        <div className="overflow-auto rounded-md bg-muted/40 p-3">
          <div className="mx-auto w-fit shadow-md">
            <ReportCardPreview settings={settings ?? {}} data={data} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
