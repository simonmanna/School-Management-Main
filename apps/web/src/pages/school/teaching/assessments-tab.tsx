import { useNavigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCourseAssessments, useCourseCoverage } from '@/features/school/teaching-api';
import { EmptyState, Progress, fmtDate } from '../_components/exam-workflow';

const OUTCOME_TONE: Record<string, string> = {
  assessed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  delivered: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  planned: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  not_planned: 'bg-muted text-muted-foreground',
};

/**
 * The Assessments tab — the work set on this course, and how far the curriculum
 * has been evidenced.
 *
 * Marks are not entered here: the canonical marking screen stays the single
 * writer, and this deep-links into it.
 */
export function AssessmentsTab({ offeringId }: { offeringId: string }) {
  const navigate = useNavigate();
  const { data: assessments = [], isLoading } = useCourseAssessments(offeringId);
  const { data: coverage } = useCourseCoverage(offeringId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-4 w-4" /> Assessments</CardTitle>
            <Button size="sm" variant="outline" onClick={() => navigate('/school/assessments')}>New assessment</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && assessments.length === 0 && (
            <EmptyState title="No assessments yet" hint="Set homework, a CAT or a project for this class and it appears here." />
          )}
          {assessments.map((a: any) => (
            <button
              key={a.id}
              onClick={() => navigate(`/school/assessments/${a.id}/mark`)}
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition hover:border-primary hover:bg-accent/40"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{a.title}</div>
                <div className="text-xs text-muted-foreground">
                  {String(a.kind).toLowerCase()} · max {String(a.maxScore)}{a.dueAt ? ` · due ${fmtDate(a.dueAt)}` : ''}
                </div>
              </div>
              <div className="ml-2 flex shrink-0 items-center gap-3">
                <Progress done={a.marked ?? 0} total={a.learners ?? 0} />
                <Badge variant="secondary">{a.status}</Badge>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {coverage && coverage.outcomes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Curriculum outcomes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              {coverage.totals.planned}/{coverage.totals.total} planned · {coverage.totals.delivered} taught · {coverage.totals.assessed} assessed
            </p>
            {coverage.outcomes.map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{o.title}</div>
                  {o.schemeWeeks.length > 0 && (
                    <div className="text-xs text-muted-foreground">Scheme week {o.schemeWeeks.join(', ')}</div>
                  )}
                </div>
                <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs ${OUTCOME_TONE[o.state]}`}>
                  {o.state.replace('_', ' ')}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {coverage?.unmapped && (
        <p className="text-sm text-muted-foreground">{coverage.unmapped}</p>
      )}
    </div>
  );
}
