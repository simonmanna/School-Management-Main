import { useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { money, useOrgCurrency } from '@/lib/format';
import { useMenuItemsAvailable } from '@/features/menu/api';
import { useProductsForPos } from '@/features/pos/api';
import { useProductCategories } from '@/features/products/api';
import {
  toLineInput, type PickableItem,
} from './line-source';
import type { OrderLineInput } from '@/features/orders/types';

const tabClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
    active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'
  }`;

/**
 * Searchable line picker for the Orders pages. Serves the org's configured
 * line source: menu items (café/bar/restaurant), products (retail), or both
 * (per-line source toggle). Menu lines carry menuItemId; product lines carry
 * productId+sku — downstream (OrderLineDto → DocumentBuilder tax engine) treats
 * them identically.
 */
export function OrderLinePicker({
  open,
  onOpenChange,
  resolved,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resolved: 'menu' | 'products' | 'both';
  onPick: (line: OrderLineInput) => void;
}) {
  const [tab, setTab] = useState<'menu' | 'products'>('menu');
  const [search, setSearch] = useState('');
  const currency = useOrgCurrency();

  const menuQ = useMenuItemsAvailable();
  const productsQ = useProductsForPos({ search: search || undefined });
  const categoriesQ = useProductCategories();

  const menuItems = menuQ.data?.items ?? [];
  const products = productsQ.data ?? [];
  const categories = categoriesQ.data ?? [];

  const activeTab: 'menu' | 'products' = resolved === 'both' ? tab : resolved;

  const menuSource: PickableItem[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuItems
      .filter((i) => i.isAvailable !== false)
      .filter((i) => !q || i.name.toLowerCase().includes(q) || (i.code ?? '').toLowerCase().includes(q))
      .map((i) => ({
        id: i.id,
        name: i.name,
        price: Number(i.basePrice ?? 0),
        categoryName: null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [menuItems, search]);

  const productSource: PickableItem[] = useMemo(() => {
    const catNameById = new Map(categories.map((c: any) => [c.id, c.name]));
    return products
      .filter((p) => p.isActive !== false)
      .map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.salesPrice ?? 0),
        categoryName: catNameById.get(p.categoryId ?? '') ?? null,
        sku: p.sku,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, categories]);

  const pick = (item: PickableItem) => {
    onPick(toLineInput(item, activeTab));
    setSearch('');
    onOpenChange(false);
  };

  const loading = activeTab === 'menu' ? menuQ.isLoading : productsQ.isLoading;
  const source = activeTab === 'menu' ? menuSource : productSource;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add line</DialogTitle>
          <DialogDescription>
            Pick an item to add to the order — prices are resolved server-side on save.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          {resolved === 'both' && (
            <div className="flex shrink-0 gap-1 rounded-lg bg-muted p-1">
              <button type="button" className={tabClass(tab === 'menu')} onClick={() => setTab('menu')}>
                Menu
              </button>
              <button type="button" className={tabClass(tab === 'products')} onClick={() => setTab('products')}>
                Products
              </button>
            </div>
          )}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={activeTab === 'menu' ? 'Search menu items…' : 'Search products…'}
              className="pl-8"
            />
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto rounded-md border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : source.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No {activeTab === 'menu' ? 'menu items' : 'products'} found{search ? ` for “${search}”` : ''}.
            </div>
          ) : (
            <ul className="divide-y">
              {source.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/70"
                    onClick={() => pick(item)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{item.name}</span>
                      {item.categoryName && (
                        <span className="block text-xs text-muted-foreground">{item.categoryName}</span>
                      )}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(item.price, currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}