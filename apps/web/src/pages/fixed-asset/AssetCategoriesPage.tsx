import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Edit, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DataTable, type Column } from '@/components/data-table';
import { useAuthStore } from '@/stores/auth.store';
import { notify } from '@/lib/notify';
import { useAllAssetCategories, useAssetCategories, useCreateAssetCategory, useDeleteAssetCategory, useUpdateAssetCategory } from '@/features/fixed-asset/api';
import type { AssetCategory } from '@/features/fixed-asset/types';

const DEPR_METHODS = [
  { value: 'straight_line', label: 'Straight Line' },
  { value: 'declining_balance', label: 'Declining Balance' },
  { value: 'double_declining', label: 'Double Declining' },
  { value: 'units_of_production', label: 'Units of Production' },
  { value: 'manual', label: 'Manual' },
];

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().or(z.literal('')),
  parentId: z.string().optional().or(z.literal('')),
  depreciationMethod: z.string().min(1),
  defaultUsefulLife: z.string().optional().or(z.literal('')),
  defaultResidualValue: z.string().optional().or(z.literal('')),
});
type FormValues = z.infer<typeof schema>;

export function AssetCategoriesPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AssetCategory | null>(null);
  const [deleting, setDeleting] = useState<AssetCategory | null>(null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.assetCategory.create);
  const canEdit = hasPermission(PERMISSIONS.assetCategory.update);
  const canDelete = hasPermission(PERMISSIONS.assetCategory.delete);

  const { data, isLoading } = useAssetCategories({ pageSize: 200 });
  const { data: allCats } = useAllAssetCategories();
  const createCat = useCreateAssetCategory();
  const updateCat = useUpdateAssetCategory();
  const deleteCat = useDeleteAssetCategory();

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: '', depreciationMethod: 'straight_line', defaultUsefulLife: '60' } });

  const openCreate = () => { setEditing(null); form.reset({ name: '', depreciationMethod: 'straight_line', defaultUsefulLife: '60' }); setOpen(true); };
  const openEdit = (cat: AssetCategory) => {
    setEditing(cat);
    form.reset({
      name: cat.name,
      description: cat.description ?? '',
      parentId: cat.parentId ?? '',
      depreciationMethod: cat.depreciationMethod,
      defaultUsefulLife: String(cat.defaultUsefulLife ?? ''),
      defaultResidualValue: String(cat.defaultResidualValue ?? ''),
    });
    setOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    try {
      const data = {
        name: values.name,
        description: values.description || undefined,
        depreciationMethod: values.depreciationMethod,
        defaultUsefulLife: values.defaultUsefulLife ? Number(values.defaultUsefulLife) : undefined,
        defaultResidualValue: values.defaultResidualValue ? Number(values.defaultResidualValue) : undefined,
        parentId: values.parentId || undefined,
      };
      if (editing) {
        await updateCat.mutateAsync({ id: editing.id, data: data as any });
        notify.success('Category updated');
      } else {
        await createCat.mutateAsync(data as any);
        notify.success('Category created');
      }
      setOpen(false);
    } catch (err: any) { notify.error(err?.response?.data?.message ?? 'Error'); }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try { await deleteCat.mutateAsync(deleting.id); notify.success('Category deleted'); setDeleting(null); } catch (err: any) { notify.error(err?.response?.data?.message ?? 'Error'); }
  };

  const columns: Column<AssetCategory>[] = [
    { key: 'name', header: 'Name' },
    { key: 'depreciationMethod', header: 'Depreciation Method', render: (r) => <Badge variant="outline">{r.depreciationMethod?.replace(/_/g, ' ')}</Badge> },
    { key: 'defaultUsefulLife', header: 'Useful Life (mo)', render: (r) => `${r.defaultUsefulLife ?? 60} mo` },
    { key: '_count', header: 'Assets', render: (r) => r._count?.assets ?? 0 },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex gap-1">
          {canEdit && <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Edit className="h-4 w-4" /></Button>}
          {canDelete && <Button size="icon" variant="ghost" onClick={() => setDeleting(r)}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Asset Categories</h1>
        {canCreate && <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> Add Category</Button>}
      </div>
      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit' : 'Create'} Asset Category</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div><Label>Name</Label><Input {...form.register('name')} /></div>
            <div><Label>Description</Label><Input {...form.register('description')} /></div>
            <div>
              <Label>Parent Category</Label>
              <Select value={form.watch('parentId')} onValueChange={(v) => form.setValue('parentId', v)}>
                <SelectTrigger><SelectValue placeholder="None (top-level)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None (top-level)</SelectItem>
                  {(allCats ?? []).filter((c: AssetCategory) => c.id !== editing?.id).map((c: AssetCategory) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Depreciation Method</Label>
              <Select value={form.watch('depreciationMethod')} onValueChange={(v) => form.setValue('depreciationMethod', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEPR_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Default Useful Life (months)</Label><Input type="number" {...form.register('defaultUsefulLife')} /></div>
            <div><Label>Default Residual Value</Label><Input type="number" step="0.01" {...form.register('defaultResidualValue')} /></div>
            <DialogFooter><Button type="submit">{editing ? 'Update' : 'Create'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Category?</AlertDialogTitle><AlertDialogDescription>This will permanently delete "{deleting?.name}". Cannot delete if assets are assigned.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
