// KDS — Kitchen Stations admin. Configure the prep stations the KDS routes to.
import React, { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';
import { ChefHat, Plus, Star, Trash2, Pencil, ArrowUp, ArrowDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';
import {
  useKitchenStations, useCreateStation, useUpdateStation, useDeleteStation, useReorderStations,
  type KitchenStationFE,
} from './pos-features-api';

const EMPTY = { name: '', code: '', color: '#6366f1', icon: '' };

const KitchenStationsPage: React.FC = () => {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission(PERMISSIONS.pos.override);

  const { data: stations = [], isLoading } = useKitchenStations();
  const create = useCreateStation();
  const update = useUpdateStation();
  const del = useDeleteStation();
  const reorder = useReorderStations();

  const [editing, setEditing] = useState<KitchenStationFE | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);

  const openNew = () => { setEditing(null); setForm(EMPTY); setShowForm(true); };
  const openEdit = (s: KitchenStationFE) => {
    setEditing(s);
    setForm({ name: s.name, code: s.code, color: s.color ?? '#6366f1', icon: s.icon ?? '' });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim() || (!editing && !form.code.trim())) {
      notify.error('Name and code are required');
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, name: form.name, color: form.color, icon: form.icon || null });
        notify.success('Station updated');
      } else {
        await create.mutateAsync({ name: form.name, code: form.code.trim().toLowerCase(), color: form.color, icon: form.icon || undefined });
        notify.success('Station created');
      }
      setShowForm(false);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Save failed');
    }
  };

  const setDefault = async (s: KitchenStationFE) => {
    try { await update.mutateAsync({ id: s.id, isDefault: true }); notify.success(`${s.name} is now the default station`); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
  };

  const toggleActive = async (s: KitchenStationFE) => {
    try { await update.mutateAsync({ id: s.id, isActive: !s.isActive }); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Failed'); }
  };

  const remove = async (s: KitchenStationFE) => {
    if (!window.confirm(`Delete station "${s.name}"? Products routed here fall back to the default station.`)) return;
    try { await del.mutateAsync(s.id); notify.success('Station deleted'); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Delete failed'); }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const next = [...stations];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    await reorder.mutateAsync(next.map((s) => s.id));
  };

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold flex items-center gap-2">
          <ChefHat className="h-6 w-6" /> Kitchen Stations
        </h1>
        {canEdit && !showForm && (
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add Station</Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Stations are the screens the Kitchen Display routes orders to. Assign each product to a
        station on its edit page; the station <code>code</code> is the routing key and cannot change once created.
      </p>

      {showForm && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{editing ? `Edit ${editing.name}` : 'New station'}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}><X className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Grill" />
            </div>
            <div className="space-y-1.5">
              <Label>Code {editing && <span className="text-muted-foreground">(immutable)</span>}</Label>
              <Input value={form.code} disabled={!!editing}
                onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. grill" />
            </div>
            <div className="space-y-1.5">
              <Label>Colour</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="h-9 w-12 rounded border" />
                <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Icon (lucide name, optional)</Label>
              <Input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} placeholder="e.g. Pizza" />
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={save} disabled={create.isPending || update.isPending}>Save</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0 divide-y">
          {isLoading && <div className="p-4 text-muted-foreground">Loading…</div>}
          {!isLoading && stations.length === 0 && <div className="p-4 text-muted-foreground">No stations yet.</div>}
          {stations.map((s, idx) => (
            <div key={s.id} className="flex items-center gap-3 p-3">
              <span className="inline-block h-4 w-4 rounded-full border" style={{ background: s.color ?? '#999' }} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold flex items-center gap-2">
                  {s.name}
                  {s.isDefault && <Badge variant="secondary" className="gap-1"><Star className="h-3 w-3" /> default</Badge>}
                  {!s.isActive && <Badge variant="outline" className="text-muted-foreground">inactive</Badge>}
                </div>
                <div className="text-xs text-muted-foreground font-mono">{s.code}</div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => move(idx, -1)} disabled={idx === 0}><ArrowUp className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => move(idx, 1)} disabled={idx === stations.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                  {!s.isDefault && <Button variant="ghost" size="sm" onClick={() => setDefault(s)}>Set default</Button>}
                  <Button variant="ghost" size="sm" onClick={() => toggleActive(s)}>{s.isActive ? 'Disable' : 'Enable'}</Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(s)} disabled={s.isDefault}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default KitchenStationsPage;
