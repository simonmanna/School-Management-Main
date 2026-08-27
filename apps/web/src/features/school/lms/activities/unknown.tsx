import { HelpCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { ActivityViewProps } from './shared';

/**
 * Fallback for an activity type with no registered viewer.
 *
 * Deliberately says so in plain language rather than dumping the payload. The
 * page this replaced ended with:
 *
 *   <pre>{JSON.stringify(view, null, 2)}</pre>
 *
 * which showed students internal ids and schema shapes for every type the client
 * did not recognise — 14 of the 18 registered types at the time.
 */
export function UnknownActivity({ view }: ActivityViewProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
        <HelpCircle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">This activity cannot be displayed here yet</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          &ldquo;{view.module.name}&rdquo; is a <code>{view.module.activityType}</code> activity,
          which has no viewer on this installation. Ask your administrator to enable it.
        </p>
      </CardContent>
    </Card>
  );
}
