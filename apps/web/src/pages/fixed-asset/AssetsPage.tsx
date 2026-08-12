import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Edit, Eye, Plus, Search, Trash2 } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DataTable, type Column } from '@/components/data-table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useAuthStore } from '@/stores/auth.store';
import { notify } from '@/lib/notify';
import { formatCurrency } from '@/lib/utils';
import { useAllAssetCategories, useAssets, useCreateAsset, useDeleteAsset, useUpdateAsset } from '@/features/fixed-asset/api';
import type { Asset } from '@/features/fixed-asset/types';

const STATUSES = ['active', 'under_maintenance', 'disposed', 'lost_stolen', 'in_repair', 'reserved'];
const ACQ_METHODS = ['purchased', 'donated', 'leased', 'constructed', 'transferred_in', 'gifted'];

const assetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  assetCode: z.string().optional().or(z.literal('')),
  barcode: z.string().optional().or(z.literal('')),
  description: z.string().optional().or(z.literal('')),
  serialNumber: z.string().optional().or(z.literal('')),
  brand: z.string().optional().or(z.literal('')),
  model: z.string().optional().or(z.literal('')),
  manufacturer: z.string().optional().or(z.literal('')),
  categoryId: z.string().optional().or(z.literal('')),
  department: z.string().optional().or(z.literal('')),
  location: z.string().optional().or(z.literal('')),
  purchaseDate: z.string().optional().or(z.literal('')),
  purchaseCost: z.string().optional().or(z.literal('')),
  salvageValue: z.string().optional().or(z.literal('')),
  usefulLife: z.string().optional().or(z.literal('')),
  acquisitionMethod: z.string().optional().or(z.literal('')),
  supplierId: z.string().optional().or(z.literal('')),
  invoiceNumber: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
});
type AssetFormValues = z.infer<typeof assetSchema>;

