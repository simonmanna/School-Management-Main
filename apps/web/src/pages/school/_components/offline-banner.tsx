import { CloudOff, RefreshCw, CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/notify';
import { useSchoolOfflineQueue } from '@/features/school/offline-queue';

/**
 * Connection state for the two screens a teacher uses under a bad connection.
 *
 * It stays out of the way when everything is fine — a permanent "you are
 * online" strip is noise — and only appears when there is either no server or
 * unsent work. Both facts matter to a teacher and neither was visible before:
 * a dropped save just showed an error toast and lost the entry.
 *
 * R02: it lists only the signed-in person's own saved work. Work saved by
 * someone else on this device is counted, never shown or sent.
 */
export function OfflineBanner() {
  const { online, pending, othersCount, replay, retry, discard } = useSchoolOfflineQueue((r) => {
    if (r.sent > 0) {
      notify.success(`${r.sent} saved entr${r.sent === 1 ? 'y' : 'ies'} sent to the server`);
    }
    for (const rej of r.rejected) {
      notify.error(rej.label ? `${rej.label} was not accepted` : 'An entry was not accepted', {
        description: `${rej.reason} It is kept below until you discard it.`,
      });
    }
    if (r.authBlocked > 0) {
      notify.warning('Saved work is waiting', {
        description: 'The server refused this sign-in. Sign in again, then press Send now.',
      });
    }
  });

  const waiting = pending.filter((p) => p.state === 'pending');
  const problems = pending.filter((p) => p.state === 'rejected' || p.state === 'auth-blocked');

  if (online && pending.length === 0 && othersCount === 0) return null;

  return (
    <div
      className={`space-y-2 rounded-md border p-3 text-sm ${
        online && problems.length === 0 ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'
      }`}
      role="status"
    >
      <div className="flex flex-wrap items-center gap-3">
        {online ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        ) : (
          <CloudOff className="h-4 w-4 shrink-0 text-amber-600" />
        )}
        <span className="min-w-0">
          {!online && <strong className="font-medium">No connection to the school server. </strong>}
          {waiting.length > 0
            ? `${waiting.length} entr${waiting.length === 1 ? 'y is' : 'ies are'} saved on this device and will be sent automatically.`
            : pending.length === 0 && !online
              ? 'Your work is being saved on this device until the connection returns.'
              : null}
        </span>
        {(waiting.length > 0 || problems.some((p) => p.state === 'auth-blocked')) && online && (
          <Button size="sm" variant="outline" onClick={() => void replay()}>
            <RefreshCw className="h-3.5 w-3.5" /> Send now
          </Button>
        )}
      </div>

      {problems.length > 0 && (
        <ul className="space-y-1">
          {problems.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span className="min-w-0 flex-1">
                <strong className="font-medium">{p.label ?? 'Saved entry'}</strong>{' '}
                {p.state === 'auth-blocked'
                  ? '— waiting: the server refused this sign-in.'
                  : `— not accepted: ${p.lastError ?? 'the server refused it.'}`}
              </span>
              <Button size="sm" variant="ghost" onClick={() => void retry(p.id)}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm(`Discard "${p.label ?? 'this entry'}"? It has not been saved to the server.`)) void discard(p.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Discard
              </Button>
            </li>
          ))}
        </ul>
      )}

      {othersCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {othersCount} entr{othersCount === 1 ? 'y was' : 'ies were'} saved on this device by another account. They are
          kept for that person and will be sent when they sign in.
        </p>
      )}
    </div>
  );
}
