import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Lock, Send } from 'lucide-react';
import {
  useBoardSheet, useSaveBoardMark, useSubmitAssessmentMarks, KIND_LABEL,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import { MarkGrid } from './_components/mark-grid';
import { fmtDate } from './_components/exam-workflow';

/**
 * Mark one assessment — the same screen whatever kind it is.
 *
 * There used to be three of these, reached three different ways, and which one
 * a teacher landed on depended on where they had started rather than on what
 * they were marking. Now the kind is a label at the top; the work below it is
 * identical.
 */
export function SchoolAssessmentMarkPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();
  const { data: sheet, isLoading, refetch } = useBoardSheet(assessmentId);
  const save = useSaveBoardMark(assessmentId);
  const submit = useSubmitAssessmentMarks();

  if (isLoading) return <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>;
  if (!sheet) return <p className="py-10 text-center text-sm text-muted-foreground">Assessment not found.</p>;

  const a = sheet.assessment;
  const complete = sheet.marked >= sheet.total && sheet.total > 0;
  const submitted = sheet.approvalStatus === 'submitted';
  const approved = sheet.approvalStatus === 'approved';

  async function onSubmit() {
    try {
      const res: any = await submit.mutateAsync(assessmentId!);
      notify.success(`${res?.updated ?? 0} mark(s) sent for approval.`);
      void refetch();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not submit these marks.');
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate('/school/assessments')}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All assessments
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{a.subject.name} — {a.title}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
            <span>{a.class.name}</span>
            <span aria-hidden>·</span>
            <span>out of {a.maxScore}</span>
            {a.dueAt && (<><span aria-hidden>·</span><span>due {fmtDate(a.dueAt)}</span></>)}
            {a.component && (
              <>
                <span aria-hidden>·</span>
                <span>counts toward {a.component.name} ({a.component.weight}%)</span>
              </>
            )}
          </p>
        </div>
        {approved && (
          <Badge variant="outline" className="border-emerald-600 text-emerald-700">
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approved
          </Badge>
        )}
        {a.locked && (
          <Badge variant="outline" className="border-amber-600 text-amber-700">
            <Lock className="mr-1 h-3.5 w-3.5" /> Locked
          </Badge>
        )}
      </div>

      {!a.component && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          This assessment is not attached to a weighting component, so it will not count toward the term
          mark. Attach it under Assessment Structure if it should.
        </p>
      )}

      <Card>
        <CardContent className="p-3">
          <MarkGrid
            students={sheet.students}
            maxScore={a.maxScore}
            locked={a.locked || approved}
            showGrade={false}
            onSave={async (student, payload) => {
              await save.mutateAsync({
                studentProfileId: student.studentProfileId,
                marks: payload.marks,
                participation: payload.participation,
              });
            }}
            footer={
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <span className="text-sm text-muted-foreground">
                  {sheet.marked} of {sheet.total} students marked
                  {!complete && sheet.total > 0 && ' — you can submit once everyone has an outcome.'}
                </span>
                {submitted ? (
                  <span className="text-sm text-muted-foreground">Awaiting approval</span>
                ) : approved ? null : (
                  <Button disabled={!complete || submit.isPending} onClick={onSubmit}>
                    <Send className="mr-1.5 h-4 w-4" /> Submit marks
                  </Button>
                )}
              </div>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
