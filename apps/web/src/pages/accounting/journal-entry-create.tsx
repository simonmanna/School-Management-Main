import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { money } from '@/lib/format';
import { useAccounts, useJournals, useCreateJournalEntry } from '@/features/accounting/api';

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface LineForm {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string;
}
interface FormValues {
  journalCode: string;
  date: string;
  description?: string;
  lines: LineForm[];
}

const num = (v: unknown): number => (Number.isFinite(v) ? Number(v) : 0);

export function JournalEntryCreatePage() {
  const navigate = useNavigate();
  const journals = useJournals();
  const accounts = useAccounts();
  const createEntry = useCreateJournalEntry();
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const { register, control, handleSubmit, watch } = useForm<FormValues>({
    defaultValues: {
      journalCode: '',
      date: today,
      description: '',
      lines: [{ accountId: '' }, { accountId: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const lines = watch('lines');
  const journalCode = watch('journalCode');

  const postable = (accounts.data?.data ?? []).filter((a) => !a.isGroup && a.isActive);

  const totalDebit = (lines ?? []).reduce((s, l) => s + num(l.debit), 0);
  const totalCredit = (lines ?? []).reduce((s, l) => s + num(l.credit), 0);
  const diff = totalDebit - totalCredit;
  const balanced = totalDebit > 0 && Math.abs(diff) < 0.005;
  const validLines = (lines ?? []).filter((l) => l.accountId && (num(l.debit) > 0 || num(l.credit) > 0));
  const canSubmit = Boolean(journalCode) && balanced && validLines.length >= 2 && !createEntry.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const entry = await createEntry.mutateAsync({
        journalCode: values.journalCode,
        date: values.date,
        description: values.description || undefined,
        lines: values.lines
          .filter((l) => l.accountId && (num(l.debit) > 0 || num(l.credit) > 0))
          .map((l) => ({
            accountId: l.accountId,
            debit: num(l.debit) > 0 ? num(l.debit) : undefined,
            credit: num(l.credit) > 0 ? num(l.credit) : undefined,
            description: l.description || undefined,
          })),
      });
      navigate(`/journal-entries/${entry.id}`);
    } catch (e) {
      const message =
        (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      setError(Array.isArray(message) ? message.join(', ') : (message ?? 'Failed to post entry'));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New Journal Entry</h1>
        <div className="flex items-center gap-3">
          <Badge variant={balanced ? 'default' : 'secondary'}>
            {balanced ? 'Balanced' : `Diff ${money(diff)}`}
          </Badge>
          <Button type="submit" disabled={!canSubmit}>
            {createEntry.isPending ? 'Posting...' : 'Post entry'}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Header</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Journal</Label>
            <select className={selectClass} {...register('journalCode', { required: true })}>
              <option value="">Select journal</option>
              {(journals.data?.data ?? []).map((j) => (
                <option key={j.id} value={j.code}>
                  {j.code} — {j.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" {...register('date', { required: true })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" {...register('description')} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Lines</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => append({ accountId: '' })}>
            <Plus className="h-4 w-4" /> Add line
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-5">
                <Label className="text-xs">Account</Label>
                <select className={selectClass} {...register(`lines.${index}.accountId`)}>
                  <option value="">Select account</option>
                  {postable.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <Label className="text-xs">Description</Label>
                <Input {...register(`lines.${index}.description`)} />
              </div>
              <div className="col-span-1">
                <Label className="text-xs">Debit</Label>
                <Input type="number" step="any" {...register(`lines.${index}.debit`, { valueAsNumber: true })} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Credit</Label>
                <Input type="number" step="any" {...register(`lines.${index}.credit`, { valueAsNumber: true })} />
              </div>
              <div className="col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  disabled={fields.length <= 2}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          <div className="flex justify-end gap-8 border-t pt-3 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground">Total debit</span>
              <span className="w-24 text-right font-medium">{money(totalDebit)}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">Total credit</span>
              <span className="w-24 text-right font-medium">{money(totalCredit)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
