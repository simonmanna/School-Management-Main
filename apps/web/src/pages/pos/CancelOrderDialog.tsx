import React, { useState } from 'react';
import { toast } from 'sonner';
import { Ban, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useVoidSale } from '@/features/pos/api';
import { OverrideDialog } from './OverrideDialog';

interface Props {
  open: boolean;
  invoiceId: string | null;
  invoiceNumber: string | null;
  onClose: () => void;
  onDone: () => void;
}

export const CancelOrderDialog: React.FC<Props> = ({
  open, invoiceId, invoiceNumber, onClose, onDone,
}) => {
  const [reason, setReason] = useState('');
  const voidSale = useVoidSale();
  const [showOverride, setShowOverride] = useState(false);
  const overrideKind: 'discount' | 'void' | 'manual_refund' = 'void';
  // D6: one Idempotency-Key per submit attempt (stable across double-clicks, so
  // a rapid second click replays instead of double-voiding). Regenerated when
  // the body changes — i.e. when we retry with a manager override attached.
  const idemKeyRef = React.useRef<string>(crypto.randomUUID());

  React.useEffect(() => {
    if (!open) { setReason(''); setShowOverride(false); }
    else { idemKeyRef.current = crypto.randomUUID(); }
  }, [open]);

  const doCancel = async (overrideById?: string) => {
    if (!invoiceId || !reason.trim() || voidSale.isPending) return;
    // Override retry carries a different body → needs its own key.
    if (overrideById) idemKeyRef.current = crypto.randomUUID();
    try {
      await voidSale.mutateAsync({
        invoiceId,
        reason: reason.trim(),
        overrideById: overrideById ?? '',
        _idemKey: idemKeyRef.current,
      });
      toast.success(`Order ${invoiceNumber} cancelled`);
      onDone();
      onClose();
    } catch (e: any) {
      // 409 = the identical void is already in flight (server-side idempotency
      // lock). Not an error — the first request will complete.
      if (e?.response?.status === 409) {
        toast.info('This cancellation is already being processed.');
        return;
      }
      const msg = e?.response?.data?.message || 'Failed to cancel order';
      if (/manager override/i.test(msg)) {
        setTimeout(() => setShowOverride(true), 100);
        return;
      }
      toast.error(msg);
    }
  };

  return (
    <>
      <Dialog open={open && !showOverride} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <Ban className="w-4 h-4" /> Cancel Order
            </DialogTitle>
            <DialogDescription>
              Void order <strong>{invoiceNumber}</strong>. This requires a manager override.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-xs text-slate-500">
              A reason is required. This action is logged for audit.
            </div>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer request, duplicate order…"
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-sm resize-none h-20"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!reason.trim() || voidSale.isPending}
              onClick={() => doCancel()}
            >
              <Lock className="w-4 h-4 mr-1" /> Cancel Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OverrideDialog
        open={showOverride}
        kind={overrideKind}
        onClose={() => setShowOverride(false)}
        onVerified={(result) => {
          setShowOverride(false);
          if (result) doCancel(result.managerId);
        }}
      />
    </>
  );
};

export default CancelOrderDialog;
