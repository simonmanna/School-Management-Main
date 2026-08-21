import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import {
  useFeeCategories,
  useCreateFeeCategory,
  useUpdateFeeCategory,
  useDeleteFeeCategory,
  type FeeCategory,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { sel } from './fees-shared';

type Draft = {
  code: string;
  name: string;
  type: 'mandatory' | 'optional';
  description: string;
  paymentOrder: number;
  isActive: boolean;
};

const emptyDraft: Draft = { code: '', name: '', type: 'mandatory', description: '', paymentOrder: 0, isActive: true };

export function SchoolFeeCategoriesPage() {
  const { data: cats } = useFeeCategories();
  const createCat = useCreateFeeCategory();
  const updateCat = useUpdateFeeCategory();
  const deleteCat = useDeleteFeeCategory();

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const reset = () => {
    setDraft(emptyDraft);
    setEditingId(null);
  };

  const save = async () => {
    try {
      const payload = {
        code: draft.code.trim().toUpperCase(),
        name: draft.name.trim(),
        type: draft.type,
        description: draft.description.trim() || undefined,
        paymentOrder: Number(draft.paymentOrder) || 0,
        isActive: draft.isActive,
      };
      if (!payload.code || !payload.name) {
        notify.error('Code and name are required');
        return;
      }
      if (editingId) {
        await updateCat.mutateAsync({ id: editingId, ...payload });
        notify.success('Fee category updated');
      } else {
        await createCat.mutateAsync(payload);
        notify.success('Fee category created');
      }
      reset();
    } catch {
      notify.error('Could not save fee category');
    }
  };

  const edit = (c: FeeCategory) => {
    setEditingId(c.id);
    setDraft({
      code: c.code,
      name: c.name,
      type: c.type,
      description: c.description ?? '',
      paymentOrder: c.paymentOrder,
      isActive: c.isActive,
    });
  };

  const remove = async (c: FeeCategory) => {
    if (!confirm(`Delete fee category "${c.name}"?`)) return;
    try {
      await deleteCat.mutateAsync(c.id);
      notify.success('Fee category deleted');
      if (editingId === c.id) reset();
    } catch {
      notify.error('Could not delete fee category');
    }
  };

  const list = (cats?.data ?? []).sort((a, b) => a.paymentOrder - b.paymentOrder);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Fee Categories</h1>
        <p className="text-sm text-muted-foreground">
          Reusable fee types referenced by fee structures. Mandatory categories bill every student in scope; optional
          categories (e.g. Swimming) are billed per-student.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{editingId ? 'Edit fee category' : 'New fee category'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Code</Label>
                <Input
                  value={draft.code}
                  onChange={(e) => set({ code: e.target.value.toUpperCase() })}
                  placeholder="TUITION"
                  disabled={!!editingId}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="School Fees" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <select className={sel} value={draft.type} onChange={(e) => set({ type: e.target.value as 'mandatory' | 'optional' })}>
                  <option value="mandatory">Mandatory</option>
                  <option value="optional">Optional</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Payment order</Label>
                <Input type="number" value={draft.paymentOrder} onChange={(e) => set({ paymentOrder: Number(e.target.value) })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Optional notes" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
              Active
            </label>
            <div className="flex gap-2">
              <Button onClick={save} disabled={createCat.isPending || updateCat.isPending}>
                <Plus className="h-4 w-4" /> {editingId ? 'Update' : 'Create'}
              </Button>
              {editingId && (
                <Button variant="ghost" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Categories</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {list.length === 0 && <p className="text-sm text-muted-foreground">No fee categories yet.</p>}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-muted-foreground">{c.paymentOrder}</TableCell>
                    <TableCell className="font-medium">{c.code}</TableCell>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>
                      <Badge variant={c.type === 'mandatory' ? 'default' : 'secondary'}>{c.type}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => edit(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(c)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
