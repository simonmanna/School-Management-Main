import { useMemo, useState } from 'react';
import { CheckCircle2, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  useApproveHrPayrollInputs,
  useCancelHrPayrollInput,
  useCreateHrPayrollInputs,
  useDeleteHrPayrollInput,
  useHrEmployees,
  useHrPayrollInputs,
  useHrPayrollPeriods,
  type HrPayrollInput,
  type HrPayrollInputType,
} from '@/features/hr/api';
import { useMoneyFormatter } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * One-off payroll money: bonuses, commissions, reimbursements and ad-hoc
 * deductions for a single employee in a single period.
 *
 * Recurring money is NOT captured here — that is a payroll component, configured
 * once in Payroll settings. Keeping them apart is what stops the component
 * catalogue filling up with "Term 2 bonus — Sarah" rows that then quietly apply
 * every month forever.
 *
 * Capture and approval are separate acts, and separate permissions. A clerk can
 * key a whole bonus list off a memo without being able to authorise a shilling
 * of it; a 403 on Approve is that rule working.
 */

const TYPES: Array<{ value: HrPayrollInputType; label: string; hint: string }> = [
  { value: 'BONUS', label: 'Bonus', hint: 'Taxable. Shown separately on the payslip.' },
  { value: 'COMMISSION', label: 'Commission', hint: 'Taxable. Shown separately on the payslip.' },
  { value: 'ALLOWANCE', label: 'Allowance', hint: 'One-off addition to pay.' },
  { value: 'REIMBURSEMENT', label: 'Reimbursement', hint: 'Untaxed by default — a refund of a cost already borne is not income.' },
  { value: 'DEDUCTION', label: 'Deduction', hint: 'Recovered from net pay this period.' },
];

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-sky-100 text-sky-800',
  APPLIED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-muted text-muted-foreground',
};

const STATUS_NOTE: Record<string, string> = {
  PENDING: 'Captured but not authorised — payroll will not pay this.',
  APPROVED: 'Will be picked up by the next calculation for its period.',
  APPLIED: 'Paid by a payroll run. Reverse the run to change it.',
  CANCELLED: 'Withdrawn before payment.',
};

type DraftRow = {
  employeeId: string;
  inputType: HrPayrollInputType;
  name: string;
  amount: string;
  isTaxable: boolean;
};

const emptyRow = (): DraftRow => ({
  employeeId: '',
  inputType: 'BONUS',
  name: '',
  amount: '',
  isTaxable: true,
});

