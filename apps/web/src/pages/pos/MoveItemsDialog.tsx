import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
// Move Items — two-step wizard.
// Step 1: Select items (with qty adjustment) from the current table.
// Step 2: Pick destination table. Uses the existing transferItems API.
import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, CheckSquare, Minus, Plus, Square, Users, X } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTables } from '@/features/tables/api';
import type { CartLine } from '@/features/pos/types';
import type { PosTable } from '@/features/tables/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Source table the items are leaving (excluded from picker). */
  tableId: string | null;
  /** Current cart lines to select from. */
  lines: CartLine[];
  /** Resolves with destination table id + selected items. */
  onConfirm: (targetId: string, selection: Array<{ lineId: string; quantity: number }>) => void | Promise<void>;
  busy?: boolean;
}

export const MoveItemsDialog: React.FC<Props> = ({
  open, onClose, tableId, lines, onConfirm, busy,
}) => {
  const { data: tables = [], isLoading: tblLoading } = useTables({ active: true });
  const [step, setStep] = useState<1 | 2>(1);
  const [sel, setSel] = useState<Record<string, number>>({});
  const [targetId, setTargetId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  React.useEffect(() => {
    if (!open) { setStep(1); setSel({}); setTargetId(null); setSearch(''); }
  }, [open]);

  /* ---- Step 1 helpers ---- */

  const toggleAll = () => {
    if (allChecked) { setSel({}); return; }
    const all: Record<string, number> = {};
    lines.forEach((l) => { all[l.lineId] = l.quantity; });
    setSel(all);
  };

  const toggle = (lineId: string) => {
    setSel((prev) => {
      const next = { ...prev };
      if (lineId in next) { delete next[lineId]; return next; }
      const line = lines.find((l) => l.lineId === lineId);
      if (line) next[lineId] = line.quantity;
      return next;
    });
  };

  const adj = (lineId: string, delta: number) => {
    setSel((prev) => {
      const cur = prev[lineId] ?? 0;
      const line = lines.find((l) => l.lineId === lineId);
      const max = line?.quantity ?? 0;
      const next = Math.max(1, Math.min(max, cur + delta));
      const nxt = { ...prev };
      if (next <= 0) delete nxt[lineId];
      else nxt[lineId] = next;
      return nxt;
    });
  };

  const allChecked = lines.length > 0 && lines.every((l) => l.lineId in sel);
  const selCount = Object.keys(sel).length;
  const canAdvance = selCount > 0 && Object.entries(sel).every(([lineId, qty]) => {
    const line = lines.find((l) => l.lineId === lineId);
    return line && qty >= 1 && qty <= line.quantity;
  });

  /* ---- Step 2 helpers ---- */

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables
      .filter((t) => t.id !== tableId && !t.mergedIntoId && t.status !== 'out_of_service')
      .filter((t) => {
        if (!q) return true;
        return `${t.number} ${t.name} ${t.zone}`.toLowerCase().includes(q);
      })
      .sort((a, b) => a.number - b.number);
  }, [tables, tableId, search]);

  const statusPill = (t: PosTable) =>
    t.status === 'occupied'
      ? 'bg-amber-100 text-amber-700'
      : t.status === 'reserved'
        ? 'bg-sky-100 text-sky-700'
        : 'bg-emerald-100 text-emerald-700';

  const statusLabel = (t: PosTable) =>
    t.status === 'occupied' ? 'Occupied'
      : t.status === 'reserved' ? 'Reserved'
        : 'Available';

  const confirm = async () => {
    if (!targetId || !canAdvance) return;
    const selection = Object.entries(sel)
      .filter(([_, qty]) => qty > 0)
      .map(([lineId, qty]) => ({ lineId, quantity: qty }));
    if (selection.length === 0) return;
    await onConfirm(targetId, selection);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden">
        <DialogHeader className="bg-gradient-to-r from-pink-500 to-pink-700 text-white p-4">
          <DialogTitle className="text-white text-base font-bold flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            {step === 1 ? 'Move Items — Select Items' : 'Move to Table'}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1 — Select Items */}
        {step === 1 && (
          <>
            <div className="p-4 space-y-2 max-h-[50vh] overflow-y-auto">
              {lines.length === 0 ? (
                <div className="text-center text-slate-400 py-8">Cart is empty</div>
              ) : (
                <>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={toggleAll}
                      className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 w-full text-left px-1 py-1 rounded"
                    >
                      {allChecked ? <CheckSquare className="h-4 w-4 text-pink-600" /> : <Square className="h-4 w-4" />}
                      {allChecked ? 'Deselect all' : 'Select all'}
                    </button>
                  )}

                  {lines.map((line) => {
                    const qty = sel[line.lineId] ?? 0;
                    const max = line.quantity;
                    const checked = line.lineId in sel;
                    return (
                      <div
                        key={line.lineId}
                        className={`flex items-center gap-3 p-2 rounded-lg border transition ${
                          checked ? 'border-pink-300 bg-pink-50' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <button type="button" onClick={() => toggle(line.lineId)} className="shrink-0">
                          {checked
                            ? <CheckSquare className="h-5 w-5 text-pink-600" />
                            : <Square className="h-5 w-5 text-slate-400" />
                          }
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-800 truncate">{line.name}</div>
                          {line.note && <div className="text-[11px] text-slate-400 truncate">{line.note}</div>}
                          <div className="text-xs text-slate-500">{orgCur()} {Number(line.unitPrice).toLocaleString()} ea</div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {checked && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); adj(line.lineId, -1); }}
                              disabled={qty <= 1}
                              className="w-7 h-7 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-slate-600"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <span className="w-8 text-center text-sm font-bold tabular-nums">
                            {checked ? qty : '-'}
                          </span>
                          {checked && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); adj(line.lineId, 1); }}
                              disabled={qty >= max}
                              className="w-7 h-7 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-30 text-slate-600"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        {checked && (
                          <div className="text-[10px] text-slate-400 w-10 text-right shrink-0">of {max}</div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            <DialogFooter className="border-t border-slate-200 p-3 bg-slate-50 gap-2">
              <Button variant="ghost" onClick={onClose}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button
                onClick={() => setStep(2)}
                disabled={!canAdvance}
                className="bg-pink-600 hover:bg-pink-700 text-white"
              >
                Next → <ArrowRightLeft className="h-4 w-4 ml-1" />
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 2 — Select Destination */}
        {step === 2 && (
          <>
            <div className="p-4 space-y-3">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search table…"
                className="h-9 text-sm"
              />
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[44vh] overflow-y-auto">
                {tblLoading ? (
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
                          {statusLabel(t)}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <DialogFooter className="border-t border-slate-200 p-3 bg-slate-50 gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                ← Back
              </Button>
              <Button
                onClick={confirm}
                disabled={!targetId || busy}
                className="bg-pink-600 hover:bg-pink-700 text-white"
              >
                <ArrowRightLeft className="h-4 w-4 mr-1" /> {busy ? 'Moving…' : 'Move Items'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default MoveItemsDialog;
