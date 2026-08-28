import { useActiveStudent } from '@/stores/auth.store';
import { useStudentDashboard } from '@/lib/portal-api';
import { ResultsPanel } from '@/routes/shared/results-panel';
import { Skeleton, Empty, PageTitle } from '@/components/ui';

/**
 * A guardian looking at their child's results.
 *
 * Same data and same component as the pupil's own results screen — the pupil
 * view keyed to a different subject. The server resolves that subject from the
 * token's portal claim and refuses any pupil this guardian does not hold, so the
 * id in the URL is a request rather than an entitlement.
 */
export default function ParentResults() {
  const active = useActiveStudent();
  const { data, isLoading } = useStudentDashboard(active?.studentProfileId);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!data) return <Empty title="No results published yet" hint="Results appear here once the school releases them." />;

  return (
    <div className="space-y-4">
      <PageTitle sub={active?.name}>Results</PageTitle>
      <ResultsPanel data={data} studentProfileId={active?.studentProfileId} />
    </div>
  );
}
