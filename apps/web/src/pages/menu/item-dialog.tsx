/**
 * ItemDialog — create or edit a MenuItem.
 *
 * Handles the full MenuItem payload:
 *   - metadata: code, name, description, image, prep time, availability
 *   - money:    basePrice (major units in the UI, converted to minor units on submit)
 *   - tree:     category picker
 *   - composition: ingredients (product picker with quantity) — fully editable
 *                on both create and edit (replace-all semantics).
 *   - variants: size/type options with absolute prices (edit only)
 *   - accompaniments: side-dish groups (edit only)
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, PlusCircle, X, Check, Trash2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { api, resolveAssetUrl } from '@/lib/api';
import {
  Dialog, DialogContent, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  useProductPicker,
  type MenuCategory, type MenuItem,
  type CreateMenuItemInput, type IngredientInput,
  type ProductMini,
} from '@/features/menu/api';
import {
  useVariants,
  useCreateVariant,
  useUpdateVariant,
  useDeleteVariant,
  useAllAccompanimentGroups,
  useMenuItemAccompaniments,
  useAssignAccompanimentGroup,
  useUnassignAccompanimentGroup,
} from '@/pages/pos/pos-features-api';

interface Props {
  open: boolean;
  item?: MenuItem;
  categories: MenuCategory[];
  onOpenChange: (o: boolean) => void;
  onSubmit: (input: CreateMenuItemInput) => Promise<void>;
}

interface DraftIngredient extends IngredientInput {
  /** Temporary key so React can track rows before the backend assigns an id. */
  _key: string;
}

const newIngredient = (): DraftIngredient => ({
  productId: '',
  quantity: 1,
  _key: Math.random().toString(36).slice(2, 10),
});

const fmt = (n: number) => `UGX ${Number(n || 0).toLocaleString()}`; 

