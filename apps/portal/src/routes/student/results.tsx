import { useActiveStudent } from '@/stores/auth.store';
import { useStudentDashboard } from '@/lib/portal-api';
import { ResultsPanel } from '@/routes/shared/results-panel';
import { Skeleton, Empty, PageTitle } from '@/components/ui';

/** The pupil's own results. Only what the school has published. */
export default function StudentResults() {
  const active = useActiveStudent();
  const { data, isLoading } = useStudentDashboard(active?.studentProfileId);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!data) return <Empty title="Nothing to show yet" />;

  return (
    <div className="space-y-4">
      <PageTitle>Results</PageTitle>
      <ResultsPanel data={data} studentProfileId={active?.studentProfileId} />
    </div>
  );
}
