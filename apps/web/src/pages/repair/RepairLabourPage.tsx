import { useState } from 'react';
import { Plus, Timer } from 'lucide-react';
import {
  useRepairLabourTypes, useCreateLabourType, useUpdateLabourType, useDeleteLabourType,
} from '@/features/repair/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function RepairLabourPage() {
  const { data } = useRepairLabourTypes();
  const create = useCreateLabourType();
  const update = useUpdateLabourType();
  const del = useDeleteLabourType();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ code: '', name: '', description: '', price: '', durationMinutes: '', productId: '' });
  const [error, setError] = useState('');

  const rows = Array.isArray(data) ? data : (data as any)?.items ?? [];
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => {
    setEditing(null);
    setForm({ code: '', name: '', description: '', price: '', durationMinutes: '', productId: '' });
    setShowForm(true);
  };

  const openEdit = (t: any) => {
    setEditing(t);
    setForm({
      code: t.code, name: t.name, description: t.description ?? '',
      price: String(t.price ?? ''), durationMinutes: String(t.durationMinutes ?? ''),
      productId: t.productId ?? '',
    });
    setShowForm(true);
  };

  const submit = async () => {
    setError('');
    const dto = {
      ...form,
      price: form.price ? Number(form.price) : undefined,
      durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : undefined,
      productId: form.productId || undefined,
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, dto });
      else await create.mutateAsync(dto);
      setShowForm(false);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? String(e?.message ?? e));
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Labour Catalog</h1>
          <p className="text-sm text-muted-foreground">Standard labour charges used on repair quotations.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> New labour type</Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">{editing ? `Edit ${editing.name}` : 'New labour type'}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-4">
            <Input placeholder="Code (LBR-DIAG)" value={form.code} onChange={(e) => set('code', e.target.value)} />
            <Input placeholder="Name (Diagnostic check)" value={form.name} onChange={(e) => set('name', e.target.value)} />
            <Input type="number" placeholder="Price (Rp)" value={form.price} onChange={(e) => set('price', e.target.value)} />
            <Input type="number" placeholder="Duration (min)" value={form.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)} />
            <Input className="sm:col-span-2" placeholder="Billing product ID (service product)" value={form.productId} onChange={(e) => set('productId', e.target.value)} />
            <Input className="sm:col-span-2" placeholder="Description" value={form.description} onChange={(e) => set('description', e.target.value)} />
            <div className="flex items-end gap-2">
              <Button onClick={submit} disabled={create.isPending || update.isPending}>Save</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
            {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} labour types</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No labour types yet.</p>}
            {rows.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <Timer className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{t.name} <span className="text-xs text-muted-foreground">· {t.code}</span></p>
                    <p className="text-xs text-muted-foreground">
                      {t.description ?? ''} {t.durationMinutes ? `· ${t.durationMinutes} min` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Rp {Number(t.price ?? 0).toLocaleString('id-ID')}</span>
                  <Button size="sm" variant="outline" onClick={() => openEdit(t)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => del.mutateAsync(t.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
