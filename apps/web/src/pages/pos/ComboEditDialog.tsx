import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
/**
 * ComboEditDialog — create or edit a Combo bundle.
 *
 * A combo is a fixed-price bundle of products. At checkout the backend expands
 * the combo's `comboId` line into per-component OrderItem rows (first carries
 * the combo price, the rest are zero-priced) — so the combo price here is the
 * SALE price, independent of the sum of component prices.
 *
 * Mirrors the product-picker pattern from menu/item-dialog.tsx:
 *   - live search (`useProductPicker`) + a full-list fallback fetch
 *   - one Select + quantity spinner per component row (replace-all on save)
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { PlusCircle, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useProductPicker, type ProductMini } from '@/features/menu/api';
import type { ComboFE } from './pos-features-api';

export interface ComboSubmitInput {
  name: string;
  price: number;
  description?: string;
  imageUrl?: string;
  items: Array<{ productId: string; quantity: number }>;
}

interface Props {
  open: boolean;
  combo?: ComboFE;
  onOpenChange: (o: boolean) => void;
  onSubmit: (input: ComboSubmitInput) => Promise<void>;
}

interface DraftItem {
  productId: string;
  quantity: number;
  /** Temporary key for React row tracking before the backend assigns an id. */
  _key: string;
}

const newItem = (): DraftItem => ({
  productId: '',
  quantity: 1,
  _key: Math.random().toString(36).slice(2, 10),
});

export function ComboEditDialog({ open, combo, onOpenChange, onSubmit }: Props) {
  const isEdit = Boolean(combo);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const products = useProductPicker(productSearch);

  // Full product list (fetched once when the dialog opens) so the picker is
  // never empty before any search text is typed.
  const allProducts = useQuery({
    queryKey: ['all-products'],
    queryFn: async () => {
      const res = await api.get<{ data: ProductMini[] }>('/products', {
        params: { page: 1, pageSize: 200 },
      });
      return (res.data?.data as ProductMini[] | undefined) ?? [];
    },
    enabled: open,
  });

  // Seed the picker with: existing combo components → search results → full list.
  // Deduplicated by product id; last source wins so live search takes priority.
  const productOptions = useMemo(() => {
    const map = new Map<string, { id: string; code?: string; name: string }>();
    for (const it of combo?.items ?? []) {
      map.set(it.productId, { id: it.productId, name: it.productName });
    }
    for (const p of products.data ?? []) map.set(p.id, p as any);
    for (const p of allProducts.data ?? []) map.set(p.id, p as any);
    return Array.from(map.values());
  }, [combo?.items, products.data, allProducts.data]);

  // Hydrate on open (edit) or reset to a clean slate (create). Runs on
  // open/combo change only — never mid-typing.
  useEffect(() => {
    if (!open) return;
    if (!combo) {
      setName(''); setPrice(''); setDescription(''); setImageUrl('');
      setItems([]); setProductSearch('');
      return;
    }
    setName(combo.name ?? '');
    setPrice(combo.price != null ? String(combo.price) : '');
    setDescription(combo.description ?? '');
    setImageUrl(combo.imageUrl ?? '');
    setItems(
      (combo.items ?? []).map((it) => ({
        productId: it.productId,
        quantity: Number(it.quantity ?? 1),
        _key: Math.random().toString(36).slice(2, 10),
      })),
    );
  }, [open, combo?.id]);

  const filledItems = items.filter((i) => i.productId);
  const hasBlankRow = items.some((i) => !i.productId);
  const valid = name.trim() && price !== '' && Number(price) >= 0 && filledItems.length >= 1 && !hasBlankRow;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        <div className="bg-[#7c3aed] text-white px-6 py-4">
          <h2 className="text-base font-semibold">{isEdit ? 'Edit Combo' : 'New Combo'}</h2>
          <p className="text-white/75 text-xs mt-0.5">
            {isEdit
              ? 'Modify the combo details and its component items below.'
              : 'A fixed-price bundle. The combo price is charged as one line and expanded into its components at checkout.'}
          </p>
        </div>
        <form
          className="p-5 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            setSubmitting(true);
            try {
              await onSubmit({
                name: name.trim(),
                price: Number(price),
                description: description.trim() || undefined,
                imageUrl: imageUrl.trim() || undefined,
                items: filledItems.map(({ productId, quantity }) => ({
                  productId,
                  quantity: quantity && quantity > 0 ? quantity : 1,
                })),
              });
              onOpenChange(false);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label htmlFor="combo-name" className="text-sm font-medium text-slate-700 mb-1.5">Name *</Label>
              <Input id="combo-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Breakfast Deal" />
            </div>
            <div>
              <Label htmlFor="combo-price" className="text-sm font-medium text-slate-700 mb-1.5">Combo price ({orgCur()}) *</Label>
              <Input id="combo-price" type="number" step="1" min="0" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="combo-img" className="text-sm font-medium text-slate-700 mb-1.5">Image URL</Label>
              <Input id="combo-img" placeholder="https://…" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="combo-desc" className="text-sm font-medium text-slate-700 mb-1.5">Description</Label>
              <Textarea id="combo-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Croissant + Latte + Juice" />
            </div>
          </div>

          {/* Component items */}
          <div className="border-t border-gray-200 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-slate-800">Items *</Label>
              <Button
                type="button" size="sm"
                style={{ background: '#7c3aed' }}
                className="rounded-lg text-white"
                onClick={() => setItems((s) => [...s, newItem()])}
              >
                <PlusCircle className="h-4 w-4 mr-1" /> Add item
              </Button>
            </div>

            <Input
              placeholder="Search products…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
            />

            {items.length === 0 && (
              <p className="text-sm text-muted-foreground">No items yet. A combo needs at least one component.</p>
            )}

            <div className="space-y-2">
              {items.map((row, idx) => {
                // A product may appear only once per combo (backend @@unique).
                const takenElsewhere = new Set(
                  items.filter((_, i) => i !== idx).map((r) => r.productId).filter(Boolean),
                );
                return (
                  <div key={row._key} className="flex items-center gap-2">
                    <Select
                      value={row.productId || '_pick'}
                      onValueChange={(v) => setItems((s) =>
                        s.map((r, i) => i === idx ? { ...r, productId: v === '_pick' ? '' : v } : r))}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Pick product" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_pick">— pick —</SelectItem>
                        {productOptions
                          .filter((p) => p.id === row.productId || !takenElsewhere.has(p.id))
                          .map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.code ? <span className="font-mono text-xs mr-2">{p.code}</span> : null}
                              {p.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number" min="1" step="1"
                      className="w-24"
                      placeholder="Qty"
                      value={row.quantity ?? 1}
                      onChange={(e) => setItems((s) =>
                        s.map((r, i) => i === idx ? { ...r, quantity: Number(e.target.value) } : r))}
                    />
                    <Button
                      type="button" size="sm" variant="ghost"
                      onClick={() => setItems((s) => s.filter((_, i) => i !== idx))}
                    >
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
            {hasBlankRow && (
              <p className="text-sm text-destructive">Pick a product for every row before saving.</p>
            )}
          </div>

          <DialogFooter className="px-1 py-1 gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !valid} style={{ background: '#7c3aed' }} className="text-white">
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create combo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
