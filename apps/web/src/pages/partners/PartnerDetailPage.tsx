import { useEffect, useState } from 'react';
import {
  ChevronRight, ArrowLeft, Users, Building2, Mail, Phone,
  MapPin, FileText, DollarSign, ShoppingCart, BookOpen, Activity, Receipt, Handshake,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { money, date, dateTime } from '@/lib/format';
import { api } from '@/lib/api';
import type { PaginatedResult } from '@erp/shared';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { usePartner, useCustomerStatement, type Partner } from '@/features/partners/api';
import { useOpenCreditInvoices } from '@/pages/pos/api';
import { RecordCreditPaymentDialog, type CreditPaymentTarget } from '@/pages/pos/RecordCreditPaymentDialog';
import { useSupplierLedger } from '@/features/invoicing/api';
import { CrmPartnerTab } from '@/features/crm/partner-tab';

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start py-2.5 gap-4">
      <dt className="w-36 flex-shrink-0 text-xs text-muted-foreground font-semibold pt-0.5 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm flex-1">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function PartnerStatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Active</Badge>;
  return <Badge variant="secondary" className="text-xs">Inactive</Badge>;
}

function TabOverview({ partner }: { partner: Partner }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Basic Info</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <dl className="divide-y">
            <InfoRow label="Code" value={<code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-primary font-semibold">{partner.code}</code>} />
            <InfoRow label="Name" value={<span className="font-semibold">{partner.name}</span>} />
            <InfoRow label="Email" value={partner.email ? <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{partner.email}</span> : null} />
            <InfoRow label="Phone" value={partner.phone ? <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted-foreground" />{partner.phone}</span> : null} />
            <InfoRow label="Website" value={partner.website} />
            <InfoRow label="Tax Number" value={partner.taxNumber ? <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{partner.taxNumber}</code> : null} />
            <InfoRow label="Status" value={<PartnerStatusBadge status={partner.status} />} />
            <InfoRow label="Type" value={
              <div className="flex gap-1.5">
                {partner.isCustomer && <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700">Customer</Badge>}
                {partner.isSupplier && <Badge variant="secondary" className="text-xs bg-purple-50 text-purple-700">Supplier</Badge>}
                {partner.isEmployee && <Badge variant="secondary" className="text-xs bg-green-50 text-green-700">Employee</Badge>}
              </div>
            } />
            <InfoRow label="Category" value={partner.category?.name ? <span className="font-semibold">{partner.category.name}</span> : null} />
            <InfoRow label="Membership" value={partner.membershipLevel ? <Badge variant="outline" className="text-xs">{partner.membershipLevel}</Badge> : null} />
            <InfoRow label="Gender" value={partner.gender ? <span className="capitalize">{partner.gender}</span> : null} />
            <InfoRow label="Notes" value={partner.notes} />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Activity</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4">
          <dl className="divide-y">
            <InfoRow label="Created" value={<span className="text-sm">{dateTime(partner.createdAt)}</span>} />
            <InfoRow label="Updated" value={<span className="text-sm">{dateTime(partner.updatedAt)}</span>} />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function TabContacts({ partner }: { partner: Partner }) {
  const contacts = partner.contacts ?? [];
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>First Name</TableHead>
              <TableHead>Last Name</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Primary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No contacts registered.</TableCell>
              </TableRow>
            ) : contacts.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.firstName}</TableCell>
                <TableCell>{c.lastName ?? '-'}</TableCell>
                <TableCell>{c.position ?? '-'}</TableCell>
                <TableCell>{c.email ?? '-'}</TableCell>
                <TableCell>{c.phone ?? '-'}</TableCell>
                <TableCell>{c.isPrimary ? <Badge className="bg-emerald-100 text-emerald-700 text-xs">Primary</Badge> : '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TabAddresses({ partner }: { partner: Partner }) {
  const addresses = partner.addresses ?? [];
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>City</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Postal Code</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Primary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {addresses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No addresses registered.</TableCell>
              </TableRow>
            ) : addresses.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="capitalize">{a.type}</TableCell>
                <TableCell>{[a.line1, a.line2].filter(Boolean).join(', ')}</TableCell>
                <TableCell>{a.city ?? '-'}</TableCell>
                <TableCell>{a.state ?? '-'}</TableCell>
                <TableCell>{a.postalCode ?? '-'}</TableCell>
                <TableCell>{a.country ?? '-'}</TableCell>
                <TableCell>{a.isPrimary ? <Badge className="bg-emerald-100 text-emerald-700 text-xs">Primary</Badge> : '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

interface InvoiceRow {
  id: string;
  documentNumber: string;
  issueDate: string;
  totalAmount: string;
  status: string;
  paymentStatus: string;
}

function TabInvoices({ partnerId }: { partnerId: string }) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<{ data: InvoiceRow[] }>('/invoices', { params: { partnerId, pageSize: 10 } })
      .then((r) => setInvoices(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [partnerId]);

  if (loading) return <div className="p-8 text-center text-muted-foreground"><Skeleton className="h-48 w-full" /></div>;

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Payment</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No invoices found.</TableCell>
              </TableRow>
            ) : invoices.map((inv) => (
              <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/invoices/${inv.id}`)}>
                <TableCell className="font-mono text-xs font-medium">{inv.documentNumber}</TableCell>
                <TableCell className="text-sm">{date(inv.issueDate)}</TableCell>
                <TableCell className="text-right font-medium">{money(inv.totalAmount)}</TableCell>
                <TableCell><Badge variant={inv.status === 'posted' ? 'default' : 'secondary'} className="text-xs capitalize">{inv.status}</Badge></TableCell>
                <TableCell><Badge variant="outline" className="text-xs capitalize">{inv.paymentStatus}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

interface PaymentRow {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  amount: string;
  direction: string;
  status: string;
  paymentMethod: string;
}

function TabPayments({ partnerId, direction }: { partnerId: string; direction: 'inbound' | 'outbound' }) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const endpoint = direction === 'inbound' ? '/payments' : '/supplier-payments';

  useEffect(() => {
    api.get<{ data: PaymentRow[] }>(endpoint, { params: { partnerId, pageSize: 10 } })
      .then((r) => setPayments(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [partnerId, endpoint]);

  if (loading) return <div className="p-8 text-center text-muted-foreground"><Skeleton className="h-48 w-full" /></div>;

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payment #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No payments found.</TableCell>
              </TableRow>
            ) : payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.paymentNumber}</TableCell>
                <TableCell className="text-sm">{date(p.paymentDate)}</TableCell>
                <TableCell className="text-right font-medium">{money(p.amount)}</TableCell>
                <TableCell className="text-sm capitalize">{p.paymentMethod}</TableCell>
                <TableCell><Badge variant={p.status === 'posted' ? 'default' : 'secondary'} className="text-xs capitalize">{p.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

interface PORow {
  id: string;
  orderNumber: string;
  orderDate: string;
  totalAmount: number;
  status: string;
}

function TabPurchaseOrders({ partnerId }: { partnerId: string }) {
  const [orders, setOrders] = useState<PORow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<PaginatedResult<PORow>>('/procurement/purchase-orders', { params: { partnerId, pageSize: 10 } })
      .then((r) => setOrders(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [partnerId]);

  if (loading) return <div className="p-8 text-center text-muted-foreground"><Skeleton className="h-48 w-full" /></div>;

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    active: 'bg-blue-100 text-blue-700',
    partially_received: 'bg-amber-100 text-amber-700',
    received: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-red-100 text-red-700',
  };

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No purchases found.</TableCell>
              </TableRow>
            ) : orders.map((po) => (
              <TableRow key={po.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/procurement/purchase-orders/${po.id}`)}>
                <TableCell className="font-mono text-xs font-medium">{po.orderNumber}</TableCell>
                <TableCell className="text-sm">{date(po.orderDate)}</TableCell>
                <TableCell className="text-right font-medium">{money(po.totalAmount)}</TableCell>
                <TableCell>
                  <span className={`inline-flex px-2.5 py-0.5 rounded text-xs font-semibold ${statusColors[po.status] ?? 'bg-gray-100 text-gray-700'}`}>
                    {po.status.replace(/_/g, ' ')}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TabLedger({ partnerId }: { partnerId: string }) {
  const { data, isLoading } = useSupplierLedger(partnerId);

  if (isLoading) return <div className="p-8"><Skeleton className="h-48 w-full" /></div>;
  if (!data) return <div className="p-8 text-center text-muted-foreground">No ledger data.</div>;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Opening Balance</div>
            <div className="text-2xl font-bold">{money(data.openingBalance)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Closing Balance</div>
            <div className="text-2xl font-bold">{money(data.closingBalance)}</div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No transactions found.</TableCell>
                </TableRow>
              ) : data.transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-sm">{date(t.date)}</TableCell>
                  <TableCell>
                    <Badge variant={t.type === 'payment' ? 'default' : t.type === 'payment_void' ? 'destructive' : 'secondary'} className="text-xs capitalize">
                      {t.type.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                  <TableCell className="text-sm">{t.description}</TableCell>
                  <TableCell className="text-right">{t.debit ? money(t.debit) : '-'}</TableCell>
                  <TableCell className="text-right">{t.credit ? money(t.credit) : '-'}</TableCell>
                  <TableCell className="text-right font-medium">{money(t.balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function TabStatement({ partnerId }: { partnerId: string }) {
  const { data, isLoading } = useCustomerStatement(partnerId);
  const { data: open } = useOpenCreditInvoices({ partnerId, pageSize: 100 });
  const [target, setTarget] = useState<CreditPaymentTarget | null>(null);

  if (isLoading) return <div className="p-8"><Skeleton className="h-48 w-full" /></div>;
  if (!data) return <div className="p-8 text-center text-muted-foreground">No statement data.</div>;

  const typeBadge: Record<string, string> = {
    credit_issue: 'bg-blue-50 text-blue-700',
    payment: 'bg-emerald-50 text-emerald-700',
    write_off: 'bg-red-50 text-red-700',
  };

  const openRows = open?.rows ?? [];

  return (
    <div className="space-y-4">
      {data.creditHold ? (
        <div className="rounded-lg border-2 border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">
          On credit hold — new credit sales are blocked for this customer.
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Credit Limit</div>
            <div className="text-2xl font-bold">{data.creditLimit > 0 ? money(data.creditLimit) : 'No limit'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Outstanding</div>
            <div className="text-2xl font-bold">{money(data.outstanding)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Available</div>
            <div className="text-2xl font-bold">{data.available == null ? '—' : money(data.available)}</div>
          </CardContent>
        </Card>
      </div>

      {openRows.length > 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="mb-3 text-sm font-semibold">Open invoices</div>
            <div className="space-y-2">
              {openRows.map((r) => (
                <div key={r.invoiceId} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-mono text-xs">{r.invoiceNumber}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{date(r.issueDate)} · {r.daysOutstanding}d</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{money(r.amountResidual)}</span>
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
                      Record payment
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <RecordCreditPaymentDialog target={target} onClose={() => setTarget(null)} />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Charge</TableHead>
                <TableHead className="text-right">Payment</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No credit activity.</TableCell>
                </TableRow>
              ) : data.entries.map((e, i) => (
                <TableRow key={`${e.invoiceId}-${e.type}-${i}`}>
                  <TableCell className="text-sm">{date(e.date)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-xs capitalize ${typeBadge[e.type] ?? ''}`}>
                      {e.type.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.reference}</TableCell>
                  <TableCell className="text-right">{e.amount > 0 ? money(e.amount) : '-'}</TableCell>
                  <TableCell className="text-right">{e.amount < 0 ? money(-e.amount) : '-'}</TableCell>
                  <TableCell className="text-right font-medium">{money(e.runningBalance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

interface ExpenseRow {
  id: string;
  expenseCode: string;
  title: string;
  expenseDate: string;
  amount: string;
  status: string;
}

interface ExpenseApiResponse {
  data: ExpenseRow[];
  total: number;
}

function TabExpensesPurchases({ partnerId }: { partnerId: string }) {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [pos, setPos] = useState<PORow[]>([]);
  const [posLoading, setPosLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<ExpenseApiResponse>('/expenses', { params: { supplierId: partnerId, limit: 5 } })
      .then((r) => setExpenses(r.data.data ?? []))
      .catch(() => {})
      .finally(() => setExpensesLoading(false));
    api.get<PaginatedResult<PORow>>('/procurement/purchase-orders', { params: { partnerId, pageSize: 5 } })
      .then((r) => setPos(r.data.data ?? []))
      .catch(() => {})
      .finally(() => setPosLoading(false));
  }, [partnerId]);

  const expStatusColors: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    APPROVED: 'bg-blue-100 text-blue-700',
    POSTED: 'bg-emerald-100 text-emerald-700',
    REJECTED: 'bg-red-100 text-red-700',
    VOID: 'bg-red-100 text-red-700',
  };

  const poStatusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    active: 'bg-blue-100 text-blue-700',
    partially_received: 'bg-amber-100 text-amber-700',
    received: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-red-100 text-red-700',
  };

  return (
    <div className="space-y-6">
      {/* Expenses Section */}
      <Card>
        <CardHeader className="pb-3 px-5 pt-4 bg-muted/30 border-b rounded-t-lg flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Expenses</CardTitle>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate('/expenses')}>
            View all expenses →
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {expensesLoading ? (
            <div className="p-4"><Skeleton className="h-32 w-full" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No expenses found.</TableCell>
                  </TableRow>
                ) : expenses.map((exp) => (
                  <TableRow key={exp.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/expenses/${exp.id}`)}>
                    <TableCell className="font-mono text-xs font-medium">{exp.expenseCode}</TableCell>
                    <TableCell className="text-sm">{exp.title}</TableCell>
                    <TableCell className="text-sm">{date(exp.expenseDate)}</TableCell>
                    <TableCell className="text-right font-medium">{money(exp.amount)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2.5 py-0.5 rounded text-xs font-semibold ${expStatusColors[exp.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {exp.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Purchase Orders Section */}
      <Card>
        <CardHeader className="pb-3 px-5 pt-4 bg-muted/30 border-b rounded-t-lg flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Purchases</CardTitle>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate('/procurement/purchase-orders')}>
            View all POs →
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {posLoading ? (
            <div className="p-4"><Skeleton className="h-32 w-full" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No purchases found.</TableCell>
                  </TableRow>
                ) : pos.map((po) => (
                  <TableRow key={po.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/procurement/purchase-orders/${po.id}`)}>
                    <TableCell className="font-mono text-xs font-medium">{po.orderNumber}</TableCell>
                    <TableCell className="text-sm">{date(po.orderDate)}</TableCell>
                    <TableCell className="text-right font-medium">{money(po.totalAmount)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2.5 py-0.5 rounded text-xs font-semibold ${poStatusColors[po.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {po.status.replace(/_/g, ' ')}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PartnerDetailPage({ partnerType }: { partnerType: 'customer' | 'supplier' }) {
  const { partnerId } = useParams<{ partnerId: string }>();
  const navigate = useNavigate();
  const canCrm = useAuthStore((s) => s.hasPermission('crm:deal:read'));
  const { data: partner, isLoading } = usePartner(partnerId);

  if (isLoading) {
    return (
      <div className="space-y-6 px-2 md:px-4 py-3 mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!partner) {
    return (
      <div className="space-y-6 px-2 md:px-4 py-3 mx-auto">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
          <h1 className="text-2xl font-semibold text-destructive">Not Found</h1>
          <p className="mt-2 text-sm text-muted-foreground">Partner not found or you don't have permission to view it.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate(partnerType === 'customer' ? '/customers' : '/suppliers')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to {partnerType === 'customer' ? 'Customers' : 'Suppliers'}
          </Button>
        </div>
      </div>
    );
  }

  const isCustomer = partnerType === 'customer';
  const labelPlural = isCustomer ? 'Customers' : 'Suppliers';
  const gradientFrom = isCustomer ? 'from-blue-600' : 'from-purple-600';
  const gradientTo = isCustomer ? 'to-blue-700' : 'to-purple-700';
  const Icon = isCustomer ? Users : Building2;

  const tabs = [
    { value: 'overview', label: 'Overview', icon: FileText },
    { value: 'contacts', label: 'Contacts', icon: Users },
    { value: 'addresses', label: 'Addresses', icon: MapPin },
    { value: isCustomer ? 'invoices' : 'expenses-purchases', label: isCustomer ? 'Invoices' : 'Expenses/Purchases', icon: isCustomer ? DollarSign : Receipt },
    { value: 'payments', label: 'Payments', icon: Activity },
  ];
  if (canCrm) {
    tabs.push({ value: 'crm', label: 'CRM', icon: Handshake });
  }
  if (isCustomer) {
    tabs.push({ value: 'statement', label: 'Statement', icon: BookOpen });
  } else {
    tabs.push({ value: 'purchase-orders', label: 'Purchases', icon: ShoppingCart });
    tabs.push({ value: 'ledger', label: 'Ledger', icon: BookOpen });
  }

  return (
    <div className="space-y-6 px-2 md:px-4 py-3 mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button onClick={() => navigate(`/${labelPlural.toLowerCase()}`)} className="hover:text-foreground transition-colors">{labelPlural}</button>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium truncate">{partner.name}</span>
      </nav>

      {/* Gradient header */}
      <div className={`rounded-xl bg-gradient-to-r ${gradientFrom} ${gradientTo} p-6 text-white shadow-lg`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
              <Icon className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{partner.name}</h1>
              <div className="flex items-center gap-3 mt-1">
                <code className="text-xs bg-white/20 px-2 py-0.5 rounded font-mono">{partner.code}</code>
                <PartnerStatusBadge status={partner.status} />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="bg-white/20 text-white hover:bg-white/30 border-0"
              onClick={() => navigate(`/${labelPlural.toLowerCase()}`)}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="bg-muted/50 p-1">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="flex items-center gap-1.5 data-[state=active]:bg-background">
              <t.icon className="h-4 w-4" />
              <span>{t.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <TabOverview partner={partner} />
        </TabsContent>

        <TabsContent value="contacts" className="mt-6">
          <TabContacts partner={partner} />
        </TabsContent>

        <TabsContent value="addresses" className="mt-6">
          <TabAddresses partner={partner} />
        </TabsContent>

        <TabsContent value={isCustomer ? 'invoices' : 'expenses-purchases'} className="mt-6">
          {isCustomer ? <TabInvoices partnerId={partner.id} /> : <TabExpensesPurchases partnerId={partner.id} />}
        </TabsContent>

        <TabsContent value="payments" className="mt-6">
          <TabPayments partnerId={partner.id} direction={isCustomer ? 'inbound' : 'outbound'} />
        </TabsContent>

        {canCrm && (
          <TabsContent value="crm" className="mt-6">
            <CrmPartnerTab partnerId={partner.id} />
          </TabsContent>
        )}

        {isCustomer ? (
          <TabsContent value="statement" className="mt-6">
            <TabStatement partnerId={partner.id} />
          </TabsContent>
        ) : (
          <>
            <TabsContent value="purchase-orders" className="mt-6">
              <TabPurchaseOrders partnerId={partner.id} />
            </TabsContent>
            <TabsContent value="ledger" className="mt-6">
              <TabLedger partnerId={partner.id} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

export { PartnerDetailPage };
