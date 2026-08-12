import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Pencil, Archive, RotateCcw, Loader2 } from 'lucide-react';
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
  usePaymentTerms,
  useDeletedPaymentTerms,
  useCreatePaymentTerm,
  useUpdatePaymentTerm,
  useArchivePaymentTerm,
  useRestorePaymentTerm,
  PAYMENT_METHOD_LABELS,
  type PaymentTerm,
  type PaymentTermMethod,
} from '@/features/accounting/api';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';

/* ── Form state ─────────────────────────────────────────── */

interface TermFormState {
  name: string;
  code: string;
  method: PaymentTermMethod;
  netDays: string;
  discountDays: string;
  discountPercent: string;
  sortOrder: string;
  isActive: boolean;
}

const defaultForm: TermFormState = {
  name: '',
  code: '',
  method: 'net_days',
  netDays: '30',
  discountDays: '',
  discountPercent: '',
  sortOrder: '0',
  isActive: true,
};

/** Human-readable due-date description of a term. */
export function describeTermDue(term: Pick<PaymentTerm, 'method' | 'netDays'>): string {
  if (term.method === 'immediate') return 'Immediate';
  if (term.method === 'end_of_following_month') {
    return term.netDays > 0
      ? `End of following month + ${term.netDays} day${term.netDays !== 1 ? 's' : ''}`
      : 'End of following month';
  }
  if (term.netDays === 0) return 'Due on invoice date';
  return `${term.netDays} day${term.netDays !== 1 ? 's' : ''} after invoice date`;
}

