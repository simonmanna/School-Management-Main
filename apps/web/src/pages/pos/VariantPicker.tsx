import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
import React, { useEffect, useState } from 'react';
import { Coffee, X, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { VariantFE } from './pos-features-api';

interface Props {
  open: boolean;
  productName: string;
  variants: VariantFE[];
  onClose: () => void;
  onConfirm: (variantId: string, variantName: string, variantPrice: number) => void;
}

const fmt = (n: number) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;

const StepDots = ({ current, total }: { current: number; total: number }) => (
  <div className="flex items-center gap-1">
    {Array.from({ length: total }, (_, i) => (
      <span key={i} className={`h-1.5 rounded-full transition-all ${i < current ? 'w-4 bg-amber-500' : i === current ? 'w-6 bg-amber-600' : 'w-1.5 bg-slate-300'}`} />
    ))}
  </div>
);

export const VariantPicker: React.FC<Props> = ({ open, productName, variants, onClose, onConfirm }) => {
  const [selected, setSelected] = useState('');

  useEffect(() => {
    if (open && variants.length > 0) {
      const def = variants.find((v) => v.sortOrder === 0) ?? variants[0];
      setSelected(def?.id ?? '');
    }
    if (!open) setSelected('');
  }, [open, variants]);

  const picked = variants.find((v) => v.id === selected);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Coffee className="h-4 w-4" />
              {productName}
            </DialogTitle>
            <StepDots current={0} total={3} />
          </div>
          <DialogDescription>
            <span className="text-amber-600 font-semibold text-xs uppercase tracking-wide">Step 1 of 3</span> — Choose a size
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          {variants.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelected(v.id)}
              className={`w-full px-4 py-3 rounded-lg border-2 text-left flex items-center justify-between transition-all duration-150 ${
                selected === v.id
                  ? 'border-amber-500 bg-amber-50 text-amber-900 shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:shadow-sm'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${selected === v.id ? 'border-amber-500 bg-amber-500' : 'border-slate-300'}`}>
                  {selected === v.id && <Check className="h-3 w-3 text-white" />}
                </span>
                <span className="font-semibold">{v.name}</span>
              </span>
              <span className="font-mono text-sm font-bold">{fmt(v.price)}</span>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="h-4 w-4 mr-1" /> Cancel</Button>
          <Button
            onClick={() => picked && onConfirm(picked.id, picked.name, picked.price)}
            disabled={!picked}
            style={{ background: '#16a34a' }}
          >
            <Check className="h-4 w-4 mr-1" /> Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
