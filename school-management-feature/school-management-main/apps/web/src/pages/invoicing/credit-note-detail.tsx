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
import { useCreditNote, usePostCreditNote } from '@/features/invoicing/api';

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function CreditNoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: cn, isLoading } = useCreditNote(id);
  const postCreditNote = usePostCreditNote();
  const has = useAuthStore((s) => s.hasPermission);

  if (isLoading || !cn) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  const isDraft = cn.status === 'draft';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{cn.documentNumber}</h1>
            <Badge variant={cn.status === 'cancelled' ? 'destructive' : 'default'}>{cn.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {cn.partner?.name} · {date(cn.issueDate)}
            {cn.reversedDocumentId ? ' · applied to an invoice' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/credit-notes')}>
            Back
          </Button>
          {isDraft && has(PERMISSIONS.creditNote.post) && (
            <Button onClick={() => postCreditNote.mutate(cn.id)} disabled={postCreditNote.isPending}>
              Post
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cn.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-right">{money(l.quantity)}</TableCell>
                  <TableCell className="text-right">{money(l.unitPrice)}</TableCell>
                  <TableCell className="text-right">{money(l.subtotal)}</TableCell>
                  <TableCell className="text-right">{money(l.taxAmount)}</TableCell>
                  <TableCell className="text-right">{money(l.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <SummaryRow label="Subtotal" value={money(cn.subtotal)} />
              <SummaryRow label="Tax" value={money(cn.taxAmount)} />
              <SummaryRow label="Total credited" value={money(cn.totalAmount)} bold />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
