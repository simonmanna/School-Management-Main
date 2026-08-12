import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/data-table';
import { useAccounts, type Account } from '@/features/accounting/api';

export function ChartOfAccountsPage() {
  const { data, isLoading } = useAccounts();

  const columns: Column<Account>[] = [
    { key: 'code', header: 'Code' },
    {
      key: 'name',
      header: 'Name',
      render: (a) => <span className={a.isGroup ? 'font-semibold' : ''}>{a.name}</span>,
    },
    {
      key: 'accountType',
      header: 'Type',
      render: (a) => <Badge variant="secondary">{a.accountType.replace(/_/g, ' ')}</Badge>,
    },
    {
      key: 'isGroup',
      header: 'Postable',
      render: (a) => (a.isGroup ? <span className="text-muted-foreground">Group</span> : 'Yes'),
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Chart of Accounts</h1>
        <p className="text-sm text-muted-foreground">The ledger accounts every module posts to.</p>
      </div>
      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} getRowId={(a) => a.id} />
    </div>
  );
}
