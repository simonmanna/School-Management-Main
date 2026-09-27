import { useMemo, useState } from 'react';
import { Download, Printer, Send, RefreshCw, Settings2, Users, ArrowRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useStudents,
  useClasses,
  useTerms,
  useReportCardClassRoll,
  useGenerateClassReportCards,
  usePublishClassReportCards,
  downloadClassReportCards,
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
import { WorkflowSteps } from './_components/exam-workflow';

const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolReportCardsPage() {
  const navigate = useNavigate();
  const { data: students } = useStudents();
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();

  const [mode, setMode] = useState<'class' | 'pupil'>('class');
  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [termId, setTermId] = useState('');

  const { data: roll } = useReportCardClassRoll({ classId, termId });
  const generateClass = useGenerateClassReportCards();
  const publishClass = usePublishClassReportCards();
  const [printing, setPrinting] = useState(false);
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
      notify.success('Report card ready', {
        description: 'Check it below, then release it so the family can see it.',
      });
      refetch();
    } catch (e: any) {
      notify.error(
        e?.response?.data?.message ?? 'Could not build this report card',
        { description: 'This term’s marks have to be approved before a card can be built.' },
      );
    }
  };

  const doGenerateClass = async () => {
    if (!classId || !termId) return;
    try {
      const res = await generateClass.mutateAsync({ classId, termId });
      const className = (classes?.data ?? []).find((c: any) => c.id === classId)?.name ?? 'this class';
      notify.success(`${res.generated} report card${res.generated === 1 ? '' : 's'} ready for ${className}`, {
        description: res.skipped.length
          ? `${res.skipped.length} could not be built: ${res.skipped.slice(0, 3).map((x) => x.name ?? 'a pupil').join(', ')}${res.skipped.length > 3 ? '…' : ''}`
          : 'Release them next, so families can see them.',
        action: { label: 'Release all', onClick: () => void doPublishClass() },
      });
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not build the class’s report cards');
    }
  };

  const doPublishClass = async () => {
    if (!classId || !termId) return;
    try {
      const res = await publishClass.mutateAsync({ classId, termId });
      notify.success(`${res.published} report card${res.published === 1 ? '' : 's'} released to families`, {
        description: [
          res.notGenerated ? `${res.notGenerated} pupil${res.notGenerated === 1 ? ' has' : 's have'} no card yet — build those first.` : '',
          res.awaitingResults
            ? `${res.awaitingResults} card${res.awaitingResults === 1 ? ' is' : 's are'} held back: ${res.awaitingResults === 1 ? 'that pupil is' : 'those pupils are'} not in the released results yet (e.g. admitted later) — amend the results, then rebuild.`
            : '',
        ].filter(Boolean).join(' ') || 'They are now visible in the parent portal.',
        action: { label: 'Print class set', onClick: () => void doPrintClass() },
      });
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not release these report cards');
    }
  };

  const doPrintClass = async () => {
    if (!classId || !termId) return;
    setPrinting(true);
    try {
      const blob = await downloadClassReportCards({ classId, termId });
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e: any) {
      notify.error(
        'Could not print the class set',
        { description: e?.response?.data?.message ?? 'Only released report cards are printed. Release them first.' },
      );
    } finally {
      setPrinting(false);
    }
  };

  const doPublish = async (next: boolean) => {
    if (!card) return;
    try {
      await publish.mutateAsync({ id: card.id, studentProfileId: studentId, publish: next });
      notify.success(
        next ? 'Report card released to the family' : 'Report card withdrawn',
        next
          ? {
              description: 'It is now visible in the parent portal.',
              action: { label: 'Print class set', onClick: () => void doPrintClass() },
            }
          : { description: 'The family can no longer see it.' },
      );
      refetch();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not change who can see this report card');
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
      <div className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold">Report cards</h1>
          <p className="text-sm text-muted-foreground">
            Build report cards from this term’s approved marks, release them to families, and print the class set.
          </p>
        </div>
        <WorkflowSteps current={6} />
      </div>

      <div className="flex gap-1 rounded-md border bg-card p-1 text-sm w-fit">
        <button
          type="button"
          className={`rounded px-3 py-1.5 ${mode === 'class' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-accent'}`}
          onClick={() => setMode('class')}
        >
          Whole class
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1.5 ${mode === 'pupil' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-accent'}`}
          onClick={() => setMode('pupil')}
        >
          One pupil
        </button>
      </div>

      {mode === 'class' && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 space-y-1">
                <Label className="text-xs">Class</Label>
                <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
                  <option value="">Select…</option>
                  {(classes?.data ?? []).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
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
              <Button disabled={!classId || !termId || generateClass.isPending} onClick={doGenerateClass}>
                <RefreshCw className="h-4 w-4" /> Build all
              </Button>
              <Button variant="secondary" disabled={!classId || !termId || publishClass.isPending} onClick={doPublishClass}>
                <Send className="h-4 w-4" /> Release all
              </Button>
              <Button variant="ghost" disabled={!classId || !termId || printing} onClick={doPrintClass}>
                <Printer className="h-4 w-4" /> {printing ? 'Preparing…' : 'Print class set'}
              </Button>
            </div>

            {classId && termId && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                {roll === undefined
                  ? 'Counting pupils…'
                  : roll.length === 0
                    ? 'No pupils are enrolled in this class for this term.'
                    : `${roll.length} pupil${roll.length === 1 ? '' : 's'} enrolled this term.`}
              </p>
            )}
            {!classId && (
              <p className="text-sm text-muted-foreground">
                Pick a class and term to build the whole set at once.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {mode === 'pupil' && (
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
      )}

      {mode === 'pupil' && !studentId && (
        <p className="text-sm text-muted-foreground">Choose a pupil and term to build or view their report card.</p>
      )}

      {mode === 'pupil' && studentId && !card && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          No report card yet for this term. Click <span className="font-medium">Generate</span> to build it from the student's exams &amp; assessments.
        </CardContent></Card>
      )}

      {mode === 'pupil' && studentId && payload && <ReportCardView card={card} payload={payload} student={students?.data?.find((s: any) => s.id === studentId)} settings={settings} />}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <span className="text-muted-foreground">Once the cards are out:</span>
          <Button size="sm" variant="outline" onClick={() => navigate('/school/promotion')}>
            Move pupils up a class <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>
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
