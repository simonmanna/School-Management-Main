import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Edit, Eye, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data-table';
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
import { useAuthStore } from '@/stores/auth.store';
import { useJournals, useDeleteJournal, type Journal } from '@/features/accounting/api';
import { notify } from '@/lib/notify';

const TYPE_COLORS: Record<string, string> = {
  general: 'bg-slate-100 text-slate-700',
  sales: 'bg-emerald-100 text-emerald-700',
  purchase: 'bg-blue-100 text-blue-700',
  cash: 'bg-amber-100 text-amber-700',
  bank: 'bg-purple-100 text-purple-700',
  adjustment: 'bg-red-100 text-red-700',
  opening: 'bg-indigo-100 text-indigo-700',
  closing: 'bg-rose-100 text-rose-700',
};

export function JournalsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useJournals();
  const deleteJournal = useDeleteJournal();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.journal.create);
  const canEdit = hasPermission(PERMISSIONS.journal.update);
  const canDelete = hasPermission(PERMISSIONS.journal.delete);
  const [deleting, setDeleting] = useState<Journal | null>(null);

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteJournal.mutateAsync(deleting.id);
      notify.success('Journal deleted');
      setDeleting(null);
    } catch (err: any) {
      notify.error(err?.response?.data?.message ?? 'Delete failed');
      setDeleting(null);
    }
  };

  const columns: Column<Journal>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (j) => <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-primary font-semibold">{j.code}</code>,
    },
    { key: 'name', header: 'Name', render: (j) => <span className="font-semibold text-sm">{j.name}</span> },
    {
      key: 'journalType',
      header: 'Type',
      render: (j) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold ${TYPE_COLORS[j.journalType] ?? 'bg-gray-50 text-gray-700'}`}>
          {j.journalType.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'entries',
      header: 'Entries',
      className: 'text-right',
      render: (j) => (
        <span className="font-semibold text-sm">{j._count?.entries ?? 0}</span>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (j) => (
        j.isActive
          ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Active</Badge>
          : <Badge variant="secondary" className="text-xs">Inactive</Badge>
      ),
    },
    {
      key: 'actions' as const,
      header: '',
      render: (j: Journal) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/journals/${j.id}`)} title="View">
            <Eye className="h-4 w-4 text-primary/70" />
          </Button>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/journals/${j.id}/edit`)} title="Edit">
              <Edit className="h-4 w-4" />
            </Button>
          )}
          {canDelete && j._count?.entries === 0 && (
            <Button size="sm" variant="ghost" onClick={() => setDeleting(j)} title="Delete">
              <Trash2 className="h-4 w-4 text-destructive/70" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Journals</h1>
          <p className="text-sm text-gray-500">Books of original entry — sales, purchases, cash, bank, general and adjustments.</p>
        </div>
        {canCreate && (
          <Button onClick={() => navigate('/journals/new')}>
            <Plus className="h-4 w-4" /> New Journal
          </Button>
        )}
      </div>

      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} getRowId={(j) => j.id} compact />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Journal?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} ({deleting?.code}) will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
