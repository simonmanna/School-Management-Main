import { useState } from 'react';
import { Plus, Pencil, Trash2, Save } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { notify } from '@/lib/notify';
import {
  useUoms, useUomCategories, useSaveUom, useSaveUomCategory, useDeleteUom, useDeleteUomCategory,
  type Uom, type UomCategory,
} from '@/features/uom/api';

const UOM_TYPES = ['smaller', 'reference', 'bigger'];

export function UomPage() {
  const { data: units = [], isLoading: unitsLoading } = useUoms();
  const { data: categories = [] } = useUomCategories();
  const saveUom = useSaveUom();
  const saveCat = useSaveUomCategory();
  const delUom = useDeleteUom();
  const delCat = useDeleteUomCategory();

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '—';

  // ---- Category dialog ----
  const [catOpen, setCatOpen] = useState(false);
  const [catEdit, setCatEdit] = useState<UomCategory | null>(null);
  const [catForm, setCatForm] = useState({ name: '', referenceUomId: '', isActive: true });
  const openCat = (c?: UomCategory) => {
    setCatEdit(c ?? null);
    setCatForm({ name: c?.name ?? '', referenceUomId: c?.referenceUomId ?? '', isActive: c?.isActive ?? true });
    setCatOpen(true);
  };
  const submitCat = async () => {
    if (!catForm.name.trim()) return notify.error('Name is required');
    await saveCat.mutateAsync({
      id: catEdit?.id,
      data: { name: catForm.name, referenceUomId: catForm.referenceUomId || undefined, isActive: catForm.isActive },
    });
    notify.success(catEdit ? 'Category updated' : 'Category created');
    setCatOpen(false);
  };

  // ---- Unit dialog ----
  const [uomOpen, setUomOpen] = useState(false);
  const [uomEdit, setUomEdit] = useState<Uom | null>(null);
  const [uomForm, setUomForm] = useState({
    code: '', name: '', symbol: '', categoryId: '', factor: '1', roundingPrecision: '0.001',
    uomType: 'reference', isBase: false, isActive: true,
  });
  const openUom = (u?: Uom) => {
    setUomEdit(u ?? null);
    setUomForm({
      code: u?.code ?? '', name: u?.name ?? '', symbol: u?.symbol ?? '', categoryId: u?.categoryId ?? '',
      factor: u?.factor ?? '1', roundingPrecision: u?.roundingPrecision ?? '0.001',
      uomType: u?.uomType ?? 'reference', isBase: u?.isBase ?? false, isActive: u?.isActive ?? true,
    });
    setUomOpen(true);
  };
  const submitUom = async () => {
    if (!uomForm.code.trim() || !uomForm.name.trim()) return notify.error('Code and name are required');
    await saveUom.mutateAsync({
      id: uomEdit?.id,
      data: {
        ...(uomEdit ? {} : { code: uomForm.code }),
        name: uomForm.name,
        symbol: uomForm.symbol || undefined,
        categoryId: uomForm.categoryId || undefined,
        factor: Number(uomForm.factor) || 1,
        roundingPrecision: Number(uomForm.roundingPrecision) || 0.000001,
        uomType: uomForm.uomType,
        isBase: uomForm.isBase,
        isActive: uomForm.isActive,
      },
    });
    notify.success(uomEdit ? 'Unit updated' : 'Unit created');
    setUomOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="border-l-4 border-[#3b82f6] pl-4">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Units of Measure</h1>
        <p className="text-sm text-gray-500">Categories convert within themselves via a factor against the reference unit.</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Categories</CardTitle>
            <CardDescription>Units only convert within the same category.</CardDescription>
          </div>
          <Button size="sm" onClick={() => openCat()}><Plus className="h-4 w-4" /> Category</Button>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground border-b">
              <th className="py-2">Name</th><th>Reference unit</th><th>Active</th><th></th>
            </tr></thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="py-2 font-medium">{c.name}</td>
                  <td>{units.find((u) => u.id === c.referenceUomId)?.code ?? '—'}</td>
                  <td><Badge variant={c.isActive ? 'default' : 'secondary'}>{c.isActive ? 'Yes' : 'No'}</Badge></td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openCat(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={async () => { await delCat.mutateAsync(c.id); notify.success('Deleted'); }}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                    </Button>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">No categories yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Units</CardTitle>
            <CardDescription>factor = base (reference) units per 1 of this unit.</CardDescription>
          </div>
          <Button size="sm" onClick={() => openUom()}><Plus className="h-4 w-4" /> Unit</Button>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground border-b">
              <th className="py-2">Code</th><th>Name</th><th>Symbol</th><th>Category</th>
              <th className="text-right">Factor</th><th className="text-right">Rounding</th><th>Base</th><th></th>
            </tr></thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id} className="border-b last:border-0">
                  <td className="py-2 font-mono">{u.code}</td>
                  <td>{u.name}</td>
                  <td className="text-muted-foreground">{u.symbol ?? '—'}</td>
                  <td>{catName(u.categoryId)}</td>
                  <td className="text-right font-mono">{u.factor}</td>
                  <td className="text-right font-mono">{u.roundingPrecision}</td>
                  <td>{u.isBase ? <Badge>ref</Badge> : ''}</td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openUom(u)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={async () => { await delUom.mutateAsync(u.id); notify.success('Deleted'); }}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                    </Button>
                  </td>
                </tr>
              ))}
              {unitsLoading && <tr><td colSpan={8} className="py-4 text-center text-muted-foreground">Loading…</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Category dialog */}
      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{catEdit ? 'Edit category' : 'New category'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} /></div>
            <div>
              <Label>Reference unit</Label>
              <Select value={catForm.referenceUomId} onValueChange={(v) => setCatForm({ ...catForm, referenceUomId: v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {units.filter((u) => !catEdit || u.categoryId === catEdit.id).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={catForm.isActive} onChange={(e) => setCatForm({ ...catForm, isActive: e.target.checked })} /> Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatOpen(false)}>Cancel</Button>
            <Button onClick={submitCat} disabled={saveCat.isPending}><Save className="h-4 w-4" /> Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unit dialog */}
      <Dialog open={uomOpen} onOpenChange={setUomOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{uomEdit ? 'Edit unit' : 'New unit'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Code</Label><Input value={uomForm.code} disabled={!!uomEdit} onChange={(e) => setUomForm({ ...uomForm, code: e.target.value })} /></div>
            <div><Label>Symbol</Label><Input value={uomForm.symbol} onChange={(e) => setUomForm({ ...uomForm, symbol: e.target.value })} /></div>
            <div className="col-span-2"><Label>Name</Label><Input value={uomForm.name} onChange={(e) => setUomForm({ ...uomForm, name: e.target.value })} /></div>
            <div className="col-span-2">
              <Label>Category</Label>
              <Select value={uomForm.categoryId} onValueChange={(v) => setUomForm({ ...uomForm, categoryId: v })}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Factor (base units / 1)</Label><Input type="number" step="any" value={uomForm.factor} onChange={(e) => setUomForm({ ...uomForm, factor: e.target.value })} /></div>
            <div><Label>Rounding step</Label><Input type="number" step="any" value={uomForm.roundingPrecision} onChange={(e) => setUomForm({ ...uomForm, roundingPrecision: e.target.value })} /></div>
            <div>
              <Label>Type</Label>
              <Select value={uomForm.uomType} onValueChange={(v) => setUomForm({ ...uomForm, uomType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UOM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={uomForm.isBase} onChange={(e) => setUomForm({ ...uomForm, isBase: e.target.checked })} /> Reference</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={uomForm.isActive} onChange={(e) => setUomForm({ ...uomForm, isActive: e.target.checked })} /> Active</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUomOpen(false)}>Cancel</Button>
            <Button onClick={submitUom} disabled={saveUom.isPending}><Save className="h-4 w-4" /> Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
