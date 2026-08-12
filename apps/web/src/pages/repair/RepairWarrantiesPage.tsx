import { useMemo, useState } from 'react';
import { ShieldCheck, Plus } from 'lucide-react';
import {
  useRepairWarranties, useCreateWarranty, useCreateWarrantyClaim,
} from '@/features/repair/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { date } from '@/lib/format';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'void', label: 'Void' },
];

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  expired: 'bg-muted text-muted-foreground',
  claimed: 'bg-amber-100 text-amber-800',
  void: 'bg-muted text-muted-foreground',
};

export function RepairWarrantiesPage() {
  const [status, setStatus] = useState('');
  const { data } = useRepairWarranties({ status: status || undefined, pageSize: 50 });
  const create = useCreateWarranty();
  const createClaim = useCreateWarrantyClaim();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    repairOrderId: '', warrantyType: 'repair_warranty', coverageStart: '', coverageEnd: '',
    coveredLabour: false, terms: '',
  });
  const [claimFor, setClaimFor] = useState<any | null>(null);
  const [claimForm, setClaimForm] = useState({ description: '', amount: '' });
  const [error, setError] = useState('');

  const rows = useMemo(() => data?.items ?? [], [data]);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError('');
    try {
      await create.mutateAsync({
        ...form,
        repairOrderId: form.repairOrderId || undefined,
        coverageStart: form.coverageStart ? new Date(form.coverageStart).toISOString() : undefined,
        coverageEnd: form.coverageEnd ? new Date(form.coverageEnd).toISOString() : undefined,
        coveredLabour: form.coveredLabour,
      });
      setShowForm(false);
      setForm({ repairOrderId: '', warrantyType: 'repair_warranty', coverageStart: '', coverageEnd: '', coveredLabour: false, terms: '' });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? String(e?.message ?? e));
    }
  };

  const submitClaim = async () => {
    setError('');
    try {
      await createClaim.mutateAsync({
        id: claimFor.id,
        dto: { description: claimForm.description, amount: claimForm.amount ? Number(claimForm.amount) : undefined },
      });
      setClaimFor(null);
      setClaimForm({ description: '', amount: '' });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? String(e?.message ?? e));
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Warranties</h1>
          <p className="text-sm text-muted-foreground">Repair warranty coverage and claims.</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}><Plus className="h-4 w-4" /> New warranty</Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">New warranty</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-4">
            <Input placeholder="Repair order ID" value={form.repairOrderId} onChange={(e) => set('repairOrderId', e.target.value)} />
            <select value={form.warrantyType} onChange={(e) => set('warrantyType', e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
              <option value="repair_warranty">Repair warranty</option>
              <option value="manufacturer">Manufacturer</option>
              <option value="extended">Extended</option>
            </select>
            <Input type="date" value={form.coverageStart} onChange={(e) => set('coverageStart', e.target.value)} />
            <Input type="date" value={form.coverageEnd} onChange={(e) => set('coverageEnd', e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.coveredLabour} onChange={(e) => setForm((f) => ({ ...f, coveredLabour: e.target.checked }))} />
              Covers labour
            </label>
            <Input className="sm:col-span-3" placeholder="Terms" value={form.terms} onChange={(e) => set('terms', e.target.value)} />
            <div className="flex items-end gap-2">
              <Button onClick={submit} disabled={create.isPending}>Save</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
            {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} warranties</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No warranties match the filter.</p>}
            {rows.map((w: any) => (
              <div key={w.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {w.order?.repairNumber ?? 'Warranty'} · {w.warrantyType.replace(/_/g, ' ')}
                      {w.coveredLabour ? ' · labour covered' : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {w.coverageStart ? date(w.coverageStart) : '—'} → {w.coverageEnd ? date(w.coverageEnd) : '—'}
                      {w.claims?.length ? ` · ${w.claims.length} claim(s)` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(w.status === 'active' || w.status === 'claimed') && (
                    <Button size="sm" variant="outline" onClick={() => setClaimFor(w)}>File claim</Button>
                  )}
                  <Badge variant="outline" className={STATUS_STYLES[w.status] ?? ''}>{w.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {claimFor && (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">File claim · {claimFor.order?.repairNumber ?? claimFor.id.slice(0, 8)}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
            <Input className="sm:col-span-2" placeholder="Claim description" value={claimForm.description} onChange={(e) => setClaimForm((f) => ({ ...f, description: e.target.value }))} />
            <Input type="number" placeholder="Amount (Rp)" value={claimForm.amount} onChange={(e) => setClaimForm((f) => ({ ...f, amount: e.target.value }))} />
            <div className="flex items-end gap-2">
              <Button onClick={submitClaim} disabled={createClaim.isPending}>File claim</Button>
              <Button variant="ghost" onClick={() => setClaimFor(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
