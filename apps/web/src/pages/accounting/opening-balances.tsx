import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Info, Search } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { date, money } from '@/lib/format';
import { notify } from '@/lib/notify';
import { useAuthStore } from '@/stores/auth.store';
import { useAccounts, useOpeningBalances, useStageOpeningBalances } from '@/features/accounting/api';

/** Sub-ledger control types: their balances come from fee, supplier and stock records, not this screen. */
const SUBLEDGER_TYPES = new Set(['ar', 'ap', 'inventory']);

const num = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive'> = {
  posted: 'default',
  draft: 'secondary',
  reversed: 'destructive',
};

/**
 * Go-live opening balances: the closing trial balance of the school's previous
 * books, entered once. Any difference goes to Opening Balance Equity. The load
 * is saved as a draft that a second person approves on the journal-entry page.
 */
export function OpeningBalancesPage() {
  const navigate = useNavigate();
  const has = useAuthStore((s) => s.hasPermission);
  const accounts = useAccounts();
  const summary = useOpeningBalances();
  const stage = useStageOpeningBalances();

  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('Opening balances');
  const [search, setSearch] = useState('');
  const [amounts, setAmounts] = useState<Record<string, { debit?: string; credit?: string }>>({});

  const obeId = summary.data?.openingBalanceEquity?.id;
  const eligible = useMemo(
    () =>
      (accounts.data?.data ?? [])
        .filter((a) => !a.isGroup && a.isActive && a.id !== obeId)
        .filter((a) => !SUBLEDGER_TYPES.has(a.controlAccountType ?? ''))
        .sort((a, b) => a.code.localeCompare(b.code)),
    [accounts.data, obeId],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? eligible.filter((a) => `${a.code} ${a.name}`.toLowerCase().includes(q)) : eligible;
  }, [eligible, search]);

  const lines = Object.entries(amounts)
    .map(([accountId, v]) => ({ accountId, debit: num(v.debit), credit: num(v.credit) }))
    .filter((l) => l.debit > 0 || l.credit > 0);
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const difference = totalDebit - totalCredit;
  const bothSides = lines.some((l) => l.debit > 0 && l.credit > 0);

  const setAmount = (accountId: string, side: 'debit' | 'credit', value: string) =>
    setAmounts((prev) => ({ ...prev, [accountId]: { ...prev[accountId], [side]: value } }));

  const onSubmit = async () => {
    try {
      const entry = await stage.mutateAsync({
        date: asOf,
        description: description.trim() || undefined,
        lines: lines.map((l) => (l.debit > 0 ? { accountId: l.accountId, debit: l.debit } : { accountId: l.accountId, credit: l.credit })),
      });
      notify.success('Opening balances saved as a draft', 'A second person approves it on the entry page.');
      setAmounts({});
      navigate(`/journal-entries/${entry.id}`);
    } catch (e: any) {
      const m = e?.response?.data?.message;
      notify.error('Could not save', Array.isArray(m) ? m.join(', ') : (m ?? e?.message));
    }
  };

  const canCreate = has(PERMISSIONS.journalEntry.create);
  const obe = summary.data?.openingBalanceEquity;

  return (
    <div className="space-y-4">
      <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Opening Balances</h1>
        <p className="text-sm text-gray-500">
          Bring the closing balances from your previous books into the ledger on the go-live date.
        </p>
      </div>

      <Card>
        <CardContent className="flex gap-3 p-4 text-sm text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-primary" />
          <div className="space-y-1">
            <p>
              Enter each account's balance as at the end of the day before go-live. Any difference is posted to{' '}
              <strong>Opening Balance Equity</strong>, so a partial load still balances; clear that account to capital or
              retained earnings with a journal entry once every balance is in.
            </p>
            <p>
              Pupil fee arrears, supplier balances and stock are not entered here. Their control accounts are kept by the
              fees, supplier-bill and inventory records, which carry their own brought-forward documents.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Loads so far</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (summary.data?.entries.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No opening balances entered yet.</p>
            ) : (
              summary.data!.entries.map((e) => (
                <Link
                  key={e.id}
                  to={`/journal-entries/${e.id}`}
                  className="flex items-center justify-between rounded border px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <span className="font-medium">{e.status === 'draft' ? 'Draft' : e.entryNumber}</span>
                  <span className="text-muted-foreground">{date(e.postingDate)} · {e._count.lines} lines</span>
                  <Badge variant={statusVariant[e.status] ?? 'secondary'} className="text-xs">
                    {e.status === 'draft' ? 'AWAITING APPROVAL' : e.status.toUpperCase()}
                  </Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Opening Balance Equity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {obe ? (
              <>
                <p className="text-2xl font-semibold tabular-nums">{money(Number(obe.balance))}</p>
                <p className="text-muted-foreground">
                  {obe.code} {obe.name}.{' '}
                  {Number(obe.balance) === 0
                    ? 'Cleared.'
                    : 'Move this to capital or retained earnings once the load is complete.'}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Created automatically with the first load.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {canCreate && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">New load</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="ob-date">Go-live date</Label>
                <Input id="ob-date" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="ob-desc">Description</Label>
                <Input id="ob-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Find an account by code or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8 text-sm"
              />
            </div>

            <div className="max-h-[480px] overflow-auto rounded border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Account</th>
                    <th className="px-3 py-2 text-right font-semibold w-40">Debit</th>
                    <th className="px-3 py-2 text-right font-semibold w-40">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.isLoading && (
                    <tr>
                      <td colSpan={3} className="p-3"><Skeleton className="h-6 w-full" /></td>
                    </tr>
                  )}
                  {shown.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="px-3 py-1.5">
                        <span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                        {a.name}
                        {a.category?.name && <span className="ml-2 text-xs text-muted-foreground">{a.category.name}</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <Input
                          inputMode="decimal"
                          className="h-8 text-right tabular-nums"
                          value={amounts[a.id]?.debit ?? ''}
                          onChange={(e) => setAmount(a.id, 'debit', e.target.value)}
                          aria-label={`${a.code} debit`}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input
                          inputMode="decimal"
                          className="h-8 text-right tabular-nums"
                          value={amounts[a.id]?.credit ?? ''}
                          onChange={(e) => setAmount(a.id, 'credit', e.target.value)}
                          aria-label={`${a.code} credit`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-4 text-sm tabular-nums">
                <span>Debits <strong>{money(totalDebit)}</strong></span>
                <span>Credits <strong>{money(totalCredit)}</strong></span>
                <span>
                  To Opening Balance Equity{' '}
                  <strong>
                    {difference === 0 ? money(0) : `${money(Math.abs(difference))} ${difference > 0 ? 'Cr' : 'Dr'}`}
                  </strong>
                </span>
              </div>
              <Button onClick={onSubmit} disabled={lines.length === 0 || bothSides || stage.isPending}>
                {stage.isPending ? 'Saving…' : 'Save draft for approval'}
              </Button>
            </div>
            {bothSides && (
              <p className="text-sm text-destructive">An account's opening balance is a debit or a credit, not both.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
