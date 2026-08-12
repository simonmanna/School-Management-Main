import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/data-table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { money, date, statusLabel } from '@/lib/format';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSupplierPayments, useCreateSupplierPayment, type Payment } from '@/features/invoicing/api';
import { usePartners } from '@/features/partners/api';
import { useAccounts } from '@/features/accounting/api';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';
import { notify } from '@/lib/notify';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  posted: 'default',
  cancelled: 'destructive',
};

interface FormValues {
  partnerId: string;
  paymentDate: string;
  amount: string;
  paymentMethod: string;
  accountId: string;
  reference?: string;
  notes?: string;
}

export function SupplierPaymentsPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [open, setOpen] = useState(false);
  const search = useDebouncedValue(searchInput, 300);

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.payment.create);

  useEffect(() => setPage(1), [search]);
  const { data, isLoading } = useSupplierPayments({ page, pageSize: 12, search: search || undefined });
  const createPayment = useCreateSupplierPayment();
  const { data: partnersData } = usePartners({ page: 1, pageSize: 200 });
  const { data: accountsData } = useAccounts();

  const supplierList = useMemo(() => (partnersData?.data ?? []).filter((p) => p.isSupplier), [partnersData]);
  const accountList = useMemo(() => accountsData?.data ?? [], [accountsData]);

  const form = useForm<FormValues>({
    defaultValues: {
      partnerId: '',
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: '',
      paymentMethod: 'cash',
      accountId: '',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await createPayment.mutateAsync({
        partnerId: values.partnerId,
        paymentDate: values.paymentDate,
        amount: Number(values.amount),
        paymentMethod: values.paymentMethod,
        reference: values.reference || undefined,
        accountId: values.accountId,
      });
      notify.success('Payment recorded successfully');
      setOpen(false);
      form.reset({
        partnerId: '',
        paymentDate: new Date().toISOString().slice(0, 10),
        amount: '',
        paymentMethod: 'cash',
        accountId: '',
      });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Failed to record payment');
    }
  });

  const columns: Column<Payment>[] = [
    {
      key: 'paymentNumber',
      header: 'Voucher #',
      render: (p) => (
        <Link to={`/payments/${p.id}`} className="font-medium text-primary hover:underline">
          {p.paymentNumber}
        </Link>
      ),
    },
    { key: 'partner', header: 'Supplier', render: (p) => p.partner?.name ?? '-' },
    { key: 'paymentDate', header: 'Date', render: (p) => date(p.paymentDate) },
    { key: 'paymentMethod', header: 'Method', render: (p) => <Badge variant="secondary">{statusLabel(p.paymentMethod)}</Badge> },
    { key: 'amount', header: 'Amount', className: 'text-right', render: (p) => money(p.amount) },
    {
      key: 'status',
      header: 'Status',
      render: (p) => <Badge variant={statusVariant[p.status] ?? 'secondary'}>{p.status}</Badge>,
    },
  ];

  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Supplier Payments</h1>
          <p className="text-sm text-muted-foreground">
            Record payments to suppliers. You can also pay from an expense detail.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setOpen(true)} className="gap-2 bg-[#0066aa] hover:bg-[#005599] text-white">
            <Plus className="h-4 w-4" /> Record Payment
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search payments..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} getRowId={(p) => p.id} />

      {meta && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} payment(s)</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Record Supplier Payment</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Supplier</Label>
              <Select value={form.watch('partnerId')} onValueChange={(v) => form.setValue('partnerId', v)}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  {supplierList.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.partnerId && <p className="text-xs text-destructive">Supplier is required</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" {...form.register('paymentDate', { required: true })} />
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" step="any" {...form.register('amount', { required: true, min: 0.01 })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Method</Label>
              <Select value={form.watch('paymentMethod')} onValueChange={(v) => form.setValue('paymentMethod', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="mobile_money">Mobile Money</SelectItem>
                  <SelectItem value="credit_card">Credit Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Account</Label>
              <Select value={form.watch('accountId')} onValueChange={(v) => form.setValue('accountId', v)}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accountList.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reference (optional)</Label>
              <Input {...form.register('reference')} />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea {...form.register('notes')} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createPayment.isPending}>
                {createPayment.isPending ? 'Saving...' : 'Save payment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
