import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Search } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/data-table';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useAuthStore } from '@/stores/auth.store';
import { useCreatePartner, usePartners, type Partner } from '@/features/partners/api';

const schema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  isCustomer: z.boolean(),
  isSupplier: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

export function PartnersPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 300);
  const [open, setOpen] = useState(false);

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.partner.create);

  useEffect(() => setPage(1), [search]);

  const { data, isLoading } = usePartners({ page, pageSize: 10, search: search || undefined });
  const createPartner = useCreatePartner();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', name: '', email: '', isCustomer: true, isSupplier: false },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await createPartner.mutateAsync({
      code: values.code,
      name: values.name,
      email: values.email || undefined,
      isCustomer: values.isCustomer,
      isSupplier: values.isSupplier,
    });
    form.reset();
    setOpen(false);
  });

  const columns: Column<Partner>[] = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name' },
    {
      key: 'type',
      header: 'Type',
      render: (p) => (
        <div className="flex gap-1">
          {p.isCustomer && <Badge variant="secondary">Customer</Badge>}
          {p.isSupplier && <Badge variant="outline">Supplier</Badge>}
          {p.isEmployee && <Badge variant="outline">Employee</Badge>}
        </div>
      ),
    },
    { key: 'email', header: 'Email', render: (p) => p.email ?? '-' },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>{p.status}</Badge>
      ),
    },
  ];

  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Partners</h1>
          <p className="text-sm text-muted-foreground">Customers, suppliers and other parties.</p>
        </div>
        {canCreate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" /> New Partner
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Partner</DialogTitle>
                <DialogDescription>Create a customer or supplier.</DialogDescription>
              </DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Code</Label>
                  <Input id="code" placeholder="CUST-001" {...form.register('code')} />
                  {form.formState.errors.code && (
                    <p className="text-sm text-destructive">{form.formState.errors.code.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" placeholder="Acme Ltd" {...form.register('name')} />
                  {form.formState.errors.name && (
                    <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="orders@acme.test" {...form.register('email')} />
                  {form.formState.errors.email && (
                    <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
                  )}
                </div>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" {...form.register('isCustomer')} /> Customer
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" {...form.register('isSupplier')} /> Supplier
                  </label>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createPartner.isPending}>
                    {createPartner.isPending ? 'Saving...' : 'Save'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search partners..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      <DataTable columns={columns} data={data?.data ?? []} loading={isLoading} getRowId={(p) => p.id} />

      {meta && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} record(s)</span>
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
    </div>
  );
}
