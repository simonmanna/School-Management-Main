import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { money } from '@/lib/format';
import { useTrialBalance } from '@/features/accounting/api';

export function TrialBalancePage() {
  const { data, isLoading } = useTrialBalance({});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Trial Balance</h1>
          <p className="text-sm text-muted-foreground">Net debit/credit per account (posted entries).</p>
        </div>
        {data && (
          <Badge variant={data.balanced ? 'default' : 'destructive'}>
            {data.balanced ? 'Balanced' : 'Out of balance'}
          </Badge>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : !data || data.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No posted entries yet.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {data.rows.map((r) => (
                  <TableRow key={r.accountId}>
                    <TableCell>{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right">{money(r.debit)}</TableCell>
                    <TableCell className="text-right">{money(r.credit)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right">{money(data.totals.debit)}</TableCell>
                  <TableCell className="text-right">{money(data.totals.credit)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
