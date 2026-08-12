// Transfer Items — destination-table picker.
// The cashier has already selected the order items (+ partial quantities) in the
// OrderPanel; this modal only chooses which table receives them. Per the epic,
// the destination MAY be occupied (items are appended to its existing order).
import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, Users, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTables } from '@/features/tables/api';
import type { PosTable } from '@/features/tables/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Source table the items are leaving (excluded from the picker). */
  sourceTableId: string | null;
  /** Number of distinct items selected — shown in the header. */
  itemCount: number;
  /** Resolves with the chosen destination table id. */
  onConfirm: (targetId: string) => void | Promise<void>;
  busy?: boolean;
}

export const TransferItemsDialog: React.FC<Props> = ({
  open, onClose, sourceTableId, itemCount, onConfirm, busy,
}) => {
  const { data: tables = [], isLoading } = useTables({ active: true });
  const [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);

  React.useEffect(() => {
    if (!open) { setSearch(''); setTargetId(null); }
  }, [open]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables
      .filter((t) => t.id !== sourceTableId && !t.mergedIntoId && t.status !== 'out_of_service')
      .filter((t) => {
        if (!q) return true;
        return `${t.number} ${t.name} ${t.zone}`.toLowerCase().includes(q);
      })
      .sort((a, b) => a.number - b.number);
  }, [tables, sourceTableId, search]);

  const statusPill = (t: PosTable) =>
    t.status === 'occupied'
      ? 'bg-amber-100 text-amber-700'
      : t.status === 'reserved'
        ? 'bg-sky-100 text-sky-700'
        : 'bg-emerald-100 text-emerald-700';

  const confirm = async () => {
    if (!targetId) return;
    await onConfirm(targetId);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px] p-0 overflow-hidden">
        <DialogHeader className="bg-gradient-to-r from-pink-500 to-pink-700 text-white p-4">
          <DialogTitle className="text-white text-base font-bold flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" /> Transfer {itemCount} item{itemCount === 1 ? '' : 's'} — Move To
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search table…"
            className="h-9 text-sm"
          />
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[44vh] overflow-y-auto">
            {isLoading ? (
              <div className="col-span-full text-center text-slate-400 py-8">Loading tables…</div>
            ) : candidates.length === 0 ? (
              <div className="col-span-full text-center text-slate-400 py-8">No eligible tables</div>
            ) : (
              candidates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTargetId(t.id)}
                  className={`text-left rounded-xl border-2 p-2.5 transition ${
                    targetId === t.id
                      ? 'border-pink-600 bg-pink-50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">T{t.number}</div>
                  <div className="text-sm font-bold text-slate-800 leading-tight truncate">{t.name}</div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-1">
                    <Users className="w-3 h-3" /> {t.seats}
                    <span className={`ml-auto text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${statusPill(t)}`}>
                      {t.status === 'occupied' ? 'Occ' : t.status === 'reserved' ? 'Resv' : 'Free'}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 p-3 bg-slate-50 gap-2">
          <Button variant="ghost" onClick={onClose}>
            <X className="h-4 w-4 mr-1" /> Cancel
          </Button>
          <Button
            onClick={confirm}
            disabled={!targetId || busy}
            className="bg-pink-600 hover:bg-pink-700 text-white"
          >
            <ArrowRightLeft className="h-4 w-4 mr-1" /> {busy ? 'Transferring…' : 'Confirm Transfer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TransferItemsDialog;
