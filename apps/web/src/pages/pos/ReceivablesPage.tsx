/**
 * POS — Credit / Receivables.
 *
 * The worklist for money sold on account: every credit invoice that is still
 * owed, oldest first. Each row collects through the POS billing path so the
 * invoice, its receipts and the customer statement stay in step.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Wallet, Users, Clock, HandCoins } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/data-table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { money, date, useOrgCurrency } from '@/lib/format';
import { useOpenCreditInvoices, type OpenCreditInvoice } from '@/pages/pos/api';
import { RecordCreditPaymentDialog, type CreditPaymentTarget } from './RecordCreditPaymentDialog';

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="rounded-lg bg-slate-100 p-2 text-slate-600">{icon}</div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className={`text-xl font-bold ${accent ?? ''}`}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Older debt reads redder — 30+ days is the usual chase threshold. */
function ageClass(days: number): string {
  if (days >= 30) return 'text-rose-600 font-semibold';
  if (days >= 14) return 'text-amber-600 font-medium';
  return 'text-muted-foreground';
}

export function ReceivablesPage() {
  const navigate = useNavigate();
  const currency = useOrgCurrency();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [target, setTarget] = useState<CreditPaymentTarget | null>(null);

  useEffect(() => setPage(1), [search]);
  const { data, isLoading } = useOpenCreditInvoices({ page, pageSize: 25, search: search || undefined });

  const columns: Column<OpenCreditInvoice>[] = [
    {
      key: 'partnerName',
      header: 'Customer',
      render: (r) => (
        <button
          className="font-medium text-primary hover:underline"
          onClick={() => navigate(`/partners/${r.partnerId}`)}
        >
          {r.partnerName}
        </button>
      ),
    },
    {
      key: 'invoiceNumber',
      header: 'Invoice',
      render: (r) => (
        <button
          className="font-mono text-xs text-primary hover:underline"
          onClick={() => navigate(`/invoices/${r.invoiceId}`)}
        >
          {r.invoiceNumber}
        </button>
      ),
    },
    { key: 'issueDate', header: 'Date', render: (r) => date(r.issueDate) },
    {
      key: 'daysOutstanding',
      header: 'Age',
      className: 'text-center',
      render: (r) => <span className={`text-xs ${ageClass(r.daysOutstanding)}`}>{r.daysOutstanding}d</span>,
    },
    { key: 'totalAmount', header: 'Total', className: 'text-right', render: (r) => money(r.totalAmount, currency) },
    {
      key: 'amountPaid',
      header: 'Paid',
      className: 'text-right',
      render: (r) => (
        <span className={r.amountPaid > 0 ? 'text-emerald-600' : 'text-muted-foreground'}>
          {money(r.amountPaid, currency)}
        </span>
      ),
    },
    {
      key: 'amountResidual',
      header: 'Outstanding',
      className: 'text-right',
      render: (r) => <span className="font-semibold">{money(r.amountResidual, currency)}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'w-36 text-right',
      render: (r) => (
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700"
          onClick={() => setTarget({
            invoiceId: r.invoiceId,
            invoiceNumber: r.invoiceNumber,
            partnerName: r.partnerName,
            amountResidual: r.amountResidual,
          })}
        >
          <HandCoins className="mr-1 h-4 w-4" /> Record payment
        </Button>
      ),
    },
  ];

  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25)));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Credit / Receivables</h1>
        <p className="text-sm text-muted-foreground">
          Sales charged to a customer's account and not yet paid. Record a payment in full or in part —
          the balance stays here until it clears.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          icon={<Wallet className="h-5 w-5" />}
          label="Total outstanding"
          value={money(data?.totalOutstanding ?? 0, currency)}
          accent="text-rose-600"
        />
        <Stat icon={<Users className="h-5 w-5" />} label="Customers owing" value={String(data?.customersOwing ?? 0)} />
        <Stat
          icon={<Clock className="h-5 w-5" />}
          label="Oldest debt"
          // A debt raised today is 0 days old — still a debt, so don't show a dash.
          value={!data || data.total === 0 ? '—' : data.oldestDebtDays >= 1 ? `${data.oldestDebtDays} days` : 'Today'}
          accent={(data?.oldestDebtDays ?? 0) >= 30 ? 'text-rose-600' : undefined}
        />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by invoice # or customer…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable columns={columns} data={rows} loading={isLoading} getRowId={(r) => r.invoiceId} compact />

      {!isLoading && rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing outstanding — every credit sale has been paid.
        </p>
      ) : null}

      {data && data.total > 0 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{data.total} open credit invoice(s)</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>Page {data.page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <RecordCreditPaymentDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}

export default ReceivablesPage;
