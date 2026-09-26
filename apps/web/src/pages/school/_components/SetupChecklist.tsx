import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, BookOpen, ArrowRight } from 'lucide-react';
import { useSetupStatus } from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth.store';

const COLLAPSED_KEY = 'school.setup-checklist.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * "Get your school ready" — the first thing an administrator sees.
 *
 * A new school opened the app to ninety menu items and an empty dashboard,
 * with nothing saying where to start or in what order. Each step here is
 * computed from real records on the server, links straight to the screen that
 * does it, and says who normally does it. It disappears once everything is done.
 */
export function SetupChecklist() {
  // Only the people who set a school up need the checklist; a teacher does not.
  const mayConfigure = useAuthStore(
    (s) => s.hasPermission('school:foundation:write') || s.hasPermission('setting:update'),
  );
  const { data } = useSetupStatus(mayConfigure);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  if (!mayConfigure || !data || data.done === data.total) return null;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* private mode: the toggle still works for this visit */
    }
  };
  const nextStep = data.steps.find((s) => !s.done);
  const pct = Math.round((data.done / data.total) * 100);

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              {data.ready ? 'Almost there — a few finishing touches' : 'Get your school ready'}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {data.done} of {data.total} steps done. Work top to bottom — each step needs the ones above it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/school/guide">
                <BookOpen className="mr-1 h-4 w-4" /> How the system works
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={toggle} aria-expanded={!collapsed}>
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              <span className="sr-only">{collapsed ? 'Show steps' : 'Hide steps'}</span>
            </Button>
          </div>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </CardHeader>

      {collapsed ? (
        nextStep && (
          <CardContent className="pt-0">
            <Link to={nextStep.href} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Next: {nextStep.title} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        )
      ) : (
        <CardContent className="pt-0">
          <ol className="divide-y">
            {data.steps.map((step, i) => (
              <li key={step.id} className="flex items-start gap-3 py-3">
                {step.done ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-label="Done" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-label="Not done" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${step.done ? 'text-muted-foreground' : ''}`}>
                    {i + 1}. {step.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{step.why}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Usually done by: {step.who}
                    {step.detail ? ` · ${step.detail}` : ''}
                  </p>
                </div>
                {!step.done && (
                  <Button asChild size="sm" variant={step.id === nextStep?.id ? 'default' : 'outline'}>
                    <Link to={step.href}>{step.id === nextStep?.id ? 'Start' : 'Open'}</Link>
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      )}
    </Card>
  );
}
