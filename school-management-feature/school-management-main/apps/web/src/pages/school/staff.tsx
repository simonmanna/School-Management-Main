import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/data-table';
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { useCreateStaff, useStaff, type Staff } from '@/features/school/api';

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  employeeNo: z.string().min(1, 'Employee number is required'),
  joinDate: z.string().min(1, 'Join date is required'),
});
type FormValues = z.infer<typeof schema>;

export function StaffPage() {
  const [open, setOpen] = useState(false);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.school.manageStaff);
  const { data, isLoading } = useStaff();
  const createStaff = useCreateStaff();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', employeeNo: '', joinDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await createStaff.mutateAsync(values as any);
    form.reset();
    setOpen(false);
  });

  const columns: Column<Staff>[] = [
    { key: 'employeeNo', header: 'Emp. No' },
    { key: 'department', header: 'Department', render: (s) => s.department?.name ?? '-' },
    {
      key: 'status',
      header: 'Status',
      render: (s) => <Badge variant={s.status === 'active' ? 'default' : 'secondary'}>{s.status}</Badge>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Staff</h1>
        {canCreate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> New Staff</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Staff Member</DialogTitle></DialogHeader>
              <form onSubmit={onSubmit} className="space-y-3">
                <Input placeholder="Full name" {...form.register('name')} />
                <Input placeholder="Employee number" {...form.register('employeeNo')} />
                <Input type="date" {...form.register('joinDate')} />
                <DialogFooter><Button type="submit" disabled={createStaff.isPending}>Create</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <DataTable<Staff> columns={columns} data={data ?? []} loading={isLoading} />
    </div>
  );
}