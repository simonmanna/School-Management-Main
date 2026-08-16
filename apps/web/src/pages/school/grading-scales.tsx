import { useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import {
  useGradingScales, useCreateGradingScale, useUpdateGradingScale, useDeleteGradingScale,
  type GradingBand, type GradingScale,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { notify } from '@/lib/notify';

const emptyBand = (): GradingBand => ({ min: 0, max: 100, grade: '', gpa: 0, remark: '' });

export function SchoolGradingScalePage() {
  const { data: scales, isLoading } = useGradingScales();
  const create = useCreateGradingScale();
  const update = useUpdateGradingScale();
  const remove = useDeleteGradingScale();

  const [editing, setEditing] = useState<GradingScale | null>(null);
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [bands, setBands] = useState<GradingBand[]>([]);

  const startNew = () => { setEditing(null); setName(''); setIsDefault(false); setBands([emptyBand()]); };
  const startEdit = (s: GradingScale) => { setEditing(s); setName(s.name); setIsDefault(s.isDefault); setBands(s.bands?.length ? [...s.bands] : [emptyBand()]); };

  const setBand = (i: number, patch: Partial<GradingBand>) =>
    setBands((b) => b.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const save = async () => {
    if (!name) return notify.error('Name required');
    const payload = { name, bands, isDefault };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, dto: payload });
      else await create.mutateAsync(payload);
      notify.success('Grading scale saved');
      setEditing(null); setName(''); setBands([]);
    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Save failed'); }
  };

  const weightsValid = (() => {
    const sorted = [...bands].sort((a, b) => b.min - a.min);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].min <= sorted[i + 1].max) return false; // overlap / non-contiguous
    }
    return bands.length > 0 && bands.every((b) => b.grade);
  })();

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Grading Scales & Boundaries</h1>
        <p className="text-sm text-muted-foreground">Define grade bands (min–max %, letter, GPA). The default scale drives grade computation.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Scales</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {(scales ?? []).length === 0 && !isLoading && <p className="text-sm text-muted-foreground">No scales yet.</p>}
            {(scales ?? []).map((s: GradingScale) => (
              <div key={s.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <div>
                  <span className="font-medium">{s.name}</span>
                  {s.isDefault && <Badge className="ml-2">default</Badge>}
                  <div className="text-xs text-muted-foreground">{s.bands?.length ?? 0} bands</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => startEdit(s)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(s.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={startNew}><Plus className="h-4 w-4" /> New scale</Button>
          </CardContent>
        </Card>

        {editing !== null || name !== '' || bands.length > 0 ? (
          <Card>
            <CardHeader><CardTitle className="text-base">{editing ? 'Edit scale' : 'New scale'}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1"><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Uganda UCE 2024" /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Set as default scale</label>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Bands (sort by min %, no overlaps)</div>
                {bands.map((b, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2 rounded border p-2">
                    <div className="space-y-1"><Label className="text-xs">Min %</Label><Input type="number" className="w-20" value={b.min} onChange={(e) => setBand(i, { min: Number(e.target.value) })} /></div>
                    <div className="space-y-1"><Label className="text-xs">Max %</Label><Input type="number" className="w-20" value={b.max} onChange={(e) => setBand(i, { max: Number(e.target.value) })} /></div>
                    <div className="space-y-1"><Label className="text-xs">Grade</Label><Input className="w-16" value={b.grade} onChange={(e) => setBand(i, { grade: e.target.value })} placeholder="A" /></div>
                    <div className="space-y-1"><Label className="text-xs">GPA</Label><Input type="number" step="0.1" className="w-20" value={b.gpa} onChange={(e) => setBand(i, { gpa: Number(e.target.value) })} /></div>
                    <div className="space-y-1"><Label className="text-xs">Remark</Label><Input className="w-32" value={b.remark ?? ''} onChange={(e) => setBand(i, { remark: e.target.value })} placeholder="Distinction" /></div>
                    <Button size="sm" variant="ghost" onClick={() => setBands((arr) => arr.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setBands((arr) => [...arr, emptyBand()])}><Plus className="h-4 w-4" /> Add band</Button>
              </div>

              {!weightsValid && <p className="text-xs text-rose-600">Bands must have grades and non-overlapping ranges.</p>}
              <div className="flex gap-2">
                <Button size="sm" disabled={!weightsValid || create.isPending || update.isPending} onClick={save}><Save className="h-4 w-4" /> Save</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setName(''); setBands([]); }}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
