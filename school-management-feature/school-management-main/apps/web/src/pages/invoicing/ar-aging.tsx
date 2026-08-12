import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/data-table';
import { money, date } from '@/lib/format';
import { useArAging, type AgingRow } from '@/features/invoicing/api';

const BUCKETS: { key: keyof import('@/features/invoicing/api').AgingBuckets; label: string }[] = [
  { key: 'current', label: 'Current' },
  { key: 'd1_30', label: '1-30 days' },
  { key: 'd31_60', label: '31-60 days' },
  { key: 'd61_90', label: '61-90 days' },
  { key: 'd90_plus', label: '90+ days' },
];

export function ArAgingPage() {
  const { data, isLoading } = useArAging();

  const columns: Column<AgingRow>[] = [
    { key: 'documentNumber', header: 'Invoice' },
    { key: 'partnerName', header: 'Customer' },
    { key: 'dueDate', header: 'Due', render: (r) => date(r.dueDate) },
    { key: 'daysOverdue', header: 'Days overdue', render: (r) => (r.daysOverdue > 0 ? r.daysOverdue : '-') },
    { key: 'residual', header: 'Outstanding', className: 'text-right', render: (r) => money(r.residual) },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">AR Aging</h1>
        <p className="text-sm text-muted-foreground">Outstanding customer balances by age (derived from open invoices).</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {BUCKETS.map((b) => (
          <Card key={b.key}>
            <CardHeader className="pb-2">
              <CardDescription>{b.label}</CardDescription>
              <CardTitle className="text-xl">{money(data?.buckets[b.key])}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">&nbsp;</CardContent>
          </Card>
        ))}
      </div>

      <DataTable columns={columns} data={data?.rows ?? []} loading={isLoading} getRowId={(r) => r.documentId} />
    </div>
  );
}
