import { useState } from 'react';
import { X, ArrowUpRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCashFlow } from '@/features/accounting/api';
import { money } from '@/lib/format';

export function CashFlowPage() {
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const defaultTo = today.toISOString().slice(0, 10);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const { data, isLoading } = useCashFlow({ from, to });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Cash Flow Statement</h1>
          <p className="text-sm text-gray-500">Direct-method cash flow — operating, investing, and financing activities.</p>
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
        {(from !== defaultFrom || to !== defaultTo) && (
          <Button variant="ghost" size="sm" onClick={() => { setFrom(defaultFrom); setTo(defaultTo); }}
            className="h-9 text-xs gap-1">
            <X className="h-3 w-3" /> Reset
          </Button>
        )}
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase">Opening Cash</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {isLoading ? <Skeleton className="h-7 w-24" /> :
              <span className="text-xl font-bold">{data ? money(data.openingCash) : '—'}</span>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-3 pb-1">
            <div className="flex items-center gap-1">
              <ArrowUpRight className="h-3 w-3 text-emerald-600" />
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase">Net Operating</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {isLoading ? <Skeleton className="h-7 w-24" /> :
              <span className={`text-lg font-bold ${data && Number(data.operating) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {data ? money(data.operating) : '—'}
              </span>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-3 pb-1">
            <div className="flex items-center gap-1">
              <ArrowUpRight className="h-3 w-3 text-amber-500" />
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase">Net Investing</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {isLoading ? <Skeleton className="h-7 w-24" /> :
              <span className={`text-lg font-bold ${data && Number(data.investing) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {data ? money(data.investing) : '—'}
              </span>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-3 pb-1">
            <div className="flex items-center gap-1">
              <ArrowUpRight className="h-3 w-3 text-purple-500" />
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase">Net Financing</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {isLoading ? <Skeleton className="h-7 w-24" /> :
              <span className={`text-lg font-bold ${data && Number(data.financing) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {data ? money(data.financing) : '—'}
              </span>}
          </CardContent>
        </Card>
      </div>

      {/* Statement Table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Cash Flow Detail</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <tbody>
              {isLoading ? (
                <tr><td className="p-6"><Skeleton className="h-40 w-full" /></td></tr>
              ) : !data ? (
                <tr><td className="p-6 text-center text-muted-foreground">No data</td></tr>
              ) : (
                <>
                  <tr className="border-b">
                    <td className="py-3 px-5 font-semibold text-xs text-muted-foreground">Opening Cash Balance</td>
                    <td className="py-3 px-5 text-right font-bold text-lg">{money(data.openingCash)}</td>
                  </tr>
                  <tr className="bg-emerald-50/30">
                    <td className="py-3 px-5 font-semibold flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Operating Activities</span>
                    </td>
                    <td className={`py-3 px-5 text-right font-bold text-lg ${Number(data.operating) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {Number(data.operating) >= 0 ? '+' : ''}{money(data.operating)}
                    </td>
                  </tr>
                  <tr className="bg-amber-50/30">
                    <td className="py-3 px-5 font-semibold flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>Investing Activities</span>
                    </td>
                    <td className={`py-3 px-5 text-right font-bold text-lg ${Number(data.investing) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {Number(data.investing) >= 0 ? '+' : ''}{money(data.investing)}
                    </td>
                  </tr>
                  <tr className="bg-purple-50/30">
                    <td className="py-3 px-5 font-semibold flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-purple-500" />
                      <span>Financing Activities</span>
                    </td>
                    <td className={`py-3 px-5 text-right font-bold text-lg ${Number(data.financing) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {Number(data.financing) >= 0 ? '+' : ''}{money(data.financing)}
                    </td>
                  </tr>
                  <tr className="border-t-2 font-bold bg-muted/20">
                    <td className="py-3 px-5">Net Cash Flow</td>
                    <td className={`py-3 px-5 text-right text-lg ${Number(data.netCashFlow) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {Number(data.netCashFlow) >= 0 ? '+' : ''}{money(data.netCashFlow)}
                    </td>
                  </tr>
                  <tr className="border-b-0">
                    <td className="py-3 px-5 font-semibold">Closing Cash Balance</td>
                    <td className="py-3 px-5 text-right font-bold text-xl">{money(data.closingCash)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Reconciliation Status */}
      {data && (
        <div className="flex items-center gap-2 p-3 rounded-lg border bg-white">
          {data.reconciled ? (
            <>
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <span className="text-sm font-medium text-emerald-700">Reconciled</span>
              <span className="text-xs text-muted-foreground ml-2">
                Closing cash {money(data.closingCash)} matches actual balance {money(data.actualClosingCash)}
              </span>
            </>
          ) : (
            <>
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <span className="text-sm font-medium text-amber-700">Mismatch</span>
              <span className="text-xs text-muted-foreground ml-2">
                Calculated {money(data.closingCash)} ≠ Actual {money(data.actualClosingCash)}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
