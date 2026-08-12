import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Scale, History, Play, Save, CheckCircle2, XCircle, Search, Plus, Trash2, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { dateTime } from '@/lib/format';
import { useProducts, type Product } from '@/features/products/api';
import {
  useBottleCounts, useStartBottleCount, useSaveBottleDraft, useSubmitBottleCount, useCancelBottleCount,
  type BottleCountSession,
} from '@/features/beverage/api';
import { bevConfigFromProduct, computeLine, type BevConfig, type Confidence } from '@/features/beverage/math';
import { useScale } from '@/features/beverage/use-scale';

interface Location { id: string; code: string; name: string }
type LineEdit = { sealed: string; readings: { g: string; bottleNumber: string }[]; reason: string };

const CONF_STYLES: Record<Confidence, string> = {
  GOOD: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  SUSPICIOUS: 'bg-amber-100 text-amber-700 border-amber-200',
  OUT_OF_RANGE: 'bg-red-100 text-red-700 border-red-200',
};
const VAR_COLOR: Record<Confidence, string> = {
  GOOD: 'text-emerald-600',
  SUSPICIOUS: 'text-amber-600',
  OUT_OF_RANGE: 'text-red-600',
};

const num = (v: string | number | null | undefined) => Number(v ?? 0);

export function BottleCountPage() {
  const [tab, setTab] = useState<'count' | 'history'>('count');
  const [locationId, setLocationId] = useState('');
  const [countType, setCountType] = useState<'opening' | 'closing'>('closing');
  const [session, setSession] = useState<BottleCountSession | null>(null);
  const [edits, setEdits] = useState<Record<string, LineEdit>>({});
  const [search, setSearch] = useState('');
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [approverEmail, setApproverEmail] = useState('');
  const [managerPin, setManagerPin] = useState('');

  const scale = useScale();
  const start = useStartBottleCount();
  const saveDraft = useSaveBottleDraft();
  const submit = useSubmitBottleCount();
  const cancel = useCancelBottleCount();

  const locations = useQuery<Location[]>({
    queryKey: ['inventory-locations'],
    queryFn: async () => (await api.get<{ data: Location[] }>('/inventory/locations')).data.data ?? [],
  });

  // Beverage product config (conversion factor, tare, pour, tolerance) for live math.
  const products = useProducts({ page: 1, pageSize: 500 });
  const cfgByProduct = useMemo(() => {
    const m = new Map<string, BevConfig>();
    for (const p of (products.data?.data ?? []) as Product[]) {
      if (p.measurementMethod === 'digital_weight') m.set(p.id, bevConfigFromProduct(p));
    }
    return m;
  }, [products.data]);

  const history = useBottleCounts(tab === 'history');

  const loadSession = (s: BottleCountSession) => {
    setSession(s);
    const e: Record<string, LineEdit> = {};
    for (const ln of s.lines) {
      e[ln.id] = {
        sealed: num(ln.sealedFullCount) ? String(num(ln.sealedFullCount)) : '',
        readings: (ln.readings ?? []).map((r) => ({ g: String(num(r.measuredWeightG)), bottleNumber: r.bottleNumber ?? '' })),
        reason: ln.reason ?? '',
      };
    }
    setEdits(e);
  };

  const onStart = () =>
    start.mutate(
      { locationId: locationId || undefined, countType },
      {
        onSuccess: (s) => { loadSession(s); notify.success(`Count ${s.countCode} ready — ${s.lines.length} bottles`); },
        onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Could not start count'),
      },
    );

  const setEdit = (id: string, patch: Partial<LineEdit>) =>
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { sealed: '', readings: [], reason: '' }), ...patch } }));

  const addReading = (id: string) => {
    const cur = edits[id] ?? { sealed: '', readings: [], reason: '' };
    setEdit(id, { readings: [...cur.readings, { g: '', bottleNumber: '' }] });
  };
  const removeReading = (id: string, idx: number) => {
    const cur = edits[id] ?? { sealed: '', readings: [], reason: '' };
    setEdit(id, { readings: cur.readings.filter((_, i) => i !== idx) });
  };
  const setReading = (id: string, idx: number, patch: Partial<{ g: string; bottleNumber: string }>) => {
    const cur = edits[id] ?? { sealed: '', readings: [], reason: '' };
    setEdit(id, { readings: cur.readings.map((r, i) => (i === idx ? { ...r, ...patch } : r)) });
  };

  // Derived per-line view (live variance from edits + product config).
  const rows = useMemo(() => {
    const lines = session?.lines ?? [];
    return lines.map((ln) => {
      const ed = edits[ln.id] ?? { sealed: '', readings: [], reason: '' };
      const cfg = cfgByProduct.get(ln.productId);
      const grams = ed.readings.map((r) => Number(r.g)).filter((g) => Number.isFinite(g) && g > 0);
      const c = computeLine(cfg, Number(ed.sealed) || 0, grams, num(ln.systemMl));
      return { ln, ed, cfg, ...c };
    });
  }, [session, edits, cfgByProduct]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(({ ln }) => !q || ln.productName.toLowerCase().includes(q));
  }, [rows, search]);

  const countedTotal = rows.filter((r) => r.countedMl !== null).length;
  const flagged = rows.filter((r) => r.countedMl !== null && r.confidence !== 'GOOD');
  const missingReasons = flagged.filter((r) => !r.ed.reason.trim()).length;

  const buildPayload = () => ({
    lines: (session?.lines ?? []).map((ln) => {
      const ed = edits[ln.id] ?? { sealed: '', readings: [], reason: '' };
      const readings = ed.readings
        .map((r) => ({ measuredWeightG: Number(r.g), bottleNumber: r.bottleNumber.trim() || undefined, measurementSource: scale.source }))
        .filter((r) => Number.isFinite(r.measuredWeightG) && r.measuredWeightG > 0);
      return { lineId: ln.id, sealedFullCount: Number(ed.sealed) || 0, readings, reason: ed.reason.trim() || undefined };
    }),
  });

  const doSave = () => {
    if (!session) return;
    saveDraft.mutate(
      { id: session.id, body: buildPayload() },
      { onSuccess: (s) => { loadSession(s); notify.success('Draft saved'); }, onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Save failed') },
    );
  };

  const doSubmit = (creds?: { approverEmail?: string; managerPin?: string }) => {
    if (!session) return;
    if (missingReasons > 0) { notify.error(`${missingReasons} flagged line(s) need a reason`); return; }
    const id = session.id;
    // Persist edits, then finalise (server recomputes + posts the variance adjustment).
    saveDraft.mutate(
      { id, body: buildPayload() },
      {
        onSuccess: () => submit.mutate(
          { id, body: creds },
          {
            onSuccess: (s) => {
              notify.success(s.adjustmentId ? 'Count submitted — stock adjusted' : 'Count submitted');
              setSession(null); setEdits({}); setApprovalOpen(false); setApproverEmail(''); setManagerPin('');
            },
            onError: (e: any) => {
              const msg = e?.response?.data?.message ?? 'Submit failed';
              if (/approval|approver/i.test(String(msg)) && !creds) { setApprovalOpen(true); return; }
              notify.error(msg);
            },
          },
        ),
        onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Save failed'),
      },
    );
  };

  const onSubmitClick = () => {
    if (flagged.length > 0) { setApprovalOpen(true); return; }
    doSubmit();
  };

  const busy = start.isPending || saveDraft.isPending || submit.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Scale className="h-6 w-6" /> Bottle Count
        </h1>
        <p className="text-sm text-muted-foreground">
          Weigh open bottles — the system converts grams → remaining ml, compares to sold, and posts only the variance as an audited adjustment.
        </p>
      </div>

      <div className="flex gap-1 border-b pb-2">
        <Button size="sm" variant={tab === 'count' ? 'default' : 'outline'} onClick={() => setTab('count')}>
          <Scale className="mr-1 h-3 w-3" /> Count
        </Button>
        <Button size="sm" variant={tab === 'history' ? 'default' : 'outline'} onClick={() => setTab('history')}>
          <History className="mr-1 h-3 w-3" /> History
        </Button>
      </div>

      {tab === 'count' && !session && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="text-sm font-medium">Location</label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger><SelectValue placeholder="Active warehouse (default)" /></SelectTrigger>
                  <SelectContent>
                    {locations.data?.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Count Type</label>
                <Select value={countType} onValueChange={(v) => setCountType(v as 'opening' | 'closing')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="opening">Opening (start of shift)</SelectItem>
                    <SelectItem value="closing">Closing (end of shift)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button className="w-full" disabled={start.isPending} onClick={onStart}>
                  <Play className="mr-2 h-4 w-4" />
                  {start.isPending ? 'Starting…' : 'Start / Resume Count'}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Only digital-weight (bar alcohol) products are counted. Leave location blank to use the active warehouse (where POS sales deduct stock).
            </p>
          </CardContent>
        </Card>
      )}

      {tab === 'count' && session && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-medium truncate max-w-[280px]">{session.name ?? session.countCode}</span>
              <Badge variant="outline" className="shrink-0">{session.countCode}</Badge>
              <span className="text-sm text-muted-foreground">
                {countedTotal} of {rows.length} weighed · {flagged.length} flagged
              </span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => session && cancel.mutate(session.id, { onSuccess: () => { setSession(null); setEdits({}); notify.success('Count cancelled'); } })}>
                <XCircle className="mr-1 h-4 w-4" /> Cancel
              </Button>
              <Button size="sm" variant="outline" onClick={doSave} disabled={busy}>
                <Save className="mr-1 h-4 w-4" /> {saveDraft.isPending ? 'Saving…' : 'Save Draft'}
              </Button>
              <Button size="sm" onClick={onSubmitClick} disabled={busy || countedTotal === 0}>
                <CheckCircle2 className="mr-1 h-4 w-4" /> {submit.isPending ? 'Submitting…' : 'Submit Count'}
              </Button>
            </div>
          </div>

          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search bottle…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="space-y-2">
            {filtered.map(({ ln, ed, cfg, countedMl, varianceMl, varianceG, confidence, remainings }) => {
              const counted = countedMl !== null;
              const needReason = counted && confidence !== 'GOOD' && !ed.reason.trim();
              return (
                <Card key={ln.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[160px]">
                        <div className="font-medium">{ln.productName}</div>
                        <div className="text-xs text-muted-foreground">
                          System {num(ln.systemMl).toFixed(0)} ml
                          {cfg ? ` · pour ${cfg.standardPourMl || '—'} ml · tol ±${cfg.toleranceG} g` : ' · not configured'}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="text-center">
                          <div className="text-[11px] text-muted-foreground">Counted</div>
                          <div className="font-mono font-semibold">{counted ? `${countedMl!.toFixed(0)} ml` : '—'}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[11px] text-muted-foreground">Variance</div>
                          <div className={`font-mono font-semibold ${counted ? VAR_COLOR[confidence] : 'text-muted-foreground'}`}>
                            {counted ? `${varianceG > 0 ? '+' : ''}${varianceG.toFixed(1)} g` : '—'}
                          </div>
                          {counted && <div className={`text-[11px] ${VAR_COLOR[confidence]}`}>{varianceMl > 0 ? '+' : ''}{varianceMl.toFixed(0)} ml</div>}
                        </div>
                        {counted && (
                          <Badge variant="outline" className={CONF_STYLES[confidence]}>{confidence.replace('_', ' ').toLowerCase()}</Badge>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-[110px_1fr]">
                      <div>
                        <label className="text-xs text-muted-foreground">Sealed (full)</label>
                        <Input type="number" inputMode="numeric" min="0" className="h-9" placeholder="0" value={ed.sealed} onChange={(e) => setEdit(ln.id, { sealed: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Open bottles — weigh each (g)</label>
                        <div className="space-y-1.5">
                          {ed.readings.map((r, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <Input
                                type="number" inputMode="decimal" min="0"
                                className="h-9 w-32 text-right font-mono"
                                placeholder="grams"
                                value={r.g}
                                onChange={(e) => setReading(ln.id, i, { g: e.target.value })}
                              />
                              <span className="text-xs text-muted-foreground w-20 text-right">
                                {r.g && cfg ? `${remainings[i]?.toFixed(0) ?? 0} ml` : ''}
                              </span>
                              <Input
                                className="h-9 w-28"
                                placeholder="bottle #"
                                value={r.bottleNumber}
                                onChange={(e) => setReading(ln.id, i, { bottleNumber: e.target.value })}
                              />
                              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeReading(ln.id, i)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          <Button type="button" size="sm" variant="outline" onClick={() => addReading(ln.id)}>
                            <Plus className="mr-1 h-3 w-3" /> Add open bottle
                          </Button>
                        </div>
                      </div>
                    </div>

                    {counted && confidence !== 'GOOD' && (
                      <div className="mt-3">
                        <label className="text-xs text-muted-foreground">Reason (required)</label>
                        <Input
                          className={needReason ? 'border-destructive focus-visible:ring-destructive' : ''}
                          placeholder="Explain the variance…"
                          value={ed.reason}
                          onChange={(e) => setEdit(ln.id, { reason: e.target.value })}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {filtered.length === 0 && (
              <Card><CardContent className="p-8 text-center text-muted-foreground">No bottles match the filter</CardContent></Card>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-2">
          {history.isLoading && <Skeleton className="h-48 w-full" />}
          {history.data && history.data.length > 0 ? (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Bottles</th>
                    <th className="px-3 py-2 text-left">Started</th>
                    <th className="px-3 py-2 text-left">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((s) => (
                    <tr key={s.id} className="border-b hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono">{s.countCode}</td>
                      <td className="px-3 py-2">{s.countType === 'opening' ? 'Opening' : 'Closing'}</td>
                      <td className="px-3 py-2">
                        <Badge variant={s.status === 'submitted' ? 'default' : s.status === 'cancelled' ? 'destructive' : 'outline'}>{s.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">{s._count?.lines ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{dateTime(s.startedAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{s.submittedAt ? dateTime(s.submittedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            !history.isLoading && <Card><CardContent className="p-8 text-center text-muted-foreground">No bottle counts yet</CardContent></Card>
          )}
        </div>
      )}

      {/* Manager approval — required when a line is over tolerance or impossible. */}
      <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Manager approval</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">
              This count has {flagged.length} flagged line(s) over tolerance. A manager (not the person who counted) must approve.
            </p>
            <div>
              <label className="text-sm font-medium">Manager email</label>
              <Input type="email" value={approverEmail} onChange={(e) => setApproverEmail(e.target.value)} placeholder="manager@bar.com" />
            </div>
            <div>
              <label className="text-sm font-medium">Manager PIN <span className="text-muted-foreground font-normal">(if set)</span></label>
              <Input type="password" value={managerPin} onChange={(e) => setManagerPin(e.target.value)} placeholder="••••" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setApprovalOpen(false)}>Cancel</Button>
              <Button
                disabled={!approverEmail.trim() || busy}
                onClick={() => doSubmit({ approverEmail: approverEmail.trim(), managerPin: managerPin.trim() || undefined })}
              >
                <CheckCircle2 className="mr-1 h-4 w-4" /> Approve & Submit
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
