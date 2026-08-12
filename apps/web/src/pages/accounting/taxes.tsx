import { useEffect, useState } from 'react';
import { Search, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/data-table';
import {
  useTaxes,
  useCreateTax,
  useUpdateTax,
  useDeleteTax,
  useAccounts,
  type Tax,
} from '@/features/accounting/api';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';
import { cn } from '@/lib/utils';

/* ── Constants ────────────────────────────────────────────── */

const TAX_TYPE_OPTIONS = ['vat', 'gst', 'sales_tax', 'withholding'] as const;

const TAX_TYPE_LABELS: Record<string, string> = {
  vat: 'VAT',
  gst: 'GST',
  sales_tax: 'Sales Tax',
  withholding: 'Withholding',
};

const VAT_CATEGORY_OPTIONS = ['standard', 'zero_rated', 'exempt', 'out_of_scope'] as const;

const VAT_CATEGORY_LABELS: Record<string, string> = {
  standard: 'Standard',
  zero_rated: 'Zero Rated',
  exempt: 'Exempt',
  out_of_scope: 'Out of Scope',
};

/* ── Default form state ──────────────────────────────────── */

interface TaxFormState {
  name: string;
  code: string;
  rate: string;
  type: string;
  vatCategory: string;
  isInclusive: boolean;
  isCompound: boolean;
  accountId: string;
}

const defaultForm: TaxFormState = {
  name: '',
  code: '',
  rate: '',
  type: 'vat',
  vatCategory: 'standard',
  isInclusive: false,
  isCompound: false,
  accountId: '',
};

/* ── Page component ──────────────────────────────────────── */

export default function TaxesPage() {
  const auth = useAuthStore();
  const canCreate = auth.hasPermission(PERMISSIONS.tax.create);
  const canUpdate = auth.hasPermission(PERMISSIONS.tax.update);
  const canDelete = auth.hasPermission(PERMISSIONS.tax.delete);

  /* pagination */
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data: taxResult, isLoading } = useTaxes({ page, pageSize });
  const taxes = taxResult?.data ?? [];
  const meta = taxResult?.meta;

  const { data: accountsData } = useAccounts();
  const accounts = accountsData?.data ?? [];

  const createTax = useCreateTax();
  const updateTax = useUpdateTax();
  const deleteTax = useDeleteTax();

  /* dialog state */
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTax, setEditingTax] = useState<Tax | null>(null);
  const [form, setForm] = useState<TaxFormState>(defaultForm);
  const [formError, setFormError] = useState('');

  /* delete confirmation */
  const [deleting, setDeleting] = useState<Tax | null>(null);

  /* search */
  const [search, setSearch] = useState('');

  /* Reset form when dialog opens */
  useEffect(() => {
    if (!dialogOpen) return;
    if (editingTax) {
      setForm({
        name: editingTax.name,
        code: editingTax.code ?? '',
        rate: String(editingTax.rate),
        type: editingTax.type,
        vatCategory: editingTax.vatCategory,
        isInclusive: editingTax.isInclusive,
        isCompound: editingTax.isCompound,
        accountId: editingTax.accountId ?? '',
      });
    } else {
      setForm(defaultForm);
    }
    setFormError('');
  }, [dialogOpen, editingTax]);

  /* ── Handlers ───────────────────────────────────────────── */

  const openCreate = () => {
    setEditingTax(null);
    setDialogOpen(true);
  };

  const openEdit = (tax: Tax) => {
    setEditingTax(tax);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setFormError('');

    if (!form.name.trim()) {
      setFormError('Tax name is required.');
      return;
    }
    if (!form.rate || isNaN(Number(form.rate)) || Number(form.rate) < 0) {
      setFormError('A valid rate is required.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || undefined,
      rate: Number(form.rate),
      type: form.type,
      vatCategory: form.vatCategory,
      isInclusive: form.isInclusive,
      isCompound: form.isCompound,
      accountId: form.accountId || undefined,
    };

    try {
      if (editingTax) {
        await updateTax.mutateAsync({ id: editingTax.id, ...payload });
      } else {
        await createTax.mutateAsync(payload);
      }
      setDialogOpen(false);
    } catch {
      /* toast handled in mutation */
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteTax.mutateAsync(deleting.id);
      setDeleting(null);
    } catch {
      /* toast handled in mutation */
    }
  };

  const isPending = createTax.isPending || updateTax.isPending;

  /* ── Filtered data (client-side search) ─────────────────── */

  const filtered = search.trim()
    ? taxes.filter((t) =>
        [t.name, t.code ?? '', TAX_TYPE_LABELS[t.type] ?? t.type]
          .some((v) => v.toLowerCase().includes(search.toLowerCase())),
      )
    : taxes;

  /* ── Columns ────────────────────────────────────────────── */

  const columns: Column<Tax>[] = [
    { key: 'name', header: 'Name' },
    { key: 'code', header: 'Code' },
    {
      key: 'rate',
      header: 'Rate',
      render: (t) => <span className="font-mono">{Number(t.rate).toFixed(2)}%</span>,
    },
    {
      key: 'type',
      header: 'Type',
      render: (t) => (
        <Badge variant="secondary">{TAX_TYPE_LABELS[t.type] ?? t.type.replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'vatCategory',
      header: 'VAT Category',
      render: (t) => (
        <span className="text-sm capitalize text-muted-foreground">
          {VAT_CATEGORY_LABELS[t.vatCategory] ?? t.vatCategory.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (t) =>
        t.isActive ? (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Active</Badge>
        ) : (
          <Badge variant="secondary">Inactive</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-24 text-right',
      render: (t) => (
        <div className="flex justify-end gap-1">
          {canUpdate && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => openEdit(t)}
              aria-label="Edit tax"
              title="Edit tax"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDeleting(t)}
              aria-label="Delete tax"
              title="Delete tax"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  /* ── Render ─────────────────────────────────────────────── */

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tax Rates</h1>
          <p className="text-sm text-muted-foreground">
            Manage VAT, sales tax, withholding and other tax configurations.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Create Tax
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search taxes..."
          className="pl-9"
        />
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={filtered}
        loading={isLoading}
        getRowId={(t) => t.id}
        emptyMessage={
          search ? 'No taxes match your search.' : 'No taxes found. Create one to get started.'
        }
      />

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-lg border px-4 py-3">
          <span className="text-xs text-slate-500 font-medium">
            {meta.total} tax{meta.total !== 1 ? 'es' : ''}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: meta.totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={cn(
                  'h-8 w-8 rounded-lg text-xs font-bold transition-colors',
                  p === page
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-500 hover:bg-slate-50',
                )}
              >
                {p}
              </button>
            ))}
            <Button
              variant="ghost"
              size="icon"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
              className="h-8 w-8"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTax ? 'Edit Tax' : 'Create Tax'}</DialogTitle>
            <DialogDescription>
              {editingTax
                ? 'Update the tax rate configuration.'
                : 'Add a new tax rate to use on invoices and transactions.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name & Code */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Standard VAT"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  placeholder="e.g. VAT-16"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </div>
            </div>

            {/* Rate & Type */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rate">Rate (%)</Label>
                <Input
                  id="rate"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 16"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type">Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) => setForm({ ...form, type: v })}
                >
                  <SelectTrigger id="type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_TYPE_OPTIONS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TAX_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* VAT Category */}
            <div className="space-y-1.5">
              <Label htmlFor="vatCategory">VAT Category</Label>
              <Select
                value={form.vatCategory}
                onValueChange={(v) => setForm({ ...form, vatCategory: v })}
              >
                <SelectTrigger id="vatCategory">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {VAT_CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {VAT_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Account (optional) */}
            <div className="space-y-1.5">
              <Label htmlFor="accountId">Account (optional)</Label>
              <Select
                value={form.accountId}
                onValueChange={(v) => setForm({ ...form, accountId: v })}
              >
                <SelectTrigger id="accountId">
                  <SelectValue placeholder="No account linked" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No account linked</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Checkboxes */}
            <div className="flex flex-col gap-3 pt-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isInclusive}
                  onChange={(e) => setForm({ ...form, isInclusive: e.target.checked })}
                  className="h-4 w-4 rounded border-input"
                />
                <span>
                  <span className="font-medium">Inclusive</span>
                  <span className="text-muted-foreground ml-1">
                    — Tax is included in the price
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isCompound}
                  onChange={(e) => setForm({ ...form, isCompound: e.target.checked })}
                  className="h-4 w-4 rounded border-input"
                />
                <span>
                  <span className="font-medium">Compound</span>
                  <span className="text-muted-foreground ml-1">
                    — Tax is calculated on the pre-tax amount plus other taxes
                  </span>
                </span>
              </label>
            </div>

            {/* Error */}
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving…
                </>
              ) : editingTax ? (
                'Save changes'
              ) : (
                'Create tax'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete tax?</DialogTitle>
            <DialogDescription>
              {deleting ? (
                <>
                  <strong>{deleting.name}</strong> (rate: {Number(deleting.rate).toFixed(2)}%) will
                  be permanently deleted. This action cannot be undone.
                </>
              ) : (
                ''
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteTax.isPending}
              onClick={confirmDelete}
            >
              {deleteTax.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
