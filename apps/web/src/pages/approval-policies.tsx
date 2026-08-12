import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { ENTITY_TYPE_LABELS } from '@/lib/approval-entity-types';

interface ApprovalPolicy {
  id: string;
  name: string;
  entityType: string;
  minAmount: number | null;
  approverPermissions: string[] | null;
  requiredCount: number;
  isActive: boolean;
  createdAt: string;
}

function EntityTypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <option value="">-- Select feature --</option>
      {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => (
        <option key={k} value={k}>{v}</option>
      ))}
    </select>
  );
}

export function ApprovalPoliciesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', entityType: '', minAmount: '', requiredCount: '1', approverPermissions: '' });

  const list = useQuery<ApprovalPolicy[]>({
    queryKey: ['approval-policies'],
    queryFn: async () => (await api.get<ApprovalPolicy[]>('/approval-policies')).data,
  });

  const toggle = useMutation({
    mutationFn: async (vars: { id: string; isActive: boolean }) =>
      api.patch(`/approval-policies/${vars.id}`, { isActive: vars.isActive }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approval-policies'] }); notify.success('Policy updated'); },
    onError: (err: any) => notify.error(err?.response?.data?.message ?? 'Failed'),
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.entityType) throw new Error('Select a feature');
      return api.post('/approval-policies', {
        name: form.name || form.entityType,
        entityType: form.entityType,
        minAmount: form.minAmount ? Number(form.minAmount) : null,
        requiredCount: Number(form.requiredCount) || 1,
        approverPermissions: form.approverPermissions ? form.approverPermissions.split(',').map((s: string) => s.trim()) : null,
        isActive: true,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approval-policies'] });
      setShowForm(false);
      setForm({ name: '', entityType: '', minAmount: '', requiredCount: '1', approverPermissions: '' });
      notify.success('Policy created');
    },
    onError: (err: any) => notify.error(err?.response?.data?.message ?? err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/approval-policies/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['approval-policies'] }); notify.success('Policy deleted'); },
    onError: (err: any) => notify.error(err?.response?.data?.message ?? 'Failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Approval Policies</h1>
          <p className="text-sm text-muted-foreground">
            Configure which features require approval. Toggle off to auto-approve.
          </p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>
          <Plus className="mr-1 h-4 w-4" /> Add Policy
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Approval Policy</CardTitle>
            <CardDescription>
              When active, this feature's actions will be held pending until the
              required number of authorized approvers decide.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Feature *</Label>
                <EntityTypeSelect
                  value={form.entityType}
                  onChange={(v) => setForm((f) => ({ ...f, entityType: v }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Policy Name</Label>
                <Input
                  placeholder="e.g. PO Approval"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Min Amount (optional)</Label>
                <Input
                  type="number"
                  placeholder="e.g. 500"
                  value={form.minAmount}
                  onChange={(e) => setForm((f) => ({ ...f, minAmount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Required Approvals</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.requiredCount}
                  onChange={(e) => setForm((f) => ({ ...f, requiredCount: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Approver Permissions (comma-separated)</Label>
                <Input
                  placeholder="purchase_order:approve, purchase_order:manage"
                  value={form.approverPermissions}
                  onChange={(e) => setForm((f) => ({ ...f, approverPermissions: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button disabled={create.isPending} onClick={() => create.mutate()}>Create Policy</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {list.isLoading && <Skeleton className="h-48 w-full" />}

      {list.data && list.data.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 p-12 text-center">
            <p className="text-sm text-muted-foreground">No approval policies configured.</p>
            <p className="text-xs text-muted-foreground">
              Features without a policy are auto-approved. Add a policy to gate them behind approval.
            </p>
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add your first policy
            </Button>
          </CardContent>
        </Card>
      )}

      {list.data && list.data.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Feature</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Min Amount</th>
                  <th className="px-4 py-3 font-medium">Approvals</th>
                  <th className="px-4 py-3 font-medium">Active</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">
                      {ENTITY_TYPE_LABELS[p.entityType] ?? p.entityType}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.minAmount != null ? `≥ ${p.minAmount}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.requiredCount}
                      {p.approverPermissions && p.approverPermissions.length > 0 && (
                        <span className="ml-1 text-[10px] text-muted-foreground/60">
                          ({p.approverPermissions.join(', ')})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ id: p.id, isActive: !p.isActive })}
                        title={p.isActive ? 'Active — click to disable' : 'Inactive — click to enable'}
                      >
                        {p.isActive
                          ? <ToggleRight className="h-5 w-5 text-emerald-500" />
                          : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                      </Button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (confirm('Delete this policy?')) remove.mutate(p.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}