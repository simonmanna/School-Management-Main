import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
/**
 * ComboListPage — admin CRUD for combo bundles (route: /menu/combos).
 *
 * Combos are fixed-price product bundles. This page lists the active combos and
 * wires create / edit / delete through the POS modifiers API
 * (`/pos/modifiers/combos`). Delete is a soft-deactivate on the backend, so a
 * deleted combo simply drops out of the active list.
 */
import { useState } from 'react';
import { Package, PlusCircle, Pencil, Trash2, Search } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

import {
  useCombos, useCreateCombo, useUpdateCombo, useDeleteCombo, type ComboFE,
} from './pos-features-api';
import { ComboEditDialog, type ComboSubmitInput } from './ComboEditDialog';

const fmt = (n: number | string) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;

function componentSummary(c: ComboFE): string {
  return (c.items ?? [])
    .map((it) => `${it.quantity > 1 ? `${it.quantity}× ` : ''}${it.productName}`)
    .join(' + ');
}

export function ComboListPage() {
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<{ open: boolean; combo?: ComboFE }>({ open: false });
  const [deleteTarget, setDeleteTarget] = useState<ComboFE | null>(null);

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canView = hasPermission(PERMISSIONS.product.read);
  const canCreate = hasPermission(PERMISSIONS.product.create);
  const canEdit = hasPermission(PERMISSIONS.product.update);
  const canDelete = hasPermission(PERMISSIONS.product.delete);

  const { data: combos = [], isLoading } = useCombos();
  const createCombo = useCreateCombo();
  const updateCombo = useUpdateCombo();
  const deleteCombo = useDeleteCombo();

  const term = search.trim().toLowerCase();
  const filtered = combos.filter((c) => !term || c.name.toLowerCase().includes(term));

  if (!canView) {
    return <div className="p-8 text-slate-500">You don't have permission to view combos.</div>;
  }

  const handleSubmit = async (input: ComboSubmitInput) => {
    try {
      if (dialog.combo) {
        await updateCombo.mutateAsync({ id: dialog.combo.id, ...input });
        toast.success(`Combo "${input.name}" updated`);
      } else {
        await createCombo.mutateAsync(input);
        toast.success(`Combo "${input.name}" created`);
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to save combo');
      throw e; // keep the dialog open on error
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCombo.mutateAsync(deleteTarget.id);
      toast.success(`Combo "${deleteTarget.name}" removed`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to delete combo');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="grid place-items-center h-9 w-9 rounded-lg bg-[#7c3aed]/10 text-[#7c3aed]">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Combos</h1>
            <p className="text-xs text-slate-500">Fixed-price product bundles shown on the POS terminal.</p>
          </div>
        </div>
        {canCreate && (
          <Button style={{ background: '#7c3aed' }} className="text-white" onClick={() => setDialog({ open: true })}>
            <PlusCircle className="h-4 w-4 mr-1" /> New Combo
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input className="pl-9" placeholder="Search combos…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="grid place-items-center py-16 text-center">
          <div className="text-4xl mb-2">🍱</div>
          <p className="font-medium text-slate-700">{term ? 'No combos match your search' : 'No combos yet'}</p>
          {canCreate && !term && (
            <p className="text-sm text-slate-500 mt-1">Create your first bundle with “New Combo”.</p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800 truncate flex items-center gap-1.5">
                    <span>🍱</span>{c.name}
                  </div>
                  <div className="text-[#7c3aed] font-bold text-sm">{fmt(c.price)}</div>
                </div>
                <Badge variant="outline" className="shrink-0">{c.items.length} item{c.items.length === 1 ? '' : 's'}</Badge>
              </div>
              <p className="text-xs text-slate-500 line-clamp-2 min-h-[2rem]" title={componentSummary(c)}>
                {componentSummary(c) || '—'}
              </p>
              <div className="flex items-center justify-end gap-1 pt-1 border-t border-slate-100">
                {canEdit && (
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, combo: c })}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                )}
                {canDelete && (
                  <Button variant="ghost" size="sm" className="text-rose-600 hover:text-rose-700" onClick={() => setDeleteTarget(c)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ComboEditDialog
        open={dialog.open}
        combo={dialog.combo}
        onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        onSubmit={handleSubmit}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete combo?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.name}” will be removed from the POS terminal. Past sales are unaffected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default ComboListPage;