export function ItemDialog({ open, item, categories, onOpenChange, onSubmit }: Props) {
  const isEdit = Boolean(item);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [basePrice, setBasePrice] = useState('');
  const imageFileIdRef = useRef<string>('');
  const [previewSrc, setPreviewSrc] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [prepTime, setPrepTime] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);
  const [isInventoryTracked, setIsInventoryTracked] = useState(false);
  const [ingredients, setIngredients] = useState<DraftIngredient[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const products = useProductPicker(productSearch);

  // Full product list (fetched once when the dialog opens so the picker is
  // never empty on first render, even before any search text is typed).
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

  // Seed the picker with: existing item ingredients → search results → full list.
  // Deduplicated by product id; last source wins so live search takes priority.
  const productOptions = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string; station?: string }>();
    for (const ing of item?.ingredients ?? []) {
      if (ing.product) map.set(ing.product.id, ing.product);
    }
    for (const p of products.data ?? []) map.set(p.id, p as any);
    for (const p of allProducts.data ?? []) map.set(p.id, p as any);
    return Array.from(map.values());
  }, [item?.ingredients, products.data, allProducts.data]);

  /* ============== Variants (edit only) ============== */
  const itemId = item?.id ?? null;
  const { data: variants = [] } = useVariants(itemId);
  const createVariant = useCreateVariant();
  const updateVariant = useUpdateVariant();
  const deleteVariant = useDeleteVariant();
  const [showNewVariant, setShowNewVariant] = useState(false);
  const [variantName, setVariantName] = useState('');
  const [variantPrice, setVariantPrice] = useState('');

  /* ============== Accompaniments (edit only) ============== */
  const { data: allAccGroups = [] } = useAllAccompanimentGroups();
  const { data: assignedGroups = [] } = useMenuItemAccompaniments(itemId);
  const assignAccGroup = useAssignAccompanimentGroup();
  const unassignAccGroup = useUnassignAccompanimentGroup();
  const assignedIds = new Set(assignedGroups.map((g) => g.id));

  // Hydrate every field when the dialog opens (edit), or reset to a clean
  // slate (create). Runs on open/item change only — never mid-typing — so it
  // won't clobber user input. Without this, the Edit dialog opened blank and
  // the Save button stayed disabled (empty name).
  useEffect(() => {
    if (!open) return;
    if (!item) {
      setName(''); setCode(''); setDescription(''); setCategoryId('');
      setBasePrice(''); setPrepTime(''); setIsAvailable(true); setIsInventoryTracked(false);
      setIngredients([]);
      setPreviewSrc(''); imageFileIdRef.current = '';
      return;
    }
    setName(item.name ?? '');
    setCode(item.code ?? '');
    setDescription(item.description ?? '');
    setCategoryId(item.categoryId ?? '');
    setBasePrice(item.basePrice != null ? String(item.basePrice) : '');
    setPrepTime(item.preparationTime != null ? String(item.preparationTime) : '');
    setIsAvailable(item.isAvailable ?? true);
    setIsInventoryTracked(item.isInventoryTracked ?? false);
    setIngredients(
      item.ingredients && item.ingredients.length > 0
        ? item.ingredients.map((ing) => ({
            productId: ing.productId,
            quantity: Number(ing.quantity ?? 1),
            _key: ing.id ?? Math.random().toString(36).slice(2, 10),
          }))
        : [],
    );

    // Image: the list API already resolves `image` to a signed download URL,
    // so use it directly for the preview. Recover the permanent file ID from
    // the URL when possible so a save without touching the image re-stores the
    // bare ID (which PosMenuService re-signs on every read).
    const raw = item.image ?? '';
    const uuid = raw.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1] ?? '';
    if (raw.startsWith('http') || raw.startsWith('/api/v1/files/')) {
      setPreviewSrc(resolveAssetUrl(raw) ?? '');
      imageFileIdRef.current = uuid;
    } else if (raw) {
      // Bare file ID — request a fresh signed URL for the preview.
      imageFileIdRef.current = raw;
      api.post(`/files/${encodeURIComponent(raw)}/signed-url`)
        .then((r) => { if (r.data?.url) setPreviewSrc(resolveAssetUrl(r.data.url) ?? ''); })
        .catch(() => setPreviewSrc(''));
    } else {
      setPreviewSrc('');
      imageFileIdRef.current = '';
    }
  }, [open, item?.id]);

  const valid = name.trim();

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('ownerType', 'menu_item');
      if (item?.id) form.append('ownerId', item.id);
      const { data } = await api.post('/files/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Store the permanent file ID; the URL in the response is a fresh
      // 15-min signed URL suitable for the immediate preview only.
      const fileId = data.id as string | undefined;
      if (fileId) imageFileIdRef.current = fileId;
      // For the preview use the fresh URL returned by the upload endpoint,
      // absolutized so it loads from the API origin.
      const previewUrl = (data as any).downloadUrl ?? (data as any).url ?? '';
      setPreviewSrc(resolveAssetUrl(previewUrl) ?? '');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Image upload failed');
    } finally {
      setUploadingImg(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        <div className="bg-[#3b82f6] text-white px-6 py-4">
          <h2 className="text-base font-semibold">{isEdit ? 'Edit Menu Item' : 'Add New Menu Item'}</h2>
          <p className="text-white/75 text-xs mt-0.5">
            {isEdit ? 'Modify the item details and ingredients below.' : 'Fill in the details to add a new item to the menu.'}
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
                code: code.trim() || undefined,
                description: description.trim() || undefined,
                categoryId: categoryId || undefined,
                basePrice: basePrice ? Number(basePrice) : undefined,
                // Send the file ID (permanent ref) rather than a time-limited signed URL.
                // The server stores the ID in MenuItem.image and the PosMenuService
                // mints a fresh signed URL on every read.
                image: imageFileIdRef.current || (previewSrc || undefined),
                preparationTime: prepTime ? Number(prepTime) : undefined,
                isAvailable,
                isInventoryTracked,
                ingredients: ingredients.map(({ productId, quantity }) => ({
                  productId,
                  quantity: quantity ?? 1,
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
              <Label htmlFor="mi-name" className="text-sm font-medium text-slate-700 mb-1.5">Name *</Label>
              <Input id="mi-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="mi-code" className="text-sm font-medium text-slate-700 mb-1.5">Code (SKU)</Label>
              <Input id="mi-code" placeholder="e.g. MI-ESP" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="mi-cat" className="text-sm font-medium text-slate-700 mb-1.5">Category</Label>
              <Select value={categoryId || '_none'} onValueChange={(v) => setCategoryId(v === '_none' ? '' : v)}>
                <SelectTrigger id="mi-cat"><SelectValue placeholder="Pick category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— No category —</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="mi-price" className="text-sm font-medium text-slate-700 mb-1.5">Base price</Label>
              <Input id="mi-price" type="number" step="1" min="0"
                placeholder="0"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="mi-prep" className="text-sm font-medium text-slate-700 mb-1.5">Prep time (minutes)</Label>
              <Input id="mi-prep" type="number" min="0" step="1"
                value={prepTime}
                onChange={(e) => setPrepTime(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="mi-img" className="text-sm font-medium text-slate-700 mb-1.5">Image</Label>
              <div className="flex items-start gap-3">
                {previewSrc && (
                  <img
                    src={previewSrc}
                    alt="Item preview"
                    className="w-16 h-16 rounded-md border border-slate-200 object-cover shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <div className="flex-1 space-y-1.5">
                  <Input
                    id="mi-img"
                    placeholder="Paste image URL, or upload below"
                    value={previewSrc}
                    onChange={(e) => { setPreviewSrc(e.target.value); imageFileIdRef.current = ''; }}
                  />
                  <div className="flex items-center gap-2">
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                    <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploadingImg}>
                      {uploadingImg ? 'Uploading…' : 'Upload image'}
                    </Button>
                    {previewSrc && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => { setPreviewSrc(''); imageFileIdRef.current = ''; }}>
                        <X className="h-3 w-3 mr-1" /> Clear
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="mi-desc" className="text-sm font-medium text-slate-700 mb-1.5">Description</Label>
              <Textarea id="mi-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="md:col-span-2 flex items-center gap-3 rounded-lg border p-3 bg-slate-50">
              <input
                id="mi-avail"
                type="checkbox"
                checked={isAvailable}
                onChange={(e) => setIsAvailable(e.target.checked)}
                className="h-5 w-5"
              />
              <div>
                <Label htmlFor="mi-avail" className="cursor-pointer text-sm font-semibold text-slate-700">
                  {isAvailable ? 'Active on the POS menu' : 'Unavailable on the POS menu'}
                </Label>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isAvailable
                    ? 'Customers can see and order this item from the POS terminal.'
                    : 'This item is hidden from the POS terminal. Uncheck to re-activate.'}
                </p>
              </div>
            </div>
            <div className="md:col-span-2 flex items-center gap-3 rounded-lg border p-3 bg-slate-50">
              <input
                id="mi-inv-tracked"
                type="checkbox"
                checked={isInventoryTracked}
                onChange={(e) => setIsInventoryTracked(e.target.checked)}
                className="h-5 w-5"
              />
              <div>
                <Label htmlFor="mi-inv-tracked" className="cursor-pointer text-sm font-semibold text-slate-700">
                  Inventory tracked
                </Label>
                <p className="text-xs text-slate-500 mt-0.5">
                  When checked, each sale deducts stock based on the ingredients below.
                </p>
              </div>
            </div>
          </div>

          {/* Ingredients */}
          <div className="border-t border-gray-200 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-slate-800">Ingredients (products)</Label>
              <Button
                type="button" size="sm"
                className="rounded-lg border-[#3b82f6] text-[#fff] hover:bg-[#3b82f6]/10"
                onClick={() => setIngredients((s) => [...s, newIngredient()])}
              >
                <PlusCircle className="h-4 w-4 mr-1" /> Add ingredient
              </Button>
            </div>

             <Input
               placeholder="Search products..."
               value={productSearch}
               onChange={(e) => setProductSearch(e.target.value)}
               className="border-gray-200 rounded-lg focus:border-[#3b82f6] focus:ring-[#3b82f6]/20"
             />

            {ingredients.length === 0 && (
              <p className="text-sm text-muted-foreground">No ingredients yet. Products can be added later.</p>
            )}

            <div className="space-y-2">
              {ingredients.map((ing, idx) => (
                <div key={ing._key} className="flex items-center gap-2">
                  <Select
                    value={ing.productId || '_pick'}
                    onValueChange={(v) => setIngredients((s) =>
                      s.map((row, i) => i === idx ? { ...row, productId: v === '_pick' ? '' : v } : row))}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Pick product" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_pick">— pick —</SelectItem>
                      {productOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="font-mono text-xs mr-2">{p.code}</span>
                          {p.name}
                          {p.station ? <Badge variant="outline" className="ml-2 text-xs">{p.station}</Badge> : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number" min="0" step="0.001"
                    className="w-24"
                    placeholder="Qty"
                    value={ing.quantity ?? 1}
                    onChange={(e) => setIngredients((s) =>
                      s.map((row, i) => i === idx ? { ...row, quantity: Number(e.target.value) } : row))}
                  />
                  <Button
                    type="button" size="sm" variant="ghost"
                    onClick={() => setIngredients((s) => s.filter((_, i) => i !== idx))}
                  >
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
            {ingredients.some((i) => !i.productId) && (
              <p className="text-sm text-destructive">
                Pick a product for every ingredient row before saving.
              </p>
            )}
          </div>

          {/* Variants (edit only) */}
          {isEdit && (
            <div className="border-t border-gray-200 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold text-slate-800">Variants (size / type)</Label>
                <Button type="button" size="sm" className="rounded-lg" style={{ background: '#4f46e5' }}
                  onClick={() => { setShowNewVariant(true); setVariantName(''); setVariantPrice(''); }}>
                  <PlusCircle className="h-4 w-4 mr-1" /> Add variant
                </Button>
              </div>
              {variants.length === 0 && (
                <p className="text-sm text-muted-foreground italic">No variants. The base price is used for all orders.</p>
              )}
              <div className="space-y-2">
                {variants.map((v) => (
                  <VariantRow
                    key={v.id}
                    variant={v}
                    menuItemId={item!.id}
                    onUpdate={updateVariant}
                    onDelete={deleteVariant}
                  />
                ))}
              </div>
              {showNewVariant && (
                <div className="flex items-end gap-2 p-3 rounded-lg border border-indigo-200 bg-indigo-50">
                  <div className="flex-1">
                    <Label className="text-[11px]">Name</Label>
                    <Input value={variantName} onChange={(e) => setVariantName(e.target.value)} placeholder="e.g. Large" autoFocus />
                  </div>
                  <div className="w-32">
                    <Label className="text-[11px]">Price (UGX)</Label>
                    <Input type="number" min="0" step="1" value={variantPrice} onChange={(e) => setVariantPrice(e.target.value)} placeholder="0" />
                  </div>
                  <Button size="sm" style={{ background: '#16a34a' }}
                    onClick={async () => {
                      if (!variantName.trim() || !variantPrice) return;
                      try {
                        await createVariant.mutateAsync({ menuItemId: item!.id, name: variantName.trim(), price: Number(variantPrice) });
                        toast.success('Variant added');
                        setShowNewVariant(false);
                      } catch (e: any) { toast.error(e?.response?.data?.message || 'Failed to add variant'); }
                    }}
                    disabled={createVariant.isPending}>
                    <Check className="h-4 w-4 mr-1" /> Add
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowNewVariant(false)}><X className="h-4 w-4" /></Button>
                </div>
              )}
            </div>
          )}

          {/* Accompaniments (edit only) — multi-select tag picker */}
          {isEdit && (
            <div className="border-t border-gray-200 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold text-slate-800">Accompaniment Groups</Label>
                <span className="text-xs text-slate-400">
                  Manage groups in <a href="/menu/accompaniments" className="text-indigo-600 underline">Accompaniments</a>
                </span>
              </div>
              {allAccGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No groups exist. Create them in the <a href="/menu/accompaniments" className="text-indigo-600 underline">Accompaniments page</a> first.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {allAccGroups.map((g) => {
                    const on = assignedIds.has(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={async () => {
                          try {
                            if (on) {
                              await unassignAccGroup.mutateAsync({ menuItemId: item!.id, groupId: g.id });
                              toast.success(`Removed "${g.name}"`);
                            } else {
                              await assignAccGroup.mutateAsync({ menuItemId: item!.id, accompanimentGroupId: g.id });
                              toast.success(`Added "${g.name}"`);
                            }
                          } catch (e: any) {
                            toast.error(e?.response?.data?.message || 'Failed');
                          }
                        }}
                        className={
                          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ' +
                          (on
                            ? 'bg-indigo-100 text-indigo-800 border-indigo-300 hover:bg-indigo-200'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')
                        }
                      >
                        {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        {g.name}
                        <span className="opacity-50 ml-1">({g.options.length} opts)</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="px-5 py-3 border-t bg-slate-50 gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting} className="rounded-lg border-gray-300 hover:bg-gray-100">
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !valid} className="rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white">
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Inline variant row — shows name + price with inline rename and delete. */
function VariantRow({
  variant, menuItemId, onUpdate, onDelete,
}: {
  variant: { id: string; name: string; price: number; sortOrder: number };
  menuItemId: string;
  onUpdate: { mutateAsync: (body: any) => Promise<any> };
  onDelete: { mutateAsync: (body: any) => Promise<any> };
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(variant.name);
  const [price, setPrice] = useState(String(variant.price));

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      await onUpdate.mutateAsync({ menuItemId, variantId: variant.id, name: name.trim(), price: Number(price) || 0 });
      setEditing(false);
      toast.success('Variant updated');
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Failed to update'); }
  };

  if (editing) {
    return (
      <div className="flex items-end gap-2 p-2 rounded-lg border border-indigo-200 bg-indigo-50">
        <div className="flex-1">
          <Label className="text-[11px]">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="w-32">
          <Label className="text-[11px]">Price</Label>
          <Input type="number" min="0" step="1" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <Button size="sm" style={{ background: '#16a34a' }} onClick={handleSave}><Check className="h-4 w-4 mr-1" /> Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white">
      <span className="flex-1 font-medium text-sm text-slate-800">{variant.name}</span>
      <span className="font-mono text-sm text-slate-600">{fmt(variant.price)}</span>
      <button onClick={() => { setName(variant.name); setPrice(String(variant.price)); setEditing(true); }} className="p-1 text-slate-400 hover:text-indigo-600" title="Edit">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button onClick={async () => {
        if (!window.confirm(`Delete variant "${variant.name}"?`)) return;
        try { await onDelete.mutateAsync({ menuItemId, variantId: variant.id }); toast.success('Variant deleted'); }
        catch (e: any) { toast.error(e?.response?.data?.message || 'Failed to delete'); }
      }} className="p-1 text-slate-400 hover:text-rose-600" title="Delete variant">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}