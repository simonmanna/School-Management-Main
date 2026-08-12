import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeftRight, SearchCheck } from 'lucide-react';
import { useRentalReturns, useCreateReturn, useInspectReturn, useSettleReturn, useRentalAgreements } from '@/features/rental/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { date } from '@/lib/format';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

export function RentalReturnsPage() {
  const { data } = useRentalReturns({ pageSize: 50 });
  const { data: agreementsData } = useRentalAgreements({ status: 'checked_out', pageSize: 100 });
  const createReturn = useCreateReturn();
  const inspectReturn = useInspectReturn();
  const settleReturn = useSettleReturn();

  const [createOpen, setCreateOpen] = useState(false);
  const [agreementId, setAgreementId] = useState('');
  const [lineChecks, setLineChecks] = useState<Record<string, { qty: string; missing: string; grade: string }>>({});
  const [damages, setDamages] = useState<Record<string, { damageType: string; charge: string }>>({});

  const rows = useMemo(() => data?.items ?? [], [data]);
  const openAgreements = agreementsData?.items ?? [];

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.success(msg);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? msg + ' failed');
    }
  };

  const selectedAgreement = openAgreements.find((a) => a.id === agreementId);

  const openCreate = (agreementIdToUse: string) => {
    setAgreementId(agreementIdToUse);
    setCreateOpen(true);
    setLineChecks({});
    setDamages({});
  };

  const inspectAll = (returnId: string) => {
    // Build inspect payload from the entered grades/damages.
    const items = Object.entries(lineChecks).map(([returnLineId, v]) => ({
      returnLineId,
      conditionGrade: v.grade || undefined,
      damages: damages[returnLineId]?.damageType
        ? [{ damageType: damages[returnLineId].damageType, chargeAmount: Number(damages[returnLineId].charge || 0) }]
        : [],
    }));
    run(
      () => inspectReturn.mutateAsync({ returnId, items }),
      'Inspection recorded',
    );
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Returns & Settlement</h1>
          <p className="text-sm text-muted-foreground">Receive units back, inspect condition, charge damages, settle.</p>
        </div>
        <Button onClick={() => setCreateOpen((v) => !v)}><ArrowLeftRight className="h-4 w-4" /> New return</Button>
      </div>

      {createOpen && (
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg">
            <CardTitle className="text-sm">Create return</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <select
              value={agreementId}
              onChange={(e) => openCreate(e.target.value)}
              className="w-full rounded-md border bg-card px-3 py-2 text-sm"
            >
              <option value="">Select a checked-out agreement…</option>
              {openAgreements.map((a) => (
                <option key={a.id} value={a.id}>{a.agreementNumber} · {a.lines?.length ?? 0} line(s)</option>
              ))}
            </select>

            {selectedAgreement && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lines — set returned qty / missing / condition</p>
                {(selectedAgreement.lines ?? []).map((l) => {
                  const state = lineChecks[l.id] ?? { qty: String(l.quantity), missing: '0', grade: 'good' };
                  return (
                    <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{l.product?.name ?? l.productId.slice(0, 8)}</p>
                        <p className="text-xs text-muted-foreground">qty {l.quantity} · {l.ratePeriod}</p>
                      </div>
                      <input
                        type="number"
                        className="w-16 rounded border px-2 py-1 text-sm"
                        value={state.qty}
                        onChange={(e) => setLineChecks((m) => ({ ...m, [l.id]: { ...state, qty: e.target.value } }))}
                      />
                      <input
                        type="number"
                        className="w-16 rounded border px-2 py-1 text-sm"
                        placeholder="missing"
                        value={state.missing}
                        onChange={(e) => setLineChecks((m) => ({ ...m, [l.id]: { ...state, missing: e.target.value } }))}
                      />
                      <select
                        className="rounded border px-2 py-1 text-sm"
                        value={state.grade}
                        onChange={(e) => setLineChecks((m) => ({ ...m, [l.id]: { ...state, grade: e.target.value } }))}
                      >
                        <option value="good">good</option>
                        <option value="fair">fair</option>
                        <option value="poor">poor</option>
                        <option value="damaged">damaged</option>
                      </select>
                      <input
                        className="w-20 rounded border px-2 py-1 text-sm"
                        placeholder="damage type"
                        value={damages[l.id]?.damageType ?? ''}
                        onChange={(e) => setDamages((m) => ({ ...m, [l.id]: { damageType: e.target.value, charge: damages[l.id]?.charge ?? '' } }))}
                      />
                      <input
                        type="number"
                        className="w-24 rounded border px-2 py-1 text-sm"
                        placeholder="charge"
                        value={damages[l.id]?.charge ?? ''}
                        onChange={(e) => setDamages((m) => ({ ...m, [l.id]: { damageType: damages[l.id]?.damageType ?? '', charge: e.target.value } }))}
                      />
                    </div>
                  );
                })}
                <Button
                  size="sm"
                  onClick={() => run(
                    () => createReturn.mutateAsync({
                      agreementId,
                      items: (selectedAgreement.lines ?? []).map((l) => {
                        const s = lineChecks[l.id] ?? { qty: String(l.quantity), missing: '0', grade: 'good' };
                        return {
                          agreementLineId: l.id,
                          quantity: Number(s.qty || 0),
                          quantityMissing: Number(s.missing || 0),
                          conditionGrade: s.grade,
                        };
                      }),
                    }),
                    'Return created',
                  )}
                >
                  Create return
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} returns</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No returns yet.</p>}
            {rows.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{r.returnNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.agreement?.agreementNumber ?? r.agreementId.slice(0, 8)} · received {date(r.receivedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => inspectAll(r.id)}>
                      <SearchCheck className="h-4 w-4" /> Inspect
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => run(() => settleReturn.mutateAsync({ returnId: r.id }), 'Settled')}
                    >
                      Settle
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {r.lines.map((l) => (
                    <div key={l.id} className="rounded-md border bg-muted/20 px-2 py-1.5 text-xs">
                      <p className="font-medium">{l.quantityMissing > 0 ? `${l.quantityMissing} missing` : `${l.quantity} returned`}</p>
                      <p className="text-muted-foreground">
                        {l.isMissing ? 'MISSING' : l.damages.length > 0 ? `damaged ${fmt(l.damages.reduce((s, d) => s + Number(d.chargeAmount), 0))}` : l.conditionGrade ?? 'ok'}
                        {l.lateDays > 0 ? ` · ${l.lateDays}d late` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
