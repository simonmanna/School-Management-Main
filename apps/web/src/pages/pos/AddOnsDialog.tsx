import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
import React, { useEffect, useMemo, useState } from 'react';
import { Coffee, X, Check, Minus, Plus, ArrowLeft } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useMenuItemBundle, type ModifierGroupFE } from './pos-features-api';

interface Props {
  open: boolean;
  productId: string | null;
  basePrice?: number;
  onClose: () => void;
  onBack?: () => void;
  onAdd: (input: {
    productId: string;
    productName: string;
    unitPrice: number;
    sku: string | null;
    modifiers: Array<{ modifierId: string; name: string; kitchenPrintName?: string | null; priceDelta: number }>;
    quantity: number;
    note: string;
    taxInclusive?: boolean;
  }) => void;
}

const fmt = (n: number) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;

const StepDots = ({ current, total }: { current: number; total: number }) => (
  <div className="flex items-center gap-1">
    {Array.from({ length: total }, (_, i) => (
      <span key={i} className={`h-1.5 rounded-full transition-all ${i < current ? 'w-4 bg-amber-500' : i === current ? 'w-6 bg-amber-600' : 'w-1.5 bg-slate-300'}`} />
    ))}
  </div>
);

export const AddOnsDialog: React.FC<Props> = ({ open, productId, basePrice, onClose, onBack, onAdd }) => {
  const { data: bundle, isLoading } = useMenuItemBundle(open ? productId : null);
  const [modifierSelection, setModifierSelection] = useState<Record<string, Set<string>>>({});
  const [addonQty, setAddonQty] = useState<Record<string, Record<string, number>>>({});
  const [note, setNote] = useState('');
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (!open || !bundle) {
      setModifierSelection({});
      setAddonQty({});
      setNote('');
      setQuantity(1);
      return;
    }
    const modSel: Record<string, Set<string>> = {};
    const addQty: Record<string, Record<string, number>> = {};
    for (const g of bundle.groups) {
      if (g.groupType === 'MODIFIER') {
        const defaults = g.modifiers.filter((m) => m.isDefault);
        modSel[g.id] = defaults.length > 0
          ? new Set(defaults.map((m) => m.id).slice(0, g.maxSelect))
          : new Set();
      } else {
        const qtyMap: Record<string, number> = {};
        for (const m of g.modifiers) {
          qtyMap[m.id] = m.isDefault ? 1 : 0;
        }
        addQty[g.id] = qtyMap;
      }
    }
    setModifierSelection(modSel);
    setAddonQty(addQty);
    setNote('');
    setQuantity(1);
  }, [open, bundle?.product.id]);

  const toggleModifier = (g: ModifierGroupFE, modifierId: string) => {
    setModifierSelection((prev) => {
      const cur = new Set(prev[g.id] ?? []);
      if (cur.has(modifierId)) {
        cur.delete(modifierId);
      } else {
        if (g.maxSelect === 1) {
          cur.clear();
          cur.add(modifierId);
        } else if (cur.size >= g.maxSelect) {
          const first = cur.values().next().value;
          if (first) cur.delete(first);
          cur.add(modifierId);
        } else {
          cur.add(modifierId);
        }
      }
      return { ...prev, [g.id]: cur };
    });
  };

  const setAddonQuantity = (groupId: string, modifierId: string, qty: number) => {
    setAddonQty((prev) => ({
      ...prev,
      [groupId]: {
        ...(prev[groupId] ?? {}),
        [modifierId]: Math.max(0, Math.min(qty, 99)),
      },
    }));
  };

  const incAddon = (g: ModifierGroupFE, mId: string) => {
    const cur = addonQty[g.id]?.[mId] ?? 0;
    if (cur < g.maxSelect) setAddonQuantity(g.id, mId, cur + 1);
  };
  const decAddon = (g: ModifierGroupFE, mId: string) => {
    const cur = addonQty[g.id]?.[mId] ?? 0;
    if (cur > 0) setAddonQuantity(g.id, mId, cur - 1);
  };

  const validation = useMemo(() => {
    if (!bundle) return { ok: false, missing: [] as string[] };
    const missing: string[] = [];
    for (const g of bundle.groups) {
      if (g.groupType === 'MODIFIER') {
        const selected = modifierSelection[g.id]?.size ?? 0;
        if (g.minSelect > 0 && selected < g.minSelect) missing.push(g.name);
      } else {
        const totalQty = Object.values(addonQty[g.id] ?? {}).reduce((s, q) => s + q, 0);
        if (g.minSelect > 0 && totalQty < g.minSelect) missing.push(g.name);
      }
    }
    return { ok: missing.length === 0, missing };
  }, [bundle, modifierSelection, addonQty]);

  const extraPrice = useMemo(() => {
    if (!bundle) return 0;
    let total = 0;
    for (const g of bundle.groups) {
      for (const m of g.modifiers) {
        if (g.groupType === 'MODIFIER') {
          if (modifierSelection[g.id]?.has(m.id)) total += Number(m.priceDelta);
        } else {
          const qty = addonQty[g.id]?.[m.id] ?? 0;
          total += Number(m.priceDelta) * qty;
        }
      }
    }
    return total;
  }, [bundle, modifierSelection, addonQty]);

  const effectiveBasePrice = basePrice ?? bundle?.product.unitPrice ?? 0;

  const hasAddOns = bundle?.groups.some((g) => g.groupType === 'ADD_ON') ?? false;
  const hasModifiers = bundle?.groups.some((g) => g.groupType === 'MODIFIER') ?? false;

  const renderStepper = (g: ModifierGroupFE, m: typeof g.modifiers[0]) => {
    const qty = addonQty[g.id]?.[m.id] ?? 0;
    const lineTotal = qty * Number(m.priceDelta);
    return (
      <div
        key={m.id}
        className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2.5 py-2"
      >
        <span className="text-xs font-semibold text-slate-700 truncate flex-1">{m.name}</span>
        <div className="flex items-center gap-1.5 ml-2">
          <span className="text-[11px] font-mono text-slate-500 w-16 text-right">
            {lineTotal === 0 ? '—' : (lineTotal > 0 ? '+' : '') + fmt(lineTotal)}
          </span>
          <button
            type="button"
            aria-label={`decrease ${m.name}`}
            disabled={qty === 0}
            onClick={() => decAddon(g, m.id)}
            className="w-7 h-7 rounded-md border border-slate-300 flex items-center justify-center font-bold text-sm leading-none disabled:opacity-30 hover:bg-slate-50 transition-colors"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="w-6 text-center font-mono font-bold text-sm">{qty}</span>
          <button
            type="button"
            aria-label={`increase ${m.name}`}
            disabled={qty >= g.maxSelect}
            onClick={() => incAddon(g, m.id)}
            className="w-7 h-7 rounded-md border border-slate-300 flex items-center justify-center font-bold text-sm leading-none disabled:opacity-30 hover:bg-slate-50 transition-colors"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  };

  const renderToggle = (g: ModifierGroupFE, m: typeof g.modifiers[0]) => {
    const selected = modifierSelection[g.id]?.has(m.id) ?? false;
    return (
      <button
        key={m.id}
        type="button"
        onClick={() => toggleModifier(g, m.id)}
        className={`px-2.5 py-2 rounded-md text-xs font-semibold border-2 text-left flex items-center justify-between transition-all duration-150 ${
          selected
            ? 'border-amber-500 bg-amber-50 text-amber-900 shadow-sm'
            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:shadow-sm'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${selected ? 'border-amber-500 bg-amber-500' : 'border-slate-300'}`}>
            {selected && <Check className="h-2.5 w-2.5 text-white" />}
          </span>
          {m.name}
        </span>
        <span className="text-[11px] font-mono">
          {m.priceDelta === 0 ? '—' : (m.priceDelta > 0 ? '+' : '') + fmt(m.priceDelta)}
        </span>
      </button>
    );
  };

  const renderGroup = (g: ModifierGroupFE) => {
    const renderItem = (m: typeof g.modifiers[0]) =>
      g.groupType === 'ADD_ON' ? renderStepper(g, m) : renderToggle(g, m);
    const isAddOn = g.groupType === 'ADD_ON';

    return (
      <div key={g.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-sm">{g.name}</div>
          <div className="text-[11px] text-slate-500">
            {isAddOn
              ? `${g.minSelect > 0 ? 'Required' : 'Optional'} · up to ${g.maxSelect}`
              : `${g.minSelect > 0 ? 'Required' : 'Optional'} · ${g.maxSelect === 1 ? 'Pick one' : `Up to ${g.maxSelect}`}`}
          </div>
        </div>
        <div className={isAddOn ? 'space-y-1.5 max-h-48 overflow-y-auto pr-0.5' : 'grid grid-cols-2 gap-1.5'}>
          {g.modifiers.map(renderItem)}
        </div>
      </div>
    );
  };

  if (!bundle && !isLoading) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Coffee className="h-4 w-4" />
              {isLoading ? 'Loading…' : bundle?.product.name}
            </DialogTitle>
            <StepDots current={2} total={3} />
          </div>
          <DialogDescription>
            <span className="text-amber-600 font-semibold text-xs uppercase tracking-wide">Step 3 of 3</span> — Add-ons, modifiers & notes
          </DialogDescription>
        </DialogHeader>

        {bundle ? (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {/* Line quantity */}
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2">
              <span className="text-sm font-bold text-slate-700">Quantity</span>
              <div className="flex items-center gap-3">
                <button type="button" aria-label="decrease quantity" onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="w-9 h-9 rounded-md border border-slate-300 font-bold text-xl leading-none hover:bg-slate-50 transition-colors">−</button>
                <span className="w-8 text-center font-mono font-bold text-lg">{quantity}</span>
                <button type="button" aria-label="increase quantity" onClick={() => setQuantity((q) => q + 1)} className="w-9 h-9 rounded-md border border-slate-300 font-bold text-xl leading-none hover:bg-slate-50 transition-colors">+</button>
              </div>
            </div>

            {bundle.groups.length === 0 ? (
              <div className="text-sm text-slate-500 italic text-center py-4">
                No options for this product.
              </div>
            ) : (
              <>
                {hasAddOns && (
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">Add-ons</div>
                )}
                {bundle.groups.filter((g) => g.groupType === 'ADD_ON').map(renderGroup)}

                {hasModifiers && (
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1 pt-2">Modifiers</div>
                )}
                {bundle.groups.filter((g) => g.groupType === 'MODIFIER').map(renderGroup)}
              </>
            )}

            {/* Kitchen note */}
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-1">Note for kitchen</div>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. extra hot, no sugar"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
              />
            </div>

            {/* Combined price (base + extras) */}
            <div className="rounded-lg bg-slate-900 text-white px-3 py-3 flex items-center justify-between">
              <span className="text-sm font-semibold">
                Item price
                {quantity > 1 ? ` (×${quantity} @ ${fmt(effectiveBasePrice + extraPrice)} each)` : ''}
              </span>
              <span className="font-mono font-bold text-lg">{fmt((effectiveBasePrice + extraPrice) * quantity)}</span>
            </div>

            {validation.missing.length > 0 ? (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
                Required: {validation.missing.join(', ')}
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <div className="flex gap-2">
            {onBack && (
              <Button variant="ghost" onClick={onBack}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
          </div>
          <Button
            onClick={() => {
              if (!bundle || !validation.ok) return;
              const modifiers: Array<{ modifierId: string; name: string; kitchenPrintName: string | null; priceDelta: number }> = [];
              for (const g of bundle.groups) {
                if (g.groupType === 'MODIFIER') {
                  for (const m of g.modifiers) {
                    if (modifierSelection[g.id]?.has(m.id)) {
                      modifiers.push({ modifierId: m.id, name: m.name, kitchenPrintName: m.kitchenPrintName ?? null, priceDelta: Number(m.priceDelta) });
                    }
                  }
                } else {
                  for (const m of g.modifiers) {
                    const qty = addonQty[g.id]?.[m.id] ?? 0;
                    for (let i = 0; i < qty; i++) {
                      modifiers.push({ modifierId: m.id, name: m.name, kitchenPrintName: m.kitchenPrintName ?? null, priceDelta: Number(m.priceDelta) });
                    }
                  }
                }
              }
              onAdd({
                productId: bundle.product.id,
                productName: bundle.product.name,
                unitPrice: effectiveBasePrice + extraPrice,
                sku: bundle.product.sku,
                modifiers,
                quantity,
                note,
              });
            }}
            disabled={!bundle || !validation.ok}
            style={{ background: '#16a34a' }}
          >
            <Check className="h-4 w-4 mr-1" /> Add to cart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
