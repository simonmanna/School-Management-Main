import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Power, PowerOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, type Column } from '@/components/data-table';
import { api } from '@/lib/api';
import type { PaginatedResult } from '@erp/shared';
import { toast } from 'sonner';

interface CashRegisterItem {
  id: string;
  code: string;
  name: string;
  defaultAccountId: string;
  locationId?: string | null;
  isActive: boolean;
}

function useCashRegistersCrud() {
  return useQuery({
    queryKey: ['cash-registers-crud'],
    queryFn: async () =>
      (await api.get<PaginatedResult<CashRegisterItem>>('/cash-registers', { params: { pageSize: 100 } })).data?.data ?? [],
  });
}

function useCreateCashRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { code: string; name: string; defaultAccountId: string; locationId?: string }) =>
      (await api.post('/cash-registers', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash-registers-crud'] }),
  });
}

function useUpdateCashRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; name?: string; defaultAccountId?: string; locationId?: string; isActive?: boolean }) =>
      (await api.patch(`/cash-registers/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash-registers-crud'] }),
  });
}

export function CashRegistersCrudPage() {
  const { data, isLoading } = useCashRegistersCrud();
  const create = useCreateCashRegister();
  const update = useUpdateCashRegister();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [defaultAccountId, setDefaultAccountId] = useState('');
  const [locationId, setLocationId] = useState('');

  const resetForm = () => {
    setCode(''); setName(''); setDefaultAccountId(''); setLocationId(''); setEditId(null);
  };

  const openEdit = (r: CashRegisterItem) => {
    setEditId(r.id); setCode(r.code); setName(r.name); setDefaultAccountId(r.defaultAccountId); setLocationId(r.locationId ?? ''); setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!code.trim() || !name.trim() || !defaultAccountId.trim()) {
      toast.error('Code, name, and default account are required');
      return;
    }
    try {
      if (editId) {
        await update.mutateAsync({ id: editId, name: name.trim(), defaultAccountId: defaultAccountId.trim(), locationId: locationId.trim() || undefined });
        toast.success('Register updated');
      } else {
        await create.mutateAsync({ code: code.trim(), name: name.trim(), defaultAccountId: defaultAccountId.trim(), locationId: locationId.trim() || undefined });
        toast.success('Register created');
      }
      setShowForm(false); resetForm();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to save register');
    }
  };

  const toggleActive = async (r: CashRegisterItem) => {
    try {
      await update.mutateAsync({ id: r.id, isActive: !r.isActive });
      toast.success(r.isActive ? 'Register deactivated' : 'Register activated');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to toggle');
    }
  };

  const columns: Column<CashRegisterItem>[] = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name' },
    {
      key: 'isActive', header: 'Status',
      render: (r) => (
        <span className={'px-2 py-0.5 rounded-full text-xs font-bold ' + (r.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500')}>
          {r.isActive ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'id', header: 'Actions',
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Pencil className="h-3 w-3" /></Button>
          <Button variant="ghost" size="sm" onClick={() => toggleActive(r)}>
            {r.isActive ? <PowerOff className="h-3 w-3 text-rose-500" /> : <Power className="h-3 w-3 text-emerald-500" />}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Cash Registers</h1>
          <p className="text-sm text-muted-foreground">Create, edit, activate or deactivate cash registers.</p>
        </div>
        <Button onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-1" /> New Register
        </Button>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{editId ? 'Edit Register' : 'New Register'}</h2>
              <button onClick={() => setShowForm(false)}><X className="h-5 w-5 text-slate-400" /></button>
            </div>
            <div>
              <Label>Code</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. MAIN-01" disabled={!!editId} />
            </div>
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Counter" />
            </div>
            <div>
              <Label>Default Account ID (GL cash account)</Label>
              <Input value={defaultAccountId} onChange={(e) => setDefaultAccountId(e.target.value)} placeholder="UUID of the cash GL account" />
            </div>
            <div>
              <Label>Location ID (optional)</Label>
              <Input value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="UUID of the inventory location" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={create.isPending || update.isPending}>
                {editId ? 'Update' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <DataTable columns={columns} data={data ?? []} loading={isLoading} getRowId={(r) => r.id} />
    </div>
  );
}
