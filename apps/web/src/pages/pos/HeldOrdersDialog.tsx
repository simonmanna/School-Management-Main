import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
// Held-orders drawer — list of parked tickets + one-tap "Recall".
import React, { useState } from 'react';
import { Pause, Play, RefreshCw, Clock, Hash, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useHeldOrders, useRecallHold, useCancelHold } from './api';
import type { CartLine } from '@/features/pos/types';

const fmt = (n: number | string) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when the cashier taps "Resume". Parent loads the hold into the cart. */
  onRecall: (input: { id: string; name: string; lines: CartLine[] }) => void;
}

export const HeldOrdersDialog: React.FC<Props> = ({ open, onClose, onRecall }) => {
  const { data: list = [], isLoading, refetch } = useHeldOrders('open');
  const recall = useRecallHold();
  const cancel = useCancelHold();
  const [busy, setBusy] = useState(false);

  const handleRecall = async (hold: any) => {
    try {
      setBusy(true);
      await recall.mutateAsync(hold.id);
      const cartLines: CartLine[] = (hold.lines ?? []).map((ln: any) => ({
        lineId: ln.id,
        productId: ln.productId ?? undefined,
        sku: undefined,
        name: ln.description,
        quantity: Number(ln.quantity),
        unitPrice: Number(ln.unitPrice),
        discountPercent: Number(ln.discountPercent ?? 0),
        taxId: ln.taxId ?? undefined,
        note: ln.note ?? undefined,
      }));
      onRecall({ id: hold.id, name: hold.name, lines: cartLines });
      onClose();
    } catch (e) {
      // toast handled in api layer
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (hold: any) => {
    try {
      setBusy(true);
      await cancel.mutateAsync(hold.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[640px] p-0 overflow-hidden">
        <DialogHeader className="bg-gradient-to-r from-amber-500 to-amber-700 text-white p-4">
          <DialogTitle className="text-white text-base font-bold flex items-center gap-2">
            <Pause className="h-4 w-4" /> Held / parked orders
          </DialogTitle>
          <DialogDescription className="text-amber-100 text-xs">
            Pick a parked ticket to recall it into the cart, or cancel it if it's no longer needed.
          </DialogDescription>
        </DialogHeader>
        <div className="p-3 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <p className="text-center text-slate-500 py-6">Loading…</p>
          ) : list.length === 0 ? (
            <div className="text-center py-10 text-slate-500">
              <Pause className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="font-semibold">No held orders</p>
              <p className="text-xs mt-1">Held tickets will show here so you can recall them later.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {list.map((o: any) => {
                const itemCount = (o.lines ?? []).length;
                const heldAgo = o.createdAt ? new Date(o.createdAt) : null;
                const mins = heldAgo ? Math.floor((Date.now() - heldAgo.getTime()) / 60000) : 0;
                return (
                  <div key={o.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white hover:border-amber-400 transition-colors">
                    <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                      <Pause className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm flex items-center gap-2">
                        <Hash className="h-3 w-3 text-slate-400" />
                        {o.name}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-3 mt-0.5">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{mins}m ago</span>
                        <span>{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                        <span className="font-mono font-bold text-amber-600">{fmt(o.totalAmount)}</span>
                      </div>
                      {o.notes ? <div className="text-xs text-slate-600 italic mt-1">"{o.notes}"</div> : null}
                    </div>
                    <Button onClick={() => handleRecall(o)} disabled={busy} style={{ background: '#16a34a' }}>
                      <Play className="h-4 w-4 mr-1" /> Recall
                    </Button>
                    <Button onClick={() => handleCancel(o)} disabled={busy} variant="outline" className="border-rose-300 text-rose-600">
                      <X className="h-4 w-4 mr-1" /> Cancel
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter className="border-t border-slate-200 p-3 bg-slate-50">
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};