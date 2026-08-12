import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Pencil, Archive, RotateCcw, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  useFiscalPositions,
  useDeletedFiscalPositions,
  useCreateFiscalPosition,
  useUpdateFiscalPosition,
  useArchiveFiscalPosition,
  useRestoreFiscalPosition,
  type FiscalPosition,
} from '@/features/accounting/api';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';

interface PositionFormState {
  name: string;
  code: string;
  sortOrder: string;
  isActive: boolean;
}

const defaultForm: PositionFormState = {
  name: '',
  code: '',
  sortOrder: '0',
  isActive: true,
};

export default function FiscalPositionsPage() {
  const auth = useAuthStore();
  const canCreate = auth.hasPermission(PERMISSIONS.account.create);
  const canUpdate = auth.hasPermission(PERMISSIONS.account.update);
  const canDelete = auth.hasPermission(PERMISSIONS.account.delete);

  const { data: positions, isLoading } = useFiscalPositions();
  const { data: archived } = useDeletedFiscalPositions();

  const createPosition = useCreateFiscalPosition();
  const updatePosition = useUpdateFiscalPosition();
  const archivePosition = useArchiveFiscalPosition();
  const restorePosition = useRestoreFiscalPosition();

  /* dialog state */
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FiscalPosition | null>(null);
  const [form, setForm] = useState<PositionFormState>(defaultForm);
  const [formError, setFormError] = useState('');

  /* archive confirmation */
  const [archiving, setArchiving] = useState<FiscalPosition | null>(null);

  /* search */
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!dialogOpen) return;
    if (editing) {
      setForm({
        name: editing.name,
        code: editing.code,
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

  const openEdit = (position: FiscalPosition) => {
    setEditing(position);
    setDialogOpen(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.code.trim()) {
      setFormError('Name and code are required');
      return;
    }
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toLowerCase().replace(/\s+/g, '-'),
      sortOrder: parseInt(form.sortOrder, 10) || 0,
      isActive: form.isActive,
    };
    if (editing) {
      updatePosition.mutate(
        { id: editing.id, ...payload },
        { onSuccess: () => setDialogOpen(false) },
      );
    } else {
      createPosition.mutate(payload, { onSuccess: () => setDialogOpen(false) });
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return positions ?? [];
    return (positions ?? []).filter(
      (p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q),
    );
  }, [positions, search]);

  const columns: Column<FiscalPosition>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (p) => <div className="font-medium">{p.name}</div>,
    },
    { key: 'code', header: 'Code', render: (p) => <span className="text-sm text-muted-foreground">{p.code}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (p) =>
        p.isActive ? (
          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge>
        ) : (
          <Badge className="bg-slate-100 text-slate-600 border-slate-200">Inactive</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <div className="flex justify-end gap-1">
          {canUpdate && (
            <Button
              variant="ghost"
              size="sm"
              title="Edit fiscal position"
              onClick={() => openEdit(p)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              title="Archive fiscal position"
              onClick={() => setArchiving(p)}
            >
              <Archive className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fiscal Positions</h1>
          <p className="text-sm text-muted-foreground">
            Tax-treatment labels selectable on sales invoices (Odoo-style).
          </p>
        </div>
        {canCreate && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> New Fiscal Position
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search fiscal positions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <DataTable columns={columns} data={filtered} />
      )}

      {/* ── Archived section ─────────────────────────────────────── */}
      {(archived?.length ?? 0) > 0 && (
        <div className="rounded-lg border bg-muted/30">
          <div className="border-b px-4 py-2 text-sm font-medium text-muted-foreground">
            Archived ({archived?.length})
          </div>
          <ul className="divide-y">
            {archived?.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">{p.name}</div>
                  <div className="text-xs text-muted-foreground/70">{p.code}</div>
                </div>
                {canUpdate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => restorePosition.mutate(p.id)}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Create / edit dialog ─────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Fiscal Position' : 'New Fiscal Position'}</DialogTitle>
              <DialogDescription>
                {editing
                  ? 'Update the position label used on sales invoices.'
                  : 'Add a tax-treatment label selectable on sales invoices.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Domestic — Taxable" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input id="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="domestic_taxable" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sortOrder">Display order</Label>
                <Input id="sortOrder" type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-input"
                />
                Active
              </label>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createPosition.isPending || updatePosition.isPending}>
                {editing ? 'Save changes' : 'Create position'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Archive confirmation ─────────────────────────────────── */}
      <Dialog open={archiving != null} onOpenChange={(o) => !o && setArchiving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive fiscal position?</DialogTitle>
            <DialogDescription>
              <strong>{archiving?.name}</strong> will be removed from sales pickers. Existing
              invoices keep their fiscal position name. You can restore it later from the archived
              section.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={archivePosition.isPending}
              onClick={() => {
                if (archiving) archivePosition.mutate(archiving.id, { onSuccess: () => setArchiving(null) });
              }}
            >
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}