import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer, Play, RefreshCw, ShieldCheck, CheckCircle2, XCircle, Upload, Zap } from 'lucide-react';
import {
  useStudents,
  useStudent,
  useStudentBalance,
  useStudentLedger,
  useSchoolProfile,
  useArGlReconciliation,
  useCreditLiabilityReconciliation,
  useSchoolFinanceDashboard,
  useSchoolOutstandingByClass,
  useBillingRuns,
  useBillingRun,
  useStartBillingRun,
  useProcessBillingRun,
  useTerms,
  useAdjustments,
  useApproveAdjustment,
  useRejectAdjustment,
  usePaymentImportBatches,
  usePaymentImportBatch,
  useImportPayments,
  useConfirmImportRow,
  useSchoolInvoices,
  useRebillInvoice,
  useCachedProjectionReconciliation,
  useMomoClearing,
  useConfirmHighImportRows,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { money, sel, Stat } from './fees-shared';

const fmtDate = (d?: string) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

/* ═══════════════════════════ Student Ledger (B1) ═══════════════════════════ */

export function SchoolStudentLedgerPage() {
  const params = useParams<{ id: string }>();
  const [studentProfileId, setStudentProfileId] = useState(params.id ?? '');
  const students = useStudents({ search: '', pageSize: 100 });
  const { data: profile } = useSchoolProfile();
  const student = useStudent(studentProfileId);
  const balance = useStudentBalance(studentProfileId);
  const ledger = useStudentLedger(studentProfileId);

  const studentOptions = (students.data?.data ?? []).map((s: any) => ({
    value: s.id,
    label: s.admissionNo ? `${s.admissionNo} · ${s.firstName} ${s.lastName}` : s.id,
  }));

  return (
    <div className="p-4 space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Student Ledger</h1>
        <div className="flex gap-2">
          <select className={`${sel} min-w-[280px]`} value={studentProfileId} onChange={(e) => setStudentProfileId(e.target.value)}>
            <option value="">Select student…</option>
            {studentOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Button variant="outline" disabled={!studentProfileId} onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      {!studentProfileId && <p className="text-muted-foreground text-sm">Pick a student to view their financial ledger.</p>}

      {studentProfileId && (
        <div className="print-ledger space-y-4">
          <div className="hidden print:block text-center">
            <div className="text-lg font-bold">{profile?.name ?? 'School'}</div>
            <div className="text-sm text-muted-foreground">Student Financial Ledger</div>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {(student.data as any)?.firstName} {(student.data as any)?.lastName}
                <span className="ml-2 text-xs text-muted-foreground">{(student.data as any)?.admissionNo}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {balance.data && (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  <Stat label="Billed" value={money(balance.data.billed)} />
                  <Stat label="Collected" value={money(balance.data.collected)} tone="emerald" />
                  <Stat label="Waived" value={money(balance.data.waived)} />
                  <Stat label="Credited" value={money(balance.data.credited)} />
                  <Stat label="Balance" value={money(balance.data.balance)} tone={balance.data.balance > 0 ? 'rose' : 'emerald'} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.isLoading && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell></TableRow>}
                  {ledger.data?.rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No ledger entries.</TableCell></TableRow>}
                  {ledger.data?.rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{fmtDate(r.date)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="mr-1 text-[10px]">{r.ledgerType}</Badge>
                        {r.description}
                      </TableCell>
                      <TableCell className="text-right">{r.debit ? money(r.debit) : ''}</TableCell>
                      <TableCell className="text-right">{r.credit ? money(r.credit) : ''}</TableCell>
                      <TableCell className="text-right font-medium">{money(r.balance)}</TableCell>
                    </TableRow>
                  ))}
                  {ledger.data && (
                    <TableRow className="border-t-2">
                      <TableCell colSpan={5} className="text-right font-semibold">Closing balance</TableCell>
                      <TableCell className="text-right font-bold">{money(ledger.data.closingBalance)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════ Finance Dashboard (B3) ═══════════════════════════ */

export function SchoolFinanceDashboardPage() {
  const dash = useSchoolFinanceDashboard();
  const byClass = useSchoolOutstandingByClass();
  const arGl = useArGlReconciliation();
  const credit = useCreditLiabilityReconciliation();
  const projections = useCachedProjectionReconciliation();
  const clearing = useMomoClearing();

  const reconOk = (v?: number) => Math.abs(v ?? 0) <= 0.01;
  const drifted = projections.data?.drifted ?? [];

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">Finance Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Collected (this month)" value={money(dash.data?.collectionsThisMonth ?? 0)} tone="emerald" />
        <Stat label="Outstanding AR" value={money(dash.data?.outstanding ?? 0)} tone="rose" />
        <Stat label="AR ⇄ GL variance" value={money(arGl.data?.variance ?? 0)} tone={reconOk(arGl.data?.variance) ? 'emerald' : 'rose'} />
        <Stat label="Credit liability variance" value={money(credit.data?.variance ?? 0)} tone={reconOk(credit.data?.variance) ? 'emerald' : 'rose'} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Reconciliation status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ReconLine label="AR subledger = GL AR control" ok={reconOk(arGl.data?.variance)}
            detail={`subledger ${money(arGl.data?.subledgerTotal ?? 0)} vs GL ${money(arGl.data?.glTotal ?? 0)}`} />
          <ReconLine label="Fee-credit liability = GL" ok={reconOk(credit.data?.variance)}
            detail={`outstanding ${money(credit.data?.outstanding ?? 0)} vs GL ${money(credit.data?.glBalance ?? 0)}`} />
          <ReconLine label="Invoice balances = transactions behind them" ok={projections.isSuccess && drifted.length === 0}
            detail={projections.data ? `${projections.data.checked} checked, ${drifted.length} drifted` : 'checking…'} />
          {(clearing.data ?? []).map((c) => (
            <ReconLine key={c.provider} label={`${c.provider.toUpperCase()} clearing = unsettled receipts`} ok={reconOk(c.variance)}
              detail={`GL ${money(c.glBalance)} vs receipts awaiting payout ${money(c.unsettledCollections)}`} />
          ))}
          {arGl.data && arGl.data.perStudent.length > 0 && (
            <p className="text-rose-600">{arGl.data.perStudent.length} student(s) with a variance — investigate before closing the period.</p>
          )}
          {drifted.length > 0 && (
            <div className="rounded-md border border-rose-200 p-2 text-xs">
              <p className="mb-1 font-medium text-rose-700">Financial integrity alert — cached balances that disagree with their transactions:</p>
              {drifted.slice(0, 10).map((d) => (
                <div key={`${d.kind}-${d.id}`} className="flex gap-2">
                  <span className="font-mono">{d.reference}</span>
                  <span className="text-muted-foreground">{d.kind}</span>
                  <span className="ml-auto tabular-nums">stored {money(d.cached)} · expected {money(d.subledger)}</span>
                </div>
              ))}
              {drifted.length > 10 && <p className="text-muted-foreground">…and {drifted.length - 10} more</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Outstanding by class</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Class</TableHead><TableHead className="text-right">Students</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader>
            <TableBody>
              {(byClass.data ?? []).map((c) => (
                <TableRow key={c.classId}>
                  <TableCell>{c.className}</TableCell>
                  <TableCell className="text-right">{c.studentCount}</TableCell>
                  <TableCell className="text-right">{money(c.outstanding)}</TableCell>
                </TableRow>
              ))}
              {byClass.data?.length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground">Nothing outstanding.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ReconLine({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />}
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground">— {detail}</span>
    </div>
  );
}

/* ═══════════════════════════ Billing Runs (Phase 1.5) ═══════════════════════════ */

export function SchoolBillingRunsPage() {
  const [termId, setTermId] = useState('');
  const [selectedRun, setSelectedRun] = useState<string | undefined>();
  const terms = useTerms();
  const runs = useBillingRuns();
  const run = useBillingRun(selectedRun);
  const start = useStartBillingRun();
  const process = useProcessBillingRun();

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">Billing Runs</h1>
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-2">
          <select className={`${sel} max-w-xs`} value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="">Select term…</option>
            {((terms.data?.data ?? []) as any[]).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <Button disabled={!termId || start.isPending} onClick={() => start.mutate({ termId }, {
            onSuccess: (r: any) => { setSelectedRun(r.id); notify.success('Billing run queued'); runs.refetch(); },
            onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed to start run'),
          })}>
            <Play className="mr-1 h-4 w-4" /> Start run
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent runs</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Created</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Posted/Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {(runs.data ?? []).map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelectedRun(r.id)}>
                    <TableCell>{fmtDate(r.createdAt)}</TableCell>
                    <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                    <TableCell className="text-right">{r.postedCount}/{r.totalStudents}{r.failedCount ? ` · ${r.failedCount} failed` : ''}</TableCell>
                  </TableRow>
                ))}
                {runs.data?.length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground">No runs yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {selectedRun && run.data && (
          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="text-base">Run detail</CardTitle>
              <Button size="sm" variant="outline" disabled={process.isPending || run.data.run.status === 'completed'}
                onClick={() => process.mutate({ id: selectedRun }, { onSuccess: () => notify.success('Processed a batch') })}>
                <RefreshCw className="mr-1 h-4 w-4" /> Process batch
              </Button>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Total" value={String(run.data.run.totalStudents)} />
                <Stat label="Posted" value={String(run.data.run.postedCount)} tone="emerald" />
                <Stat label="Failed" value={String(run.data.run.failedCount)} tone={run.data.run.failedCount ? 'rose' : undefined} />
                <Stat label="Skipped" value={String(run.data.run.skippedCount)} />
              </div>
              <div className="max-h-64 overflow-auto">
                {(run.data.items ?? []).filter((i: any) => i.status === 'failed').map((i: any) => (
                  <div key={i.id} className="text-xs text-rose-600 border-b py-1">{i.studentProfileId.slice(0, 8)}: {i.error}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════ Adjustments (A2) ═══════════════════════════ */

export function SchoolAdjustmentsPage() {
  const pending = useAdjustments('pending_approval');
  const posted = useAdjustments('posted');
  const approve = useApproveAdjustment();
  const reject = useRejectAdjustment();

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">Fee Adjustments</h1>
      <p className="text-sm text-muted-foreground">
        Every balance change that is not an invoice, payment, waiver, credit or refund is a typed, approved adjustment —
        so the ledger and the general ledger never drift. Maker-checker: the approver must differ from the creator.
      </p>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Pending approval</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Direction</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Reason</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {(pending.data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.code}</TableCell>
                  <TableCell><Badge variant={a.direction === 'debit' ? 'destructive' : 'outline'}>{a.direction}</Badge></TableCell>
                  <TableCell className="text-right">{money(a.amount)}</TableCell>
                  <TableCell>{a.reason}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="outline" className="mr-1" disabled={approve.isPending}
                      onClick={() => approve.mutate(a.id, { onSuccess: () => notify.success('Adjustment posted'), onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed') })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => reject.mutate({ id: a.id, reason: 'Rejected' }, { onSuccess: () => notify.success('Rejected') })}>Reject</Button>
                  </TableCell>
                </TableRow>
              ))}
              {pending.data?.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Nothing pending.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Posted</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Direction</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
            <TableBody>
              {(posted.data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.code}</TableCell>
                  <TableCell>{a.direction}</TableCell>
                  <TableCell className="text-right">{money(a.amount)}</TableCell>
                  <TableCell>{a.reason}</TableCell>
                </TableRow>
              ))}
              {posted.data?.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">None posted.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ═══════════════════════════ Payment Reconciliation (B4) ═══════════════════════════ */

export function SchoolReconciliationPage() {
  const [provider, setProvider] = useState('mtn_momo');
  const [period, setPeriod] = useState('');
  const [csv, setCsv] = useState('');
  const [selected, setSelected] = useState<string | undefined>();
  const batches = usePaymentImportBatches();
  const batch = usePaymentImportBatch(selected);
  const importPayments = useImportPayments();
  const confirmRow = useConfirmImportRow();
  const confirmHigh = useConfirmHighImportRows();
  const [assignFor, setAssignFor] = useState<any | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [assignStudent, setAssignStudent] = useState('');
  const assignCandidates = useStudents({ search: assignSearch || undefined, pageSize: 20 });

  const assignAndPost = () => {
    if (!selected || !assignFor || !assignStudent) return;
    confirmRow.mutate(
      { batchId: selected, rowId: assignFor.id, studentProfileId: assignStudent },
      {
        onSuccess: () => { notify.success('Assigned and posted'); setAssignFor(null); setAssignStudent(''); setAssignSearch(''); },
        onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
      },
    );
  };

  const parseCsv = (): any[] => {
    // externalRef,amount,payerPhone,payerName,transactionDate,narration
    return csv.trim().split('\n').filter(Boolean).map((line) => {
      const [externalRef, amount, payerPhone, payerName, transactionDate, ...rest] = line.split(',').map((x) => x.trim());
      return { externalRef, amount: Number(amount), payerPhone, payerName, transactionDate, narration: rest.join(',') };
    });
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">Payment Reconciliation</h1>
      <p className="text-sm text-muted-foreground">
        Import an MTN MoMo / Airtel Money / bank statement. Matching confidence: HIGH for our own MoMo request reference or an
        exact admission number; MEDIUM (review) for a unique guardian phone or exact name; LOW needs manual assignment. A
        reference already received is flagged, never posted twice. Nothing posts until you confirm it.
      </p>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <select className={`${sel} max-w-[200px]`} value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="mtn_momo">MTN MoMo</option>
              <option value="airtel_money">Airtel Money</option>
              <option value="bank">Bank</option>
            </select>
            <Input className="max-w-[180px]" placeholder="Statement period e.g. 2026-08" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <textarea className={`${sel} font-mono text-xs h-32`} placeholder="externalRef,amount,payerPhone,payerName,transactionDate,narration"
            value={csv} onChange={(e) => setCsv(e.target.value)} />
          <Button disabled={!csv.trim() || importPayments.isPending} onClick={() => importPayments.mutate(
            { provider, filename: `${provider}-${period || 'stmt'}.csv`, statementPeriod: period || undefined, rows: parseCsv() },
            { onSuccess: (b: any) => { setSelected(b.batch.id); notify.success(`Imported ${b.batch.rowCount} rows, ${b.batch.matchedCount} matched`); batches.refetch(); },
              onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Import failed') },
          )}>
            <Upload className="mr-1 h-4 w-4" /> Import
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Batches</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Provider</TableHead><TableHead>Rows</TableHead><TableHead className="text-right">Posted</TableHead></TableRow></TableHeader>
              <TableBody>
                {(batches.data ?? []).map((b) => (
                  <TableRow key={b.id} className="cursor-pointer" onClick={() => setSelected(b.id)}>
                    <TableCell>{b.provider}<div className="text-xs text-muted-foreground">{fmtDate(b.uploadedAt)}</div></TableCell>
                    <TableCell>{b.rowCount}</TableCell>
                    <TableCell className="text-right">{b.postedCount}/{b.rowCount}</TableCell>
                  </TableRow>
                ))}
                {batches.data?.length === 0 && <TableRow><TableCell colSpan={3} className="text-muted-foreground">No imports yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {selected && batch.data && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Rows — {batch.data.batch.originalFilename}</CardTitle>
              <Button size="sm" variant="outline" disabled={confirmHigh.isPending}
                onClick={() => confirmHigh.mutate(selected, {
                  onSuccess: (r) => notify.success(`Posted ${r.posted} of ${r.attempted} high-confidence rows`),
                  onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
                })}>
                <Zap className="mr-1 h-4 w-4" /> Post all HIGH
              </Button>
            </CardHeader>
            <CardContent className="p-0 max-h-96 overflow-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Ref</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Match</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {batch.data.rows.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.externalRef}<div className="text-muted-foreground">{r.narration}</div></TableCell>
                      <TableCell className="text-right">{money(r.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={r.matchStatus === 'posted' ? 'default' : r.matchStatus === 'matched' ? 'outline' : 'secondary'}>
                          {r.matchStatus.replace('_', ' ')} {r.matchConfidence !== 'none' ? `· ${r.matchConfidence}` : ''}
                        </Badge>
                        {r.matchReason && <div className="text-xs text-muted-foreground">{r.matchReason.replace(/_/g, ' ')}</div>}
                        {r.error && <div className="text-xs text-rose-600">{r.error}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {!['posted', 'duplicate', 'already_received', 'posting'].includes(r.matchStatus) && (
                          <>
                            {r.matchedStudentProfileId && (
                              <Button size="sm" variant="outline" className="mr-1" disabled={confirmRow.isPending}
                                title="Post this payment to the matched student"
                                onClick={() => confirmRow.mutate({ batchId: selected, rowId: r.id },
                                  { onSuccess: () => notify.success('Posted'), onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed') })}>
                                Confirm
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => { setAssignFor(r); setAssignStudent(r.matchedStudentProfileId ?? ''); }}>
                              Assign
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {assignFor && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Assign {assignFor.externalRef} · {money(assignFor.amount)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Payer: {assignFor.payerName || '—'} {assignFor.payerPhone ? `· ${assignFor.payerPhone}` : ''} {assignFor.narration ? `· ${assignFor.narration}` : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-xs" placeholder="Search pupil…" value={assignSearch} onChange={(e) => setAssignSearch(e.target.value)} />
              <select className={`${sel} max-w-sm`} value={assignStudent} onChange={(e) => setAssignStudent(e.target.value)}>
                <option value="">Select pupil…</option>
                {(assignCandidates.data?.data ?? []).map((st: any) => (
                  <option key={st.id} value={st.id}>{st.admissionNo} · {st.partner?.name ?? `${st.firstName ?? ''} ${st.lastName ?? ''}`}</option>
                ))}
              </select>
              <Button disabled={!assignStudent || confirmRow.isPending} onClick={assignAndPost}>Assign &amp; post</Button>
              <Button variant="ghost" onClick={() => setAssignFor(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


/* ═══════════════════════════ School Invoices (A1.1 / B2) ═══════════════════════════ */

export function SchoolInvoicesPage() {
  const [status, setStatus] = useState('');
  const invoices = useSchoolInvoices({ status: status || undefined, pageSize: 100 });
  const rebill = useRebillInvoice();

  // Wave 17 R05: a published fee change reaches an already-billed pupil only
  // through this approved correction — never by editing the invoice.
  const revise = async (r: { id: string; invoiceNumber: string }) => {
    const reason = window.prompt(
      `Revise ${r.invoiceNumber} to the current published fee version?\n\n` +
        'The invoice is credited in full and kept on record, the pupil is billed at the new fees, and any ' +
        'payments move to the new invoice. A second person must approve.\n\nReason (recorded permanently):',
    );
    if (!reason?.trim()) return;
    try {
      const res = await rebill.mutateAsync({ schoolFeeInvoiceId: r.id, reason: reason.trim() });
      notify.success(res.status === 'pending_approval' ? `Revision of ${r.invoiceNumber} sent for approval` : `${r.invoiceNumber} revised`);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not revise the invoice');
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Fee Invoices</h1>
        <select className={`${sel} max-w-[180px]`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="issued">Issued</option>
          <option value="settled">Settled</option>
          <option value="cancelled">Cancelled</option>
          <option value="voided">Revised (voided)</option>
        </select>
      </div>
      <p className="text-sm text-muted-foreground">
        First-class school invoices (SFI-series), each bound 1:1 to its accounting Document. The money lives on the
        Document and is shown here by joining — never duplicated, so there is no second number to disagree.
      </p>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Invoice #</TableHead><TableHead>Doc #</TableHead><TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Waived</TableHead><TableHead className="text-right">Balance</TableHead>
              <TableHead>Issued</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {invoices.isLoading && <TableRow><TableCell colSpan={9} className="text-muted-foreground">Loading…</TableCell></TableRow>}
              {invoices.data?.data.length === 0 && <TableRow><TableCell colSpan={9} className="text-muted-foreground">No invoices.</TableCell></TableRow>}
              {(invoices.data?.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.invoiceNumber}</TableCell>
                  <TableCell className="font-mono text-xs">{r.documentNumber}</TableCell>
                  <TableCell><Badge variant={r.paymentStatus === 'paid' ? 'default' : 'outline'}>{r.paymentStatus ?? r.status}</Badge></TableCell>
                  <TableCell className="text-right">{money(r.totalAmount)}</TableCell>
                  <TableCell className="text-right">{money(r.amountPaid)}</TableCell>
                  <TableCell className="text-right">{r.amountWaived ? money(r.amountWaived) : ''}</TableCell>
                  <TableCell className="text-right font-medium">{money(r.amountResidual)}</TableCell>
                  <TableCell>{fmtDate(r.issueDate)}</TableCell>
                  <TableCell className="text-right">
                    {!['voided', 'cancelled'].includes(r.status) && (
                      <Button size="sm" variant="ghost" disabled={rebill.isPending} onClick={() => void revise(r)}>
                        Revise to current fees
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