export function AssetsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [statusFilter, setStatusFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.fixedAsset.create);
  const canEdit = hasPermission(PERMISSIONS.fixedAsset.update);
  const canDelete = hasPermission(PERMISSIONS.fixedAsset.delete);

  const { data, isLoading } = useAssets({ page, pageSize: 10, search, status: statusFilter || undefined, categoryId: catFilter || undefined });
  const { data: categories } = useAllAssetCategories();
  const createAsset = useCreateAsset();
  const updateAsset = useUpdateAsset();
  const deleteAsset = useDeleteAsset();

  const form = useForm<AssetFormValues>({ resolver: zodResolver(assetSchema) });
  useEffect(() => { setPage(1); }, [search, statusFilter, catFilter]);

  const openCreate = () => { setEditing(null); form.reset({ acquisitionMethod: 'purchased', usefulLife: '60' }); setOpen(true); };
  const openEdit = (asset: Asset) => {
    setEditing(asset);
    form.reset({
      name: asset.name, assetCode: asset.assetCode, barcode: asset.barcode ?? '',
      description: asset.description ?? '', serialNumber: asset.serialNumber ?? '',
      brand: asset.brand ?? '', model: asset.model ?? '', manufacturer: asset.manufacturer ?? '',
      categoryId: asset.categoryId ?? '', department: asset.department ?? '',
      location: asset.location ?? '', purchaseDate: asset.purchaseDate?.split('T')[0] ?? '',
      purchaseCost: asset.purchaseCost ?? '', salvageValue: asset.salvageValue ?? '',
      usefulLife: String(asset.usefulLife ?? ''), acquisitionMethod: asset.acquisitionMethod,
      supplierId: asset.supplierId ?? '', invoiceNumber: asset.invoiceNumber ?? '',
      notes: asset.notes ?? '',
    });
    setOpen(true);
  };

  const onSubmit = async (values: AssetFormValues) => {
    try {
      const data: Record<string, any> = {
        ...values,
        purchaseCost: values.purchaseCost ? Number(values.purchaseCost) : undefined,
        salvageValue: values.salvageValue ? Number(values.salvageValue) : undefined,
        usefulLife: values.usefulLife ? Number(values.usefulLife) : undefined,
        categoryId: values.categoryId || undefined,
        supplierId: values.supplierId || undefined,
        purchaseDate: values.purchaseDate || undefined,
      };
      if (editing) {
        await updateAsset.mutateAsync({ id: editing.id, data });
        notify.success('Asset updated');
      } else {
        await createAsset.mutateAsync(data);
        notify.success('Asset created');
      }
      setOpen(false);
    } catch (err: any) { notify.error(err?.response?.data?.message ?? 'Error'); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { active: 'bg-green-100 text-green-800', under_maintenance: 'bg-yellow-100 text-yellow-800', disposed: 'bg-red-100 text-red-800', lost_stolen: 'bg-red-100 text-red-800', in_repair: 'bg-orange-100 text-orange-800', reserved: 'bg-blue-100 text-blue-800' };
    return <Badge className={map[status] ?? ''}>{status.replace(/_/g, ' ')}</Badge>;
  };

  const columns: Column<Asset>[] = [
    { key: 'assetCode', header: 'Code' },
    { key: 'name', header: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'category', header: 'Category', render: (r) => r.category?.name ?? '-' },
    { key: 'location', header: 'Location' },
    { key: 'status', header: 'Status', render: (r) => statusBadge(r.status) },
    { key: 'currentValue', header: 'Value', render: (r) => formatCurrency(r.currentValue ?? '0') },
    { key: 'serialNumber', header: 'Serial #' },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" onClick={() => navigate(`/fixed-assets/${r.id}`)}><Eye className="h-4 w-4" /></Button>
          {canEdit && <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Edit className="h-4 w-4" /></Button>}
          {canDelete && r.status !== 'disposed' && <Button size="icon" variant="ghost" onClick={() => setDeleting(r)}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Asset Register</h1>
        {canCreate && <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> Add Asset</Button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative w-64"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder="Search assets..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="pl-8" /></div>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-40"><SelectValue placeholder="All Status" /></SelectTrigger><SelectContent><SelectItem value="">All Status</SelectItem>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent></Select>
        <Select value={catFilter} onValueChange={setCatFilter}><SelectTrigger className="w-48"><SelectValue placeholder="All Categories" /></SelectTrigger><SelectContent><SelectItem value="">All Categories</SelectItem>{(categories ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
      </div>
      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} />
      {data?.meta && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {data.meta.page} of {data.meta.totalPages} ({data.meta.total} total)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= (data.meta.totalPages ?? 1)} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Edit' : 'Create'} Asset</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Asset Code</Label><Input {...form.register('assetCode')} placeholder="Auto-generated" /></div>
              <div><Label>Barcode / QR</Label><Input {...form.register('barcode')} /></div>
            </div>
            <div><Label>Name *</Label><Input {...form.register('name')} /></div>
            <div><Label>Description</Label><Input {...form.register('description')} /></div>
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Brand</Label><Input {...form.register('brand')} /></div>
              <div><Label>Model</Label><Input {...form.register('model')} /></div>
              <div><Label>Serial #</Label><Input {...form.register('serialNumber')} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={form.watch('categoryId')} onValueChange={(v) => form.setValue('categoryId', v)}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent><SelectItem value="">None</SelectItem>{(categories ?? []).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Acquisition Method</Label>
                <Select value={form.watch('acquisitionMethod')} onValueChange={(v) => form.setValue('acquisitionMethod', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ACQ_METHODS.map((m) => <SelectItem key={m} value={m}>{m.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Department</Label><Input {...form.register('department')} /></div>
              <div><Label>Location</Label><Input {...form.register('location')} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Purchase Date</Label><Input type="date" {...form.register('purchaseDate')} /></div>
              <div><Label>Purchase Cost</Label><Input type="number" step="0.01" {...form.register('purchaseCost')} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Salvage Value</Label><Input type="number" step="0.01" {...form.register('salvageValue')} /></div>
              <div><Label>Useful Life (months)</Label><Input type="number" {...form.register('usefulLife')} /></div>
            </div>
            <div><Label>Notes</Label><Input {...form.register('notes')} /></div>
            <DialogFooter><Button type="submit">{editing ? 'Update' : 'Create'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Asset?</AlertDialogTitle><AlertDialogDescription>Soft-delete "{deleting?.name}" ({deleting?.assetCode})?</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={async () => { try { await deleteAsset.mutateAsync(deleting!.id); notify.success('Deleted'); setDeleting(null); } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Error'); } }}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
