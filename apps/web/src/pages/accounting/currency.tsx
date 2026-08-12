import { useState } from 'react';
import { DollarSign, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCurrencies, useCurrencyRates, useCreateCurrencyRate,
} from '@/features/accounting/api';
import { format } from 'date-fns';

export function CurrencyPage() {
  const { data: currencies, isLoading: currLoading } = useCurrencies();
  const { data: rates, isLoading: ratesLoading, refetch } = useCurrencyRates();
  const createRate = useCreateCurrencyRate();

  const [fromCode, setFromCode] = useState('USD');
  const [toCode, setToCode] = useState('IDR');
  const [rate, setRate] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleAddRate = async () => {
    if (!fromCode || !toCode || !rate) return;
    await createRate.mutateAsync({ fromCode, toCode, rate: Number(rate) });
    setRate('');
    setDialogOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Currency Management</h1>
          <p className="text-sm text-gray-500">Global currency catalog and exchange rate management.</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add Rate
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="text-sm font-bold uppercase tracking-wider">Add Exchange Rate</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-muted-foreground uppercase">From</Label>
                    <select
                      value={fromCode}
                      onChange={(e) => setFromCode(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
                    >
                      {currencies?.map((c) => (
                        <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-muted-foreground uppercase">To</Label>
                    <select
                      value={toCode}
                      onChange={(e) => setToCode(e.target.value)}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
                    >
                      {currencies?.map((c) => (
                        <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-muted-foreground uppercase">Rate</Label>
                  <Input type="number" step="0.00000001" value={rate}
                    onChange={(e) => setRate(e.target.value)} placeholder="e.g. 15650.50" className="h-9 text-xs" />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleAddRate} disabled={!rate || createRate.isPending}>
                    {createRate.isPending ? 'Adding...' : 'Add Rate'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Currency Catalog */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Currency Catalog
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Code</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Name</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Symbol</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right pr-4">Decimals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={4}><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                  ))
                ) : !currencies || currencies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No currencies</TableCell>
                  </TableRow>
                ) : (
                  currencies.map((c) => (
                    <TableRow key={c.code}>
                      <TableCell className="text-xs font-bold font-mono">{c.code}</TableCell>
                      <TableCell className="text-xs">{c.name}</TableCell>
                      <TableCell className="text-xs">{c.symbol}</TableCell>
                      <TableCell className="text-right text-xs pr-4">{c.decimalPlaces}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Exchange Rates */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Exchange Rates
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">From</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">To</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right">Rate</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right pr-4">As Of</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ratesLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={4}><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                  ))
                ) : !rates || rates.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      <DollarSign className="h-6 w-6 mx-auto mb-1 opacity-30" />
                      <p className="text-sm font-medium">No rates configured</p>
                      <p className="text-xs">Add exchange rates to enable multi-currency transactions.</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  rates.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs font-bold font-mono">{r.fromCode}</TableCell>
                      <TableCell className="text-xs font-bold font-mono">{r.toCode}</TableCell>
                      <TableCell className="text-right text-xs font-semibold">
                        {Number(r.rate).toFixed(typeof r.rate === 'number' && r.rate % 1 !== 0 ? 4 : 0)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground pr-4">
                        {format(new Date(r.asOf), 'MMM d, yyyy')}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