export function HrPayrollInputsPage() {
  const fmt = useMoneyFormatter();
  const [periodId, setPeriodId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>([emptyRow()]);

  const periods = useHrPayrollPeriods();
  const employees = useHrEmployees({ pageSize: 500, isActive: 'true' });
  const inputs = useHrPayrollInputs({
    ...(periodId ? { periodId } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
  });

  const create = useCreateHrPayrollInputs();
  const approve = useApproveHrPayrollInputs();
  const cancel = useCancelHrPayrollInput();
  const remove = useDeleteHrPayrollInput();

  const periodRows: any[] = periods.data?.rows ?? periods.data ?? [];
  const employeeRows: any[] = employees.data?.rows ?? employees.data ?? [];
  const list: HrPayrollInput[] = inputs.data ?? [];

  const pendingIds = useMemo(
    () => list.filter((i) => i.status === 'PENDING').map((i) => i.id),
    [list],
  );
  const selectable = new Set(pendingIds);
  // Only PENDING rows can be approved, so a selection that survived a filter
  // change must not carry a row the server would reject.
  const validSelection = selected.filter((id) => selectable.has(id));

  const totals = useMemo(() => {
    let additions = 0;
    let deductions = 0;
    for (const i of list) {
      if (i.status === 'CANCELLED') continue;
      const amount = Number(i.amount ?? 0);
      if (i.inputType === 'DEDUCTION') deductions += amount;
      else additions += amount;
    }
    return { additions, deductions, net: additions - deductions };
  }, [list]);

  const openPeriods = periodRows.filter((p) => p.status === 'OPEN');

  const submit = async () => {
    const payload = rows
      .filter((r) => r.employeeId && r.name && Number(r.amount) > 0)
      .map((r) => ({
        employeeId: r.employeeId,
        periodId,
        inputType: r.inputType,
        name: r.name,
        amount: Number(r.amount),
        isTaxable: r.isTaxable,
      }));
    if (payload.length === 0) {
      toast.error('Fill in an employee, a description and a positive amount.');
      return;
    }
    try {
      await create.mutateAsync({ inputs: payload });
      toast.success(`Captured ${payload.length} input(s). They still need approval.`);
      setOpen(false);
      setRows([emptyRow()]);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Could not save these inputs.');
    }
  };

  const doApprove = async () => {
    try {
      await approve.mutateAsync(validSelection);
      toast.success(`Approved ${validSelection.length} input(s).`);
      setSelected([]);
    } catch (err: any) {
      toast.error(
        err?.response?.status === 403
          ? 'Approving payroll inputs needs the payroll permission — capture and approval are deliberately separate.'
          : err?.response?.data?.message ?? 'Could not approve.',
      );
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Payroll inputs</h1>
          <p className="text-sm text-muted-foreground">
            One-off bonuses, commissions, reimbursements and deductions for a single pay period.
            Recurring pay belongs in <span className="font-medium">Payroll settings</span> instead.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} disabled={!periodId}>
          <Plus className="mr-1.5 h-4 w-4" /> Capture inputs
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
        <div className="min-w-[14rem] flex-1">
          <Label className="text-xs text-muted-foreground">Pay period</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
            value={periodId}
            onChange={(e) => { setPeriodId(e.target.value); setSelected([]); }}
          >
            <option value="">All periods</option>
            {periodRows.map((p) => (
              <option key={p.id} value={p.id}>
                {p.periodCode}{p.status !== 'OPEN' ? ` · ${p.status}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[10rem]">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setSelected([]); }}
          >
            <option value="">Any</option>
            {['PENDING', 'APPROVED', 'APPLIED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>{s.toLowerCase()}</option>
            ))}
          </select>
        </div>
        {!periodId && (
          <p className="pb-2 text-xs text-muted-foreground">
            Choose a period to capture new inputs.
          </p>
        )}
      </div>

      {list.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Additions" value={fmt(totals.additions)} />
          <Stat label="Deductions" value={fmt(totals.deductions)} />
          <Stat label="Net effect on this payroll" value={fmt(totals.net)} emphasis />
        </div>
      )}

      {validSelection.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-sky-300/60 bg-sky-50/60 p-3 dark:bg-sky-950/20">
          <p className="text-sm">
            {validSelection.length} pending input(s) selected.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
            <Button size="sm" onClick={doApprove} disabled={approve.isPending}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve for payment
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between rounded-t-lg border-b bg-muted/30">
          <CardTitle className="text-sm">{list.length} input(s)</CardTitle>
          {pendingIds.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setSelected(validSelection.length === pendingIds.length ? [] : pendingIds)
              }
            >
              {validSelection.length === pendingIds.length ? 'Deselect all' : `Select all ${pendingIds.length} pending`}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {list.length === 0 && (
              <p className="p-6 text-sm text-muted-foreground">
                No inputs captured{periodId ? ' for this period' : ''} yet.
              </p>
            )}
            {list.map((i) => {
              const isDeduction = i.inputType === 'DEDUCTION';
              return (
                <div key={i.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    disabled={i.status !== 'PENDING'}
                    checked={selected.includes(i.id)}
                    onChange={(e) =>
                      setSelected(e.target.checked
                        ? [...selected, i.id]
                        : selected.filter((s) => s !== i.id))
                    }
                    aria-label={`Select ${i.name}`}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {i.employee?.employeeCode} {i.employee?.firstName}{i.employee?.lastName ? ` ${i.employee.lastName}` : ''}
                      <span className="ml-2 font-normal text-muted-foreground">{i.name}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {i.inputType.toLowerCase()} · {i.period?.periodCode}
                      {!i.isTaxable && ' · untaxed'}
                      {' · '}{STATUS_NOTE[i.status]}
                    </p>
                  </div>
                  <p className={`text-sm font-medium ${isDeduction ? 'text-destructive' : ''}`}>
                    {isDeduction ? '−' : '+'}{fmt(i.amount)}
                  </p>
                  <Badge variant="outline" className={STATUS_STYLE[i.status] ?? ''}>{i.status}</Badge>
                  {i.status !== 'APPLIED' && i.status !== 'CANCELLED' && (
                    <div className="flex gap-1">
                      <Button
                        size="icon" variant="ghost" title="Cancel"
                        onClick={() => cancel.mutate({ id: i.id, reason: 'cancelled from payroll inputs' })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" title="Delete"
                        onClick={() => remove.mutate(i.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Capture inputs · {periodRows.find((p) => p.id === periodId)?.periodCode ?? ''}
            </DialogTitle>
          </DialogHeader>

          {openPeriods.length === 0 && (
            <p className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
              No pay period is open. Inputs can only be added to an OPEN period — a closed
              period's figures have already been reported.
            </p>
          )}

          <div className="space-y-2">
            {rows.map((r, idx) => (
              <div key={idx} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                <div className="min-w-[14rem] flex-1">
                  <Label className="text-xs text-muted-foreground">Employee</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={r.employeeId}
                    onChange={(e) => setRows(rows.map((x, i) => i === idx ? { ...x, employeeId: e.target.value } : x))}
                  >
                    <option value="">Select…</option>
                    {employeeRows.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.employeeCode} · {e.firstName}{e.lastName ? ` ${e.lastName}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[9rem]">
                  <Label className="text-xs text-muted-foreground">Type</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={r.inputType}
                    onChange={(e) => {
                      const inputType = e.target.value as HrPayrollInputType;
                      setRows(rows.map((x, i) => i === idx
                        // A reimbursement refunds a cost already borne, so it
                        // defaults untaxed; everything else defaults taxable.
                        ? { ...x, inputType, isTaxable: inputType !== 'REIMBURSEMENT' }
                        : x));
                    }}
                  >
                    {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="min-w-[12rem] flex-1">
                  <Label className="text-xs text-muted-foreground">Description</Label>
                  <Input
                    placeholder="Shown on the payslip"
                    value={r.name}
                    onChange={(e) => setRows(rows.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                  />
                </div>
                <div className="min-w-[9rem]">
                  <Label className="text-xs text-muted-foreground">Amount</Label>
                  <Input
                    type="number" min="0" step="0.01"
                    value={r.amount}
                    onChange={(e) => setRows(rows.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))}
                  />
                </div>
                <label className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={r.isTaxable}
                    disabled={r.inputType === 'DEDUCTION'}
                    onChange={(e) => setRows(rows.map((x, i) => i === idx ? { ...x, isTaxable: e.target.checked } : x))}
                  />
                  Taxable
                </label>
                {rows.length > 1 && (
                  <Button
                    size="icon" variant="ghost"
                    onClick={() => setRows(rows.filter((_, i) => i !== idx))}
                    aria-label="Remove row"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            {TYPES.find((t) => t.value === rows[rows.length - 1]?.inputType)?.hint}
          </p>

          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setRows([...rows, emptyRow()])}>
              <Plus className="mr-1.5 h-4 w-4" /> Add another
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={create.isPending}>
                Capture {rows.length} input(s)
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Captured inputs start as <span className="font-medium">pending</span> and are not paid
            until someone with the payroll permission approves them.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 ${emphasis ? 'text-lg font-semibold' : 'text-base font-medium'}`}>{value}</p>
    </Card>
  );
}
