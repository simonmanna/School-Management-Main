import { useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePnL } from '@/features/accounting/api';
import { money } from '@/lib/format';

export function ProfitAndLossPage() {
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const defaultTo = today.toISOString().slice(0, 10);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const { data, isLoading } = usePnL({ from, to });

  const profitColor = data ? (Number(data.operatingProfit) >= 0 ? 'text-emerald-600' : 'text-red-600') : '';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Profit & Loss</h1>
          <p className="text-sm text-gray-500">Revenue, costs, and operating profit for the selected period.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 p-3 bg-white border rounded-lg shadow-sm">
        <div className="space-y-1 min-w-[150px]">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">From</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 text-xs" />
        </div>
        <div className="space-y-1 min-w-[150px]">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">To</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 text-xs" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Revenue Card */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5 bg-emerald-50/50 border-b rounded-t-lg">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              <CardTitle className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Revenue</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Gross Revenue</span>
                  <span className="text-lg font-bold text-emerald-600">{data ? money(data.revenue) : '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Contra Revenue</span>
                  <span className="text-sm font-medium text-red-500">({data ? money(data.contraRevenue) : '—'})</span>
                </div>
                <div className="border-t pt-2 mt-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Net Revenue</span>
                  <span className="text-base font-bold text-emerald-600">{data ? money(data.netRevenue) : '—'}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expenses Card */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5 bg-red-50/50 border-b rounded-t-lg">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-500" />
              <CardTitle className="text-xs font-bold text-red-700 uppercase tracking-wider">Costs</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">COGS</span>
                  <span className="text-lg font-bold text-red-500">{data ? money(data.cogs) : '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Operating Expenses</span>
                  <span className="text-sm font-medium text-red-500">{data ? money(data.expense) : '—'}</span>
                </div>
                <div className="border-t pt-2 mt-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Total Costs</span>
                  <span className="text-base font-bold text-red-500">{data ? money(Number(data.cogs) + Number(data.expense)) : '—'}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Profit Card */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5 bg-blue-50/50 border-b rounded-t-lg">
            <div className="flex items-center gap-2">
              <DollarSign className={`h-4 w-4 ${profitColor}`} />
              <CardTitle className={`text-xs font-bold uppercase tracking-wider ${profitColor}`}>Operating Profit</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Gross Profit</span>
                  <span className="text-sm font-semibold">{data ? money(data.grossProfit) : '—'}</span>
                </div>
                <div className="border-t pt-2 flex items-center justify-between">
                  <span className="text-sm font-bold text-muted-foreground">Operating Profit</span>
                  <span className={`text-xl font-bold ${profitColor}`}>{data ? money(data.operatingProfit) : '—'}</span>
                </div>
                <div className="text-[10px] text-muted-foreground italic pt-1">
                  {data ? (data.source === 'snapshot' ? `Snapshotted ${data.asOf ? new Date(data.asOf).toLocaleDateString() : ''}` : 'Live computation') : ''}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
