import { RefreshCw, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useTieOut } from '@/features/accounting/api';
import { money } from '@/lib/format';
import { format } from 'date-fns';

export function TieOutPage() {
  const { data, isLoading, refetch, isRefetching } = useTieOut();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Tie-Out / Reconciliation</h1>
          <p className="text-sm text-gray-500">
            Verifies that the sub-ledger (open invoices / bills) matches the GL control accounts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.asOf && (
            <span className="text-xs text-muted-foreground">
              As of {format(new Date(data.asOf), 'MMM d, yyyy HH:mm')}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : !data ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <ShieldCheck className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="font-medium">No tie-out data available</p>
            <p className="text-xs mt-1">Run snapshot rebuild or wait for nightly job to populate.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* AR Card */}
          <Card className={data.arBalanced ? 'border-emerald-200' : 'border-amber-200'}>
            <CardHeader className={`pb-2 pt-4 px-5 border-b rounded-t-lg ${data.arBalanced ? 'bg-emerald-50/50' : 'bg-amber-50/50'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {data.arBalanced ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                  )}
                  <CardTitle className="text-sm font-bold uppercase tracking-wider">Accounts Receivable</CardTitle>
                </div>
                <Badge variant={data.arBalanced ? 'secondary' : 'destructive'} className="text-[10px]">
                  {data.arBalanced ? 'Balanced' : `Variance ${money(data.arVariance)}`}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">GL Control Account Balance</span>
                <span className="font-semibold">{data.arDetails ? money(data.arDetails.glBalance) : '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Open Invoice Sub-ledger</span>
                <span className="font-semibold">{data.arDetails ? money(data.arDetails.subLedgerBalance) : '—'}</span>
              </div>
              <div className="border-t pt-2 flex justify-between text-sm font-bold">
                <span>Variance</span>
                <span className={data.arBalanced ? 'text-emerald-600' : 'text-red-500'}>
                  {money(data.arVariance)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground italic">
                {data.arBalanced
                  ? 'AR sub-ledger matches the GL control account.'
                  : 'Variance detected. Check for manual journal entries or missed allocations.'}
              </p>
            </CardContent>
          </Card>

          {/* AP Card */}
          <Card className={data.apBalanced ? 'border-emerald-200' : 'border-amber-200'}>
            <CardHeader className={`pb-2 pt-4 px-5 border-b rounded-t-lg ${data.apBalanced ? 'bg-emerald-50/50' : 'bg-amber-50/50'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {data.apBalanced ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                  )}
                  <CardTitle className="text-sm font-bold uppercase tracking-wider">Accounts Payable</CardTitle>
                </div>
                <Badge variant={data.apBalanced ? 'secondary' : 'destructive'} className="text-[10px]">
                  {data.apBalanced ? 'Balanced' : `Variance ${money(data.apVariance)}`}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">GL Control Account Balance</span>
                <span className="font-semibold">{data.apDetails ? money(data.apDetails.glBalance) : '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Open Bills Sub-ledger</span>
                <span className="font-semibold">{data.apDetails ? money(data.apDetails.subLedgerBalance) : '—'}</span>
              </div>
              <div className="border-t pt-2 flex justify-between text-sm font-bold">
                <span>Variance</span>
                <span className={data.apBalanced ? 'text-emerald-600' : 'text-red-500'}>
                  {money(data.apVariance)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground italic">
                {data.apBalanced
                  ? 'AP sub-ledger matches the GL control account.'
                  : 'Variance detected. Check for unallocated payments or manual adjustments.'}
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
