import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Coffee, Edit, PlusCircle, Trash2, Search, Eye,
  Tag, FolderOpen, List, Layers, RotateCcw,
  CircleDollarSign, CheckCircle2, EyeOff,
} from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { notify } from '@/lib/notify';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { formatCurrency } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import {
  useMenuCategories,
  useMenuItems,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useRestoreCategory,
  useCreateMenuItem,
  useUpdateMenuItem,
  useDisableMenuItem,
  useToggleAvailability,
  type MenuCategory,
  type MenuItem,
} from '@/features/menu/api';
import { CategoryDialog } from './category-dialog';
import { ItemDialog } from './item-dialog';

export function MenuPage() {
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search, 250);

  const [catDialog, setCatDialog] = useState<{ open: boolean; category?: MenuCategory | null }>({ open: false });
  const [itemDialog, setItemDialog] = useState<{ open: boolean; item?: MenuItem }>({ open: false });
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'category' | 'item'; id: string; name: string } | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canViewMenu = hasPermission(PERMISSIONS.menu.view);
  const canCreateMenu = hasPermission(PERMISSIONS.menu.create);
  const canEditMenu = hasPermission(PERMISSIONS.menu.edit);
  const canDeleteMenu = hasPermission(PERMISSIONS.menu.delete);
  const canViewCat = hasPermission(PERMISSIONS.menuCategories.view);
  const canCreateCat = hasPermission(PERMISSIONS.menuCategories.create);
  const canEditCat = hasPermission(PERMISSIONS.menuCategories.edit);
  const canDeleteCat = hasPermission(PERMISSIONS.menuCategories.delete);

  const cats = useMenuCategories();
  const items = useMenuItems({ page, pageSize: 20, search: debounced || undefined });
  const restoreCategory = useRestoreCategory();

  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();
  const createItem = useCreateMenuItem();
  const updateItem = useUpdateMenuItem();
  const disableItem = useDisableMenuItem();
  const toggleAvailability = useToggleAvailability();

  const allPaginatedItems = items.data?.data ?? [];
  const activeItems = useMemo(() => {
    return allPaginatedItems.filter((it) => {
      if (selectedCat && it.categoryId !== selectedCat) return false;
      return true;
    });
  }, [allPaginatedItems, selectedCat]);

  useEffect(() => { setPage(1); }, [debounced]);

  const meta = items.data?.meta;
  const liveCats = (cats.data ?? []).filter((c) => !c.deletedAt);
  const deletedCats = (cats.data ?? []).filter((c) => c.deletedAt);

  // Density stats — derived from the loaded page (POS menus are small).
  const availableCount = allPaginatedItems.filter((it) => it.isAvailable).length;
  const priced = allPaginatedItems
    .map((it) => (it.basePrice != null ? Number(it.basePrice) : null))
    .filter((v): v is number => v != null && !Number.isNaN(v));
  const avgPrice = priced.length ? priced.reduce((a, b) => a + b, 0) / priced.length : null;

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'category') {
        await deleteCategory.mutateAsync(deleteTarget.id);
        notify.success('Category moved to Recently deleted');
        if (selectedCat === deleteTarget.id) setSelectedCat(null);
      } else {
        await disableItem.mutateAsync(deleteTarget.id);
        notify.success('Item disabled successfully');
      }
    } catch {
      notify.error('Could not delete');
    }
    setDeleteTarget(null);
  };

  const handleRestore = async (c: MenuCategory) => {
    try {
      await restoreCategory.mutateAsync(c.id);
      notify.success(`Category "${c.name}" restored`);
    } catch {
      notify.error('Could not restore category');
    }
  };

  const handleToggle = async (it: MenuItem) => {
    if (!canEditMenu) return;
    try {
      await toggleAvailability.mutateAsync({ id: it.id, isAvailable: !it.isAvailable });
      notify.success(it.isAvailable ? `"${it.name}" marked unavailable (86)` : `"${it.name}" is back on the menu`);
    } catch {
      notify.error('Could not update availability');
    }
  };

  if (!canViewMenu && !canViewCat) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
          <h1 className="text-2xl font-semibold text-destructive">Access Denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">You do not have permission to view the menu.</p>
        </div>
      </div>
    );
  }

  const selectedCatName = liveCats.find((c) => c.id === selectedCat)?.name ?? 'All items';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Menu</h1>
          <p className="text-sm text-muted-foreground">
            Menu items are what customers order; products remain the master inventory behind them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreateCat && (
            <Button size="sm" variant="outline" onClick={() => setCatDialog({ open: true })}>
              <FolderOpen className="mr-1.5 h-3.5 w-3.5" />Add category
            </Button>
          )}
          {canCreateMenu && (
            <Button size="sm" onClick={() => setItemDialog({ open: true })}>
              <PlusCircle className="mr-1.5 h-3.5 w-3.5" />Add menu item
            </Button>
          )}
        </div>
      </div>

      {/* KPI stats */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Card className="p-2">
          <CardContent className="flex items-center gap-2 p-0">
            <Coffee className="h-4 w-4 shrink-0 text-sky-600" />
            <div className="flex w-full items-center justify-between gap-1">
              <span className="text-xs text-muted-foreground">Menu Items</span>
              <span className="text-sm font-bold tabular-nums text-sky-600">{meta?.total ?? '—'}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="p-2">
          <CardContent className="flex items-center gap-2 p-0">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <div className="flex w-full items-center justify-between gap-1">
              <span className="text-xs text-muted-foreground">Available</span>
              <span className="text-sm font-bold tabular-nums text-emerald-600">{items.isLoading ? '—' : availableCount}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="p-2">
          <CardContent className="flex items-center gap-2 p-0">
            <FolderOpen className="h-4 w-4 shrink-0 text-violet-600" />
            <div className="flex w-full items-center justify-between gap-1">
              <span className="text-xs text-muted-foreground">Categories</span>
              <span className="text-sm font-bold tabular-nums text-violet-600">{cats.isLoading ? '—' : liveCats.length}</span>
            </div>
          </CardContent>
        </Card>
        <Card className="p-2">
          <CardContent className="flex items-center gap-2 p-0">
            <CircleDollarSign className="h-4 w-4 shrink-0 text-amber-600" />
            <div className="flex w-full items-center justify-between gap-1">
              <span className="text-xs text-muted-foreground">Avg Price</span>
              <span className="text-sm font-bold tabular-nums text-amber-600">{avgPrice != null ? formatCurrency(avgPrice) : '—'}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[28rem_1fr]">
        {/* Categories Sidebar */}
        {canViewCat && (
          <div className="flex flex-col rounded-md border bg-card">
            <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Categories</h3>
              </div>
              {canCreateCat && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => setCatDialog({ open: true })}
                  title="Add category"
                >
                  <PlusCircle className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="scroll-thin max-h-[560px] space-y-0.5 overflow-y-auto p-2">
              <button
                type="button"
                onClick={() => setSelectedCat(null)}
                className={
                  'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors ' +
                  (selectedCat === null ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted')
                }
              >
                <span className="flex items-center gap-2">
                  <List className="h-3.5 w-3.5" />All items
                </span>
                <Badge variant="secondary" className="tabular-nums">{allPaginatedItems.length}</Badge>
              </button>

              {cats.isLoading && (
                <div className="space-y-1 pt-1">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-8 w-full rounded-md" />
                  ))}
                </div>
              )}

              {liveCats.map((c) => {
                const count = allPaginatedItems.filter((it) => it.categoryId === c.id).length;
                const selected = selectedCat === c.id;
                return (
                  <div key={c.id} className="group flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setSelectedCat(c.id)}
                      className={
                        'flex flex-1 items-center justify-between gap-2 overflow-hidden rounded-md px-2.5 py-1.5 text-sm transition-colors ' +
                        (selected ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted')
                      }
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Tag className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <Badge variant="secondary" className="tabular-nums">{count}</Badge>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {canEditCat && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-primary"
                          onClick={() => setCatDialog({ open: true, category: c })}
                          title="Edit category"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canDeleteCat && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget({ type: 'category', id: c.id, name: c.name })}
                          title="Move to Recently deleted"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}

              {!cats.isLoading && liveCats.length === 0 && (
                <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">No categories yet.</p>
              )}
            </div>

            {/* Recently deleted — restore bin */}
            {canDeleteCat && (
              <div className="border-t p-2">
                <button
                  type="button"
                  onClick={() => setShowDeleted((v) => !v)}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Recently deleted{deletedCats.length ? ` (${deletedCats.length})` : ''}
                </button>
                {showDeleted && (
                  <div className="mt-1 space-y-0.5">
                    {deletedCats.length === 0 && (
                      <p className="px-2.5 py-1.5 text-xs text-muted-foreground">Nothing here.</p>
                    )}
                    {deletedCats.map((c) => (
                      <div key={c.id} className="flex items-center justify-between rounded-md px-2.5 py-1 text-sm text-muted-foreground">
                        <span className="truncate">{c.name}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600"
                          onClick={() => handleRestore(c)}
                          disabled={restoreCategory.isPending}
                          title="Restore category"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Items */}
        <div className="flex flex-col rounded-md border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{selectedCatName}</h3>
              <p className="text-xs text-muted-foreground">
                {meta?.total ?? 0} item{(meta?.total ?? 0) !== 1 ? 's' : ''}{debounced ? ' (filtered)' : ''}
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search items…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8"
              />
            </div>
          </div>

          {items.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : activeItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Coffee className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold">No menu items{selectedCat ? ' in this category' : ''}</h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                {search ? 'Try adjusting your search terms.' : 'Add one to make it available on the POS terminal.'}
              </p>
              {!search && canCreateMenu && (
                <Button className="mt-2" size="sm" onClick={() => setItemDialog({ open: true })}>
                  <PlusCircle className="mr-1.5 h-4 w-4" />Add menu item
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-left font-medium">Code</th>
                    <th className="px-3 py-2 text-left font-medium">Category</th>
                    <th className="px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 text-right font-medium">Recipe</th>
                    <th className="px-3 py-2 text-center font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeItems.map((it) => (
                    <ItemRow
                      key={it.id}
                      item={it}
                      categoryName={liveCats.find((c) => c.id === it.categoryId)?.name ?? null}
                      canEdit={canEditMenu}
                      canDelete={canDeleteMenu}
                      toggling={toggleAvailability.isPending}
                      onToggle={() => handleToggle(it)}
                      onEdit={() => setItemDialog({ open: true, item: it })}
                      onDelete={() => setDeleteTarget({ type: 'item', id: it.id, name: it.name })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Page {meta.page} of {meta.totalPages} · {meta.total} total
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <CategoryDialog
        open={catDialog.open}
        category={catDialog.category ?? null}
        onOpenChange={(o) => setCatDialog((s) => ({ ...s, open: o, category: o ? s.category : null }))}
        onSubmit={(input) =>
          new Promise<void>((resolve, reject) => {
            if (catDialog.category) {
              updateCategory.mutate(
                { id: catDialog.category.id, data: input },
                {
                  onSuccess: () => { notify.success('Category updated successfully'); resolve(); },
                  onError: (e: any) => { notify.error(e?.message ?? 'Could not update category'); reject(e); },
                },
              );
            } else {
              createCategory.mutate(input, {
                onSuccess: () => { notify.success(`Category "${input.name}" created successfully`); resolve(); },
                onError: (e: any) => { notify.error(e?.message ?? 'Could not create category'); reject(e); },
              });
            }
          })
        }
      />

      <ItemDialog
        open={itemDialog.open}
        item={itemDialog.item}
        categories={liveCats}
        onOpenChange={(o) => setItemDialog((s) => ({ ...s, open: o }))}
        onSubmit={(input) =>
          new Promise<void>((resolve, reject) => {
            const onSuccess = () => { notify.success(itemDialog.item ? 'Item updated successfully' : 'Item created successfully'); resolve(); };
            const onError = (e: any) => { notify.error(e?.response?.data?.message ?? e?.message ?? 'Could not save item'); reject(e); };
            if (itemDialog.item) {
              updateItem.mutate(
                { id: itemDialog.item.id, patch: input },
                { onSuccess, onError },
              );
            } else {
              createItem.mutate(input, { onSuccess, onError });
            }
          })
        }
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <AlertDialogTitle>
                  {deleteTarget?.type === 'category' ? 'Delete category' : 'Disable menu item'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This action can be undone from the Recently deleted bin.
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTarget?.type === 'category'
              ? <>Delete <span className="font-semibold text-foreground">{deleteTarget?.name}</span>? Items in this category are not deleted and the category can be restored later.</>
              : <>Disable <span className="font-semibold text-foreground">{deleteTarget?.name}</span>? It disappears from the POS menu but stays in the database.</>}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteTarget?.type === 'category' ? 'Delete category' : 'Disable item'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ItemRow({
  item, categoryName, canEdit, canDelete, toggling, onToggle, onEdit, onDelete,
}: {
  item: MenuItem;
  categoryName: string | null;
  canEdit: boolean;
  canDelete: boolean;
  toggling: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const navigateRow = useNavigate();
  const priceMajor = item.basePrice != null ? Number(item.basePrice) : null;
  const ingredientCount = item.ingredients?.length ?? 0;

  return (
    <tr
      className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
      onClick={() => navigateRow(`/menu/${item.id}`)}
    >
      {/* Item name + description */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.isAvailable ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{item.name}</div>
            {item.description && (
              <div className="truncate text-xs text-muted-foreground">{item.description}</div>
            )}
          </div>
        </div>
      </td>

      {/* Code */}
      <td className="px-3 py-2">
        {item.code
          ? <span className="font-mono text-xs text-muted-foreground">{item.code}</span>
          : <span className="text-muted-foreground/50">—</span>}
      </td>

      {/* Category */}
      <td className="px-3 py-2">
        {categoryName
          ? <Badge variant="outline" className="font-normal">{categoryName}</Badge>
          : <span className="text-muted-foreground/50">—</span>}
      </td>

      {/* Price */}
      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
        {priceMajor != null ? formatCurrency(priceMajor) : <span className="font-sans text-muted-foreground/50">—</span>}
      </td>

      {/* Ingredient count */}
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Layers className="h-3.5 w-3.5" />{ingredientCount}</span>
      </td>

      {/* Status — clickable 86 toggle */}
      <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          disabled={!canEdit || toggling}
          onClick={onToggle}
          title={canEdit ? (item.isAvailable ? 'Mark unavailable (86)' : 'Mark available') : undefined}
          className={
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors ' +
            (item.isAvailable
              ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
              : 'bg-muted text-muted-foreground hover:bg-muted/80') +
            (canEdit ? ' cursor-pointer' : ' cursor-default')
          }
        >
          <span className={`h-1.5 w-1.5 rounded-full ${item.isAvailable ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />
          {item.isAvailable ? 'Available' : '86'}
        </button>
      </td>

      {/* Actions */}
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => navigateRow(`/menu/${item.id}`)}
            className="h-8 w-8 text-muted-foreground hover:text-primary"
            title="View details"
          >
            <Eye className="h-4 w-4" />
          </Button>
          {canEdit && (
            <Button
              size="icon"
              variant="ghost"
              onClick={onEdit}
              className="h-8 w-8 text-muted-foreground hover:text-primary"
              title="Edit item"
            >
              <Edit className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              size="icon"
              variant="ghost"
              onClick={onDelete}
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              title="Disable item"
            >
              {item.isAvailable ? <Trash2 className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default MenuPage;
