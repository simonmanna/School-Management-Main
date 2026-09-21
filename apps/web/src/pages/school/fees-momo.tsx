/**
 * Operational reach — the four things that separate a working module from one
 * a school will actually choose.
 *
 *   Mobile money    prompt a parent's phone; the balance moves in seconds
 *   Explainer       "why does this pupil owe this?", answered in one panel
 *   Parent payment  the portal already shows the balance; now it takes the money
 */
import { useState } from 'react';
import { Smartphone, HelpCircle, Send, RefreshCw, CheckCircle2, Clock, XCircle } from 'lucide-react';
import {
  useMomoAvailability,
  useMomoRequests,
  useRequestMomoPayment,
  useBalanceExplainer,
  useStudents,
  type MomoRequest,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { money, sel, Stat, apiError } from './fees-shared';
import { MomoClearingCard, MomoGatewaysCard } from './fees-integrity';

const statusPill = (s: MomoRequest['status']) =>
  s === 'succeeded' ? (
    <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Paid</Badge>
  ) : s === 'pending' ? (
    <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> Waiting on phone</Badge>
  ) : s === 'needs_review' ? (
    <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700"><Clock className="h-3 w-3" /> Needs review</Badge>
  ) : (
    <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Failed</Badge>
  );

/* ══════════════════ Mobile money collection ══════════════════ */

export function SchoolMobileMoneyPage() {
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const [provider, setProvider] = useState<'mtn' | 'airtel'>('mtn');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');

  const { data: availability } = useMomoAvailability();
  const { data: students } = useStudents({ search: search || undefined, pageSize: 20 });
  const { data: requests, refetch, isFetching } = useMomoRequests({});
  const request = useRequestMomoPayment();

  const anyConfigured = availability?.mtn || availability?.airtel;

  const send = async () => {
    if (!studentId) return notify.error('Pick a pupil');
    if (!(Number(amount) > 0)) return notify.error('Enter an amount above zero');
    if (!phone.trim()) return notify.error("Enter the parent's phone number");
    try {
      const res = await request.mutateAsync({
        provider,
        studentProfileId: studentId,
        amount: Number(amount),
        phone: phone.trim(),
      });
      notify.success(
        res.status === 'pending'
          ? 'Prompt sent — the parent must approve it on their phone'
          : `Request ${res.status}${res.message ? `: ${res.message}` : ''}`,
      );
      setAmount('');
      setPhone('');
    } catch (e) {
      notify.error(apiError(e, 'Could not send the payment prompt'));
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Mobile Money Collection</h1>
        <p className="text-sm text-muted-foreground">
          Prompt a parent's phone to pay. Nothing is recorded until they approve it — the
          confirmation posts the receipt automatically, exactly as if you had taken the cash.
        </p>
      </div>

      {!anyConfigured && (
        <Card>
          <CardContent className="p-4 text-sm">
            <p className="font-medium">No mobile-money gateway is ready yet.</p>
            <p className="mt-1 text-muted-foreground">
              Complete a gateway below (base URL, credentials and callback secret) to enable live
              collection. Until then you can still import a MoMo or bank statement under Payment
              Reconciliation, which posts the same receipts a day later.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base"><Smartphone className="mr-1 inline h-4 w-4" /> Request a payment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-5">
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
            <Label className="text-xs">Provider</Label>
            <select className={sel} value={provider} onChange={(e) => setProvider(e.target.value as 'mtn' | 'airtel')}>
              <option value="mtn" disabled={!availability?.mtn}>MTN MoMo{availability?.mtn ? '' : ' (not configured)'}</option>
              <option value="airtel" disabled={!availability?.airtel}>Airtel Money{availability?.airtel ? '' : ' (not configured)'}</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Amount</Label>
            <Input inputMode="numeric" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} />
          </div>
          <div>
            <Label className="text-xs">Parent's phone</Label>
            <Input placeholder="0772 000000" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="sm:col-span-5">
            <Button onClick={send} disabled={request.isPending || !anyConfigured}>
              <Send className="h-4 w-4" /> Send prompt
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recent requests</CardTitle>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pupil</TableHead><TableHead>Provider</TableHead><TableHead>Phone</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(requests ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div>{r.studentProfile?.partner?.name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{r.studentProfile?.admissionNo}</div>
                  </TableCell>
                  <TableCell className="uppercase">{r.provider}</TableCell>
                  <TableCell className="font-mono text-xs">{r.msisdn}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(r.amount)}
                    {r.receivedAmount != null && Number(r.receivedAmount) !== Number(r.amount) && (
                      <div className="text-xs text-amber-700">received {money(r.receivedAmount)}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {statusPill(r.status)}
                    {r.failureReason && <div className="mt-1 text-xs text-destructive">{r.failureReason}</div>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              {(requests ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-muted-foreground">No requests yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <MomoClearingCard />
      <MomoGatewaysCard />
    </div>
  );
}

/* ══════════════════ "Why does this pupil owe this?" ══════════════════ */

export function SchoolBalanceExplainerPage() {
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const { data: students } = useStudents({ search: search || undefined, pageSize: 20 });
  const { data: ex } = useBalanceExplainer(studentId || undefined);

  return (
    <div className="space-y-4 p-6">
      <div className="print:hidden">
        <h1 className="text-xl font-semibold">Explain a Balance</h1>
        <p className="text-sm text-muted-foreground">
          Every figure behind what a family owes, in the order it happened. Read it out at the
          window when a parent asks why.
        </p>
      </div>

      <Card className="print:hidden">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Pupil</Label>
            <Input placeholder="Search name or admission no…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className={`${sel} mt-1`} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">Select a pupil…</option>
              {(students?.data ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" disabled={!ex} onClick={() => window.print()}>Print</Button>
          </div>
        </CardContent>
      </Card>

      {ex && (
        <>
          <Card>
            <CardContent className="p-4">
              <p className="text-base font-medium">{ex.headline}</p>
              {ex.className && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {ex.studentName} · {ex.admissionNo} · {ex.className}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5">
              <Stat label="Billed" value={money(ex.summary.billed)} />
              <Stat label="Paid" value={money(ex.summary.paid)} tone="emerald" />
              <Stat label="Waived" value={money(ex.summary.waived)} />
              <Stat label="Credit applied" value={money(ex.summary.credited)} />
              <Stat
                label="Outstanding"
                value={money(ex.summary.outstanding)}
                tone={ex.summary.outstanding > 0 ? 'rose' : 'emerald'}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base"><HelpCircle className="mr-1 inline h-4 w-4" /> How it adds up</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead><TableHead>What happened</TableHead>
                    <TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ex.lines.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(l.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </TableCell>
                      <TableCell>{l.label}</TableCell>
                      <TableCell className={`text-right tabular-nums ${l.amount < 0 ? 'text-emerald-600' : ''}`}>
                        {l.amount === 0 ? '—' : `${l.amount < 0 ? '−' : ''}${money(Math.abs(l.amount))}`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{money(l.runningBalance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {ex.clearance && (
            <p className="text-sm text-muted-foreground">
              {ex.clearance.status === 'cleared'
                ? 'Fees are cleared — this pupil may sit exams.'
                : `${ex.clearance.settledPercent}% cleared. ${money(ex.clearance.shortfall)} short of the ${ex.clearance.thresholdPercent}% required to sit exams.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
