import { useMemo, useState } from 'react';
import { HandCoins } from 'lucide-react';
import {
  useHrAdvances, useCreateHrAdvance, useApproveHrAdvance, useMarkHrAdvancePaid, useRejectHrAdvance, useHrLoans,
  useCreateHrLoan, useDisburseHrLoan, useWriteOffHrLoan, useDeleteHrLoan, useHrEmployees,
} from '@/features/hr/api';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMoneyFormatter } from '@/lib/format';


const ADVANCE_STATUS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-cyan-100 text-cyan-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  SETTLED: 'bg-sky-100 text-sky-800',
  REJECTED: 'bg-muted text-muted-foreground',
};

const PAYMENT_METHODS = ['BANK', 'MOBILE_MONEY', 'CASH', 'CHEQUE'] as const;
const onError = (e: any) => toast.error(e?.response?.data?.message ?? 'Request failed');

const LOAN_STATUS: Record<string, string> = {
  ACTIVE: 'bg-amber-100 text-amber-800',
  PAID: 'bg-emerald-100 text-emerald-800',
  DEFAULTED: 'bg-rose-100 text-rose-800',
};

export function HrAdvancesLoansPage() {
  const fmt = useMoneyFormatter();
  const [tab, setTab] = useState('advances');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  // Money leaving the school posts to the ledger from this account type.
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('CASH');
  const { data: advances } = useHrAdvances();
  const { data: loans } = useHrLoans();
  const { data: empData } = useHrEmployees({ pageSize: 200 });
  const createA = useCreateHrAdvance();
  const approveA = useApproveHrAdvance();
  const payA = useMarkHrAdvancePaid();
  const rejectA = useRejectHrAdvance();
  const createL = useCreateHrLoan();
  const disburseL = useDisburseHrLoan();
  const writeOffL = useWriteOffHrLoan();
  const deleteL = useDeleteHrLoan();

  const advanceRows = useMemo(() => advances?.rows ?? [], [advances]);
  const loanRows = useMemo(() => loans?.rows ?? [], [loans]);
  const employees = useMemo(() => empData?.rows ?? [], [empData]);

  const openCreate = () => {
    setForm(tab === 'advances' ? { installmentMonths: 1 } : { interestRate: 0, disburseNow: true, disbursedAt: new Date().toISOString().slice(0, 10) });
    setOpen(true);
  };
  const submit = async () => {
    try {
      if (tab === 'advances') {
        if (!form.employeeId || !form.amount) return;
        await createA.mutateAsync({
          employeeId: form.employeeId,
          amount: Number(form.amount),
          installmentMonths: Number(form.installmentMonths || 1),
          notes: form.notes || undefined,
        });
      } else {
        if (!form.employeeId || !form.principal || !form.installmentsTotal) return;
        await createL.mutateAsync({
          employeeId: form.employeeId,
          principal: Number(form.principal),
          interestRate: Number(form.interestRate || 0),
          installmentsTotal: Number(form.installmentsTotal),
          ...(form.disburseNow ? { disbursedAt: form.disbursedAt, disbursementMethod: method } : {}),
          notes: form.notes || undefined,
        });
      }
      setOpen(false);
    } catch (e) {
      onError(e);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Advances & loans</h1>
          <p className="text-sm text-muted-foreground">
            Salary advances and staff loans, recovered through payroll. Paying out or disbursing posts to the ledger;
            payroll recovers only money that has actually been paid out.
          </p>
        </div>
        <Button onClick={openCreate}>New {tab === 'advances' ? 'advance' : 'loan'}</Button>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Pay out / disburse by</span>
        <select value={method} onChange={(e) => setMethod(e.target.value as any)} className="rounded-md border bg-card px-3 py-1.5 text-sm">
          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
        </select>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="advances">Salary advances</TabsTrigger>
          <TabsTrigger value="loans">Loans</TabsTrigger>
        </TabsList>

        <TabsContent value="advances" className="space-y-4">
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-sm">{advanceRows.length} advances</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {advanceRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No advances yet.</p>}
                {advanceRows.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                    <div className="flex items-center gap-3">
                      <HandCoins className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{a.advanceCode} · {a.employee?.employeeCode} {a.employee?.firstName}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmt(a.amount)} · {fmt(a.monthlyDeduction)}/mo × {a.installmentMonths} · balance {fmt(a.balance)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.status === 'PENDING' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => approveA.mutate(a.id, { onError })}>Approve</Button>
                          <Button size="sm" variant="ghost" onClick={() => rejectA.mutate({ id: a.id })}>Reject</Button>
                        </>
                      )}
                      {a.status === 'APPROVED' && (
                        <Button size="sm" variant="outline"
                          onClick={() => { if (confirm(`Pay out ${a.advanceCode} by ${method.replace('_', ' ')}? This posts to the ledger.`)) payA.mutate({ id: a.id, dto: { paymentMethod: method } }, { onError }); }}>
                          Pay out
                        </Button>
                      )}
                      <Badge variant="outline" className={ADVANCE_STATUS[a.status] ?? ''}>{a.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="loans" className="space-y-4">
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-sm">{loanRows.length} loans</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {loanRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No loans yet.</p>}
                {loanRows.map((l: any) => (
                  <div key={l.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                    <div className="flex items-center gap-3">
                      <HandCoins className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{l.loanCode} · {l.employee?.employeeCode} {l.employee?.firstName}</p>
                        <p className="text-xs text-muted-foreground">
                          Principal {fmt(l.principal)} · {l.installmentsPaid}/{l.installmentsTotal} paid · installment {fmt(l.installmentAmount)} · balance {fmt(l.balance)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!l.disbursementJournalEntryId && l.status === 'ACTIVE' && (
                        <>
                          <span className="text-xs text-amber-700">Not disbursed</span>
                          <button
                            onClick={() => { if (confirm(`Disburse ${l.loanCode} by ${method.replace('_', ' ')}? This posts to the ledger.`)) disburseL.mutate({ id: l.id, dto: { method } }, { onError }); }}
                            className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60">Disburse</button>
                          <button onClick={() => { if (confirm(`Delete loan ${l.loanCode}?`)) deleteL.mutate(l.id, { onError }); }}
                            className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
                        </>
                      )}
                      {l.disbursementJournalEntryId && l.status === 'ACTIVE' && (
                        <button
                          onClick={() => {
                            const reason = prompt(`Write off the remaining ${fmt(l.balance)} on ${l.loanCode}? Reason:`);
                            if (reason) writeOffL.mutate({ id: l.id, reason }, { onError });
                          }}
                          className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Write off</button>
                      )}
                      <Badge variant="outline" className={LOAN_STATUS[l.status] ?? ''}>{l.status === 'DEFAULTED' ? 'WRITTEN OFF' : l.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tab === 'advances' ? 'New salary advance' : 'New loan'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Employee *</Label>
              <select value={form.employeeId ?? ''} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">Select employee…</option>
                {employees.map((e: any) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.firstName}{e.lastName ? ' ' + e.lastName : ''}</option>)}
              </select>
            </div>
            {tab === 'advances' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Amount *</Label>
                    <Input type="number" value={form.amount ?? ''} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                  </div>
                  <div>
                    <Label>Installment months</Label>
                    <Input type="number" min={1} value={form.installmentMonths ?? 1} onChange={(e) => setForm({ ...form, installmentMonths: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>Notes</Label>
                  <Input value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label>Principal *</Label>
                    <Input type="number" value={form.principal ?? ''} onChange={(e) => setForm({ ...form, principal: e.target.value })} />
                  </div>
                  <div>
                    <Label>Interest rate</Label>
                    <Input type="number" step="0.01" value={form.interestRate ?? ''} onChange={(e) => setForm({ ...form, interestRate: e.target.value })} placeholder="0.1 = 10%" />
                  </div>
                  <div>
                    <Label>Installments *</Label>
                    <Input type="number" min={1} value={form.installmentsTotal ?? ''} onChange={(e) => setForm({ ...form, installmentsTotal: e.target.value })} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!form.disburseNow} onChange={(e) => setForm({ ...form, disburseNow: e.target.checked })} />
                  Disburse now by {method.replace('_', ' ')}
                </label>
                {form.disburseNow && (
                  <div>
                    <Label>Disbursement date</Label>
                    <Input type="date" value={form.disbursedAt ?? ''} onChange={(e) => setForm({ ...form, disbursedAt: e.target.value })} />
                  </div>
                )}
                <div>
                  <Label>Notes</Label>
                  <Input value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </>
            )}
            <Button onClick={submit} disabled={createA.isPending || createL.isPending}>
              {tab === 'advances' ? 'Create advance' : 'Create loan'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
