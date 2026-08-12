import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, ArrowLeft, ScrollText, FileText, RotateCcw, ExternalLink } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { money, date } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useJournalEntry, useReverseJournalEntry } from '@/features/accounting/api';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  posted: 'default',
  draft: 'secondary',
  reversed: 'destructive',
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start py-2 gap-4">
      <dt className="w-32 flex-shrink-0 text-[11px] text-muted-foreground font-semibold pt-0.5 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm flex-1">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function getSourceLink(sourceType: string, sourceId: string): { path: string; label: string } | null {
  switch (sourceType) {
    case 'invoice': return { path: `/invoices/${sourceId}`, label: 'Invoice' };
    case 'payment': return { path: `/payments/${sourceId}`, label: 'Payment' };
    case 'receipt': return { path: `/pos/receipts/${sourceId}`, label: 'POS Receipt' };
    case 'stock_transfer': return { path: `/inventory/transfers`, label: 'Stock Transfer' };
    case 'stock_adjustment': return { path: `/inventory/adjustments`, label: 'Stock Adjustment' };
    case 'journal_entry_draft': return { path: `/journal-entries/${sourceId}`, label: 'Draft Journal Entry' };
    default: return null;
  }
}

export function JournalEntryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: entry, isLoading } = useJournalEntry(id);
  const reverse = useReverseJournalEntry();
  const has = useAuthStore((s) => s.hasPermission);
  const [reverseConfirm, setReverseConfirm] = useState(false);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 min-h-screen">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="text-center">
          <ScrollText className="h-12 w-12 opacity-30 mx-auto mb-2" />
          <p className="font-semibold">Journal entry not found</p>
        </div>
      </div>
    );
  }

  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const onReverse = async () => {
    setReverseConfirm(false);
    const reversal = await reverse.mutateAsync(entry.id);
    navigate(`/journal-entries/${reversal.id}`);
  };

  const sourceLink = entry.sourceType && entry.sourceId
    ? getSourceLink(entry.sourceType, entry.sourceId)
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb + Header */}
      <div className="px-6 py-4 border-b bg-white shadow-sm">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
          <button onClick={() => navigate('/journal-entries')} className="hover:text-primary transition-colors font-medium">Journal Entries</button>
          <ChevronRight className="h-3 w-3" />
          <span className="font-semibold">{entry.entryNumber}</span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/journal-entries')} className="h-8 w-8 flex-shrink-0 hover:bg-muted">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0"><ScrollText className="h-5 w-5 text-primary" /></div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold">{entry.entryNumber}</h1>
                <Badge variant={statusVariant[entry.status] ?? 'secondary'} className="text-xs font-semibold">{entry.status.toUpperCase()}</Badge>
                {!balanced && <Badge variant="destructive" className="text-[10px]">UNBALANCED</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {entry.journal?.name} ({entry.journal?.code}) · {date(entry.postingDate)}
                {entry.description ? ` · ${entry.description}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" onClick={() => navigate('/journal-entries')}>
              Back to List
            </Button>
            {entry.status === 'posted' && has(PERMISSIONS.journalEntry.reverse) && (
              <Button variant="outline" size="sm" className="border-amber-300 text-amber-700 hover:bg-amber-50 gap-1.5" onClick={() => setReverseConfirm(true)} disabled={reverse.isPending}>
                <RotateCcw className="h-4 w-4" />
                {reverse.isPending ? 'Reversing…' : 'Reverse'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Entry Info cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2 pt-3 px-4 bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Journal</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[11px] font-mono">{entry.journal?.code}</Badge>
                <span className="text-sm font-semibold">{entry.journal?.name}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-3 px-4 bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Posting Date</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-3">
              <p className="text-sm font-semibold">{date(entry.postingDate)}</p>
              {entry.postedAt && (
                <p className="text-[10px] text-muted-foreground mt-0.5">Posted {date(entry.postedAt)}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-3 px-4 bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Lines / Balance</CardTitle>
            </CardHeader>
            <CardContent className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">{entry.lines.length} lines</span>
                <Separator orientation="vertical" className="h-4" />
                <span className={`text-sm font-semibold ${balanced ? 'text-emerald-600' : 'text-destructive'}`}>
                  {balanced ? 'Balanced ✓' : 'Unbalanced'}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Details Card */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Entry Details</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <dl className="divide-y">
              <InfoRow label="Description" value={entry.description ?? <span className="italic text-muted-foreground">No description</span>} />
              <InfoRow label="Status" value={<Badge variant={statusVariant[entry.status] ?? 'secondary'} className="text-xs">{entry.status}</Badge>} />
              {entry.postedBy && <InfoRow label="Posted By" value={entry.postedBy} />}
              {entry.createdBy && <InfoRow label="Created By" value={entry.createdBy} />}
              {sourceLink && (
                <InfoRow label="Source" value={
                  <a href={sourceLink.path} className="text-primary hover:underline font-medium text-sm flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    {sourceLink.label} <ExternalLink className="h-3 w-3" />
                  </a>
                } />
              )}
              {entry.reversalOfId && (
                <InfoRow label="Reversal of" value={
                  <button onClick={() => navigate(`/journal-entries/${entry.reversalOfId}`)} className="text-primary hover:underline font-medium text-sm flex items-center gap-1">
                    Original entry <ExternalLink className="h-3 w-3" />
                  </button>
                } />
              )}
              {entry.reversedEntryId && (
                <InfoRow label="Reversed by" value={
                  <button onClick={() => navigate(`/journal-entries/${entry.reversedEntryId}`)} className="text-primary hover:underline font-medium text-sm flex items-center gap-1">
                    Reversal entry <ExternalLink className="h-3 w-3" />
                  </button>
                } />
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Lines Table */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg flex-row items-center justify-between">
            <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Account Lines</CardTitle>
            <p className="text-[10px] font-medium text-muted-foreground">
              Dr {money(totalDebit)} / Cr {money(totalCredit)} {balanced ? '✓' : '✗'}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase w-12">#</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase">Account</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase">Description</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Debit</TableHead>
                  <TableHead className="text-xs font-bold text-muted-foreground uppercase text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entry.lines.map((l, idx) => (
                  <TableRow key={l.id} className="hover:bg-muted/20">
                    <TableCell className="text-xs text-muted-foreground font-mono">{idx + 1}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <code className="text-[11px] bg-primary/5 px-1.5 py-0.5 rounded font-mono text-primary font-semibold">{l.account.code}</code>
                        <span className="text-sm font-medium">{l.account.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.description ?? '-'}</TableCell>
                    <TableCell className="text-right font-semibold text-sm text-emerald-600">{Number(l.debit) ? money(l.debit) : ''}</TableCell>
                    <TableCell className="text-right font-semibold text-sm">{Number(l.credit) ? money(l.credit) : ''}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/10 border-t-2">
                  <TableCell colSpan={3} className="text-sm">Total</TableCell>
                  <TableCell className="text-right text-sm text-emerald-600">{money(totalDebit)}</TableCell>
                  <TableCell className="text-right text-sm">{money(totalCredit)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Reverse confirmation */}
      <Dialog open={reverseConfirm} onOpenChange={(o) => !o && setReverseConfirm(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse Journal Entry?</DialogTitle>
            <DialogDescription>
              This will create a new journal entry with debits and credits swapped,
              fully reversing {entry.entryNumber}. The original remains unchanged for audit.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={onReverse} disabled={reverse.isPending}>
              {reverse.isPending ? 'Reversing…' : 'Confirm Reversal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
