import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ShieldCheck, Undo2 } from 'lucide-react';
import {
  useAcademicYears, useApprovalQueue, useApproveAssessmentMarks, useClasses, useTerms,
  KIND_LABEL, type ApprovalRow,
} from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import { EmptyState, Picker, WorkflowSteps, useDefaulted, useStickyState } from './_components/exam-workflow';

/**
 * Approvals — the head of department's screen.
 *
 * Approving marks had no home: it was a tab inside a configuration page, which
 * meant the person accountable for the numbers had to go looking for them. This
 * is the queue, with the four figures an approver actually decides on — who
 * submitted, how many students, the average, and how many are still missing —
 * so the common case needs no marksheet at all.
 *
 * Segregation of duty is enforced in the service, not here: a teacher who
 * entered the marks is refused if they try to approve them, whatever the UI
 * offers.
 */
export function SchoolApprovalsPage() {
  const navigate = useNavigate();
  const { data: years } = useAcademicYears();
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();

  const [yearId, setYearId] = useStickyState('yearId');
  const [termId, setTermId] = useStickyState('termId');
  const [classId, setClassId] = useState('');

  const yearList = years?.data ?? [];
  const termList = useMemo(
    () => (terms?.data ?? []).filter((t) => !yearId || t.academicYearId === yearId),
    [terms, yearId],
  );
  useDefaulted(yearId, setYearId, yearList.find((y) => y.isCurrent)?.id ?? yearList[0]?.id);
  useDefaulted(termId, setTermId, termList.find((t) => t.isCurrent)?.id ?? termList[0]?.id);

  const { data, isLoading, refetch } = useApprovalQueue(termId || undefined, classId || undefined);
  const act = useApproveAssessmentMarks();
  const rows = data?.rows ?? [];

  async function decide(row: ApprovalRow, action: 'approve' | 'reject') {
    const reason = action === 'reject'
      ? window.prompt(`Send "${row.title}" back to ${row.submittedBy ?? 'the teacher'}. Why?`) ?? undefined
      : undefined;
    if (action === 'reject' && !reason) return;
    try {
      const res: any = await act.mutateAsync({ assessmentId: row.assessmentId, action, reason });
      // Approving is the last gate before results can be worked out, so say so
      // and offer the screen that does it — otherwise the approver is left on a
      // shrinking queue with no idea the term is now ready to compute.
      notify.success(
        action === 'approve'
          ? `${row.title}: ${res?.updated ?? 0} mark(s) approved.`
          : `${row.title} returned for correction.`,
        action === 'approve'
          ? {
              description: 'These marks can now go into the term result.',
              action: { label: 'Work out results', onClick: () => navigate('/school/results') },
            }
          : { description: `${row.submittedBy ?? 'The teacher'} can correct and resubmit.` },
      );
      void refetch();
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? `Could not ${action} these marks.`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold">Approve marks</h1>
          <p className="text-sm text-muted-foreground">
            Marks teachers have submitted, waiting on you. Approving lets them go into the term result.
          </p>
        </div>
        <WorkflowSteps current={4} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-3">
          <Picker label="Year" value={yearId} onChange={setYearId}
            options={yearList.map((y) => ({ value: y.id, label: y.name }))} />
          <Picker label="Term" value={termId} onChange={setTermId}
            options={termList.map((t) => ({ value: t.id, label: t.name }))} />
          <Picker label="Class" value={classId} onChange={setClassId} placeholder="All classes"
            options={(classes?.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="Nothing waiting on you"
          hint="Marks appear here the moment a teacher submits them."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Assessment</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Submitted by</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Students</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Average</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Missing</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.assessmentId} className="border-t">
                  <td className="px-3 py-2">
                    <Link to={`/school/assessments/${r.assessmentId}/mark`} className="font-medium hover:underline">
                      {r.subject} — {r.title}
                    </Link>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                      {r.class}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.submittedBy ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.students}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.average === null ? '—' : `${r.average}%`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.missing > 0 ? (
                      <span className="flex items-center justify-end gap-1 text-amber-600">
                        <AlertTriangle className="h-3.5 w-3.5" /> {r.missing}
                      </span>
                    ) : '0'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => decide(r, 'reject')}>
                        <Undo2 className="mr-1 h-3.5 w-3.5" /> Return
                      </Button>
                      <Button size="sm" disabled={act.isPending} onClick={() => decide(r, 'approve')}>
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
