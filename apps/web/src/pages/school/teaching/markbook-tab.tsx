import { useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCourseAssessments, useCourseLearners } from '@/features/school/teaching-api';
import { EmptyState, Progress } from '../_components/exam-workflow';

/**
 * The Markbook tab — marking progress for this course.
 *
 * Deliberately read-only. Scores have exactly one writer (the canonical marking
 * service behind the mark screen), so this shows where each column stands and
 * sends the teacher to that screen rather than opening a second grid that could
 * write marks by another route.
 */
export function MarkbookTab({ offeringId }: { offeringId: string }) {
  const navigate = useNavigate();
  const { data: assessments = [], isLoading } = useCourseAssessments(offeringId);
  const { data: learners = [] } = useCourseLearners(offeringId);

  const totalMarked = assessments.reduce((n: number, a: any) => n + (a.marked ?? 0), 0);
  const totalRows = assessments.reduce((n: number, a: any) => n + (a.learners ?? 0), 0);
  const totalApproved = assessments.reduce((n: number, a: any) => n + (a.approved ?? 0), 0);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading markbook…</p>;

  if (assessments.length === 0) {
    return <EmptyState title="Nothing to mark yet" hint="Once work is set for this class, its marking progress appears here." />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="h-4 w-4" /> Marking progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span>{learners.length} learners on the roster</span>
            <span>{totalMarked}/{totalRows} marks entered</span>
            <span>{totalApproved} approved</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2">Assessment</th>
                  <th className="py-2">Kind</th>
                  <th className="py-2">Entered</th>
                  <th className="py-2">Approved</th>
                  <th className="py-2">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {assessments.map((a: any) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{a.title}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{String(a.kind).toLowerCase()}</td>
                    <td className="py-2 pr-3"><Progress done={a.marked ?? 0} total={a.learners ?? 0} /></td>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">{a.approved ?? 0}</td>
                    <td className="py-2 pr-3"><Badge variant="secondary">{a.status}</Badge></td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => navigate(`/school/assessments/${a.id}/mark`)}>
                        Enter marks
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Marks are entered and submitted on the marking screen, which is the only place scores are written.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
