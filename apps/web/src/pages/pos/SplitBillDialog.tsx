import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
/**
 * SplitBillDialog — divide a table's open tab into multiple independently-payable
 * bills. Left pane = the order's items with the quantity still unassigned; right
 * pane = the bills. Pick a bill (it highlights), then add item quantities to it.
 * Each bill pays on its own (its own method + receipt); the table closes only
 * once every item is paid. Splitting never touches the kitchen.
 *
 * Backed by /pos/tabs/:tableId/split + /pos/split-bills/:billId/* (see api.ts).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Minus, X, Trash2, Printer, Wallet, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PaymentDialog } from './PaymentDialog';
import { ReceiptPreviewDialog } from './ReceiptPreviewDialog';
import {
  useSplitState, useAddSplitBills, useAssignSplitItems, useUnassignSplitItems,
  useMergeSplitBills, useDeleteSplitBill, useSettleSplitBill, useCancelSplit,
  type SplitBill,
} from './api';
import type { PaymentTender } from '@/features/pos/types';

const fmt = (n: number | string) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;

interface Props {
  open: boolean;
  tableId: string | null;
  tableLabel?: string;
  cashSessionId?: string;
  onClose: () => void;
  /** Fired when the table fully closes (all bills paid) so the parent can reset. */
  onTableClosed?: () => void;
}

