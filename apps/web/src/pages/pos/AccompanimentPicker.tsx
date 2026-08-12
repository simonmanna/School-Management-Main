import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
import React, { useEffect, useMemo, useState } from 'react';
import { Coffee, X, Check, ArrowLeft } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { AccompanimentGroupFE } from './pos-features-api';

interface Props {
  open: boolean;
  productName: string;
  groups: AccompanimentGroupFE[];
  onClose: () => void;
  onBack?: () => void;
  onConfirm: (selections: Array<{ optionId: string; optionName: string; priceImpact: number }>) => void;
}

const fmt = (n: number) => (n === 0 ? '—' : `${orgCur()} ${Number(n || 0).toLocaleString()}`);


const StepDots = ({ current, total }: { current: number; total: number }) => (
  <div className="flex items-center gap-1">
    {Array.from({ length: total }, (_, i) => (
      <span key={i} className={`h-1.5 rounded-full transition-all ${i < current ? 'w-4 bg-amber-500' : i === current ? 'w-6 bg-amber-600' : 'w-1.5 bg-slate-300'}`} />
    ))}
  </div>
);

export const AccompanimentPicker: React.FC<Props> = ({ open, productName, groups, onClose, onBack, onConfirm }) => {
  const [selections, setSelections] = useState<Record<string, Record<string, { optionId: string; optionName: string; priceImpact: number }>>>({});

  useEffect(() => {
    if (!open) { setSelections({}); return; }
    const init: Record<string, Record<string, { optionId: string; optionName: string; priceImpact: number }>> = {};
    for (const g of groups) {
      const defaults = g.options.filter((o) => o.isDefault);
      if (defaults.length > 0) {
        init[g.id] = {};
        for (const o of defaults) init[g.id][o.id] = { optionId: o.id, optionName: o.name, priceImpact: o.priceImpact };
      }
    }
    setSelections(init);
  }, [open, groups]);

  const toggle = (g: AccompanimentGroupFE, optionId: string, optionName: string, priceImpact: number) => {
    setSelections((prev) => {
      const cur = { ...(prev[g.id] ?? {}) };
      if (cur[optionId]) {
        delete cur[optionId];
      } else if (g.maxSelect === 1) {
        const next: Record<string, { optionId: string; optionName: string; priceImpact: number }> = {};
        next[optionId] = { optionId, optionName, priceImpact };
        return { ...prev, [g.id]: next };
      } else if (Object.keys(cur).length >= g.maxSelect) {
        delete cur[Object.keys(cur)[0]];
        cur[optionId] = { optionId, optionName, priceImpact };
      } else {
        cur[optionId] = { optionId, optionName, priceImpact };
      }
      return { ...prev, [g.id]: cur };
    });
  };

  const valid = useMemo(() => {
    for (const g of groups) {
      const count = Object.keys(selections[g.id] ?? {}).length;
      if (g.isRequired && count === 0) return false;
      if (g.minSelect > 0 && count < g.minSelect) return false;
    }
    return true;
  }, [groups, selections]);

  const totalImpact = useMemo(() => {
    let t = 0;
    for (const g of groups)
      for (const o of Object.values(selections[g.id] ?? {}))
        t += o.priceImpact;
    return t;
  }, [groups, selections]);

  const handleConfirm = () => {
    const flat: Array<{ optionId: string; optionName: string; priceImpact: number }> = [];
    for (const g of groups)
      for (const o of Object.values(selections[g.id] ?? {}))
        flat.push(o);
    onConfirm(flat);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Coffee className="h-4 w-4" />
              {productName}
            </DialogTitle>
            <StepDots current={1} total={3} />
          </div>
          <DialogDescription>
            <span className="text-amber-600 font-semibold text-xs uppercase tracking-wide">Step 2 of 3</span> — Choose sides & extras
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {groups.map((g) => {
            const count = Object.keys(selections[g.id] ?? {}).length;
            const limitLabel = g.maxSelect === 1 ? 'Pick one' : `Up to ${g.maxSelect}`;
            return (
              <div key={g.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-sm">{g.name}</div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold min-w-[3rem] text-right ${g.minSelect > 0 && count < g.minSelect ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {count}/{g.maxSelect}
                    </span>
                    <div className="text-[11px] text-slate-500">
                      {g.isRequired ? 'Required' : 'Optional'} · {limitLabel}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {g.options.map((o) => {
                    const sel = !!selections[g.id]?.[o.id];
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => toggle(g, o.id, o.name, o.priceImpact)}
                        className={`px-2.5 py-2 rounded-md text-xs font-semibold border-2 text-left flex items-center justify-between transition-all duration-150 ${
                          sel
                            ? 'border-amber-500 bg-amber-50 text-amber-900 shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:shadow-sm'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${sel ? 'border-amber-500 bg-amber-500' : 'border-slate-300'}`}>
                            {sel && <Check className="h-2.5 w-2.5 text-white" />}
                          </span>
                          {o.name}
                        </span>
                        <span className="text-[11px] font-mono">
                          {o.priceImpact === 0 ? '(included)' : `+${fmt(o.priceImpact)}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {totalImpact !== 0 && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-emerald-900">+ Accompaniments</span>
              <span className="font-mono font-bold text-emerald-900">+{fmt(totalImpact)}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <div className="flex gap-2">
            {onBack && (
              <Button variant="ghost" onClick={onBack}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}><X className="h-4 w-4 mr-1" /> Cancel</Button>
          </div>
          <Button onClick={handleConfirm} disabled={!valid} style={{ background: '#16a34a' }}>
            <Check className="h-4 w-4 mr-1" /> Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
