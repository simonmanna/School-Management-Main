import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { date, money } from '@/lib/format';
import { useAccounts, useGeneralLedger } from '@/features/accounting/api';

const PAGE_SIZE = 50;

export function GeneralLedgerPage() {
  const navigate = useNavigate();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filterAccountId, setFilterAccountId] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useGeneralLedger({ from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE });
  const { data: accountsData } = useAccounts();
  const accounts = accountsData?.data ?? [];

  const filterAccountCode = filterAccountId
    ? accounts.find((a) => a.id === filterAccountId)?.code ?? ''
    : '';

  // Client-side account filter (backend doesn't have it yet)
  const rows = data?.data ?? [];
  const filteredRows = filterAccountCode
    ? rows.filter((r) => r.accountCode === filterAccountCode)
    : rows;
  const meta = data?.meta;

  const totalDebit = filteredRows.reduce((s, r) => s + Number(r.debit || 0), 0);
  const totalCredit = filteredRows.reduce((s, r) => s + Number(r.credit || 0), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">General Ledger</h1>
          <p className="text-sm text-gray-500">
            Every journal line — chronologically sorted, with debit and credit details per account.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 p-3 bg-white border rounded-lg shadow-sm">
        <div className="space-y-1 min-w-[150px]">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">From</Label>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            className="h-9 text-xs" />
        </div>
        <div className="space-y-1 min-w-[150px]">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">To</Label>
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }}
            className="h-9 text-xs" />
        </div>
        <div className="space-y-1 min-w-[200px]">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Account</Label>
          <Select value={filterAccountId} onValueChange={(v) => { setFilterAccountId(v === '_all' ? '' : v); setPage(1); }}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All Accounts" /></SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="_all">All Accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(from || to || filterAccountId) && (
          <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); setFilterAccountId(''); setPage(1); }}
            className="h-9 text-xs gap-1">
            <X className="h-3 w-3" /> Clear
          </Button>
        )}
        <div className="flex-1 text-right text-xs text-muted-foreground">
          {meta && (
            <span>{filteredRows.length} of {meta.total} line{meta.total !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      {/* GL Table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg flex-row items-center justify-between">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            General Ledger Lines
          </CardTitle>
          {!isLoading && meta && (
            <p className="text-[10px] font-medium text-muted-foreground">
              Page {page} of {meta.totalPages}
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Date</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Entry #</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Account</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Description</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right">Debit</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={`s-${i}`}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center gap-1">
                      <ArrowUpDown className="h-8 w-8 opacity-30" />
                      <p className="font-medium text-sm">No ledger entries found</p>
                      <p className="text-xs">Try adjusting the date range or account filter</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-muted/20 cursor-pointer"
                    onClick={() => navigate(`/journal-entries/${r.entryNumber}`)}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {date(r.date)}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-primary hover:underline text-xs">
                        {r.entryNumber}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <code className="text-[10px] bg-primary/5 px-1.5 py-0.5 rounded font-mono text-primary font-semibold whitespace-nowrap">
                          {r.accountCode}
                        </code>
                        <span className="text-xs text-muted-foreground truncate max-w-[200px]">{r.accountName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[250px] truncate">
                      {r.description ?? '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold text-emerald-600">
                      {Number(r.debit) ? money(r.debit) : ''}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold">
                      {Number(r.credit) ? money(r.credit) : ''}
                    </TableCell>
                  </TableRow>
                ))
              )}
              {/* Totals row */}
              {!isLoading && filteredRows.length > 0 && (
                <TableRow className="font-bold bg-muted/10 border-t-2">
                  <TableCell colSpan={4} className="text-xs">Page Totals</TableCell>
                  <TableCell className="text-right text-xs text-emerald-600">{money(totalDebit)}</TableCell>
                  <TableCell className="text-right text-xs">{money(totalCredit)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} total lines</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-xs font-medium">
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
