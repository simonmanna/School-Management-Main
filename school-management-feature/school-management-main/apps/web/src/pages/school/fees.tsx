import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  useCurrentTerm,
  useFeeStructures,
  useFinanceDashboard,
  useGenerateBilling,
  useOutstandingByClass,
  usePenaltyRun,
} from '@/features/school/api';

const fmt = (n: number) => new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX', maximumFractionDigits: 0 }).format(n);

export function FeesPage() {
  const { data: structures } = useFeeStructures();
  const { data: term } = useCurrentTerm();
  const { data: finance } = useFinanceDashboard();
  const { data: outstandingByClass } = useOutstandingByClass();
  const generateBilling = useGenerateBilling();
  const penaltyRun = usePenaltyRun();
  const [termId, setTermId] = useState('');
  const [scheduleId, setScheduleId] = useState('');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">School Fees</h1>
      {term && <Badge>Current term: {term.name}</Badge>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Generate term billing</CardTitle>
            <CardDescription>
              Creates one sales invoice per active student for the selected term. Idempotent on rerun.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Term ID</Label>
              <Input placeholder="term_…" value={termId} onChange={(e) => setTermId(e.target.value)} />
            </div>
            <Button
              disabled={!termId || generateBilling.isPending}
              onClick={() => generateBilling.mutate({ termId })}
            >
              Generate invoices
            </Button>
            {generateBilling.data && (
              <p className="text-sm text-muted-foreground">
                {generateBilling.data.count} invoice(s) created.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Run penalty assessment</CardTitle>
            <CardDescription>Posts late fees for overdue invoices on a fee schedule.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Schedule ID</Label>
              <Input placeholder="sch_…" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} />
            </div>
            <Button
              disabled={!scheduleId || penaltyRun.isPending}
              onClick={() => penaltyRun.mutate({ scheduleId })}
            >
              Run penalties
            </Button>
            {penaltyRun.data && (
              <p className="text-sm text-muted-foreground">
                Total assessed: {fmt(Number(penaltyRun.data.totalAssessed))}.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Finance summary</CardTitle>
          <CardDescription>Live from the reporting module.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted-foreground">Collections this month</div>
            <div className="text-2xl font-bold">{finance ? fmt(finance.collectionsThisMonth) : '—'}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Outstanding fees</div>
            <div className="text-2xl font-bold text-red-600">{finance ? fmt(finance.outstanding) : '—'}</div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Outstanding by class</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-2 text-left">Class</th>
                <th className="p-2 text-right">Students</th>
                <th className="p-2 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {(outstandingByClass ?? []).map((c: any) => (
                <tr key={c.classId} className="border-b">
                  <td className="p-2">{c.className}</td>
                  <td className="p-2 text-right">{c.studentCount}</td>
                  <td className="p-2 text-right text-red-600">{fmt(c.outstanding)}</td>
                </tr>
              ))}
              {(outstandingByClass ?? []).length === 0 && (
                <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">No outstanding balances.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Fee structures</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(structures ?? []).map((s: any) => (
            <div key={s.id} className="rounded border p-3">
              <div className="font-medium">{s.name}</div>
              <div className="text-sm text-muted-foreground">
                {(s.components ?? []).map((c: any) => `${c.code}: ${fmt(c.amount)}`).join(' · ')}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}