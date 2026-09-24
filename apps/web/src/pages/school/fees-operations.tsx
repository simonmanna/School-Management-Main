/**
 * The bursar's day — the screens that were missing.
 *
 *   B2  Receipt search + reprint      a parent loses the paper
 *   B4  Bulk receipt entry            reporting day, a class at a time
 *   C1  Fee clearance                 who sits the exam, who is sent home
 *   C4  Printable termly statement    the sheet a parent is handed
 *   E1  Daily cash book               what the drawer is counted against
 *   E2  Income vs budget              is the term tracking the plan
 *   D1  Discounts                     sibling and staff-child rates
 */
import { useMemo, useState } from 'react';
import {
  Printer,
  Search,
  Send,
  ShieldCheck,
  Undo2,
  Plus,
  FileText,
  Users,
  Wallet,
} from 'lucide-react';
import {
  useReceiptSearch,
  useReceipt,
  useCollectBatch,
  useClassFeeClearance,
  useSendFeeReminders,
  useTermStatement,
  useCashBook,
  useBudgetVariance,
  useReverseAllocation,
  useReversePayment,
  useDiscounts,
  useCreateDiscount,
  useFeeStructures,
  useStudentFeeAssignments,
  useUpsertStudentFeeAssignment,
  useDeleteStudentFeeAssignment,
  useClasses,
  useStudents,
  useClassRoster,
  useTerms,
  useSchoolProfile,
  type BatchRow,
  type DiscountAppliesTo,
  type ReceiptRow,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { exportCSV } from '@/lib/export-csv';
import { money, sel, Stat, apiError } from './fees-shared';
import { JournalTrail } from './fees-integrity';

const today = () => new Date().toISOString().slice(0, 10);

/* ══════════════════════ B2 · Receipts ══════════════════════ */

export function SchoolReceiptsPage() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useReceiptSearch({ q: q || undefined, from: from || undefined, to: to || undefined });
  const { data: detail } = useReceipt(selected ?? undefined);
  const { data: profile } = useSchoolProfile();
  const reverseAllocation = useReverseAllocation();
  const reversePayment = useReversePayment();

  const rows = data?.data ?? [];

  const reverseOne = async (r: ReceiptRow) => {
    const reason = window.prompt(
      `Reverse the whole receipt ${r.paymentNumber}?\n\n` +
        'Use this only when the money never actually arrived — a mis-keyed entry, or a ' +
        'bounced transfer. To refund money that WAS received, use Refund instead.\n\n' +
        'Reason (recorded permanently):',
    );
    if (!reason?.trim()) return;
    try {
      await reversePayment.mutateAsync({ paymentId: r.id, reason: reason.trim() });
      notify.success(`Receipt ${r.paymentNumber} reversed`);
    } catch (e) {
      notify.error(apiError(e, 'Could not reverse the receipt'));
    }
  };

  const unallocateOne = async (allocationId: string, docNumber: string | null) => {
    const reason = window.prompt(
      `Un-apply this payment from ${docNumber ?? 'the invoice'}?\n\n` +
        'The money stays on the receipt and the invoice goes back to unpaid, so you can ' +
        're-apply it to the right invoice.\n\nReason (recorded permanently):',
    );
    if (!reason?.trim()) return;
    try {
      await reverseAllocation.mutateAsync({ allocationId, reason: reason.trim() });
      notify.success('Allocation reversed — the amount is back on the receipt');
    } catch (e) {
      notify.error(apiError(e, 'Could not reverse the allocation'));
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Receipts</h1>
          <p className="text-sm text-muted-foreground">
            Find and reprint any receipt, or correct one that was entered wrongly.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            exportCSV(
              'receipts.csv',
              ['Receipt', 'Date', 'Pupil', 'Admission', 'Method', 'Reference', 'Amount', 'Status'],
              rows.map((r) => [
                r.paymentNumber,
                new Date(r.paymentDate).toLocaleDateString(),
                r.studentName ?? '',
                r.admissionNo ?? '',
                r.paymentMethod,
                r.reference ?? '',
                String(r.amount),
                r.reversed ? 'reversed' : 'posted',
              ]),
            )
          }
        >
          <FileText className="h-4 w-4" /> Export
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Receipt no, admission no, pupil name, guardian phone, or MoMo reference…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Pupil</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">Loading…</TableCell>
                </TableRow>
              )}
              {!isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">No receipts match that search.</TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id} className={r.reversed ? 'opacity-60' : undefined}>
                  <TableCell className="font-mono text-xs">
                    {r.paymentNumber}
                    {r.reversed && <Badge variant="destructive" className="ml-2">Reversed</Badge>}
                  </TableCell>
                  <TableCell>{new Date(r.paymentDate).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div>{r.studentName ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{r.admissionNo ?? ''}</div>
                  </TableCell>
                  <TableCell className="capitalize">{r.paymentMethod.replace('_', ' ')}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.externalReference || r.reference || '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{money(r.amount)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(r.id)} title="Reprint">
                      <Printer className="h-4 w-4" />
                    </Button>
                    {!r.reversed && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => reverseOne(r)}
                        title="Reverse this receipt"
                      >
                        <Undo2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {detail && (
        <Card className="print-receipt">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Receipt {detail.payment?.paymentNumber}</CardTitle>
            <div className="flex gap-2 print:hidden">
              <Button size="sm" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="text-center">
              <div className="text-lg font-bold">{profile?.name ?? 'School'}</div>
              {profile?.phone && <div className="text-xs">Tel: {profile.phone}</div>}
              <div className="mt-1 font-semibold underline">FEES PAYMENT RECEIPT</div>
              <div className="text-xs text-muted-foreground">(reprint)</div>
            </div>

            <div className="grid grid-cols-2 gap-y-1 text-xs sm:grid-cols-3">
              <div><span className="text-muted-foreground">Pupil:</span> {detail.student?.partner?.name ?? '—'}</div>
              <div><span className="text-muted-foreground">Reg No:</span> {detail.student?.admissionNo ?? '—'}</div>
              <div><span className="text-muted-foreground">Class:</span> {detail.student?.currentClass?.name ?? '—'}</div>
              <div><span className="text-muted-foreground">Receipt:</span> {detail.payment?.paymentNumber}</div>
              <div><span className="text-muted-foreground">Mode:</span> {detail.payment?.paymentMethod}</div>
              <div><span className="text-muted-foreground">Date:</span> {new Date(detail.payment?.paymentDate).toLocaleDateString()}</div>
            </div>

            <Table>
              <TableHeader>
                <TableRow><TableHead>Applied to</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="print:hidden" /></TableRow>
              </TableHeader>
              <TableBody>
                {(detail.payment?.allocations ?? []).map((a: any) => (
                  <TableRow key={a.id} className={a.status === 'reversed' ? 'opacity-50 line-through' : undefined}>
                    <TableCell>{a.document?.documentNumber ?? a.documentId?.slice(0, 8)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(a.amount)}</TableCell>
                    <TableCell className="print:hidden text-right">
                      {a.status !== 'reversed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => unallocateOne(a.id, a.document?.documentNumber ?? null)}
                          title="Un-apply from this invoice"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(detail.payment?.allocations ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-muted-foreground">Held as credit — not applied to an invoice.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>

            <div className="grid grid-cols-3 gap-2">
              <Stat label="Received" value={money(detail.payment?.amount ?? 0)} tone="emerald" />
              <Stat label="Unallocated" value={money(detail.payment?.unallocatedAmount ?? 0)} />
              <Stat
                label="Balance now"
                value={money(detail.balance?.balance ?? 0)}
                tone={(detail.balance?.balance ?? 0) > 0 ? 'rose' : 'emerald'}
              />
            </div>

            <div className="space-y-2 print:hidden">
              <p className="text-xs font-medium text-muted-foreground">Accounting trail</p>
              <JournalTrail journalEntryId={detail.payment?.journalEntryId} label={`Receipt journal · ${detail.payment?.paymentMethod?.replace('_', ' ')}`} />
              {(detail.payment?.allocations ?? [])
                .filter((a: any) => a.document?.journalEntryId)
                .map((a: any) => (
                  <JournalTrail key={a.id} journalEntryId={a.document.journalEntryId} label={`Invoice ${a.document.documentNumber}`} />
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ══════════════════════ B4 · Bulk entry ══════════════════════ */

export function SchoolBulkCollectPage() {
  const [classId, setClassId] = useState('');
  const [paymentDate, setPaymentDate] = useState(today());
  const [draft, setDraft] = useState<Record<string, { amount: string; method: BatchRow['paymentMethod']; reference: string }>>({});
  const [result, setResult] = useState<Awaited<ReturnType<ReturnType<typeof useCollectBatch>['mutateAsync']>> | null>(null);

  const { data: classes } = useClasses();
  const { data: rosterRows } = useClassRoster(classId || undefined);
  const batch = useCollectBatch();

  const roster = rosterRows ?? [];
  const rows: BatchRow[] = useMemo(
    () =>
      Object.entries(draft)
        .filter(([, v]) => Number(v.amount) > 0)
        .map(([studentProfileId, v]) => ({
          studentProfileId,
          amount: Number(v.amount),
          paymentMethod: v.method ?? 'cash',
          reference: v.reference || undefined,
          // Reporting-day tenders are almost always round; anything over what
          // is owed is held as credit rather than rejected.
          convertOverpaymentToCredit: true,
        })),
    [draft],
  );
  const total = rows.reduce((t, r) => t + r.amount, 0);

  const setRow = (id: string, patch: Partial<{ amount: string; method: BatchRow['paymentMethod']; reference: string }>) =>
    setDraft((d) => {
      const existing = d[id];
      return {
        ...d,
        [id]: {
          amount: patch.amount ?? existing?.amount ?? '',
          method: patch.method ?? existing?.method ?? 'cash',
          reference: patch.reference ?? existing?.reference ?? '',
        },
      };
    });

  const submit = async () => {
    if (rows.length === 0) return notify.error('Enter at least one amount');
    try {
      const res = await batch.mutateAsync({ rows, paymentDate });
      setResult(res);
      if (res.failed === 0) {
        notify.success(`${res.posted} receipt(s) posted · ${money(res.totalCollected)}`);
        setDraft({});
      } else {
        notify.error(`${res.posted} posted, ${res.failed} failed — see the results below`);
      }
    } catch (e) {
      notify.error(apiError(e, 'Could not post the batch'));
    }
  };

  const resultFor = (id: string) => result?.results.find((r) => r.studentProfileId === id);

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Bulk Collection</h1>
        <p className="text-sm text-muted-foreground">
          Reporting day — take a whole class at once. Each row posts on its own, so one bad row
          never undoes the receipts beside it.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Class</Label>
            <select className={sel} value={classId} onChange={(e) => { setClassId(e.target.value); setDraft({}); setResult(null); }}>
              <option value="">Select a class…</option>
              {(classes?.data ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Payment date</Label>
            <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={submit} disabled={batch.isPending || rows.length === 0}>
              <Wallet className="h-4 w-4" /> Post {rows.length} receipt(s) · {money(total)}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardContent className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
            <Stat label="Posted" value={String(result.posted)} tone="emerald" />
            <Stat label="Already recorded" value={String(result.replayed)} />
            <Stat label="Failed" value={String(result.failed)} tone={result.failed ? 'rose' : undefined} />
            <Stat label="Collected" value={money(result.totalCollected)} tone="emerald" />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pupil</TableHead>
                <TableHead className="w-40">Amount</TableHead>
                <TableHead className="w-36">Method</TableHead>
                <TableHead className="w-48">Reference</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!classId && (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground">Pick a class to load its roster.</TableCell></TableRow>
              )}
              {classId && roster.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground">No active pupils in this class.</TableCell></TableRow>
              )}
              {roster.map((s: any) => {
                const r = resultFor(s.id);
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div>{s.partner?.name ?? s.id}</div>
                      <div className="text-xs text-muted-foreground">{s.admissionNo}</div>
                    </TableCell>
                    <TableCell>
                      <Input
                        inputMode="numeric"
                        placeholder="0"
                        value={draft[s.id]?.amount ?? ''}
                        onChange={(e) => setRow(s.id, { amount: e.target.value.replace(/[^\d]/g, '') })}
                      />
                    </TableCell>
                    <TableCell>
                      <select
                        className={sel}
                        value={draft[s.id]?.method ?? 'cash'}
                        onChange={(e) => setRow(s.id, { method: e.target.value as BatchRow['paymentMethod'] })}
                      >
                        <option value="cash">Cash</option>
                        <option value="mobile_money">Mobile money</option>
                        <option value="bank">Bank</option>
                      </select>
                    </TableCell>
                    <TableCell>
                      <Input
                        placeholder="MoMo / slip no."
                        value={draft[s.id]?.reference ?? ''}
                        onChange={(e) => setRow(s.id, { reference: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="text-sm">
                      {!r && <span className="text-muted-foreground">—</span>}
                      {r?.status === 'posted' && (
                        <span className="text-emerald-600">
                          {r.paymentNumber}
                          {r.creditCode && ` · credit ${r.creditCode}`}
                        </span>
                      )}
                      {r?.status === 'replayed' && <span className="text-muted-foreground">Already recorded</span>}
                      {r?.status === 'failed' && <span className="text-destructive">{r.error}</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════ C1 · Fee clearance ══════════════════════ */

export function SchoolFeeClearancePage() {
  const [classId, setClassId] = useState('');
  const [threshold, setThreshold] = useState('');
  const { data: classes } = useClasses();
  const { data, isLoading } = useClassFeeClearance(classId || undefined, threshold ? Number(threshold) : undefined);
  const remind = useSendFeeReminders();

  const sendReminders = async (overdue: boolean) => {
    try {
      const res = await remind.mutateAsync({ classId: classId || undefined, overdue, daysAhead: 7 });
      notify.success(`${res.sent} guardian message(s) sent · ${res.skipped} pupil(s) owed nothing`);
    } catch (e) {
      notify.error(apiError(e, 'Could not send reminders'));
    }
  };

  const tone = (s: string) => (s === 'cleared' ? 'default' : s === 'partial' ? 'secondary' : 'destructive');

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Fee Clearance</h1>
        <p className="text-sm text-muted-foreground">
          Who has cleared enough to sit exams. Waived and bursary amounts count as cleared — the
          school chose not to collect them.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <div>
            <Label className="text-xs">Class</Label>
            <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Select a class…</option>
              {(classes?.data ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Clearance bar (%)</Label>
            <Input
              inputMode="numeric"
              placeholder={String(data?.thresholdPercent ?? 100)}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value.replace(/[^\d]/g, ''))}
            />
          </div>
          <div className="flex items-end gap-2 sm:col-span-2">
            <Button variant="outline" disabled={remind.isPending} onClick={() => sendReminders(false)}>
              <Send className="h-4 w-4" /> Remind (due soon)
            </Button>
            <Button variant="destructive" disabled={remind.isPending} onClick={() => sendReminders(true)}>
              <Send className="h-4 w-4" /> Remind (overdue)
            </Button>
          </div>
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardContent className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
            <Stat label="Pupils" value={String(data.total)} />
            <Stat label="Cleared" value={String(data.cleared)} tone="emerald" />
            <Stat label="Part-paid" value={String(data.partial)} />
            <Stat label="Nothing paid" value={String(data.blocked)} tone="rose" />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            <ShieldCheck className="mr-1 inline h-4 w-4" /> Clearance list
          </CardTitle>
          {data && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportCSV(
                  'fee-clearance.csv',
                  ['Admission', 'Pupil', 'Billed', 'Settled', 'Outstanding', '%', 'Status'],
                  data.rows.map((r) => [
                    r.admissionNo ?? '',
                    r.studentName ?? '',
                    String(r.billed),
                    String(r.settled),
                    String(r.outstanding),
                    String(r.settledPercent),
                    r.status,
                  ]),
                )
              }
            >
              <FileText className="h-4 w-4" /> Export
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pupil</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">Settled</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!classId && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Pick a class.</TableCell></TableRow>}
              {isLoading && classId && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell></TableRow>}
              {(data?.rows ?? []).map((r) => (
                <TableRow key={r.studentProfileId}>
                  <TableCell>
                    <div>{r.studentName}</div>
                    <div className="text-xs text-muted-foreground">{r.admissionNo}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.billed)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.settled)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.outstanding)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.settledPercent}%</TableCell>
                  <TableCell>
                    <Badge variant={tone(r.status) as any} className="capitalize">
                      {r.status === 'blocked' ? 'Not cleared' : r.status}
                    </Badge>
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

/* ══════════════════════ C4 · Printable statement ══════════════════════ */

export function SchoolFeeStatementPage() {
  const [studentId, setStudentId] = useState('');
  const [termId, setTermId] = useState('');
  const [search, setSearch] = useState('');
  const { data: students } = useStudents({ search: search || undefined, pageSize: 20 });
  const { data: terms } = useTerms();
  const { data: st } = useTermStatement(studentId || undefined, termId || undefined);

  return (
    <div className="space-y-4 p-6">
      <div className="print:hidden">
        <h1 className="text-xl font-semibold">Fee Statement</h1>
        <p className="text-sm text-muted-foreground">
          The sheet a parent is handed. Opening balance, everything that happened this term, and
          what is left.
        </p>
      </div>

      <Card className="print:hidden">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label className="text-xs">Pupil</Label>
            <Input placeholder="Search name or admission no…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className={`${sel} mt-1`} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">Select a pupil…</option>
              {(students?.data ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Term</Label>
            <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}>
              <option value="">Current term</option>
              {(terms?.data ?? []).map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button className="w-full" disabled={!st} onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        </CardContent>
      </Card>

      {st && (
        <Card className="print-receipt">
          <CardContent className="space-y-4 p-6 text-sm">
            <div className="text-center">
              <div className="text-lg font-bold">{st.school?.name ?? 'School'}</div>
              {st.school?.address && <div className="text-xs">{st.school.address}</div>}
              {st.school?.phone && <div className="text-xs">Tel: {st.school.phone}</div>}
              <div className="mt-2 font-semibold underline">FEE STATEMENT</div>
              {st.term && (
                <div className="text-xs text-muted-foreground">
                  {st.term.name} · {new Date(st.term.startDate).toLocaleDateString()} – {new Date(st.term.endDate).toLocaleDateString()}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-y-1 text-xs sm:grid-cols-4">
              <div><span className="text-muted-foreground">Pupil:</span> {st.student?.partner?.name}</div>
              <div><span className="text-muted-foreground">Reg No:</span> {st.student?.admissionNo}</div>
              <div><span className="text-muted-foreground">Class:</span> {st.student?.currentClass?.name ?? '—'}</div>
              <div><span className="text-muted-foreground">Issued:</span> {new Date(st.generatedAt).toLocaleDateString()}</div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Charge</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(st.ledger?.rows ?? []).map((r: any, i: number) => (
                  <TableRow key={i} className={r.ledgerType === 'OPENING_BALANCE' ? 'font-medium' : undefined}>
                    <TableCell className="whitespace-nowrap">{new Date(r.date).toLocaleDateString()}</TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.debit ? money(r.debit) : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.credit ? money(r.credit) : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.balance)}</TableCell>
                  </TableRow>
                ))}
                {(st.ledger?.rows ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-muted-foreground">Nothing recorded in this term.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>

            {(st.advanceReceipts ?? []).length > 0 && (
              <div className="space-y-1 text-xs">
                <p className="font-medium">Paid in advance — held as credit</p>
                {(st.advanceReceipts ?? []).map((a: any) => (
                  <div key={a.creditCode} className="flex justify-between gap-2">
                    <span>{new Date(a.date).toLocaleDateString()} · <span className="font-mono">{a.reference}</span></span>
                    <span className="tabular-nums">{money(a.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Billed (all time)" value={money(st.balance?.billed ?? 0)} />
              <Stat label="Paid" value={money(st.balance?.collected ?? 0)} tone="emerald" />
              <Stat label="Waived / credited" value={money((st.balance?.waived ?? 0) + (st.balance?.credited ?? 0))} />
              <Stat
                label="Balance due"
                value={money(st.balance?.balance ?? 0)}
                tone={(st.balance?.balance ?? 0) > 0 ? 'rose' : 'emerald'}
              />
              <Stat label="Credit on account" value={money(st.creditOnAccount ?? 0)} tone="emerald" />
            </div>

            {st.clearance && (
              <p className="text-center text-xs text-muted-foreground">
                {st.clearance.status === 'cleared'
                  ? 'Fees cleared for this term.'
                  : `${st.clearance.settledPercent}% cleared — ${money(st.clearance.shortfall)} short of the ${st.clearance.thresholdPercent}% required.`}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ══════════════════════ E1 / E2 · Reports ══════════════════════ */

export function SchoolCashBookPage() {
  const [date, setDate] = useState(today());
  const { data } = useCashBook(date);
  const { data: variance } = useBudgetVariance();

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold">Daily Cash Book</h1>
          <p className="text-sm text-muted-foreground">
            What the drawer is counted against at close of day. Only cash is physically counted —
            mobile money and bank are separate accounts, not discrepancies.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button>
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5">
          <Stat label="Receipts" value={String(data?.receiptCount ?? 0)} />
          <Stat label="Collected" value={money(data?.totalCollected ?? 0)} tone="emerald" />
          <Stat label="Cash in drawer" value={money(data?.cashTotal ?? 0)} />
          <Stat label="Refunds paid" value={money(data?.refundsPaid ?? 0)} tone={data?.refundsPaid ? 'rose' : undefined} />
          <Stat label="Net cash" value={money(data?.netCash ?? 0)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">By method</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Method</TableHead><TableHead className="text-right">Receipts</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.byMethod ?? []).map((m) => (
                <TableRow key={m.method}>
                  <TableCell className="capitalize">{m.method.replace('_', ' ')}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(m.total)}</TableCell>
                </TableRow>
              ))}
              {(data?.byMethod ?? []).length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-muted-foreground">Nothing collected on this date.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(data?.reversedCount ?? 0) > 0 && (
        <p className="text-sm text-muted-foreground">
          {data!.reversedCount} receipt(s) totalling {money(data!.reversedTotal)} were reversed on this date and are
          excluded from the totals above.
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Receipts</CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="print:hidden"
            onClick={() =>
              exportCSV(
                `cash-book-${date}.csv`,
                ['Receipt', 'Time', 'Payer', 'Method', 'Reference', 'Amount'],
                (data?.receipts ?? []).map((r) => [
                  r.paymentNumber,
                  new Date(r.time).toLocaleTimeString(),
                  r.payer,
                  r.method,
                  r.reference ?? '',
                  String(r.amount),
                ]),
              )
            }
          >
            <FileText className="h-4 w-4" /> Export
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Receipt</TableHead><TableHead>Time</TableHead><TableHead>Payer</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(data?.receipts ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.paymentNumber}</TableCell>
                  <TableCell>{new Date(r.time).toLocaleTimeString()}</TableCell>
                  <TableCell>{r.payer}</TableCell>
                  <TableCell className="capitalize">{r.method.replace('_', ' ')}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader className="pb-2"><CardTitle className="text-base">Income vs budget</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Budget</TableHead><TableHead>Term</TableHead><TableHead className="text-right">Planned</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Variance</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(variance?.rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}<div className="text-xs text-muted-foreground">{r.category}</div></TableCell>
                  <TableCell>{r.termName ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.planned)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.actual)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.variance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {money(r.variance)}
                    {r.achievedPercent != null && <span className="ml-1 text-xs text-muted-foreground">({r.achievedPercent}%)</span>}
                  </TableCell>
                </TableRow>
              ))}
              {(variance?.rows ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground">No budgets set. Add one under Budgeting to track income against a plan.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ══════════════════════ D3 · Per-pupil fee overrides ══════════════════════ */

export function SchoolFeeOverridesPage() {
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const [structureId, setStructureId] = useState('');
  const [termId, setTermId] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const { data: students } = useStudents({ search: search || undefined, pageSize: 20 });
  const { data: structures } = useFeeStructures();
  const { data: terms } = useTerms();
  const { data: existing } = useStudentFeeAssignments(studentId || undefined);
  const upsert = useUpsertStudentFeeAssignment();
  const remove = useDeleteStudentFeeAssignment();

  const structure = (structures?.data ?? []).find((s) => s.id === structureId);
  const components = structure?.components ?? [];
  const current = (existing ?? []).find((a) => a.feeStructureId === structureId && a.termId === termId);

  // Load whatever override already exists for this (pupil, structure, term).
  const load = (sid: string, tid: string) => {
    const found = (existing ?? []).find((a) => a.feeStructureId === sid && a.termId === tid);
    setAmounts(
      Object.fromEntries(Object.entries(found?.customDiscount ?? {}).map(([k, v]) => [k, String(v)])),
    );
  };

  const save = async () => {
    if (!studentId || !structureId || !termId) return notify.error('Pick a pupil, a structure and a term');
    const customDiscount: Record<string, number> = {};
    for (const [code, v] of Object.entries(amounts)) {
      if (v !== '' && Number.isFinite(Number(v))) customDiscount[code] = Number(v);
    }
    if (Object.keys(customDiscount).length === 0) {
      return notify.error('Set at least one component price, or delete the override entirely');
    }
    try {
      await upsert.mutateAsync({ id: current?.id, studentProfileId: studentId, feeStructureId: structureId, termId, customDiscount });
      notify.success('Override saved — it applies from the next billing run');
    } catch (e) {
      notify.error(apiError(e, 'Could not save the override'));
    }
  };

  const clear = async () => {
    if (!current) return;
    try {
      await remove.mutateAsync(current.id);
      setAmounts({});
      notify.success('Override removed — this pupil now pays the standard price');
    } catch (e) {
      notify.error(apiError(e, 'Could not remove the override'));
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Per-Pupil Fee Overrides</h1>
        <p className="text-sm text-muted-foreground">
          Set what one pupil pays for a component, overriding the structure price. Use this for a
          negotiated rate. For a concession that applies to many pupils, make a Discount instead;
          for one the school absorbs after billing, use a Waiver.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Pupil</Label>
            <Input placeholder="Search name or admission no…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select
              className={`${sel} mt-1`}
              value={studentId}
              onChange={(e) => { setStudentId(e.target.value); setAmounts({}); }}
            >
              <option value="">Select a pupil…</option>
              {(students?.data ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Fee structure</Label>
            <select
              className={sel}
              value={structureId}
              onChange={(e) => { setStructureId(e.target.value); load(e.target.value, termId); }}
            >
              <option value="">Select a structure…</option>
              {(structures?.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Term</Label>
            <select
              className={sel}
              value={termId}
              onChange={(e) => { setTermId(e.target.value); load(structureId, e.target.value); }}
            >
              <option value="">Select a term…</option>
              {(terms?.data ?? []).map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {structureId && termId && studentId && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Component prices for this pupil
              {current && <Badge className="ml-2">Override active</Badge>}
            </CardTitle>
            <div className="flex gap-2">
              {current && <Button variant="outline" size="sm" onClick={clear}>Remove override</Button>}
              <Button size="sm" onClick={save} disabled={upsert.isPending}>Save</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead className="text-right">Standard price</TableHead>
                  <TableHead className="w-48">This pupil pays</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {components.map((c: any) => (
                  <TableRow key={c.code}>
                    <TableCell>
                      {c.name || c.code}
                      {c.isOptional && <Badge variant="secondary" className="ml-2">Optional</Badge>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{money(c.amount)}</TableCell>
                    <TableCell>
                      <Input
                        inputMode="numeric"
                        placeholder="standard"
                        value={amounts[c.code] ?? ''}
                        onChange={(e) => setAmounts({ ...amounts, [c.code]: e.target.value.replace(/[^\d]/g, '') })}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {components.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-muted-foreground">This structure has no components.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {studentId && (existing ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Existing overrides for this pupil</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Structure</TableHead><TableHead>Term</TableHead><TableHead>Overridden components</TableHead></TableRow></TableHeader>
              <TableBody>
                {(existing ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.feeStructure?.name ?? a.feeStructureId.slice(0, 8)}</TableCell>
                    <TableCell>{a.term?.name ?? a.termId.slice(0, 8)}</TableCell>
                    <TableCell className="text-sm">
                      {Object.entries(a.customDiscount ?? {}).map(([k, v]) => `${k}: ${money(v)}`).join(' · ') || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ══════════════════════ D1 · Discounts ══════════════════════ */

export function SchoolDiscountsPage() {
  const { data: discounts, isLoading } = useDiscounts();
  const create = useCreateDiscount();
  const { data: classes } = useClasses();
  const [draft, setDraft] = useState({ code: '', name: '', type: 'percentage' as 'percentage' | 'fixed_amount', value: '' });
  // Who the discount is for. There is no "blank = everyone": an untargeted
  // discount used to reach every pupil in the school, so the whole-school case
  // must be chosen deliberately.
  const [scope, setScope] = useState<'students' | 'classes' | 'all'>('students');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [pupils, setPupils] = useState<Array<{ id: string; label: string }>>([]);
  const [search, setSearch] = useState('');
  const { data: found } = useStudents({ search: search || undefined, pageSize: 20 });

  const appliesTo: DiscountAppliesTo =
    scope === 'all' ? { allStudents: true }
    : scope === 'classes' ? { classIds }
    : { studentProfileIds: pupils.map((p) => p.id) };

  const save = async () => {
    if (!draft.code.trim() || !draft.name.trim()) return notify.error('A code and a name are required');
    if (!(Number(draft.value) > 0)) return notify.error('Enter a value above zero');
    if (scope === 'classes' && classIds.length === 0) return notify.error('Pick at least one class');
    if (scope === 'students' && pupils.length === 0) return notify.error('Add at least one pupil');
    try {
      await create.mutateAsync({
        code: draft.code.trim().toUpperCase(),
        name: draft.name.trim(),
        type: draft.type,
        value: Number(draft.value),
        appliesTo,
      });
      notify.success(`Discount ${draft.code.toUpperCase()} created`);
      setDraft({ code: '', name: '', type: 'percentage', value: '' });
      setClassIds([]);
      setPupils([]);
    } catch (e) {
      notify.error(apiError(e, 'Could not create the discount'));
    }
  };

  const describe = (a: DiscountAppliesTo | null | undefined) => {
    if (!a) return 'No one';
    if (a.allStudents) return 'Whole school';
    const parts: string[] = [];
    if (a.studentProfileIds?.length) parts.push(`${a.studentProfileIds.length} pupil(s)`);
    if (a.classIds?.length) parts.push(`${a.classIds.length} class(es)`);
    if (a.gradeLevelIds?.length) parts.push(`${a.gradeLevelIds.length} grade level(s)`);
    return parts.join(' · ') || 'No one';
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Discounts</h1>
        <p className="text-sm text-muted-foreground">
          Concessions applied at billing time — sibling rates, staff children, prompt payment. The
          billing engine has always applied these; this is where you set them up.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base"><Plus className="mr-1 inline h-4 w-4" /> New discount</CardTitle></CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-5">
          <div>
            <Label className="text-xs">Code</Label>
            <Input placeholder="SIBLING" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Name</Label>
            <Input placeholder="Second child in school" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <select className={sel} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as any })}>
              <option value="percentage">Percentage</option>
              <option value="fixed_amount">Fixed amount</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-xs">{draft.type === 'percentage' ? 'Percent' : 'Amount per pupil'}</Label>
              <Input inputMode="numeric" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value.replace(/[^\d.]/g, '') })} />
            </div>
            <Button onClick={save} disabled={create.isPending}>Add</Button>
          </div>
          <div className="space-y-2 sm:col-span-5">
            <Label className="text-xs">Applies to</Label>
            <select className={sel} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="students">Specific pupils</option>
              <option value="classes">Whole classes</option>
              <option value="all">Every pupil in the school</option>
            </select>
            {scope === 'classes' && (
              <div className="flex flex-wrap gap-3 text-sm">
                {(classes?.data ?? []).map((c) => (
                  <label key={c.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={classIds.includes(c.id)}
                      onChange={(e) => setClassIds(e.target.checked ? [...classIds, c.id] : classIds.filter((x) => x !== c.id))}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
            {scope === 'students' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Input placeholder="Search name or admission no…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <select
                    className={`${sel} mt-1`}
                    value=""
                    onChange={(e) => {
                      const s = (found?.data ?? []).find((x: any) => x.id === e.target.value) as any;
                      if (s && !pupils.some((p) => p.id === s.id)) {
                        setPupils([...pupils, { id: s.id, label: `${s.partner?.name ?? ''} · ${s.admissionNo}` }]);
                      }
                    }}
                  >
                    <option value="">Add a pupil…</option>
                    {(found?.data ?? []).map((s: any) => (
                      <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-1">
                  {pupils.map((p) => (
                    <Badge key={p.id} variant="secondary" className="cursor-pointer" onClick={() => setPupils(pupils.filter((x) => x.id !== p.id))}>
                      {p.label} ×
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {scope === 'all' && (
              <p className="text-xs text-muted-foreground">This discount will reduce every pupil's bill at the next billing run.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base"><Users className="mr-1 inline h-4 w-4" /> Active discounts</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Applies to</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Loading…</TableCell></TableRow>}
              {(discounts?.data ?? []).map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.code}</TableCell>
                  <TableCell>{d.name}</TableCell>
                  <TableCell className="capitalize">{d.type.replace('_', ' ')}</TableCell>
                  <TableCell>{describe(d.appliesTo)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {d.type === 'percentage' ? `${d.value}%` : money(d.value)}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (discounts?.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-muted-foreground">No discounts yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
