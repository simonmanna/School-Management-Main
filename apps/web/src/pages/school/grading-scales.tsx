import { useState } from 'react';
import { Link } from 'react-router-dom';
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
import { ConfirmButton } from './_components/confirm-button';

const emptyBand = (): GradingBand => ({ min: 0, max: 100, grade: '', gpa: 0, remark: '' });

/** A new band starts above the current top band, so adding one is never instantly invalid. */
const nextBand = (bands: GradingBand[]): GradingBand => {
  if (!bands.length) return emptyBand();
  const top = Math.max(...bands.map((b) => b.min));
  return { min: Math.min(top + 10, 100), max: 100, grade: '', gpa: 0, remark: '' };
};

export function SchoolGradingScalePage() {
  const { data: scales, isLoading } = useGradingScales();
  const create = useCreateGradingScale();
  const update = useUpdateGradingScale();
  const remove = useDeleteGradingScale();

  const [editing, setEditing] = useState<GradingScale | null>(null);
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [bands, setBands] = useState<GradingBand[]>([]);
  const [system, setSystem] = useState('');
  const [bandRounding, setBandRounding] = useState<'none' | 'half_up_integer'>('none');

  const startNew = () => { setEditing(null); setName(''); setIsDefault(false); setBands([emptyBand()]); setSystem(''); setBandRounding('none'); };
  const startEdit = (s: GradingScale) => {
    setEditing(s); setName(s.name); setIsDefault(s.isDefault); setBands(s.bands?.length ? [...s.bands] : [emptyBand()]);
    setSystem(s.system ?? ''); setBandRounding(s.bandRounding ?? 'none');
  };

  const setBand = (i: number, patch: Partial<GradingBand>) =>
    setBands((b) => b.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const save = async () => {
    if (!name) return notify.error('Name required');
    const payload = { name, bands, isDefault, bandRounding, ...(system ? { system } : {}) };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, dto: payload });
      else await create.mutateAsync(payload);
      notify.success('Grading scale saved');
      setEditing(null); setName(''); setBands([]);
    } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Save failed'); }
  };

  // The same rules the server applies (validateBands): a band is chosen by the
  // highest Min % not above the score, so bands only need distinct starting
  // points, a grade each, and a bottom band starting at 0. Max % is for
  // display; 70–80 followed by 80–100 is fine.
  const bandErrors = (() => {
    const errors: string[] = [];
    if (!bands.length) return ['Add at least one band.'];
    const mins = bands.map((b) => b.min);
    if (new Set(mins).size !== mins.length) errors.push('Two bands start at the same Min %.');
    if (bands.some((b) => !b.grade)) errors.push('Every band needs a grade.');
    if (Math.min(...mins) > 0) errors.push(`The lowest band starts at ${Math.min(...mins)}%, so lower scores would get no grade — start it at 0.`);
    return errors;
  })();
  const weightsValid = bandErrors.length === 0;
  const sortedMins = [...bands.map((b) => b.min)].sort((a, b) => a - b);
  const runsTo = (min: number) => {
    const next = sortedMins.find((m) => m > min);
    return next === undefined ? '100%' : `just under ${next}%`;
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Grading Scales</h1>
        <p className="text-sm text-muted-foreground">
          Grade bands (from–to %, grade, points) that turn a percentage into a grade. The default scale for each system is the one used.
          How much each kind of work counts is set in <Link to="/school/assessment" className="underline">Assessment Weighting</Link>.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Scales</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {(scales ?? []).length === 0 && !isLoading && (
              <p className="text-sm text-muted-foreground">No scales yet. Without a default scale for your system, results can't be given grades — create one with “New scale”.</p>
            )}
            {(scales ?? []).map((s: GradingScale) => (
              <div key={s.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <div>
                  <span className="font-medium">{s.name}</span>
                  {s.isDefault && <Badge className="ml-2">Default</Badge>}
                  <div className="text-xs text-muted-foreground">{s.bands?.length ?? 0} bands{s.system ? ` · ${s.system}` : ''}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => startEdit(s)}>Edit</Button>
                  <ConfirmButton
                    variant="ghost" destructive
                    title={`Delete “${s.name}”?`}
                    description={s.isDefault ? 'This is a default scale. Results for its system will have no grades until another scale is made the default.' : 'The scale and its bands will be removed.'}
                    confirmLabel="Delete"
                    onConfirm={async () => {
                      try { await remove.mutateAsync(s.id); notify.success('Scale deleted'); }
                      catch (e: any) { notify.error(e?.response?.data?.message ?? 'Could not delete the scale'); }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </ConfirmButton>
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="scale-system" className="text-xs">Used for</Label>
                  <select id="scale-system" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={system} onChange={(e) => setSystem(e.target.value)}>
                    <option value="">School's own scale (graded classes)</option>
                    <option value="PLE">PLE — primary</option>
                    <option value="UCE">UCE — O level</option>
                    <option value="UACE">UACE — A level</option>
                    <option value="CBC">CBC</option>
                    <option value="ECD">Nursery descriptors (ECD)</option>
                  </select>
                  <p className="text-xs text-muted-foreground">A scale is only ever used for its own system — nursery is never graded on a primary scale.</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="scale-rounding" className="text-xs">Before choosing a grade</Label>
                  <select id="scale-rounding" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={bandRounding} onChange={(e) => setBandRounding(e.target.value as typeof bandRounding)}>
                    <option value="none">Use the exact percentage (89.5 → band starting at 80)</option>
                    <option value="half_up_integer">Round to a whole percent first (89.5 → 90)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Bands — a score gets the band with the highest Min % at or below it. The lowest band must start at 0.</div>
                {bands.map((b, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2 rounded border p-2">
                    <div className="space-y-1"><Label className="text-xs">Min %</Label><Input type="number" className="w-20" value={b.min} onChange={(e) => setBand(i, { min: Number(e.target.value) })} /></div>
                    <div className="space-y-1"><Label className="text-xs">Max %</Label><Input type="number" className="w-20" value={b.max} onChange={(e) => setBand(i, { max: Number(e.target.value) })} /></div>
                    <div className="space-y-1"><Label className="text-xs">Grade</Label><Input className="w-16" value={b.grade} onChange={(e) => setBand(i, { grade: e.target.value })} placeholder="A" /></div>
                    <div className="space-y-1"><Label className="text-xs">GPA</Label><Input type="number" step="0.1" className="w-20" value={b.gpa} onChange={(e) => setBand(i, { gpa: Number(e.target.value) })} /></div>
                    <div className="space-y-1"><Label className="text-xs">Remark</Label><Input className="w-32" value={b.remark ?? ''} onChange={(e) => setBand(i, { remark: e.target.value })} placeholder="Distinction" /></div>
                    <p className="w-full text-xs text-muted-foreground">Scores from {b.min}% to {runsTo(b.min)} get {b.grade || 'this grade'}.</p>
                    <Button size="sm" variant="ghost" onClick={() => setBands((arr) => arr.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setBands((arr) => [...arr, nextBand(arr)])}><Plus className="h-4 w-4" /> Add band</Button>
              </div>

              {!weightsValid && <ul className="list-disc pl-4 text-xs text-rose-600">{bandErrors.map((e) => <li key={e}>{e}</li>)}</ul>}
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
