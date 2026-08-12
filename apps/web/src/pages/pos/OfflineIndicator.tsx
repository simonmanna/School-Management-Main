/**
 * POS P11 — Online/offline indicator + queued-sales badge.
 * Designed to live in the Topbar.
 *
 * Also surfaces server-rejected sales (4xx on replay) parked in the
 * failed-sales store: a red badge opens a review dialog where the cashier
 * can retry (after the cause is fixed) or explicitly discard. A rejected
 * sale is money — it must never disappear without a human deciding so.
 */
import React from 'react';
import { Wifi, WifiOff, CloudUpload, AlertTriangle, RotateCcw, Trash2 } from 'lucide-react';
import { useOfflineQueue, useFailedSales, type FailedSale } from '@/features/pos/offline-queue';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

function saleAmount(sale: FailedSale): number | null {
  const tenders = sale.payload?.tenders;
  if (Array.isArray(tenders) && tenders.length > 0) {
    return tenders.reduce((s: number, t: any) => s + (Number(t?.amount) || 0), 0);
  }
  return null;
}

const FailedSaleRow: React.FC<{
  sale: FailedSale;
  onRetry: (key: string) => Promise<void>;
  onDiscard: (key: string) => Promise<void>;
}> = ({ sale, onRetry, onDiscard }) => {
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const amount = saleAmount(sale);

  const retry = async () => {
    setBusy(true);
    try {
      await onRetry(sale.idempotencyKey);
      toast.info('Sale moved back to the sync queue.');
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    setBusy(true);
    try {
      await onDiscard(sale.idempotencyKey);
      toast.warning('Sale discarded permanently.');
    } finally {
      setBusy(false);
      setConfirmingDiscard(false);
    }
  };

  return (
    <div className="rounded-md border border-rose-400/30 bg-rose-500/5 p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs opacity-70">{sale.idempotencyKey.slice(0, 8).toUpperCase()}</span>
        <span className="text-xs opacity-70">{new Date(sale.createdAt).toLocaleString()}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate">{sale.endpoint ?? '/pos/checkout'}</span>
        {amount != null && <span className="font-semibold whitespace-nowrap">{amount.toLocaleString()}</span>}
      </div>
      <div className="text-xs text-rose-300 break-words">
        {sale.httpStatus ? `HTTP ${sale.httpStatus} — ` : ''}{sale.lastError || 'Rejected by server'}
      </div>
      <div className="flex justify-end gap-2 pt-1">
        {confirmingDiscard ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={discard}
              className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2.5 py-1 text-xs text-white hover:bg-rose-500 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> Discard forever
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingDiscard(false)}
              className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
            >
              Keep
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={retry}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-400/50 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" /> Retry
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingDiscard(true)}
              className="inline-flex items-center gap-1 rounded-md border border-rose-400/50 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" /> Discard…
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export const OfflineIndicator: React.FC = () => {
  const { online, pending, replaying, replay } = useOfflineQueue();
  const { failed, retry, discard } = useFailedSales();
  const [reviewOpen, setReviewOpen] = React.useState(false);

  const onClick = () => {
    if (pending.length === 0) return;
    if (!online) {
      toast.warning(`Offline — ${pending.length} sale${pending.length === 1 ? '' : 's'} queued. They will sync when the network returns.`);
      return;
    }
    toast.info(`Syncing ${pending.length} pending sale${pending.length === 1 ? '' : 's'}…`);
    replay();
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        title={
          online
            ? pending.length > 0
              ? `Online — ${pending.length} sale${pending.length === 1 ? '' : 's'} queued. Click to sync.`
              : 'Online — all sales synced'
            : `Offline — ${pending.length} sale${pending.length === 1 ? '' : 's'} queued. Sales are stored locally and will sync when the network returns.`
        }
        className={
          'pos-tbl-pill ' +
          (online
            ? (pending.length > 0 ? '!bg-amber-500/20 !border-amber-400/50' : '!bg-emerald-500/20 !border-emerald-400/50')
            : '!bg-rose-500/20 !border-rose-400/50')
        }
      >
        {online ? (
          pending.length > 0 ? <AlertTriangle className="h-3.5 w-3.5 text-amber-200" /> : <Wifi className="h-3.5 w-3.5 text-emerald-200" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-rose-200" />
        )}
        <span className={online ? (pending.length > 0 ? 'text-amber-100' : 'text-emerald-100') : 'text-rose-100'}>
          {online ? (pending.length > 0 ? `${pending.length} queued` : 'Online') : `Offline · ${pending.length} queued`}
        </span>
        {pending.length > 0 && online && !replaying ? (
          <CloudUpload className="h-3 w-3 text-amber-200 ml-0.5" />
        ) : null}
      </button>

      {failed.length > 0 && (
        <button
          type="button"
          onClick={() => setReviewOpen(true)}
          title={`${failed.length} sale${failed.length === 1 ? '' : 's'} rejected by the server — click to review`}
          className="pos-tbl-pill !bg-rose-600/30 !border-rose-400/70 animate-pulse"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-rose-200" />
          <span className="text-rose-100">{failed.length} failed</span>
        </button>
      )}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Rejected offline sales</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            These queued sales were rejected by the server and were NOT recorded.
            Retry after the cause is fixed, or discard only if the sale was rung up
            another way.
          </p>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {failed.map((sale) => (
              <FailedSaleRow key={sale.idempotencyKey} sale={sale} onRetry={retry} onDiscard={discard} />
            ))}
            {failed.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing left to review.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
