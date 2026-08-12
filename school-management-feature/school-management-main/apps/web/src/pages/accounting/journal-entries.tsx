import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/data-table';
import { date } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useJournalEntries, type JournalEntryRow } from '@/features/accounting/api';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  posted: 'default',
  draft: 'secondary',
  reversed: 'destructive',
};

export function JournalEntriesPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useJournalEntries({ page, pageSize: 15 });

  const columns: Column<JournalEntryRow>[] = [
    {
      key: 'entryNumber',
      header: 'Entry #',
      render: (e) => (
        <Link to={`/journal-entries/${e.id}`} className="font-medium text-primary hover:underline">
          {e.entryNumber}
        </Link>
      ),
    },
    { key: 'postingDate', header: 'Date', render: (e) => date(e.postingDate) },
    { key: 'journal', header: 'Journal', render: (e) => e.journal?.code ?? '-' },
    { key: 'description', header: 'Description', render: (e) => e.description ?? '-' },
    { key: 'lines', header: 'Lines', render: (e) => e._count?.lines ?? '-' },
    {
      key: 'status',
      header: 'Status',
      render: (e) => <Badge variant={statusVariant[e.status] ?? 'secondary'}>{e.status}</Badge>,
    },
  ];

  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Journal Entries</h1>
          <p className="text-sm text-muted-foreground">Every posting, from invoices, payments and manual entries.</p>
        </div>
        {hasPermission(PERMISSIONS.journalEntry.post) && (
          <Button onClick={() => navigate('/journal-entries/new')}>
            <Plus className="h-4 w-4" /> New Entry
          </Button>
        )}
      </div>

      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} getRowId={(e) => e.id} />

      {meta && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} entries</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              Page {meta.page} of {meta.totalPages}
            </span>
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
    </div>
  );
}
