import { useState } from 'react';
import { Eye, AlertTriangle } from 'lucide-react';
import { useHrRunPreview, useHrPayrollRuns } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function HrPayrollPreviewPage() {
  const [runId, setRunId] = useState<string>('');
  const { data: runs } = useHrPayrollRuns({});
  const { data: preview, isFetching } = useHrRunPreview(runId || undefined);

  const runRows: any[] = (runs as any)?.rows ?? [];

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Payroll Preview & Variance Check</h1>
        <p className="text-sm text-muted-foreground">Run before approving a payroll — totals, headcount, variances vs the previous run, and data-quality flags.</p>
      </div>

      <div className="flex items-center gap-2">
        <select value={runId} onChange={(e) => setRunId(e.target.value)} className="w-80 rounded-md border bg-card px-3 py-2 text-sm">
          <option value="">Select a calculated payroll run…</option>
          {runRows.map((r: any) => <option key={r.id} value={r.id}>{r.period?.periodCode ?? r.id} · {r.status}</option>)}
        </select>
      </div>

      {preview && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Totals</CardTitle></CardHeader>
            <CardContent className="space-y-1 p-4 text-sm">
              <Line k="Employees" v={preview.employeeCount} />
              <Line k="Gross payroll" v={preview.totalGross} />
              <Line k="Deductions" v={preview.totalDeductions} />
              <Line k="Net payroll" v={preview.totalNet} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Headcount</CardTitle></CardHeader>
            <CardContent className="space-y-1 p-4 text-sm">
              <Line k="New employees" v={preview.newEmployees?.length ?? 0} />
              <Line k="Departed" v={preview.departedEmployees ?? 0} />
              <Line k="Large variances (≥15%)" v={preview.largeVariances?.length ?? 0} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" /> Data-quality flags</CardTitle></CardHeader>
            <CardContent className="space-y-1 p-4 text-sm">
              <Line k="Missing bank details" v={preview.missingBankDetails ?? 0} />
              <Line k="Missing tax info" v={preview.missingTaxInfo ?? 0} />
              <Line k="Negative net pay" v={preview.negativeNetEmployees?.length ?? 0} />
            </CardContent>
          </Card>

          {preview.largeVariances?.length > 0 && (
            <Card className="lg:col-span-3">
              <CardHeader className="border-b"><CardTitle className="text-sm">Salary variances (≥15% vs previous run)</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {preview.largeVariances.map((v: any, i: number) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span>{v.employeeCode}</span>
                      <span>{v.prevNet} → {v.net} ({v.pct}%)</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {preview.missingBankDetails > 0 && (
            <Card className="lg:col-span-3 border-amber-300 bg-amber-50/50">
              <CardContent className="p-4 text-sm flex items-center gap-2"><Eye className="h-4 w-4 text-amber-600" /> {preview.missingBankDetails} employee(s) cannot be paid — missing bank / mobile-money details.</CardContent>
            </Card>
          )}
        </div>
      )}
      {isFetching && <p className="text-sm text-muted-foreground">Loading preview…</p>}
      {runId && !preview && !isFetching && <p className="text-sm text-muted-foreground">No preview available — ensure the run is CALCULATED.</p>}
    </div>
  );
}

function Line({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{typeof v === 'number' ? v.toLocaleString() : v}</span>
    </div>
  );
}
