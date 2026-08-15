import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  children: ReactNode;
  /** Changing this value clears the error — pass the route path so navigating away recovers. */
  resetKey?: string;
}

interface State {
  error: Error | null;
  resetKey?: string;
}

/**
 * Catches render-time throws so a single bad page cannot blank the whole app.
 *
 * The app shell (sidebar + header) stays mounted around this boundary, so the
 * user can navigate away from a broken screen instead of reloading. Errors are
 * logged to the console with the component stack for triage.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  /** Clear the error when the route changes, so navigation always recovers. */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (state.error && state.resetKey !== undefined && props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    if (state.resetKey !== props.resetKey) return { resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[RouteErrorBoundary]', error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="p-6">
        <Card className="mx-auto max-w-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              This screen ran into a problem
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The rest of the app is still working — use the menu to go elsewhere, or try again.
            </p>
            <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
              {error.message || String(error)}
            </pre>
            <Button variant="outline" size="sm" onClick={this.retry}>
              <RotateCcw className="h-4 w-4" /> Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
}
