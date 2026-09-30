import { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { ChevronRight, Upload, Wand2, Link2, Unlink, Ban, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/stores/auth.store';
import { cn, formatCurrency } from '@/lib/utils';
import {
  parseStatementCsv,
  useAutoMatch,
  useBankAccountsForRecon,
  useExcludeLine,
  useImportStatement,
  useManualMatch,
  useOpenLedgerLines,
  useReconReport,
  useStatementLines,
  useUnmatch,
  type ImportLine,
  type StatementLine,
} from '@/features/accounting/bank-reconciliation';

const STATUS: Record<StatementLine['status'], string> = {
  unmatched: 'bg-amber-100 text-amber-700 hover:bg-amber-100',
  matched: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
  excluded: 'bg-slate-100 text-slate-600 hover:bg-slate-100',
};

const day = (d: string) => format(new Date(d), 'MMM d, yyyy');
const money = (a: string) => (
  <span className={cn('tabular-nums', Number(a) < 0 ? 'text-red-700' : 'text-emerald-700')}>{formatCurrency(Number(a))}</span>
);

function BankReconciliationPage() {
  const navigate = useNavigate();
  const can = useAuthStore((s) => s.hasPermission);
  const canImport = can('bank_reconciliation:import');
  const canReconcile = can('bank_reconciliation:reconcile');

  const { data: banks } = useBankAccountsForRecon();
  const [bankId, setBankId] = useState<string>();
  const { data: lines = [], isLoading: linesLoading } = useStatementLines(bankId);
  const { data: ledger = [] } = useOpenLedgerLines(bankId);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [closing, setClosing] = useState('');
  const { data: report } = useReconReport(bankId, asOf, closing);

  const importMut = useImportStatement();
  const matchMut = useAutoMatch();
  const manualMut = useManualMatch();
  const unmatchMut = useUnmatch();
  const excludeMut = useExcludeLine();

  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ lines: ImportLine[]; errors: string[]; name: string } | null>(null);
  const [selectedLine, setSelectedLine] = useState<string>();
  const [excluding, setExcluding] = useState<StatementLine | null>(null);
  const [excludeReason, setExcludeReason] = useState('');

  const open = useMemo(() => lines.filter((l) => l.status === 'unmatched'), [lines]);
  const done = useMemo(() => lines.filter((l) => l.status !== 'unmatched'), [lines]);
  const selected = open.find((l) => l.id === selectedLine);
  const ledgerChoices = useMemo(
    () => (selected ? ledger.filter((g) => !g.reversal && g.amount === String(Number(selected.amount))) : ledger.filter((g) => !g.reversal)),
    [ledger, selected],
  );

  async function onFile(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    setPreview({ ...parseStatementCsv(text), name: f.name });
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1.5 text-[11px] text-muted-foreground py-1">
        <button onClick={() => navigate('/accounts')} className="hover:text-foreground transition-colors">
          Accounting
        </button>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Bank Reconciliation</span>
      </nav>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Bank Reconciliation</h1>
          <p className="text-sm text-gray-500">
            Match the bank statement to the ledger: fee receipts, expense payments, mobile-money payouts and refunds.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={bankId} onValueChange={(v) => { setBankId(v); setSelectedLine(undefined); }}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Choose a bank account" />
            </SelectTrigger>
            <SelectContent>
              {(banks?.data ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                  {b.accountNumber ? ` · ${b.accountNumber}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canImport && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <Button variant="outline" className="gap-1.5" disabled={!bankId} onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4" /> Import CSV
              </Button>
            </>
          )}
          {canReconcile && (
            <Button
              className="gap-1.5"
              disabled={!bankId || matchMut.isPending}
              onClick={() => bankId && matchMut.mutate({ bankAccountId: bankId, dateToleranceDays: 3 })}
            >
              <Wand2 className="h-4 w-4" /> Auto-match
            </Button>
          )}
        </div>
      </div>

      {!bankId ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Choose a bank account to reconcile.
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="match">
          <TabsList>
            <TabsTrigger value="match">To reconcile ({open.length})</TabsTrigger>
            <TabsTrigger value="done">Reconciled ({done.length})</TabsTrigger>
            <TabsTrigger value="report">Report</TabsTrigger>
          </TabsList>

          <TabsContent value="match" className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Statement lines not yet matched</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] uppercase">Date</TableHead>
                      <TableHead className="text-[10px] uppercase">Description</TableHead>
                      <TableHead className="text-[10px] uppercase text-right">Amount</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linesLoading ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-xs py-6">Loading…</TableCell></TableRow>
                    ) : open.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-xs py-8 text-muted-foreground">
                          Nothing to reconcile. Import a statement or run auto-match.
                        </TableCell>
                      </TableRow>
                    ) : (
                      open.map((l) => (
                        <TableRow
                          key={l.id}
                          className={cn('cursor-pointer', selectedLine === l.id && 'bg-blue-50')}
                          onClick={() => setSelectedLine(l.id === selectedLine ? undefined : l.id)}
                        >
                          <TableCell className="text-xs whitespace-nowrap">{day(l.postedAt)}</TableCell>
                          <TableCell className="text-xs">
                            {l.description}
                            {l.externalRef && <span className="block text-[10px] text-muted-foreground">{l.externalRef}</span>}
                          </TableCell>
                          <TableCell className="text-xs text-right">{money(l.amount)}</TableCell>
                          <TableCell className="text-right">
                            {canReconcile && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-[10px] gap-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExcludeReason('');
                                  setExcluding(l);
                                }}
                              >
                                <Ban className="h-3 w-3" /> Exclude
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {selected ? `Ledger lines for ${formatCurrency(Number(selected.amount))}` : 'Ledger lines not on the statement'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] uppercase">Date</TableHead>
                      <TableHead className="text-[10px] uppercase">Entry</TableHead>
                      <TableHead className="text-[10px] uppercase text-right">Amount</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ledgerChoices.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-xs py-8 text-muted-foreground">
                          {selected ? 'No ledger line with this exact amount. Book the missing entry, or exclude the statement line.' : 'Every ledger line is matched.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      ledgerChoices.map((g) => (
                        <TableRow key={g.id}>
                          <TableCell className="text-xs whitespace-nowrap">{day(g.postingDate)}</TableCell>
                          <TableCell className="text-xs">
                            {g.entryNumber}
                            {g.description && <span className="block text-[10px] text-muted-foreground">{g.description}</span>}
                          </TableCell>
                          <TableCell className="text-xs text-right">{money(g.amount)}</TableCell>
                          <TableCell className="text-right">
                            {canReconcile && selected && (
                              <Button
                                size="sm"
                                className="h-7 text-[10px] gap-1"
                                disabled={manualMut.isPending}
                                onClick={() =>
                                  manualMut.mutate(
                                    { lineId: selected.id, journalLineId: g.id },
                                    { onSuccess: () => setSelectedLine(undefined) },
                                  )
                                }
                              >
                                <Link2 className="h-3 w-3" /> Match
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                {!selected && ledgerChoices.length > 0 && (
                  <p className="px-4 py-2 text-[11px] text-muted-foreground">
                    Select a statement line on the left to see the ledger lines it can match.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="done">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] uppercase">Date</TableHead>
                      <TableHead className="text-[10px] uppercase">Statement</TableHead>
                      <TableHead className="text-[10px] uppercase text-right">Amount</TableHead>
                      <TableHead className="text-[10px] uppercase">Ledger / reason</TableHead>
                      <TableHead className="text-[10px] uppercase">Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {done.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs whitespace-nowrap">{day(l.postedAt)}</TableCell>
                        <TableCell className="text-xs">{l.description}</TableCell>
                        <TableCell className="text-xs text-right">{money(l.amount)}</TableCell>
                        <TableCell className="text-xs">
                          {l.match ? `${l.match.entryNumber} · ${day(l.match.postingDate)} (${l.match.method})` : l.excludedReason}
                        </TableCell>
                        <TableCell>
                          <Badge className={cn('text-[10px]', STATUS[l.status])}>{l.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {canReconcile && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[10px] gap-1"
                              disabled={unmatchMut.isPending}
                              onClick={() => unmatchMut.mutate({ lineId: l.id })}
                            >
                              <Unlink className="h-3 w-3" /> {l.status === 'matched' ? 'Unmatch' : 'Restore'}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="report">
            <Card>
              <CardContent className="space-y-4 pt-4">
                <div className="flex flex-wrap gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="asof">As of</Label>
                    <Input id="asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-44" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="closing">Statement closing balance</Label>
                    <Input
                      id="closing"
                      inputMode="decimal"
                      placeholder="From the bank statement"
                      value={closing}
                      onChange={(e) => setClosing(e.target.value.replace(/[^\d.-]/g, ''))}
                      className="w-56"
                    />
                  </div>
                </div>
                {report && (
                  <div className="max-w-xl space-y-1 text-sm">
                    <Row label="Statement closing balance" value={report.statementClosingBalance}
                      hint={report.statementClosingSource === 'sum_of_imported_lines' ? 'sum of imported lines — enter the printed balance' : undefined} />
                    <Row label="+ In the books, not yet on the statement" value={report.ledgerItemsNotOnStatement} />
                    <Row label="= Adjusted bank balance" value={report.adjustedBankBalance} strong />
                    <div className="h-2" />
                    <Row label="Ledger balance" value={report.ledgerBalance} />
                    <Row label="+ On the statement, not in the books" value={report.statementItemsNotInLedger} />
                    <Row label="= Adjusted book balance" value={report.adjustedBookBalance} strong />
                    <div
                      className={cn(
                        'mt-3 flex items-center gap-2 rounded border px-3 py-2',
                        report.reconciled ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800',
                      )}
                    >
                      {report.reconciled ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                      <span className="font-medium">
                        Difference {formatCurrency(Number(report.difference))}
                        {report.reconciled ? ' — reconciled' : ' — not reconciled'}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Import preview */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import {preview?.name}</DialogTitle>
            <DialogDescription>
              {preview?.lines.length ?? 0} line(s) read. Lines already imported are skipped automatically.
            </DialogDescription>
          </DialogHeader>
          {preview?.errors.length ? (
            <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 max-h-24 overflow-auto">
              {preview.errors.map((e) => <div key={e}>{e}</div>)}
            </div>
          ) : null}
          <div className="max-h-72 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] uppercase">Date</TableHead>
                  <TableHead className="text-[10px] uppercase">Description</TableHead>
                  <TableHead className="text-[10px] uppercase">Reference</TableHead>
                  <TableHead className="text-[10px] uppercase text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview?.lines.slice(0, 200).map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{l.postedAt}</TableCell>
                    <TableCell className="text-xs">{l.description}</TableCell>
                    <TableCell className="text-xs">{l.externalRef ?? '—'}</TableCell>
                    <TableCell className="text-xs text-right">{money(l.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>Cancel</Button>
            <Button
              disabled={!bankId || !preview?.lines.length || importMut.isPending}
              onClick={() =>
                bankId && preview &&
                importMut.mutate({ bankAccountId: bankId, lines: preview.lines }, { onSuccess: () => setPreview(null) })
              }
            >
              {importMut.isPending ? 'Importing…' : `Import ${preview?.lines.length ?? 0} line(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exclude reason */}
      <Dialog open={!!excluding} onOpenChange={(o) => !o && setExcluding(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Exclude statement line</DialogTitle>
            <DialogDescription>
              {excluding?.description} · {excluding && formatCurrency(Number(excluding.amount))}. It stays on the report as an
              item on the statement but not in the books.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="exclude-reason">Reason</Label>
            <Textarea id="exclude-reason" rows={3} value={excludeReason} onChange={(e) => setExcludeReason(e.target.value)}
              placeholder="e.g. Bank charge — journal to be raised" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcluding(null)}>Cancel</Button>
            <Button
              disabled={excludeReason.trim().length < 3 || excludeMut.isPending}
              onClick={() =>
                excluding &&
                excludeMut.mutate({ lineId: excluding.id, reason: excludeReason.trim() }, { onSuccess: () => setExcluding(null) })
              }
            >
              Exclude
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4', strong && 'font-semibold border-t pt-1')}>
      <span>
        {label}
        {hint && <span className="block text-[10px] font-normal text-muted-foreground">{hint}</span>}
      </span>
      <span className="tabular-nums">{formatCurrency(Number(value))}</span>
    </div>
  );
}

export default BankReconciliationPage;
