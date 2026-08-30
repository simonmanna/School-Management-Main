import { CloudOff, RefreshCw, CheckCircle2 } from 'lucide-react';
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
 */
export function OfflineBanner() {
  const { online, pending, replay } = useSchoolOfflineQueue((r) => {
    if (r.sent > 0) {
      notify.success(`${r.sent} saved entr${r.sent === 1 ? 'y' : 'ies'} sent to the server`);
    }
    for (const rej of r.rejected) {
      notify.error(rej.label ? `${rej.label} was not accepted` : 'An entry was not accepted', {
        description: rej.reason,
      });
    }
  });

  if (online && pending.length === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm ${
        online ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'
      }`}
      role="status"
    >
      {online ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
      ) : (
        <CloudOff className="h-4 w-4 shrink-0 text-amber-600" />
      )}
      <span className="min-w-0">
        {!online && (
          <strong className="font-medium">No connection to the school server. </strong>
        )}
        {pending.length > 0
          ? `${pending.length} entr${pending.length === 1 ? 'y is' : 'ies are'} saved on this device and will be sent automatically.`
          : 'Your work is being saved on this device until the connection returns.'}
      </span>
      {pending.length > 0 && online && (
        <Button size="sm" variant="outline" onClick={() => void replay()}>
          <RefreshCw className="h-3.5 w-3.5" /> Send now
        </Button>
      )}
    </div>
  );
}
