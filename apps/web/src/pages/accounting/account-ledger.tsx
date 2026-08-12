import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccountLedger, useAccounts } from '@/features/accounting/api';
import { date, money } from '@/lib/format';

export function AccountLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: accountsData } = useAccounts();
  const { data, isLoading } = useAccountLedger(id, { from: from || undefined, to: to || undefined });

  const account = id && accountsData?.data?.find((a) => a.id === id);
  const title = account ? `${account.code} — ${account.name}` : 'Account Ledger';
  const isActiveFilter = from || to;

  const rows = data?.lines ?? [];

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[11px] text-muted-foreground py-1">
        <button onClick={() => navigate('/accounts')} className="hover:text-foreground transition-colors">Chart of Accounts</button>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium truncate max-w-[300px]">{title}</span>
      </nav>

      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">
            Every journal line affecting this account, with running balance.{' '}
            {data && <span className="font-medium">Closing Balance: {money(data.closingBalance)}</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate('/accounts')} className="gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Accounts
        </Button>
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
        {isActiveFilter && (
          <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); }}
            className="h-9 text-xs">Clear</Button>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg flex-row items-center justify-between">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Account Transactions
          </CardTitle>
          <span className="text-[10px] text-muted-foreground">{rows.length} line{rows.length !== 1 ? 's' : ''}</span>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Date</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Entry #</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Description</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right">Debit</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right">Credit</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right pr-5">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={`s-${i}`}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    No transactions found for this account.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/20 cursor-pointer"
                    onClick={() => navigate(`/journal-entries/${r.id}`)}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{date(r.date)}</TableCell>
                    <TableCell>
                      <span className="font-medium text-primary hover:underline text-xs">{r.entryNumber}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">{r.description ?? '—'}</TableCell>
                    <TableCell className="text-right text-xs font-semibold text-emerald-600">
                      {Number(r.debit) ? money(r.debit) : ''}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold">
                      {Number(r.credit) ? money(r.credit) : ''}
                    </TableCell>
                    <TableCell className={`text-right text-xs font-bold pr-5 ${Number(r.balance) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {money(r.balance)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
