import { AlertTriangle, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Why a request failed, in words a member of staff can act on. */
export function describeQueryError(error: unknown): string {
  const e = error as any;
  const status: number | undefined = e?.response?.status;
  const msg = e?.response?.data?.message;
  if (status === 403) return typeof msg === 'string' ? msg : 'You do not have access to this list.';
  if (status === 401) return 'Your session has ended. Sign in again.';
  if (!e?.response) return 'Could not reach the server. Check the connection and try again.';
  return typeof msg === 'string' ? msg : Array.isArray(msg) ? msg.join('; ') : 'Something went wrong loading this list.';
}

/**
 * The failed-request state (F20). A list that failed to load must never look
 * like an empty school: this says it failed, why, and offers a retry.
 */
export function QueryError({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={`flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive ${className ?? ''}`}>
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{describeQueryError(error)}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Try again
        </Button>
      )}
    </div>
  );
}

/** Page controls with a visible count, so nothing past page one is out of reach (F17). */
export function ListPager({
  page,
  pageSize,
  total,
  onPage,
  noun = 'records',
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm text-muted-foreground">
      <span>{total === 0 ? `No ${noun}` : `${from}–${to} of ${total} ${noun}`}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