export default function PaymentTermsPage() {
  const auth = useAuthStore();
  const canCreate = auth.hasPermission(PERMISSIONS.account.create);
  const canUpdate = auth.hasPermission(PERMISSIONS.account.update);
  const canDelete = auth.hasPermission(PERMISSIONS.account.delete);

  const { data: terms, isLoading } = usePaymentTerms();
  const { data: archived } = useDeletedPaymentTerms();

  const createTerm = useCreatePaymentTerm();
  const updateTerm = useUpdatePaymentTerm();
  const archiveTerm = useArchivePaymentTerm();
  const restoreTerm = useRestorePaymentTerm();

  /* dialog state */
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentTerm | null>(null);
  const [form, setForm] = useState<TermFormState>(defaultForm);
  const [formError, setFormError] = useState('');

  /* archive confirmation */
  const [archiving, setArchiving] = useState<PaymentTerm | null>(null);

  /* search */
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!dialogOpen) return;
    if (editing) {
      setForm({
        name: editing.name,
        code: editing.code,
        method: editing.method,
        netDays: String(editing.netDays),
        discountDays: editing.discountDays != null ? String(editing.discountDays) : '',
        discountPercent: editing.discountPercent != null ? String(editing.discountPercent) : '',
        sortOrder: String(editing.sortOrder ?? 0),
        isActive: editing.isActive,
      });
    } else {
      setForm(defaultForm);
    }
    setFormError('');
  }, [dialogOpen, editing]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (t: PaymentTerm) => {
    setEditing(t);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setFormError('');
    if (!form.name.trim()) {
      setFormError('Name is required.');
      return;
    }
    if (!form.code.trim()) {
      setFormError('Code is required.');
      return;
    }
    if (form.method !== 'immediate' && (isNaN(Number(form.netDays)) || Number(form.netDays) < 0)) {
      setFormError('A valid number of days is required.');
      return;
    }
    const discountDays = form.discountDays.trim() === '' ? null : Number(form.discountDays);
    const discountPercent = form.discountPercent.trim() === '' ? null : Number(form.discountPercent);
    if ((discountDays == null) !== (discountPercent == null)) {
      setFormError('Early-payment discount needs both a discount window (days) and a percent.');
      return;
    }
    if (discountPercent != null && (discountPercent < 0 || discountPercent > 100)) {
      setFormError('Discount percent must be between 0 and 100.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      method: form.method,
      netDays: form.method === 'immediate' ? 0 : Number(form.netDays),
      discountDays,
      discountPercent,
      sortOrder: Number(form.sortOrder) || 0,
      isActive: form.isActive,
    };

    try {
      if (editing) {
        await updateTerm.mutateAsync({ id: editing.id, ...payload });
      } else {
        await createTerm.mutateAsync(payload);
      }
      setDialogOpen(false);
    } catch {
      /* toast handled in mutation */
    }
  };

  const confirmArchive = async () => {
    if (!archiving) return;
    try {
      await archiveTerm.mutateAsync(archiving.id);
      setArchiving(null);
    } catch {
      /* toast handled in mutation */
    }
  };

  const isPending = createTerm.isPending || updateTerm.isPending;

  /* ── Filtered data (client-side search) ─────────────────── */

  const filtered = useMemo(() => {
    const list = terms ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((t) =>
      [t.name, t.code, PAYMENT_METHOD_LABELS[t.method] ?? t.method, describeTermDue(t)]
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [terms, search]);

  /* ── Columns ────────────────────────────────────────────── */

  const columns: Column<PaymentTerm>[] = [
    { key: 'name', header: 'Name' },
    { key: 'code', header: 'Code' },
    {
      key: 'due',
      header: 'Due date computation',
      render: (t) => <span className="text-sm">{describeTermDue(t)}</span>,
    },
    {
      key: 'discount',
      header: 'Early-payment discount',
      render: (t) =>
        t.discountDays != null && t.discountPercent != null ? (
          <span className="text-sm">
            {Number(t.discountPercent)}% if paid within {t.discountDays} day
            {t.discountDays !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
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
              aria-label="Edit payment term"
              title="Edit payment term"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setArchiving(t)}
              aria-label="Archive payment term"
              title="Archive payment term"
            >
              <Archive className="h-4 w-4 text-destructive" />
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
          <h1 className="text-2xl font-semibold">Payment Terms</h1>
          <p className="text-sm text-muted-foreground">
            Configure due-date terms (immediate, net days, end of month) selectable on sales
            invoices.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New Payment Term
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search payment terms..."
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
          search
            ? 'No payment terms match your search.'
            : 'No payment terms yet. Create one to get started.'
        }
      />

      {/* Archived section */}
      {!!archived?.length && (
        <div className="rounded-lg border bg-muted/30">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Archived ({archived.length})
            </h2>
          </div>
          <div className="divide-y">
            {archived.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium">{t.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    {t.code} · {describeTermDue(t)}
                  </span>
                </div>
                {canUpdate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => restoreTerm.mutate(t.id)}
                    disabled={restoreTerm.isPending}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Restore
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Payment Term' : 'New Payment Term'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the due-date computation for this payment term.'
                : 'Add a payment term that can be selected on sales invoices.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name & Code */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="e.g. Net 30"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  placeholder="e.g. net-30"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </div>
            </div>

            {/* Method */}
            <div className="space-y-1.5">
              <Label htmlFor="method">Due date computation</Label>
              <Select
                value={form.method}
                onValueChange={(v) => setForm({ ...form, method: v as PaymentTermMethod })}
              >
                <SelectTrigger id="method">
                  <SelectValue placeholder="Select computation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="immediate">Immediate Payment</SelectItem>
                  <SelectItem value="net_days">Days after invoice date (net days)</SelectItem>
                  <SelectItem value="end_of_following_month">End of following month</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Days */}
            {form.method !== 'immediate' && (
              <div className="space-y-1.5">
                <Label htmlFor="netDays">
                  {form.method === 'end_of_following_month'
                    ? 'Extra days after end of month (0 = end of month)'
                    : 'Number of days'}
                </Label>
                <Input
                  id="netDays"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="e.g. 30"
                  value={form.netDays}
                  onChange={(e) => setForm({ ...form, netDays: e.target.value })}
                />
              </div>
            )}

            {/* Early-payment discount */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="discountDays">Early-payment window (days)</Label>
                <Input
                  id="discountDays"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="Optional"
                  value={form.discountDays}
                  onChange={(e) => setForm({ ...form, discountDays: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="discountPercent">Early-payment discount (%)</Label>
                <Input
                  id="discountPercent"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  placeholder="Optional"
                  value={form.discountPercent}
                  onChange={(e) => setForm({ ...form, discountPercent: e.target.value })}
                />
              </div>
            </div>

            {/* Sort order + Active */}
            <div className="grid grid-cols-2 gap-4 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="sortOrder">Display order</Label>
                <Input
                  id="sortOrder"
                  type="number"
                  step="1"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer pb-2.5">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-input"
                />
                <span className="font-medium">Active</span>
              </label>
            </div>

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
              ) : editing ? (
                'Save changes'
              ) : (
                'Create term'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation dialog */}
      <Dialog open={!!archiving} onOpenChange={(open) => !open && setArchiving(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Archive payment term?</DialogTitle>
            <DialogDescription>
              {archiving ? (
                <>
                  <strong>{archiving.name}</strong> will be removed from sales pickers. Existing
                  invoices keep their payment term name. You can restore it later from the
                  archived section.
                </>
              ) : (
                ''
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={archiveTerm.isPending}
              onClick={confirmArchive}
            >
              {archiveTerm.isPending ? 'Archiving…' : 'Archive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}