import { Link } from 'react-router-dom';
import { BookOpen, CheckCircle2 } from 'lucide-react';
import { useSetupStatus, useTerms } from '@/features/school/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth.store';
import { SetupChecklist } from './_components/SetupChecklist';

/**
 * School overview — the setup state of the school, moved off the dashboard.
 *
 * The dashboard is for the running term's work queue and figures; "is this
 * school set up yet" is a settings question that an administrator visits
 * deliberately, not something every user should meet on their landing page.
 */
export function SchoolOverviewPage() {
  const mayConfigure = useAuthStore(
    (s) => s.hasPermission('school:foundation:write') || s.hasPermission('setting:update'),
  );
  const { data: setup } = useSetupStatus(mayConfigure);
  const { data: terms } = useTerms();
  const currentTerm = terms?.data?.find((t) => t.isCurrent) ?? terms?.data?.[0];

  // SetupChecklist renders nothing once every step is done (or for a user who
  // cannot configure the school), so this page says so itself rather than
  // showing a heading over empty space.
  const allDone = !!setup && setup.done === setup.total;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {currentTerm ? currentTerm.name : 'This term'} at a glance
          </h1>
          <p className="text-sm text-muted-foreground">
            What is waiting on someone, how the term is marked, and where the fees stand.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/school/guide">
            <BookOpen className="mr-1 h-4 w-4" /> How the system works
          </Link>
        </Button>
      </div>

      <SetupChecklist />

      {!mayConfigure && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Setup steps are shown to administrators and head teachers.
          </CardContent>
        </Card>
      )}

      {mayConfigure && allDone && (
        <Card className="border-emerald-500/40">
          <CardContent className="flex items-start gap-3 p-6">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-medium">This school is fully set up.</p>
              <p className="text-sm text-muted-foreground">
                All {setup?.total} setup steps are done. Come back here after a new academic year or
                term to check nothing is missing.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
