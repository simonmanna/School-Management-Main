import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Edit, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/data-table';
import {
  useCostCenters,
  useCreateCostCenter,
  useUpdateCostCenter,
  useDeleteCostCenter,
  type CostCenter,
} from '@/features/accounting/api';

type TabValue = 'all' | 'cost' | 'profit';

const TAB_OPTIONS: { value: TabValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'cost', label: 'Cost Centers' },
  { value: 'profit', label: 'Profit Centers' },
];

const TYPE_LABELS: Record<string, string> = {
  cost: 'Cost',
  profit: 'Profit',
};

const formSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['cost', 'profit'], { required_error: 'Type is required' }),
});

type FormValues = z.infer<typeof formSchema>;

function CostCentersPage() {
  const [tab, setTab] = useState<TabValue>('all');
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [deleting, setDeleting] = useState<CostCenter | null>(null);

  const typeParam = tab === 'all' ? undefined : tab;
  const { data, isLoading } = useCostCenters({ page, type: typeParam });
  const createCenter = useCreateCostCenter();
  const updateCenter = useUpdateCostCenter();
  const deleteCenter = useDeleteCostCenter();

  const isEdit = !!editing;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { code: '', name: '', type: 'cost' },
  });

  function handleOpenCreate() {
    setEditing(null);
    form.reset({ code: '', name: '', type: 'cost' });
    setDialogOpen(true);
  }

  function handleOpenEdit(center: CostCenter) {
    setEditing(center);
    form.reset({ code: center.code, name: center.name, type: center.type as 'cost' | 'profit' });
    setDialogOpen(true);
  }

  function handleTabChange(value: string) {
    setTab(value as TabValue);
    setPage(1);
  }

  async function onSubmit(values: FormValues) {
    try {
      if (isEdit && editing) {
        await updateCenter.mutateAsync({ id: editing.id, ...values });
      } else {
        await createCenter.mutateAsync(values);
      }
      setDialogOpen(false);
    } catch {
      /* toast handled in mutation */
    }
  }

  async function handleConfirmDelete() {
    if (!deleting) return;
    try {
      await deleteCenter.mutateAsync(deleting.id);
    } catch {
      /* toast handled in mutation */
    }
    setDeleting(null);
  }

  const isPending = createCenter.isPending || updateCenter.isPending;
  const centers = data?.data ?? [];
  const meta = data?.meta;

  const columns: Column<CostCenter>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (c) => <span className="font-mono text-sm font-medium">{c.code}</span>,
    },
    {
      key: 'name',
      header: 'Name',
    },
    {
      key: 'type',
      header: 'Type',
      render: (c) => (
        <Badge variant={c.type === 'profit' ? 'default' : 'secondary'}>
          {TYPE_LABELS[c.type] ?? c.type}
        </Badge>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (c) => (
        c.isActive
          ? <Badge variant="default" className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">Active</Badge>
          : <Badge variant="secondary" className="bg-slate-100 text-slate-500 border-slate-200">Inactive</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (c) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleOpenEdit(c)}
          >
            <Edit className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => setDeleting(c)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            Cost & Profit Centers
          </h1>
          <p className="text-sm text-gray-500">
            Manage cost and profit centers used to track performance by department or business unit.
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="gap-1.5">
          <Plus className="h-4 w-4" /> Create Center
        </Button>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          {TAB_OPTIONS.map((opt) => (
            <TabsTrigger key={opt.value} value={opt.value}>
              {opt.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Table */}
      <DataTable
        columns={columns}
        data={centers}
        loading={isLoading}
        getRowId={(c) => c.id}
        emptyMessage="No cost or profit centers found."
      />

      {/* Pagination */}
      {meta && (
        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-600">
            Showing{' '}
            <span className="font-medium text-gray-800">
              {(page - 1) * meta.pageSize + 1}
            </span>{' '}
            to{' '}
            <span className="font-medium text-gray-800">
              {Math.min(page * meta.pageSize, meta.total)}
            </span>{' '}
            of{' '}
            <span className="font-medium text-gray-800">{meta.total}</span> centers
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => p - 1)}
              className="border-gray-300"
            >
              Previous
            </Button>
            <span className="text-sm text-gray-600">
              Page {page} of {meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages || isLoading}
              onClick={() => setPage((p) => p + 1)}
              className="border-gray-300"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit Center' : 'Create Center'}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? 'Update the code, name, or type of this cost/profit center.'
                : 'Add a new cost or profit center to track performance.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Code</Label>
              <Input id="code" placeholder="e.g. CC-001" {...form.register('code')} />
              {form.formState.errors.code && (
                <p className="text-sm text-destructive">{form.formState.errors.code.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="e.g. Kitchen Operations" {...form.register('name')} />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select
                value={form.watch('type')}
                onValueChange={(v) => form.setValue('type', v as 'cost' | 'profit', { shouldValidate: true })}
              >
                <SelectTrigger id="type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cost">Cost Center</SelectItem>
                  <SelectItem value="profit">Profit Center</SelectItem>
                </SelectContent>
              </Select>
              {form.formState.errors.type && (
                <p className="text-sm text-destructive">{form.formState.errors.type.message}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create center'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Center</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{' '}
              <span className="font-medium">{deleting?.code} — {deleting?.name}</span>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleteCenter.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCenter.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default CostCentersPage;
export { CostCentersPage };
