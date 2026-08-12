import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/data-table';
import {
  useAccountCategories, useCreateAccountCategory, useDeleteAccountCategory,
  useUpdateAccountCategory, type AccountCategory,
} from '@/features/accounting/api';
import { useAuthStore } from '@/stores/auth.store';

const CLASSIFICATIONS = ['asset', 'liability', 'equity', 'revenue', 'expense', 'off_balance'] as const;
const NORMAL_BALANCES = ['debit', 'credit'] as const;
const CASH_FLOW_CLASSES = ['operating', 'investing', 'financing', 'none'] as const;
const REPORT_SECTIONS = [
  'current_assets', 'non_current_assets', 'current_liabilities', 'long_term_liabilities',
  'equity', 'revenue', 'contra_revenue', 'cogs', 'operating_expense',
  'other_income', 'other_expense', 'off_balance',
] as const;

const LABELS: Record<string, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity', revenue: 'Revenue',
  expense: 'Expense', off_balance: 'Off Balance Sheet',
  debit: 'Debit', credit: 'Credit',
  operating: 'Operating', investing: 'Investing', financing: 'Financing', none: 'Excluded',
  current_assets: 'Current Assets', non_current_assets: 'Non-current Assets',
  current_liabilities: 'Current Liabilities', long_term_liabilities: 'Long-term Liabilities',
  contra_revenue: 'Contra Revenue', cogs: 'Cost of Sales',
  operating_expense: 'Operating Expenses', other_income: 'Other Income',
  other_expense: 'Other Expenses',
};

const label = (v: string | null | undefined): string =>
  !v ? '—' : LABELS[v] ?? v.replace(/_/g, ' ');

const schema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,48}$/, 'Lower-case snake_case, 2-49 chars'),
  name: z.string().min(1, 'Required'),
  description: z.string().optional(),
  classification: z.enum(CLASSIFICATIONS),
  normalBalance: z.enum(NORMAL_BALANCES),
  reportSection: z.enum(REPORT_SECTIONS),
  cashFlowClass: z.enum(CASH_FLOW_CLASSES),
  isContra: z.boolean(),
  isCashEquivalent: z.boolean(),
  allowReconciliation: z.boolean(),
  allowManualPosting: z.boolean(),
  allowBudgeting: z.boolean(),
  sortOrder: z.coerce.number().int(),
});

type FormValues = z.infer<typeof schema>;

const DEFAULTS: FormValues = {
  key: '', name: '', description: '',
  classification: 'asset', normalBalance: 'debit', reportSection: 'current_assets',
  cashFlowClass: 'operating', isContra: false, isCashEquivalent: false,
  allowReconciliation: false, allowManualPosting: true, allowBudgeting: false,
  sortOrder: 500,
};

