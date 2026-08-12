import { useNavigate, useParams } from 'react-router-dom';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { money, date } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useJournalEntry, useReverseJournalEntry } from '@/features/accounting/api';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  posted: 'default',
  draft: 'secondary',
  reversed: 'destructive',
};

export function JournalEntryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: entry, isLoading } = useJournalEntry(id);
  const reverse = useReverseJournalEntry();
  const has = useAuthStore((s) => s.hasPermission);

  if (isLoading || !entry) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit || 0), 0);

  const onReverse = async () => {
    const reversal = await reverse.mutateAsync(entry.id);
    navigate(`/journal-entries/${reversal.id}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{entry.entryNumber}</h1>
            <Badge variant={statusVariant[entry.status] ?? 'secondary'}>{entry.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {entry.journal?.code} · {date(entry.postingDate)}
            {entry.description ? ` · ${entry.description}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/journal-entries')}>
            Back
          </Button>
          {entry.status === 'posted' && has(PERMISSIONS.journalEntry.reverse) && (
            <Button variant="outline" onClick={onReverse} disabled={reverse.isPending}>
              {reverse.isPending ? 'Reversing...' : 'Reverse'}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    {l.account.code} — {l.account.name}
                  </TableCell>
                  <TableCell>{l.description ?? '-'}</TableCell>
                  <TableCell className="text-right">{Number(l.debit) ? money(l.debit) : ''}</TableCell>
                  <TableCell className="text-right">{Number(l.credit) ? money(l.credit) : ''}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell colSpan={2}>Total</TableCell>
                <TableCell className="text-right">{money(totalDebit)}</TableCell>
                <TableCell className="text-right">{money(totalCredit)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
