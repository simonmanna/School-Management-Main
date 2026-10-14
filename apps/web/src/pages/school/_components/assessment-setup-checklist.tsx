import { Link } from 'react-router-dom';
import { CheckCircle2, Circle } from 'lucide-react';
import {
  useAssessmentPolicies, useCourseOfferings, useGradingScales, useRosters, useTeacherAssignments, useTerms,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * What has to exist before marks turn into term results — in the order the
 * academic office does it. These prerequisites used to surface only on the
 * Term Results readiness check, at the very end of the term; here they show
 * where assessments start, and the card disappears once all are done.
 */
export function AssessmentSetupChecklist({ termId }: { termId?: string }) {
  const { data: terms } = useTerms();
  const { data: offerings } = useCourseOfferings(termId || undefined);
  // Allocation lives on the Teacher Allocation grid (TeacherAssignment);
  // course offerings are the advanced route. Either counts.
  const { data: assignments } = useTeacherAssignments();
  const { data: policies } = useAssessmentPolicies();
  const { data: scales } = useGradingScales();
  const { data: rosters } = useRosters();

  const termRosters = (rosters?.data ?? []).filter((r) => !termId || r.termId === termId);
  const steps = [
    {
      done: (terms?.data ?? []).length > 0,
      label: 'Academic year and terms set up',
      to: '/school/management/terms',
    },
    {
      done: (offerings ?? []).length > 0 || (assignments ?? []).some((a: any) => !termId || a.termId === termId),
      label: 'Teachers allocated to classes and subjects',
      to: '/school/teaching-allocation',
    },
    {
      done: (policies?.data ?? []).some((p) => !!p.publishedAt),
      label: 'An assessment weighting published (parts add up to 100%)',
      to: '/school/assessment',
    },
    {
      done: (scales ?? []).some((s) => s.isDefault),
      label: 'A default grading scale',
      to: '/school/grading-scales',
    },
    {
      done: termRosters.some((r) => !!r.frozenAt),
      label: 'Class lists locked for this term (needed to work out results)',
      to: '/school/assessment-ops',
    },
  ];

  // Only render once everything has loaded, so the card doesn't flash.
  if (!terms || !offerings || !assignments || !policies || !scales || !rosters) return null;
  if (steps.every((s) => s.done)) return null;

  const left = steps.filter((s) => !s.done).length;
  return (
    <Card className="border-amber-500/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Before marks can count — {left} step{left === 1 ? '' : 's'} left</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-1.5 text-sm">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-2">
              {s.done
                ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
              {s.done
                ? <span className="text-muted-foreground">{s.label}</span>
                : <Link to={s.to} className="font-medium underline-offset-2 hover:underline">{s.label}</Link>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