export function AccountCategoriesPage() {
  const auth = useAuthStore();
  const canCreate = auth.hasPermission(PERMISSIONS.accountCategory.create);
  const canUpdate = auth.hasPermission(PERMISSIONS.accountCategory.update);
  const canDelete = auth.hasPermission(PERMISSIONS.accountCategory.delete);

  const [tab, setTab] = useState<'all' | 'system' | 'custom'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AccountCategory | null>(null);
  const [deleting, setDeleting] = useState<AccountCategory | null>(null);

  const categories = useAccountCategories();
  const createCategory = useCreateAccountCategory();
  const updateCategory = useUpdateAccountCategory();
  const deleteCategory = useDeleteAccountCategory();

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });

  const rows = useMemo(() => {
    const all = categories.data ?? [];
    if (tab === 'system') return all.filter((c) => c.isSystem);
    if (tab === 'custom') return all.filter((c) => !c.isSystem);
    return all;
  }, [categories.data, tab]);

  const handleOpenCreate = () => {
    setEditing(null);
    form.reset(DEFAULTS);
    setDialogOpen(true);
  };

  const handleOpenEdit = (c: AccountCategory) => {
    setEditing(c);
    form.reset({
      key: c.key,
      name: c.name,
      description: c.description ?? '',
      classification: c.classification as FormValues['classification'],
      normalBalance: c.normalBalance,
      reportSection: c.reportSection as FormValues['reportSection'],
      cashFlowClass: c.cashFlowClass as FormValues['cashFlowClass'],
      isContra: c.isContra,
      isCashEquivalent: c.isCashEquivalent,
      allowReconciliation: c.allowReconciliation,
      allowManualPosting: c.allowManualPosting,
      allowBudgeting: c.allowBudgeting,
      sortOrder: c.sortOrder,
    });
    setDialogOpen(true);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (editing) {
        // `key` is immutable — modules resolve accounts by it.
        const { key: _key, ...patch } = values;
        await updateCategory.mutateAsync({ id: editing.id, ...patch });
      } else {
        await createCategory.mutateAsync(values);
      }
      setDialogOpen(false);
    } catch { /* handled in mutation */ }
  });

  const columns: Column<AccountCategory>[] = [
    {
      key: 'key',
      header: 'Key',
      render: (c) => (
        <div className="flex items-center gap-2">
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{c.key}</code>
          {c.isSystem && <Lock className="h-3 w-3 text-muted-foreground" aria-label="System category" />}
        </div>
      ),
    },
    { key: 'name', header: 'Name', render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'classification', header: 'Classification', render: (c) => label(c.classification) },
    {
      key: 'normalBalance',
      header: 'Normal Balance',
      render: (c) => (
        <Badge variant={c.normalBalance === 'debit' ? 'secondary' : 'outline'} className="text-xs">
          {label(c.normalBalance)}
        </Badge>
      ),
    },
    { key: 'reportSection', header: 'Report Section', render: (c) => label(c.reportSection) },
    {
      key: 'flags',
      header: 'Flags',
      render: (c) => (
        <div className="flex flex-wrap gap-1">
          {c.isContra && <Badge variant="outline" className="text-[10px]">Contra</Badge>}
          {c.isCashEquivalent && <Badge variant="outline" className="text-[10px]">Cash</Badge>}
          {c.allowReconciliation && <Badge variant="outline" className="text-[10px]">Reconcile</Badge>}
          {!c.isActive && <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
        </div>
      ),
    },
    {
      key: 'accountCount',
      header: 'Accounts',
      className: 'text-right',
      render: (c) => <span className="tabular-nums">{c.accountCount ?? 0}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (c) => (
        <div className="flex justify-end gap-1">
          {canUpdate && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenEdit(c)} title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {canDelete && !c.isSystem && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setDeleting(c)}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const isSystemEdit = !!editing?.isSystem;
  const isSaving = createCategory.isPending || updateCategory.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4">
          <h1 className="text-3xl font-bold">Account Categories</h1>
          <p className="text-sm text-gray-500 mt-1">
            Categories define accounting <em>behavior</em> — normal balance, which statement an
            account lands on, and which modules can find it automatically. This is separate from
            the chart-of-accounts hierarchy, which is for reporting and navigation only.
          </p>
        </div>
        {canCreate && (
          <Button onClick={handleOpenCreate}>
            <Plus className="h-4 w-4 mr-1" /> New Category
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="custom">Custom</TabsTrigger>
        </TabsList>
      </Tabs>

      <DataTable
        data={rows}
        columns={columns}
        loading={categories.isLoading}
        getRowId={(c) => c.id}
        emptyMessage="No account categories found."
      />

      {/* ── Create / Edit dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New Account Category'}</DialogTitle>
            <DialogDescription>
              {isSystemEdit
                ? 'This is a system category. Its key, classification, normal balance and contra flag are fixed — the posting engine and every report depend on them.'
                : 'Modules resolve accounts by category key, so choose it carefully: it cannot be changed later.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="key">Key *</Label>
                <Input id="key" placeholder="e.g. crypto_wallet" disabled={!!editing} {...form.register('key')} />
                {form.formState.errors.key && (
                  <p className="text-sm text-destructive">{form.formState.errors.key.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" placeholder="e.g. Crypto Wallet" {...form.register('name')} />
                {form.formState.errors.name && (
                  <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" rows={2} {...form.register('description')} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Classification *</Label>
                <Select
                  value={form.watch('classification')}
                  onValueChange={(v) => form.setValue('classification', v as FormValues['classification'])}
                  disabled={isSystemEdit}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CLASSIFICATIONS.map((c) => (
                      <SelectItem key={c} value={c}>{label(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Normal Balance *</Label>
                <Select
                  value={form.watch('normalBalance')}
                  onValueChange={(v) => form.setValue('normalBalance', v as FormValues['normalBalance'])}
                  disabled={isSystemEdit}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {NORMAL_BALANCES.map((c) => (
                      <SelectItem key={c} value={c}>{label(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Report Section *</Label>
                <Select
                  value={form.watch('reportSection')}
                  onValueChange={(v) => form.setValue('reportSection', v as FormValues['reportSection'])}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REPORT_SECTIONS.map((c) => (
                      <SelectItem key={c} value={c}>{label(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cash Flow Class</Label>
                <Select
                  value={form.watch('cashFlowClass')}
                  onValueChange={(v) => form.setValue('cashFlowClass', v as FormValues['cashFlowClass'])}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CASH_FLOW_CLASSES.map((c) => (
                      <SelectItem key={c} value={c}>{label(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" disabled={isSystemEdit} {...form.register('isContra')} />
                <span>Contra account (opposite normal balance)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" {...form.register('isCashEquivalent')} />
                <span>Cash &amp; cash equivalent</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" {...form.register('allowReconciliation')} />
                <span>Allow reconciliation</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" {...form.register('allowManualPosting')} />
                <span>Allow manual posting</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" {...form.register('allowBudgeting')} />
                <span>Allow budgeting</span>
              </label>
              <div className="space-y-1">
                <Label htmlFor="sortOrder" className="text-xs">Sort order</Label>
                <Input id="sortOrder" type="number" className="h-8" {...form.register('sortOrder')} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Saving…' : editing ? 'Save' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.accountCount
                ? `${deleting.accountCount} account(s) still use this category. Reassign them first.`
                : 'This category is not used by any account and can be safely removed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!!deleting?.accountCount || deleteCategory.isPending}
              onClick={async () => {
                if (!deleting) return;
                try {
                  await deleteCategory.mutateAsync(deleting.id);
                  setDeleting(null);
                } catch { /* handled */ }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default AccountCategoriesPage;