export const SplitBillDialog: React.FC<Props> = ({ open, tableId, tableLabel, cashSessionId, onClose, onTableClosed }) => {
  const { data: state, isLoading } = useSplitState(tableId ?? undefined, open);
  const addBills = useAddSplitBills();
  const assignItems = useAssignSplitItems();
  const unassignItems = useUnassignSplitItems();
  const mergeBills = useMergeSplitBills();
  const deleteBill = useDeleteSplitBill();
  const settleBill = useSettleSplitBill();
  const cancelSplit = useCancelSplit();

  const [activeBillId, setActiveBillId] = useState<string | null>(null);
  const [qtyByLine, setQtyByLine] = useState<Record<string, number>>({});
  const [payingBill, setPayingBill] = useState<SplitBill | null>(null);
  const [receipt, setReceipt] = useState<{ invoiceId: string; invoiceNumber?: string; receiptHtml?: string } | null>(null);

  const bills = state?.bills ?? [];
  const lines = state?.lines ?? [];
  const summary = state?.summary;
  const openBills = useMemo(() => bills.filter((b) => b.status === 'open'), [bills]);

  // Keep an active (open) bill selected as the assignment target.
  useEffect(() => {
    if (!open) { setActiveBillId(null); return; }
    if (activeBillId && openBills.some((b) => b.id === activeBillId)) return;
    setActiveBillId(openBills[0]?.id ?? null);
  }, [open, openBills, activeBillId]);

  if (!tableId) return null;

  const busy = addBills.isPending || assignItems.isPending || unassignItems.isPending
    || mergeBills.isPending || deleteBill.isPending || cancelSplit.isPending;

  const stepFor = (lineId: string, max: number) => {
    const v = qtyByLine[lineId];
    return Math.max(1, Math.min(max, v ?? Math.max(1, max)));
  };
  const setStep = (lineId: string, v: number) => setQtyByLine((p) => ({ ...p, [lineId]: v }));

  const onAddBill = async () => {
    try {
      const res = await addBills.mutateAsync({ tableId });
      const created = res.bills.filter((b) => b.status === 'open');
      setActiveBillId(created[created.length - 1]?.id ?? activeBillId);
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Could not add a bill'); }
  };

  const onAssign = async (lineId: string, qty: number) => {
    if (!activeBillId) { toast.error('Pick a bill first'); return; }
    try {
      await assignItems.mutateAsync({ billId: activeBillId, tableId, items: [{ sourceItemId: lineId, quantity: qty }] });
      setQtyByLine((p) => ({ ...p, [lineId]: 0 }));
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Assign failed'); }
  };

  const onReturn = async (billId: string, sourceItemId: string, quantity: number) => {
    try {
      await unassignItems.mutateAsync({ billId, tableId, items: [{ sourceItemId, quantity }] });
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Return failed'); }
  };

  const onMerge = async (billId: string, targetBillId: string) => {
    try { await mergeBills.mutateAsync({ billId, targetBillId }); }
    catch (e: any) { toast.error(e?.response?.data?.message || 'Merge failed'); }
  };

  const onDelete = async (billId: string) => {
    try { await deleteBill.mutateAsync({ billId }); }
    catch (e: any) { toast.error(e?.response?.data?.message || 'Delete failed'); }
  };

  const onCancelSplit = async () => {
    try {
      await cancelSplit.mutateAsync({ tableId });
      toast.success('Split cancelled');
      onClose();
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Could not cancel the split'); }
  };

  const onPaySettle = async (input: { tenders: PaymentTender[] }) => {
    if (!payingBill) return;
    const res = await settleBill.mutateAsync({
      billId: payingBill.id, tableId, tenders: input.tenders, cashSessionId,
    });
    toast.success(`${payingBill.label} paid — change ${fmt(res.change ?? 0)}`);
    setPayingBill(null);
    if (res.invoiceId) setTimeout(() => setReceipt({ invoiceId: res.invoiceId, invoiceNumber: res.invoiceNumber, receiptHtml: res.receiptHtml }), 100);
    if (res.tableClosed) {
      toast.success('All bills paid — table closed');
      onTableClosed?.();
    }
  };

  return (
    <>
      <Dialog open={open && !payingBill && !receipt} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-[1000px] p-0 overflow-hidden">
          <DialogHeader className="bg-gradient-to-r from-indigo-600 to-indigo-800 text-white p-4">
            <DialogTitle className="text-white text-base font-bold flex items-center gap-2">
              Split Bill {tableLabel ? `· ${tableLabel}` : ''}
            </DialogTitle>
            <DialogDescription className="text-indigo-100 text-xs">
              Assign items to bills. Each bill pays on its own — the table closes when every bill is settled. Kitchen orders are unchanged.
            </DialogDescription>
          </DialogHeader>

          {/* Running balance bar */}
          {summary ? (
            <div className="grid grid-cols-4 divide-x divide-slate-200 border-b bg-slate-50 text-center text-xs">
              <div className="py-2"><div className="text-slate-400">Table total</div><div className="font-bold text-slate-800">{fmt(summary.tableTotal)}</div></div>
              <div className="py-2"><div className="text-slate-400">Unassigned</div><div className="font-bold text-amber-600">{fmt(summary.unassignedTotal)}</div></div>
              <div className="py-2"><div className="text-slate-400">Paid</div><div className="font-bold text-emerald-600">{fmt(summary.paidTotal)}</div></div>
              <div className="py-2"><div className="text-slate-400">Outstanding</div><div className="font-bold text-rose-600">{fmt(summary.outstandingTotal)}</div></div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 min-h-[420px] max-h-[60vh]">
            {/* Left — current order */}
            <div className="border-r border-slate-200 p-3 overflow-y-auto">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Current Order</div>
              {isLoading ? (
                <div className="text-center text-slate-400 py-8 text-sm">Loading…</div>
              ) : lines.length === 0 ? (
                <div className="text-center text-slate-400 py-8 text-sm">No open tab on this table.</div>
              ) : (
                <div className="space-y-1.5">
                  {lines.map((l) => {
                    const remaining = l.unassignedQty;
                    const step = stepFor(l.id, Math.max(1, Math.ceil(remaining)));
                    return (
                      <div key={l.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-800 truncate">{l.description}</div>
                            <div className="text-[11px] text-slate-400">
                              {fmt(l.unitPrice)} · qty {l.quantity}
                              {l.assignedQty > 0 && <span className="text-indigo-500"> · assigned {l.assignedQty}</span>}
                            </div>
                            {l.modifiers.length > 0 && <div className="text-[10px] text-slate-400 truncate">+ {l.modifiers.join(', ')}</div>}
                          </div>
                          <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded ' + (remaining > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                            {remaining > 0 ? `${remaining} left` : 'assigned'}
                          </span>
                        </div>
                        {remaining > 0 && (
                          <div className="flex items-center gap-2 mt-2">
                            <div className="flex items-center border border-slate-200 rounded-md">
                              <button type="button" className="px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40" disabled={step <= 1} onClick={() => setStep(l.id, step - 1)}><Minus className="h-3 w-3" /></button>
                              <span className="px-2 text-sm font-bold w-7 text-center">{step}</span>
                              <button type="button" className="px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40" disabled={step >= Math.ceil(remaining)} onClick={() => setStep(l.id, step + 1)}><Plus className="h-3 w-3" /></button>
                            </div>
                            <Button size="sm" className="h-7 text-xs flex-1" disabled={!activeBillId || busy} onClick={() => onAssign(l.id, step)}>
                              Add to {bills.find((b) => b.id === activeBillId)?.label ?? 'bill'}
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right — bills */}
            <div className="p-3 overflow-y-auto bg-slate-50">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Bills</div>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={lines.length === 0 || busy} onClick={onAddBill}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Bill
                </Button>
              </div>
              {bills.length === 0 ? (
                <div className="text-center text-slate-400 py-8 text-sm">Add a bill, then assign items to it.</div>
              ) : (
                <div className="space-y-2">
                  {bills.map((b) => {
                    const isActive = b.id === activeBillId;
                    const isOpen = b.status === 'open';
                    const mergeTargets = openBills.filter((o) => o.id !== b.id);
                    return (
                      <div
                        key={b.id}
                        onClick={() => isOpen && setActiveBillId(b.id)}
                        className={'rounded-lg border-2 bg-white p-3 transition-all ' + (isActive ? 'border-indigo-500 shadow-sm' : 'border-slate-200') + (isOpen ? ' cursor-pointer' : '')}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-slate-800">{b.label}</span>
                            {b.status === 'settled'
                              ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">PAID</span>
                              : isActive ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">SELECTED</span> : null}
                          </div>
                          <span className="text-sm font-bold text-slate-800">{fmt(b.totalAmount)}</span>
                        </div>
                        {b.items.length === 0 ? (
                          <div className="text-[11px] text-slate-400 italic py-1">(empty)</div>
                        ) : (
                          <div className="space-y-1">
                            {b.items.map((it) => (
                              <div key={it.sourceItemId} className="flex items-center justify-between text-xs">
                                <span className="text-slate-600 truncate">{it.quantity}× {it.description}</span>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-slate-500">{fmt(it.lineTotal)}</span>
                                  {isOpen && (
                                    <button type="button" title="Return to order" className="text-rose-400 hover:text-rose-600" onClick={(e) => { e.stopPropagation(); onReturn(b.id, it.sourceItemId, it.quantity); }}>
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {isOpen ? (
                          <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" className="h-7 text-xs flex-1" style={{ background: '#16a34a' }} disabled={b.items.length === 0 || busy || settleBill.isPending} onClick={() => setTimeout(() => setPayingBill(b), 100)}>
                              <Wallet className="h-3.5 w-3.5 mr-1" /> Pay {fmt(b.totalAmount)}
                            </Button>
                            {mergeTargets.length > 0 && (
                              <select
                                className="h-7 text-xs border border-slate-200 rounded-md px-1 text-slate-600 bg-white max-w-[110px]"
                                value=""
                                onChange={(e) => { if (e.target.value) onMerge(b.id, e.target.value); }}
                                title="Merge this bill into another"
                              >
                                <option value="">Merge…</option>
                                {mergeTargets.map((t) => <option key={t.id} value={t.id}>→ {t.label}</option>)}
                              </select>
                            )}
                            <button type="button" title="Delete bill" className="h-7 px-2 text-rose-500 hover:bg-rose-50 rounded-md" disabled={busy} onClick={() => onDelete(b.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : b.invoiceId ? (
                          <div className="mt-2 pt-2 border-t border-slate-100" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="outline" className="h-7 text-xs w-full" onClick={() => setReceipt({ invoiceId: b.invoiceId!, invoiceNumber: undefined })}>
                              <Printer className="h-3.5 w-3.5 mr-1" /> Receipt
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-slate-200 p-3 bg-white flex items-center justify-between gap-2">
            <Button variant="ghost" className="text-rose-600" disabled={busy || bills.some((b) => b.status === 'settled')} onClick={onCancelSplit}>
              Cancel Split
            </Button>
            <div className="text-[11px] text-slate-500">
              {summary?.fullyAssigned ? <span className="text-emerald-600 font-semibold flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Every item assigned</span> : 'Assign every item to a bill, then pay each bill.'}
            </div>
            <Button variant="outline" onClick={onClose}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Per-bill payment */}
      {payingBill ? (
        <PaymentDialog
          open
          total={payingBill.totalAmount}
          onRequestOverride={async () => null}
          onClose={() => setPayingBill(null)}
          onSettle={onPaySettle}
        />
      ) : null}

      {/* Per-bill receipt */}
      {receipt ? (
        <ReceiptPreviewDialog
          open
          invoiceId={receipt.invoiceId}
          invoiceNumber={receipt.invoiceNumber}
          receiptHtml={receipt.receiptHtml}
          onClose={() => setReceipt(null)}
        />
      ) : null}
    </>
  );
};

export default SplitBillDialog;
