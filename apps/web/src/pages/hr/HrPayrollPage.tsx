import { useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import {
  useHrPayrollRuns, useHrPayrollRun, useHrPayrollPeriods, useCreateHrPayrollRun, useCalculateHrPayrollRun,
  useApproveHrPayrollRun, useReverseHrPayrollRun, useHrBankPayments, useGenerateHrBankPayment,
  useUpdateHrBankPaymentStatus, useReverseHrBankPayment,
} from '@/features/hr/api';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useMoneyFormatter } from '@/lib/format';


const PAYMENT_METHODS = ['BANK', 'MOBILE_MONEY', 'CASH', 'CHEQUE'] as const;

const BATCH_STATUS: Record<string, string> = {
  GENERATED: 'bg-cyan-100 text-cyan-800',
  SENT: 'bg-indigo-100 text-indigo-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-muted text-muted-foreground',
};

/** Surface the API's refusal (it explains what to do) instead of failing silently. */
const onError = (e: any) => toast.error(e?.response?.data?.message ?? 'Request failed');

const RUN_STATUS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  CALCULATED: 'bg-cyan-100 text-cyan-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PAID: 'bg-sky-100 text-sky-800',
  REVERSED: 'bg-amber-100 text-amber-800',
};

export function HrPayrollPage() {
  const fmt = useMoneyFormatter();
  const [periodId, setPeriodId] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<any>({});
  const { data } = useHrPayrollRuns({ periodId: periodId || undefined });
  const { data: periods } = useHrPayrollPeriods();
  const { data: detail } = useHrPayrollRun(detailId ?? undefined);
  const create = useCreateHrPayrollRun();
  const calculate = useCalculateHrPayrollRun();
  const approve = useApproveHrPayrollRun();
  const reverse = useReverseHrPayrollRun();
  const { data: batches } = useHrBankPayments({ runId: detailId ?? undefined });
  const generate = useGenerateHrBankPayment();
  const setBatchStatus = useUpdateHrBankPaymentStatus();
  const reverseBatch = useReverseHrBankPayment();
  const [batchMethod, setBatchMethod] = useState<(typeof PAYMENT_METHODS)[number]>('BANK');

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const periodRows = useMemo(() => periods?.rows ?? [], [periods]);
  const items = useMemo(() => detail?.items ?? [], [detail]);
  const batchRows = useMemo(() => (detailId ? batches?.rows ?? [] : []), [batches, detailId]);
  const employerCost = useMemo(
    () => items.reduce((s: number, i: any) => s + Number(i.employerPensionAmount ?? 0) + Number(i.employerSocialSecurityAmount ?? 0), 0),
    [items],
  );

  const doCreate = async () => {
    if (!createForm.periodId) return;
    await create.mutateAsync({ periodId: createForm.periodId });
    setCreateOpen(false);
    setCreateForm({});
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Payroll</h1>
          <p className="text-sm text-muted-foreground">Periods → runs → calculate → approve → post to GL → pay.</p>
        </div>
        <Button onClick={() => { setCreateForm({}); setCreateOpen(true); }}>New run</Button>
      </div>

      <div className="flex items-center gap-2">
        <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
          <option value="">All periods</option>
          {periodRows.map((p: any) => <option key={p.id} value={p.id}>{p.periodCode} ({p.startDate} → {p.endDate})</option>)}
        </select>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} payroll runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No payroll runs yet — create a run for an open period.</p>}
            {rows.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <button className="flex flex-1 items-center gap-3 text-left" onClick={() => setDetailId(r.id)}>
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{r.runNumber} · {r.period?.periodCode}</p>
                    <p className="text-xs text-muted-foreground">
                      Net {fmt(r.totalNet)} · {r._count?.items ?? 0} employees
                      {r.glPosted ? ' · GL posted' : ''}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  {r.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => calculate.mutate(r.id, { onError })}>Calculate</Button>}
                  {r.status === 'CALCULATED' && <Button size="sm" onClick={() => approve.mutate(r.id, { onError })}>Approve & post</Button>}
                  {(r.status === 'APPROVED' || r.status === 'PAID') && (
                    <Button
                      size="sm" variant="outline"
                      onClick={() => {
                        const reason = prompt('Reverse this run and void its GL entry? Reason:');
                        if (reason) reverse.mutate({ id: r.id, dto: { reason } }, { onError });
                      }}
                    >
                      Reverse
                    </Button>
                  )}
                  <Badge variant="outline" className={RUN_STATUS[r.status] ?? ''}>{r.status.replace(/_/g, ' ')}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Create run dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New payroll run</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Period *</Label>
              <select value={createForm.periodId ?? ''} onChange={(e) => setCreateForm({ ...createForm, periodId: e.target.value })}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select period…</option>
                {periodRows.filter((p: any) => p.status === 'OPEN').map((p: any) => (
                  <option key={p.id} value={p.id}>{p.periodCode} ({p.startDate} → {p.endDate})</option>
                ))}
              </select>
            </div>
            <Button onClick={doCreate} disabled={create.isPending}>Create run</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Run detail dialog */}
      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{detail?.runNumber} · {detail?.period?.periodCode}</DialogTitle></DialogHeader>

          <div className="flex items-center gap-2">
            {detail?.status === 'DRAFT' && <Button size="sm" onClick={() => calculate.mutate(detail.id, { onError })}>Calculate</Button>}
            {detail?.status === 'CALCULATED' && (
              <>
                <Button size="sm" variant="outline" onClick={() => calculate.mutate(detail.id, { onError })}>Recalculate</Button>
                <Button size="sm" onClick={() => approve.mutate(detail.id, { onError })}>Approve & post</Button>
              </>
            )}
            <Badge variant="outline" className={RUN_STATUS[detail?.status ?? ''] ?? ''}>{detail?.status?.replace(/_/g, ' ')}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            {[['Gross', detail?.totalGross], ['Deductions', detail?.totalDeductions], ['Net', detail?.totalNet], ['Employer contrib.', employerCost]].map(([label, val]) => (
              <div key={String(label)} className="rounded-md bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-sm font-semibold">{fmt(Number(val ?? 0))}</p>
              </div>
            ))}
          </div>

          {(detail?.status === 'APPROVED' || detail?.status === 'PAID') && (
            <div className="rounded-md border">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 border-b px-3 py-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment batches</span>
                {detail?.status === 'APPROVED' && !batchRows.some((b: any) => ['DRAFT', 'GENERATED', 'SENT'].includes(b.status)) && (
                  <div className="flex items-center gap-2">
                    <select value={batchMethod} onChange={(e) => setBatchMethod(e.target.value as any)} className="rounded-md border bg-card px-2 py-1 text-xs">
                      {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                    </select>
                    <Button size="sm" variant="outline" disabled={generate.isPending}
                      onClick={() => generate.mutate({ runId: detail.id, method: batchMethod }, { onError })}>
                      Generate batch
                    </Button>
                  </div>
                )}
              </div>
              <div className="divide-y">
                {batchRows.length === 0 && <p className="p-3 text-sm text-muted-foreground">No payment batch yet. Net pay stays owed (net pay payable) until a batch is marked paid.</p>}
                {batchRows.map((b: any) => (
                  <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{b.paymentCode} · {b.method.replace('_', ' ')}</p>
                      <p className="text-xs text-muted-foreground">{fmt(b.totalAmount)} · {b._count?.lines ?? 0} payees</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.status === 'GENERATED' && (
                        <Button size="sm" variant="ghost" onClick={() => setBatchStatus.mutate({ id: b.id, dto: { status: 'SENT' } }, { onError })}>Mark sent</Button>
                      )}
                      {(b.status === 'GENERATED' || b.status === 'SENT') && (
                        <>
                          <Button size="sm" onClick={() => {
                            if (confirm(`Confirm the bank has paid ${b.paymentCode}? This posts the payment to the ledger.`))
                              setBatchStatus.mutate({ id: b.id, dto: { status: 'PAID' } }, { onError, onSuccess: () => toast.success('Payment posted') });
                          }}>Mark paid</Button>
                          <Button size="sm" variant="ghost" onClick={() => setBatchStatus.mutate({ id: b.id, dto: { status: 'CANCELLED' } }, { onError })}>Cancel</Button>
                        </>
                      )}
                      {b.status === 'PAID' && (
                        <Button size="sm" variant="outline" onClick={() => {
                          const reason = prompt('Reverse this payment (for example, the bank rejected the file)? Reason:');
                          if (reason) reverseBatch.mutate({ id: b.id, reason }, { onError });
                        }}>Reverse payment</Button>
                      )}
                      <Badge variant="outline" className={BATCH_STATUS[b.status] ?? ''}>{b.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-md border">
            <div className="bg-muted/30 border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Employee breakdown</div>
            <div className="divide-y">
              {items.length === 0 && <p className="p-4 text-sm text-muted-foreground">No items yet — run Calculate.</p>}
              {items.map((it: any) => (
                <div key={it.id} className="px-3 py-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{it.employee?.employeeCode} {it.employee?.firstName}{it.employee?.lastName ? ' ' + it.employee?.lastName : ''}</p>
                    <p className="text-sm font-semibold">{fmt(it.netPay)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Base {fmt(it.baseSalary)}{it.overtimeHours > 0 ? ` · OT ${it.overtimeHours}h` : ''}{it.absenceDays > 0 ? ` · absent ${it.absenceDays}d` : ''}
                    {' · '}tax {fmt(it.taxAmount)}{Number(it.pensionAmount) > 0 ? ` · pension ${fmt(it.pensionAmount)}` : ''}{Number(it.socialSecurityAmount) > 0 ? ` · SSF ${fmt(it.socialSecurityAmount)}` : ''}
                    {Number(it.localTaxAmount) > 0 ? ` · LST ${fmt(it.localTaxAmount)}` : ''}{Number(it.loanDeduction) > 0 ? ` · loan ${fmt(it.loanDeduction)}` : ''}{Number(it.advanceDeduction) > 0 ? ` · advance ${fmt(it.advanceDeduction)}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
