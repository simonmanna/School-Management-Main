import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
// Per-line discount dialog. Updates the cart line's discount in the store.
import React, { useEffect, useState } from 'react';
import { Tag, Percent, DollarSign } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CartLine, DiscountType } from '@/features/pos/types';

interface Props {
  open: boolean;
  line: CartLine | null;
  onClose: () => void;
  /** Receives a percent 0–100 and the discount type. */
  onApply: (lineId: string, amount: number, type?: DiscountType) => void;
}

const fmt = (n: number) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;

export const LineDiscountDialog: React.FC<Props> = ({ open, line, onClose, onApply }) => {
  const [mode, setMode] = useState<DiscountType>('percentage');
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open && line) {
      setValue(String(line.discountPercent || ''));
      setMode(line.discountType ?? 'percentage');
      setErr(null);
    } else if (!open) {
      setValue(''); setErr(null);
    }
  }, [open, line?.lineId]);

  if (!line) return null;

  const num = Number(value);
  const validPercent = Number.isFinite(num) && num >= 0 && num <= 100;
  const validFixed = Number.isFinite(num) && num >= 0;
  const valid = mode === 'percentage' ? validPercent : validFixed;
  const requiresOverride = mode === 'percentage' ? num >= 10 : num >= 50000;

  const currentDisc = line.discountType === 'fixed_amount'
    ? (line.discountAmount ?? 0)
    : line.quantity * line.unitPrice * (line.discountPercent / 100);
  const lineSub = line.quantity * line.unitPrice - currentDisc;
  const newDisc = mode === 'fixed_amount' ? (validFixed ? num : 0) : line.quantity * line.unitPrice * (validPercent ? num / 100 : 0);
  const newSub = Math.max(0, line.quantity * line.unitPrice - newDisc);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tag className="h-4 w-4" /> Line discount</DialogTitle>
          <DialogDescription>Discount a single item. ≥ 10% or {orgCur()} 50,000 needs a manager override.</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="font-bold text-sm">{line.name}</div>
          <div className="text-xs text-slate-500">
            {line.quantity} × {fmt(line.unitPrice)} = {fmt(line.quantity * line.unitPrice)}
          </div>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          <button
            type="button"
            className={`flex-1 py-2 text-xs font-bold flex items-center justify-center gap-1.5 transition ${
              mode === 'percentage' ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
            onClick={() => setMode('percentage')}
          >
            <Percent className="w-3.5 h-3.5" /> Percentage
          </button>
          <button
            type="button"
            className={`flex-1 py-2 text-xs font-bold flex items-center justify-center gap-1.5 transition ${
              mode === 'fixed_amount' ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
            onClick={() => setMode('fixed_amount')}
          >
            <DollarSign className="w-3.5 h-3.5" /> Fixed Amount
          </button>
        </div>

        <div>
          <Label>{mode === 'percentage' ? 'Percent off (%)' : 'Amount off ({orgCur()})'}</Label>
          <Input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
            className="text-right text-lg h-11 font-mono font-bold"
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded border border-slate-200 px-3 py-2 bg-slate-50">
            <div className="text-xs text-slate-500">Current</div>
            <div className="font-mono font-bold">{fmt(lineSub)}</div>
          </div>
          <div className="rounded border border-emerald-200 px-3 py-2 bg-emerald-50">
            <div className="text-xs text-emerald-700">After discount</div>
            <div className="font-mono font-bold text-emerald-700">{fmt(valid ? newSub : lineSub)}</div>
          </div>
        </div>

        {requiresOverride ? (
          <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2">
            ⚠ This line discount requires a manager override.
          </div>
        ) : null}

        {err ? <p className="text-sm text-rose-600">{err}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!valid) { setErr(mode === 'percentage' ? 'Enter a percent between 0 and 100' : 'Enter a valid amount'); return; }
              onApply(line.lineId, num, mode);
              onClose();
            }}
            style={{ background: '#f59e0b' }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};