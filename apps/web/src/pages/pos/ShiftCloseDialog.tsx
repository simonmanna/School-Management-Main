import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
// Shift-close dialog. BLIND close: the cashier counts the drawer without seeing
// the expected figure, enters the total (optionally via a denomination grid),
// and only learns the variance AFTER the count is committed. A non-zero variance
// needs a reason; a large variance additionally needs manager sign-off.
import React, { useEffect, useMemo, useState } from 'react';
import { PowerOff, AlertTriangle, Check, ShieldCheck, Calculator } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCloseShift } from './api';
import type { CashSession } from './types';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  session: CashSession | null;
  onClose: () => void;
  onClosed: () => void;
}

const fmt = (n: number | string | null | undefined) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;

// Common UGX note/coin faces, largest first.
const DENOMS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];

export const ShiftCloseDialog: React.FC<Props> = ({ open, session, onClose, onClosed }) => {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [varianceReason, setVarianceReason] = useState('');
  const [byDenom, setByDenom] = useState(false);
  const [denom, setDenom] = useState<Record<number, string>>({});
  const [showManager, setShowManager] = useState(false);
  const [approverEmail, setApproverEmail] = useState('');
  const [managerPin, setManagerPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ variance: number } | null>(null);
  const closeShift = useCloseShift();

  useEffect(() => {
    if (open) {
      setCounted(''); setNotes(''); setVarianceReason('');
      setByDenom(false); setDenom({});
      setShowManager(false); setApproverEmail(''); setManagerPin('');
      setErr(null); setResult(null);
    }
  }, [open]);

  const denomTotal = useMemo(
    () => DENOMS.reduce((s, face) => s + face * (parseInt(denom[face] || '0', 10) || 0), 0),
    [denom],
  );

  // When counting by denomination, the grid drives the counted total.
  const countedNum = byDenom ? denomTotal : Number(counted);

  if (!session) return null;

  const submit = async () => {
    setErr(null);
    if (!Number.isFinite(countedNum) || countedNum < 0) {
      setErr('Counted cash must be a non-negative number');
      return;
    }
    const closingDenomination = byDenom
      ? Object.fromEntries(DENOMS.map((f) => [String(f), parseInt(denom[f] || '0', 10) || 0]).filter(([, c]) => (c as number) > 0))
      : undefined;
    try {
          const res = await closeShift.mutateAsync({
            closingCounted: countedNum,
            notes: notes.trim() || undefined,
            varianceReason: varianceReason.trim() || undefined,
            approverEmail: showManager ? approverEmail.trim() || undefined : undefined,
            managerPin: showManager ? managerPin.trim() || undefined : undefined,
            closingDenomination,
            sessionId: session.id,
          });
      const variance = Number((res as any)?.closingDifference ?? 0);
      setResult({ variance });
      toast.success(`Shift closed. Variance: ${fmt(variance)}`);
      onClosed();
      onClose();
    } catch (e: any) {
          const msg = e?.response?.data?.message || 'Failed to close shift';
          // Backend guides the flow: reveal the field it is asking for.
          if (/variance reason/i.test(msg)) {
            setErr('The drawer does not balance — enter a reason for the variance.');
          } else if (/manager approval|approver|manager pin/i.test(msg)) {
            setShowManager(true);
            setErr('This variance is large and needs manager sign-off. Enter a manager email + PIN.');
          } else if (/unsettled order/i.test(msg)) {
            setErr(msg);
          } else if (/no open cash session/i.test(msg)) {
            setErr('There is no open shift for this register — open the register first, or ask the cashier who opened it.');
          } else {
            setErr(msg);
          }
        }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PowerOff className="h-4 w-4 text-rose-600" /> Close shift
          </DialogTitle>
          <DialogDescription>
            Count the cash in the drawer and enter the total. The expected figure is hidden until
            you commit the count — the variance is shown after closing.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-600">Opening float</span>
          <span className="font-mono font-bold">{fmt(session.openingFloat)}</span>
        </div>

        <div className="flex items-center justify-between">
          <Label>Counted cash ({orgCur()})</Label>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
            onClick={() => setByDenom((v) => !v)}
          >
            <Calculator className="h-3 w-3" /> {byDenom ? 'Enter total instead' : 'Count by denomination'}
          </button>
        </div>

        {byDenom ? (
          <div className="grid grid-cols-2 gap-2">
            {DENOMS.map((face) => (
              <div key={face} className="flex items-center gap-2">
                <span className="w-16 text-right text-xs font-mono text-slate-500">{face.toLocaleString()}</span>
                <span className="text-slate-400">×</span>
                <Input
                  type="number"
                  min={0}
                  value={denom[face] ?? ''}
                  onChange={(e) => setDenom((d) => ({ ...d, [face]: e.target.value }))}
                  placeholder="0"
                  className="h-8 text-right font-mono"
                />
              </div>
            ))}
            <div className="col-span-2 flex justify-between rounded bg-slate-100 px-3 py-1.5 text-sm">
              <span className="text-slate-600">Counted total</span>
              <span className="font-mono font-bold">{fmt(denomTotal)}</span>
            </div>
          </div>
        ) : (
          <Input
            type="number"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            placeholder="0"
            className="text-right text-xl h-12 font-mono font-bold"
            autoFocus
          />
        )}

        <div>
          <Label>Variance reason <span className="text-slate-400 font-normal">(required if the drawer doesn't balance)</span></Label>
          <Input
            value={varianceReason}
            onChange={(e) => setVarianceReason(e.target.value)}
            placeholder={`e.g. ${orgCur()} 5k short — gave wrong change on table 4`}
          />
        </div>

        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
            onClick={() => setShowManager((v) => !v)}
          >
            <ShieldCheck className="h-3 w-3" /> Manager approval (large variance)
          </button>
          {showManager && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input
                value={approverEmail}
                onChange={(e) => setApproverEmail(e.target.value)}
                placeholder="manager@email"
                autoComplete="off"
              />
              <Input
                type="password"
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value)}
                placeholder="Manager PIN"
                autoComplete="off"
              />
            </div>
          )}
        </div>

        <div>
          <Label>Notes (optional)</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={`e.g. Took ${orgCur()} 20k for bread run`}
          />
        </div>

        {result ? (
          <div
            className={
              'rounded-lg px-3 py-2 text-sm font-bold flex items-center gap-2 ' +
              (result.variance === 0
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : result.variance > 0
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'bg-rose-50 text-rose-700 border border-rose-200')
            }
          >
            {result.variance === 0 ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            Variance: {result.variance >= 0 ? '+' : ''}{fmt(result.variance)}
            <span className="ml-auto font-normal text-xs opacity-75">
              {result.variance === 0 ? 'Drawer balanced' : result.variance > 0 ? 'Over' : 'Short'}
            </span>
          </div>
        ) : null}

        {err ? <p className="text-sm text-rose-600">{err}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={closeShift.isPending} style={{ background: '#dc2626' }}>
            {closeShift.isPending ? 'Closing…' : 'Close shift & print Z'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
