import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/data-table';
import { useJournals, type Journal } from '@/features/accounting/api';

export function JournalsPage() {
  const { data, isLoading } = useJournals();

  const columns: Column<Journal>[] = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name' },
    {
      key: 'journalType',
      header: 'Type',
      render: (j) => <Badge variant="secondary">{j.journalType.replace(/_/g, ' ')}</Badge>,
    },
    { key: 'isActive', header: 'Active', render: (j) => (j.isActive ? 'Yes' : 'No') },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Journals</h1>
        <p className="text-sm text-muted-foreground">Books of original entry (sales, cash, bank, general...).</p>
      </div>
      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} getRowId={(j) => j.id} />
    </div>
  );
}
