import { useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { useHrPayslips, useHrPayslip, useMarkHrPayslipPaid } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const PAYSLIP_STATUS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  ISSUED: 'bg-cyan-100 text-cyan-800',
  PAID: 'bg-emerald-100 text-emerald-800',
};

export function HrPayslipsPage() {
  const [detailId, setDetailId] = useState<string | null>(null);
  const { data } = useHrPayslips();
  const { data: detail } = useHrPayslip(detailId ?? undefined);
  const markPaid = useMarkHrPayslipPaid();

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const it = detail?.item;

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Payslips</h1>
        <p className="text-sm text-muted-foreground">Issued payslips, ready for payment or export.</p>
      </div>

      <Card>
        <CardHeader className="bg-muted/30 border-b rounded-t-lg">
          <CardTitle className="text-sm">{rows.length} payslips</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No payslips yet — approve a payroll run to issue them.</p>}
            {rows.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                <button className="flex flex-1 items-center gap-3 text-left" onClick={() => setDetailId(p.id)}>
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{p.payslipNumber} · {p.item?.employee?.employeeCode} {p.item?.employee?.firstName}</p>
                    <p className="text-xs text-muted-foreground">Net {fmt(p.item?.netPay)} · {p.paymentMethod ?? '—'}</p>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  {p.status === 'ISSUED' && (
                    <Button size="sm" variant="outline" onClick={() => markPaid.mutate({ id: p.id, dto: { paymentMethod: 'BANK' } })}>Mark paid</Button>
                  )}
                  <Badge variant="outline" className={PAYSLIP_STATUS[p.status] ?? ''}>{p.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.payslipNumber} · {it?.employee?.employeeCode} {it?.employee?.firstName}{it?.employee?.lastName ? ' ' + it?.employee?.lastName : ''}</DialogTitle>
          </DialogHeader>

          <div className="flex items-center justify-between">
            <Badge variant="outline" className={PAYSLIP_STATUS[detail?.status ?? ''] ?? ''}>{detail?.status}</Badge>
            {detail?.status === 'ISSUED' && (
              <Button size="sm" onClick={() => markPaid.mutate({ id: detail.id, dto: { paymentMethod: 'BANK' } })}>Mark paid</Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Earnings</p>
              <dl className="mt-1 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Base salary</dt><dd>{fmt(it?.baseSalary)}</dd></div>
                {Number(it?.overtimePay ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Overtime ({it?.overtimeHours}h)</dt><dd>{fmt(it?.overtimePay)}</dd></div>}
                <div className="flex justify-between"><dt className="text-muted-foreground">Allowances</dt><dd>{fmt(it?.allowancesTotal)}</dd></div>
                {Number(it?.commissionAmount ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Commission</dt><dd>{fmt(it?.commissionAmount)}</dd></div>}
                {Number(it?.bonusAmount ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Bonus</dt><dd>{fmt(it?.bonusAmount)}</dd></div>}
                <div className="flex justify-between border-t pt-1 font-medium"><dt>Gross</dt><dd>{fmt(it?.grossPay)}</dd></div>
              </dl>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Deductions</p>
              <dl className="mt-1 space-y-1 text-sm">
                {Number(it?.taxAmount ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Income tax</dt><dd>{fmt(it?.taxAmount)}</dd></div>}
                {Number(it?.pensionAmount ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Pension</dt><dd>{fmt(it?.pensionAmount)}</dd></div>}
                {Number(it?.socialSecurityAmount ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Social security</dt><dd>{fmt(it?.socialSecurityAmount)}</dd></div>}
                {Number(it?.loanDeduction ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Loan repayment</dt><dd>{fmt(it?.loanDeduction)}</dd></div>}
                {Number(it?.advanceDeduction ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Advance repayment</dt><dd>{fmt(it?.advanceDeduction)}</dd></div>}
                {Number(it?.insuranceAmount ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Insurance</dt><dd>{fmt(it?.insuranceAmount)}</dd></div>}
                {Number(it?.otherDeductions ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Other</dt><dd>{fmt(it?.otherDeductions)}</dd></div>}
                <div className="flex justify-between border-t pt-1 font-medium"><dt>Total</dt><dd>{fmt(it?.totalDeductions)}</dd></div>
              </dl>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md bg-muted/30 p-3">
            <p className="text-sm font-medium">Net pay</p>
            <p className="text-lg font-semibold">{fmt(it?.netPay)}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
