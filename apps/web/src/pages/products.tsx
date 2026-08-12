import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Edit, Eye, Plus, Search, Trash2, Loader2 } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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
import { DataTable, type Column } from '@/components/data-table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { notify } from '@/lib/notify';
import { formatCurrency } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import {
  useProducts, useDeleteProduct, useProductCategories,
  useCreateProductCategory, useUpdateProductCategory, useDeleteProductCategory,
  type Product, type ProductCategory,
} from '@/features/products/api';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const PRODUCT_TYPES = ['stockable', 'consumable', 'service', 'fee', 'subscription', 'asset'] as const;

export function ProductsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [deleting, setDeleting] = useState<Product | null>(null);

  // Categories dialog state
  const [categoryDialog, setCategoryDialog] = useState<{
    open: boolean;
    category?: ProductCategory | null;
  }>({ open: false });
  const [catName, setCatName] = useState('');
  const [catParentId, setCatParentId] = useState('');
  const [catIncomeAccountId, setCatIncomeAccountId] = useState('');
  const [catExpenseAccountId, setCatExpenseAccountId] = useState('');
  const [catSaving, setCatSaving] = useState(false);
  const [catError, setCatError] = useState('');

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canViewProducts = hasPermission(PERMISSIONS.products.view);
  const canCreateProduct = hasPermission(PERMISSIONS.products.create);
  const canEditProduct = hasPermission(PERMISSIONS.products.edit);
  const canDeleteProduct = hasPermission(PERMISSIONS.products.delete);
  const canViewCategories = hasPermission(PERMISSIONS.productCategory.read);
  const canCreateCategory = hasPermission(PERMISSIONS.productCategory.create);
  const canEditCategory = hasPermission(PERMISSIONS.productCategory.update);
  const canDeleteCategory = hasPermission(PERMISSIONS.productCategory.delete);

  useEffect(() => setPage(1), [search, categoryFilter, typeFilter]);

  const { data, isLoading } = useProducts({
    page, pageSize: 10,
    search: search || undefined,
    categoryId: categoryFilter || undefined,
    productType: typeFilter || undefined,
  });
  const deleteProduct = useDeleteProduct();
  const { data: categories = [] } = useProductCategories();
  const createCategory = useCreateProductCategory();
  const updateCategory = useUpdateProductCategory();
  const deleteCategory = useDeleteProductCategory();

  const handleDelete = async () => {
    if (!deleting) return;
    await deleteProduct.mutateAsync(deleting.id);
    notify.success('Product moved to deleted');
    setDeleting(null);
  };

  const columns: Column<Product>[] = [
    { key: 'name', header: 'Name' },
    { key: 'code', header: 'Code' },
    { key: 'sku', header: 'SKU', render: (p) => p.sku ?? '-' },
    { key: 'category', header: 'Category', render: (p) => p.category?.name ?? '-' },
    { key: 'productType', header: 'Type', render: (p) => <Badge variant="secondary">{p.productType}</Badge> },
    {
      key: 'salesPrice',
      header: 'Sales price',
      className: 'text-right',
      render: (p) => (p.salesPrice != null ? formatCurrency(Number(p.salesPrice)) : '-'),
    },
    {
      key: 'isActive',
      header: 'Active',
      render: (p) => <Badge variant={p.isActive ? 'default' : 'secondary'}>{p.isActive ? 'Yes' : 'No'}</Badge>,
    },
    ...((canEditProduct || canDeleteProduct) ? [{
      key: 'actions' as const,
      header: 'Actions',
      render: (p: Product) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/inventory/items/${p.id}`)}>
            <Eye className="h-4 w-4 text-primary/70" />
          </Button>
          {canEditProduct && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/products/${p.id}/edit`)}>
              <Edit className="h-4 w-4" />
            </Button>
          )}
          {canDeleteProduct && (
            <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>
              <Trash2 className="h-4 w-4 text-destructive/70" />
            </Button>
          )}
        </div>
      ),
    }] : []),
  ];

  const meta = data?.meta;

  if (!canViewProducts && !canViewCategories) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Products</h1>
        <p className="text-sm text-muted-foreground">You do not have permission to view products or categories.</p>
      </div>
    );
  }

  // Category dialog handlers
  const openCategoryDialog = (category?: ProductCategory | null) => {
    if (category) {
      setCatName(category.name);
      setCatParentId(category.parentId ?? '');
      setCatIncomeAccountId(category.incomeAccountId ?? '');
      setCatExpenseAccountId(category.expenseAccountId ?? '');
    } else {
      setCatName('');
      setCatParentId('');
      setCatIncomeAccountId('');
      setCatExpenseAccountId('');
    }
    setCatError('');
    setCategoryDialog({ open: true, category });
  };

  const closeCategoryDialog = () => {
    setCategoryDialog({ open: false });
  };

  const saveCategory = async () => {
    if (!catName.trim()) return setCatError('Category name is required');
    setCatSaving(true);
    setCatError('');
    try {
      const payload = {
        name: catName.trim(),
        parentId: catParentId || undefined,
        incomeAccountId: catIncomeAccountId || undefined,
        expenseAccountId: catExpenseAccountId || undefined,
      };
      if (categoryDialog.category) {
        await updateCategory.mutateAsync({ id: categoryDialog.category.id, data: payload });
      } else {
        await createCategory.mutateAsync(payload);
      }
      closeCategoryDialog();
      notify.success(categoryDialog.category ? 'Category updated' : 'Category created');
    } catch (e: any) {
      const msg = e.response?.data?.message;
      setCatError(Array.isArray(msg) ? msg.join(', ') : msg || e.message);
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteCategory = async (cat: ProductCategory) => {
    if (!confirm(`Delete "${cat.name}"? This cannot be undone.`)) return;
    try {
      await deleteCategory.mutateAsync(cat.id);
      notify.success('Category deleted');
    } catch (e: any) {
      alert(e.response?.data?.message || e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Products</h1>
          <p className="text-sm text-gray-500">Goods, services, fees and subscriptions.</p>
        </div>
      </div>

      <Tabs defaultValue="products" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-4">
          {(canCreateProduct || canViewProducts) && (
            <div className="flex items-center justify-between">
              <div />
              {canCreateProduct && (
                <Button onClick={() => navigate('/products/new')}>
                  <Plus className="h-4 w-4" /> New Product
                </Button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative max-w-sm flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                className="pl-9 h-10 border-gray-200 rounded-lg focus:border-[#3b82f6] focus:ring-[#3b82f6]/20"
                placeholder="Search products..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-44 h-10"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40 h-10"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All types</SelectItem>
                {PRODUCT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {canViewProducts ? (
            <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} getRowId={(p) => p.id} compact />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">You do not have permission to view products.</p>
            </div>
          )}

          {meta && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{meta.total} record(s)</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <span>Page {meta.page} of {meta.totalPages}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}

          <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Product?</AlertDialogTitle>
                <AlertDialogDescription>
                  {deleting?.name} will be marked as deleted. It can be restored later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          {canViewCategories && (
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">Categories</h2>
                <p className="text-sm text-muted-foreground">Organize products into categories.</p>
              </div>
              {canCreateCategory && (
                <Button onClick={() => openCategoryDialog(null)}>
                  <Plus className="h-4 w-4" /> New Category
                </Button>
              )}
            </div>
          )}

          {canViewCategories ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">Name</th>
                    <th className="text-left px-4 py-2 font-semibold">Parent</th>
                    <th className="text-left px-4 py-2 font-semibold">Income Account</th>
                    <th className="text-left px-4 py-2 font-semibold">Expense Account</th>
                    <th className="text-right px-4 py-2 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {categories.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {categories.find(p => p.id === c.parentId)?.name ?? '-'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {c.incomeAccountId ? c.incomeAccountId.slice(0, 8) + '...' : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {c.expenseAccountId ? c.expenseAccountId.slice(0, 8) + '...' : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {(canEditCategory || canDeleteCategory) && (
                          <div className="flex items-center justify-end gap-1">
                            {canEditCategory && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openCategoryDialog(c)}
                                className="h-8 w-8"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            )}
                            {canDeleteCategory && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteCategory(c)}
                                className="h-8 w-8 text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {categories.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                        No categories yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">You do not have permission to view categories.</p>
            </div>
          )}

          <Dialog open={categoryDialog.open} onOpenChange={(o) => !o && closeCategoryDialog()}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {categoryDialog.category ? `Edit "${categoryDialog.category.name}"` : 'New Category'}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {catError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2">
                    {catError}
                  </div>
                )}

                <div>
                  <Label className="text-sm font-medium">Name</Label>
                  <Input
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    placeholder="e.g. Beverages"
                    disabled={catSaving}
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium">Parent Category</Label>
                  <Select value={catParentId} onValueChange={setCatParentId} disabled={catSaving}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="No parent (top level)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No parent (top level)</SelectItem>
                      {categories.filter(c => c.id !== categoryDialog.category?.id).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-medium">Income Account (optional)</Label>
                  <Input
                    value={catIncomeAccountId}
                    onChange={(e) => setCatIncomeAccountId(e.target.value)}
                    placeholder="Account ID"
                    disabled={catSaving}
                  />
                </div>

                <div>
                  <Label className="text-sm font-medium">Expense Account (optional)</Label>
                  <Input
                    value={catExpenseAccountId}
                    onChange={(e) => setCatExpenseAccountId(e.target.value)}
                    placeholder="Account ID"
                    disabled={catSaving}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeCategoryDialog} disabled={catSaving}>
                  Cancel
                </Button>
                <Button onClick={saveCategory} disabled={catSaving}>
                  {catSaving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  {categoryDialog.category ? 'Save' : 'Create'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}