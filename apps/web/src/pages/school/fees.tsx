import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Play, TrendingDown, GraduationCap, Gavel, RotateCcw, HeartHandshake, PiggyBank, Clock } from 'lucide-react';
import {
  useFeeSchedules,
  useGenerateBilling,
  useTerms,
  useClasses,
  useStudents,
  useStudentStatement,
  useArrearsByClass,
  useDailyCollections,
  useScholarships,
  useCreateScholarship,
  usePenaltyRules,
  useCreatePenaltyRule,
  usePenaltyRuns,
  useRefundFee,
  useRefundRequests,
  useDecideRefundRequest,
  useFeeCorrections,
  useDecideFeeCorrection,
  useSponsorships,
  useCreateSponsorship,
  useFeeCredits,
  useCreateFeeCredit,
  useApplyCredits,
  useFeeAging,
  usePartners,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/stores/auth.store';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';
import { money, sel, Stat } from './fees-shared';

export function SchoolFeesPage() {
  const [params, setParams] = useSearchParams();
  const activeTab = params.get('tab') || 'billing';
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Fees &amp; Billing</h1>
        <p className="text-sm text-muted-foreground">Fee structures, term billing, arrears, discounts, scholarships, installments, penalties, refunds, sponsors, credits and aging.</p>
      </div>
      <Tabs value={activeTab} onValueChange={(v) => setParams(v === 'billing' ? {} : { tab: v })}>
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="billing">Billing run</TabsTrigger>
          {/*
            Phase 0 of the Fees & Finance hardening plan: the Discounts and
            Installments tabs are hidden because nothing consumes what they
            save. The billing engine never reads a Discount row, and no invoice
            or due date is ever generated from an InstallmentPlan — so staff
            were configuring policy that silently did nothing, which is worse
            than the feature not existing. A5 either wires them into the fee
            calculation pipeline or deletes them outright; the tab components
            below are left in place until that call is made.
          */}
          <TabsTrigger value="scholarships">Scholarships</TabsTrigger>
          <TabsTrigger value="penalties">Penalties</TabsTrigger>
          <TabsTrigger value="refund">Refund</TabsTrigger>
          <TabsTrigger value="sponsors">Sponsors</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="aging">Aging</TabsTrigger>
          <TabsTrigger value="arrears">Arrears</TabsTrigger>
        </TabsList>
        <TabsContent value="billing" className="pt-4"><BillingTab /></TabsContent>
        <TabsContent value="scholarships" className="pt-4"><ScholarshipsTab /></TabsContent>
        <TabsContent value="penalties" className="pt-4"><PenaltiesTab /></TabsContent>
        <TabsContent value="refund" className="pt-4"><RefundTab /></TabsContent>
        <TabsContent value="sponsors" className="pt-4"><SponsorsTab /></TabsContent>
        <TabsContent value="credits" className="pt-4"><CreditsTab /></TabsContent>
        <TabsContent value="aging" className="pt-4"><AgingTab /></TabsContent>
        <TabsContent value="arrears" className="pt-4"><ArrearsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ─────────────── Billing run ─────────────── */

function BillingTab() {
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [result, setResult] = useState<{ count: number; skipped: number } | null>(null);
  const generate = useGenerateBilling();

  const run = async () => {
    try {
      const res = await generate.mutateAsync({ termId, classId: classId || undefined });
      setResult({ count: res.count, skipped: res.skipped.length });
      notify.success(`Billing run complete · ${res.count} invoice(s) created`);
    } catch {
      notify.error('Billing run failed — check a fee schedule exists for the term');
    }
  };

  return (
    <Card className="max-w-xl">
      <CardHeader><CardTitle className="text-base">Generate term fees</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Term</Label>
          <select className={sel} value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="">Select term…</option>
            {(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.isCurrent ? ' (current)' : ''}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Class (optional — all active students if blank)</Label>
          <select className={sel} value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <Button onClick={run} disabled={!termId || generate.isPending}><Play className="h-4 w-4" /> Run billing</Button>
        {result && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <span className="font-semibold text-emerald-600">{result.count}</span> invoice(s) created
            {result.skipped > 0 && <span className="text-muted-foreground"> · {result.skipped} already billed</span>}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Each student gets one posted AR invoice per the term's fee schedule. Re-running is idempotent.</p>
      </CardContent>
    </Card>
  );
}

/* ─────────────── Arrears ─────────────── */

function ArrearsTab() {
  const { data: arrears } = useArrearsByClass();
  const { data: collections } = useDailyCollections();
  const total = (arrears ?? []).reduce((s, a) => s + a.outstanding, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingDown className="h-4 w-4" /> Outstanding by class</CardTitle></CardHeader>
        <CardContent>
          <div className="mb-2 text-sm text-muted-foreground">Total outstanding: <span className="font-semibold text-rose-600">{money(total)}</span></div>
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground"><tr><th className="py-1">Class</th><th>Students</th><th className="text-right">Outstanding</th></tr></thead>
            <tbody>
              {(arrears ?? []).map((a) => (
                <tr key={a.classId} className="border-t">
                  <td className="py-1">{a.className}</td>
                  <td>{a.studentCount}</td>
                  <td className="text-right">{money(a.outstanding)}</td>
                </tr>
              ))}
              {(arrears ?? []).length === 0 && <tr><td colSpan={3} className="py-3 text-muted-foreground">No arrears.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Daily collections</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground"><tr><th className="py-1">Date</th><th className="text-right">Collected</th></tr></thead>
            <tbody>
              {(collections ?? []).map((c) => (
                <tr key={c.date} className="border-t"><td className="py-1">{c.date}</td><td className="text-right">{money(c.total)}</td></tr>
              ))}
              {(collections ?? []).length === 0 && <tr><td colSpan={2} className="py-3 text-muted-foreground">No collections recorded.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/*
 * Discounts and Installments tabs removed in Phase 0 of the Fees & Finance
 * hardening plan. Both were full CRUD surfaces over models that nothing
 * consumed: the billing engine never read a Discount row, and no invoice or
 * due date was ever generated from an InstallmentPlan. Staff configured policy
 * that silently did nothing, which is worse than the feature not existing.
 *
 * A5 decides per feature - wire it into the fee calculation pipeline, or drop
 * the model. The API endpoints and Prisma models are untouched; only the
 * misleading UI is gone. Recover these components from git if A5 wires them.
 */

/* ─────────────── Scholarships ─────────────── */

function ScholarshipsTab() {
  const { data: scholarships } = useScholarships();
  const { data: students } = useStudents({ search: '', pageSize: 50 });
  const create = useCreateScholarship();
  const [studentId, setStudentId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [validFrom, setValidFrom] = useState('');

  const save = async () => {
    try {
      await create.mutateAsync({ studentProfileId: studentId, code, name, type, value: Number(value), validFrom });
      notify.success('Scholarship awarded');
      setCode(''); setName(''); setValue(''); setValidFrom(''); setStudentId('');
    } catch {
      notify.error('Could not award scholarship');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="h-4 w-4" /> Award scholarship</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <select className={sel} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Select student…</option>
            {(students?.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select className={sel} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="percent">Percent</option>
              <option value="fixed">Fixed</option>
            </select>
            <Input type="number" placeholder={type === 'percent' ? 'e.g. 50' : 'amount'} value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          <Button onClick={save} disabled={!studentId || !code || !value || !validFrom || create.isPending}><Plus className="h-4 w-4" /> Award</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Scholarships</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(scholarships?.data ?? []).length === 0 && <p className="text-muted-foreground">None yet.</p>}
          {(scholarships?.data ?? []).map((s) => (
            <div key={s.id} className="rounded-md border p-2">
              <div className="font-medium">{s.name} <span className="text-xs text-muted-foreground">· {s.code}</span></div>
              <div className="text-xs text-muted-foreground">{s.type === 'percent' ? `${s.value}%` : money(s.value)} · from {s.validFrom.slice(0, 10)}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────── Penalties ─────────────── */

function PenaltiesTab() {
  const { data: rules } = usePenaltyRules();
  const { data: runs } = usePenaltyRuns();
  const { data: schedules } = useFeeSchedules();
  const create = useCreatePenaltyRule();
  const [scheduleId, setScheduleId] = useState('');
  const [type, setType] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [graceDays, setGraceDays] = useState('');

  const save = async () => {
    try {
      await create.mutateAsync({ feeScheduleId: scheduleId, type, value: Number(value), graceDays: Number(graceDays) || 0 });
      notify.success('Penalty rule created');
      setScheduleId(''); setValue(''); setGraceDays('');
    } catch {
      notify.error('Could not create penalty rule');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Gavel className="h-4 w-4" /> New late-fee rule</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <select className={sel} value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
            <option value="">Fee schedule…</option>
            {(schedules?.data ?? []).map((sc) => (
              <option key={sc.id} value={sc.id}>{sc.feeStructure?.name} · due {sc.dueDate.slice(0, 10)}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <select className={sel} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="percent">Percent of outstanding</option>
              <option value="fixed">Fixed amount</option>
            </select>
            <Input type="number" placeholder={type === 'percent' ? 'e.g. 5' : 'amount'} value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <Input type="number" placeholder="Grace days" value={graceDays} onChange={(e) => setGraceDays(e.target.value)} />
          <p className="text-xs text-muted-foreground">Assessed daily by the penalty cron on unpaid invoices past due + grace days.</p>
          <Button onClick={save} disabled={!scheduleId || !value || create.isPending}><Plus className="h-4 w-4" /> Create rule</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Rules & runs</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="font-medium">Penalty rules</div>
          {(rules?.data ?? []).length === 0 && <p className="text-muted-foreground">None yet.</p>}
          {(rules?.data ?? []).map((r) => (
            <div key={r.id} className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">{r.type === 'percent' ? `${r.value}%` : money(r.value)} · grace {r.graceDays ?? 0}d</div>
            </div>
          ))}
          <div className="font-medium pt-2">Recent runs</div>
          {(runs?.data ?? []).length === 0 && <p className="text-muted-foreground">No runs yet.</p>}
          {(runs?.data ?? []).map((run) => (
            <div key={run.id} className="rounded-md border p-2">
              <div className="text-xs text-muted-foreground">{run.cronDate.slice(0, 10)} · assessed {money(run.totalAssessed)}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────── Refund ─────────────── */

function RefundTab() {
  const { data: students } = useStudents({ search: '', pageSize: 20 });
  const [studentId, setStudentId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank' | 'mobile_money' | 'card'>('cash');
  const [reference, setReference] = useState('');
  const refund = useRefundFee();
  const { data: statement } = useStudentStatement(studentId || undefined);

  const submit = async () => {
    try {
      const res = await refund.mutateAsync({ studentProfileId: studentId, amount: Number(amount), paymentMethod: method, reference: reference || undefined });
      if (res.status === 'pending_approval') notify.success(`Refund of ${money(amount)} sent for approval`, { description: 'A second person releases the money from the list below.' });
      else if (res.replayed) notify.success('Refund already recorded (idempotent replay)');
      else notify.success(`Refunded ${money(amount)}`);
      setAmount(''); setReference('');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not process refund');
    }
  };

  return (
    <div className="space-y-4">
    <Card className="max-w-xl">
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><RotateCcw className="h-4 w-4" /> Refund a fee payment</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <select className={sel} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">Select student…</option>
          {(students?.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>
          ))}
        </select>
        {statement && (
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <Stat label="Billed" value={money(statement.totalBilled)} />
            <Stat label="Paid" value={money(statement.collected)} />
            <Stat label="Balance" value={money(statement.balance)} tone={statement.balance > 0 ? 'rose' : 'emerald'} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Refund amount</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Method</Label>
            <select className={sel} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="mobile_money">Mobile money</option>
              <option value="card">Card</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Reference (e.g. mobile-money reversal id)</Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional" />
        </div>
        <Button onClick={submit} disabled={!studentId || !amount || Number(amount) <= 0 || refund.isPending}>
          <RotateCcw className="h-4 w-4" /> Process refund
        </Button>
        <p className="text-xs text-muted-foreground">
          Without the approve permission this files a refund request; the money goes out when someone else approves it.
          With it, the refund posts immediately. Replaying the same reference is safe.
        </p>
      </CardContent>
    </Card>
    <RefundRequestsCard />
    <CorrectionRequestsCard />
    </div>
  );
}

/** Pending refunds: anyone who reads fees sees them; approvers release or refuse. */
function RefundRequestsCard() {
  const { data: requests } = useRefundRequests('pending');
  const decide = useDecideRefundRequest();
  const me = useAuthStore((s) => s.user?.id);
  const canApprove = useAuthStore((s) => s.permissions.includes('school:fees:refund:approve'));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  if (!requests || requests.length === 0) return null;

  const act = async (id: string, decision: 'approve' | 'reject') => {
    try {
      await decide.mutateAsync({ id, decision, reason: reasons[id] });
      notify.success(decision === 'approve' ? 'Refund approved and paid out' : 'Refund request refused');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not record the decision');
    }
  };

  return (
    <Card className="max-w-xl">
      <CardHeader><CardTitle className="text-base">Refunds awaiting approval</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {requests.map((r) => (
          <div key={r.id} className="space-y-2 rounded-md border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{r.snapshot.studentName ?? r.snapshot.admissionNo}</div>
                <div className="text-xs text-muted-foreground">
                  {money(r.snapshot.amount)} · {r.snapshot.dto.paymentMethod.replace('_', ' ')} · requested {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              <Badge variant="outline">Pending</Badge>
            </div>
            {canApprove && r.createdById !== me ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 flex-1"
                  placeholder="Reason (required to refuse)"
                  value={reasons[r.id] ?? ''}
                  onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })}
                />
                <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => act(r.id, 'reject')}>Refuse</Button>
                <Button size="sm" disabled={decide.isPending} onClick={() => act(r.id, 'approve')}>Approve &amp; pay out</Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {r.createdById === me ? 'You requested this — someone else must approve it.' : 'Waiting for an approver.'}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const CORRECTION_LABEL: Record<string, string> = {
  reverse_payment: 'Reverse receipt',
  reverse_allocation: 'Un-apply payment',
  reallocate: 'Reallocate receipt',
  credit: 'Manual fee credit',
};

/**
 * D4 (re-audit #3): reversals, reallocations and manual credits wait here for
 * a second person. The requester cannot decide their own.
 */
function CorrectionRequestsCard() {
  const { data: requests } = useFeeCorrections('pending');
  const decide = useDecideFeeCorrection();
  const me = useAuthStore((s) => s.user?.id);
  const perms = useAuthStore((s) => s.permissions);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  if (!requests || requests.length === 0) return null;

  const mayDecide = (kind: string) =>
    perms.includes(kind === 'credit' ? 'school:fees:credit:approve' : 'school:fees:refund:approve');
  const act = async (id: string, decision: 'approve' | 'reject') => {
    try {
      await decide.mutateAsync({ id, decision, reason: reasons[id] });
      notify.success(decision === 'approve' ? 'Correction approved and applied' : 'Correction refused');
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Could not record the decision');
    }
  };

  return (
    <Card className="max-w-xl">
      <CardHeader><CardTitle className="text-base">Fee corrections awaiting approval</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {requests.map((r) => (
          <div key={r.id} className="space-y-2 rounded-md border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{CORRECTION_LABEL[r.snapshot.kind] ?? r.snapshot.kind}</div>
                <div className="text-xs text-muted-foreground">
                  {r.snapshot.amount != null ? `${money(r.snapshot.amount)} · ` : ''}
                  {r.snapshot.correction.reason ?? r.snapshot.correction.source ?? ''} · requested {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              <Badge variant="outline">Pending</Badge>
            </div>
            {mayDecide(r.snapshot.kind) && r.createdById !== me ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 flex-1"
                  placeholder="Reason (required to refuse)"
                  value={reasons[r.id] ?? ''}
                  onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })}
                />
                <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => act(r.id, 'reject')}>Refuse</Button>
                <Button size="sm" disabled={decide.isPending} onClick={() => act(r.id, 'approve')}>Approve &amp; apply</Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {r.createdById === me ? 'You requested this — someone else must approve it.' : 'Waiting for an approver.'}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────── Sponsors ───────────────────────── */

function SponsorsTab() {
  const students = useStudents();
  const { data: partners } = usePartners();
  const { data: sponsorships, isLoading } = useSponsorships();
  const create = useCreateSponsorship();
  const [studentProfileId, setStudentProfileId] = useState('');
  const [sponsorId, setSponsorId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [capAmount, setCapAmount] = useState('');
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));

  const studentOptions = (students.data?.data ?? []).map((s: any) => ({ value: s.id, label: s.admissionNo ? `${s.admissionNo} · ${s.firstName} ${s.lastName}` : s.id }));
  const sponsorOptions = (partners?.data ?? []).map((p: any) => ({ value: p.id, label: p.name }));

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><HeartHandshake className="h-4 w-4" /> Sponsorships</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <select className={sel} value={studentProfileId} onChange={(e) => setStudentProfileId(e.target.value)}>
            <option value="">Student</option>
            {studentOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className={sel} value={sponsorId} onChange={(e) => setSponsorId(e.target.value)}>
            <option value="">Sponsor (partner)</option>
            {sponsorOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code e.g. SPN-001" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          {/*
            The cap is recorded and shown on the sponsorship, but nothing
            enforces it at collection time yet (A5). Labelled so a bursar does
            not rely on it as a spending control.
          */}
          <Input value={capAmount} onChange={(e) => setCapAmount(e.target.value)} placeholder="Cap amount (not yet enforced)" type="number" />
          <Input value={validFrom} onChange={(e) => setValidFrom(e.target.value)} type="date" />
        </div>
        <Button disabled={!studentProfileId || !sponsorId || !code || !name || create.isPending} onClick={() => create.mutate({ studentProfileId, sponsorId, code, name, capAmount: capAmount ? Number(capAmount) : undefined, validFrom }, { onSuccess: () => { setCode(''); setName(''); setCapAmount(''); } })}>
          <Plus className="h-4 w-4 mr-1" /> Add sponsorship
        </Button>
        <div className="space-y-2 text-sm">
          {isLoading && <p className="text-muted-foreground">Loading…</p>}
          {(sponsorships?.data ?? []).length === 0 && <p className="text-muted-foreground">No sponsorships yet.</p>}
          {(sponsorships?.data ?? []).map((sp) => (
            <div key={sp.id} className="rounded-md border p-2">
              <div className="font-medium">{sp.name} <span className="text-xs text-muted-foreground">({sp.code})</span></div>
              <div className="text-xs text-muted-foreground">
                Cap: {sp.capAmount ? `${money(sp.capAmount)} (recorded, not enforced)` : 'unlimited'} · Valid from {sp.validFrom}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ───────────────────────── Credits ───────────────────────── */

function CreditsTab() {
  const students = useStudents();
  const { data: credits, isLoading } = useFeeCredits();
  const create = useCreateFeeCredit();
  const apply = useApplyCredits();
  const [studentProfileId, setStudentProfileId] = useState('');
  const [amount, setAmount] = useState('');
  // Re-audit #3 P1-9: the API accepts only these origins for a manual credit.
  // 'advance' / 'refund' / 'adjustment' were always rejected; an overpayment
  // credit is made at the till (collect → hold the rest as credit).
  const [source, setSource] = useState<'opening_balance' | 'approved_adjustment'>('opening_balance');

  const studentOptions = (students.data?.data ?? []).map((s: any) => ({ value: s.id, label: s.admissionNo ? `${s.admissionNo} · ${s.firstName} ${s.lastName}` : s.id }));

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><PiggyBank className="h-4 w-4" /> Fee credits</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">Student-held stored-value liability (advance payment, refund carry-forward, overpayment, or manual adjustment). Draws down automatically against future invoices.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <select className={sel} value={studentProfileId} onChange={(e) => setStudentProfileId(e.target.value)}>
            <option value="">Student</option>
            {studentOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" type="number" />
          <select className={sel} value={source} onChange={(e) => setSource(e.target.value as 'opening_balance' | 'approved_adjustment')}>
            <option value="opening_balance">Opening balance</option>
            <option value="approved_adjustment">Approved adjustment</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button disabled={!studentProfileId || !amount || create.isPending} onClick={() => create.mutate({ studentProfileId, amount: Number(amount), source }, {
            onSuccess: (res) => {
              setAmount('');
              notify.success(res.status === 'pending_approval' ? 'Credit sent for approval' : 'Credit created');
            },
            onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Could not create the credit'),
          })}>
            <Plus className="h-4 w-4 mr-1" /> Create credit
          </Button>
          <Button variant="outline" disabled={!studentProfileId || apply.isPending} onClick={() => apply.mutate(studentProfileId)}>
            <RotateCcw className="h-4 w-4 mr-1" /> Apply available credits
          </Button>
        </div>
        <div className="space-y-2 text-sm">
          {isLoading && <p className="text-muted-foreground">Loading…</p>}
          {(credits?.data ?? []).length === 0 && <p className="text-muted-foreground">No credits yet.</p>}
          {(credits?.data ?? []).map((c) => (
            <div key={c.id} className="rounded-md border p-2">
              <div className="font-medium">{c.code} <span className="text-xs text-muted-foreground">({c.source})</span></div>
              <div className="text-xs text-muted-foreground">Balance: {money(c.remaining)} of {money(c.amount)}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ───────────────────────── Aging ───────────────────────── */

function AgingTab() {
  const { data, isLoading } = useFeeAging();
  const buckets = data?.buckets ?? {};
  const rows = data?.rows ?? [];
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> Accounts receivable aging</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">As of {data?.asOf ? new Date(data.asOf).toLocaleDateString() : 'now'}. Buckets over fee invoices (current / 1-30 / 31-60 / 61-90 / 90+ days overdue).</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Stat label="Current" value={money(buckets.current ?? 0)} />
          <Stat label="1-30 days" value={money(buckets.d1_30 ?? 0)} tone="rose" />
          <Stat label="31-60 days" value={money(buckets.d31_60 ?? 0)} tone="rose" />
          <Stat label="61-90 days" value={money(buckets.d61_90 ?? 0)} tone="rose" />
          <Stat label="90+ days" value={money(buckets.d90_plus ?? 0)} tone="rose" />
        </div>
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs">
              <tr>
                <th className="text-left p-2">Document</th>
                <th className="text-left p-2">Payer</th>
                <th className="text-left p-2">Due</th>
                <th className="text-right p-2">Days</th>
                <th className="text-right p-2">Residual</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="p-2 text-muted-foreground">Loading…</td></tr>}
              {rows.length === 0 && !isLoading && <tr><td colSpan={5} className="p-2 text-muted-foreground">No outstanding balances.</td></tr>}
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="p-2">{r.documentNumber}</td>
                  <td className="p-2">{r.partnerName}</td>
                  <td className="p-2">{r.dueDate}</td>
                  <td className="p-2 text-right">{r.daysOverdue}</td>
                  <td className="p-2 text-right">{money(r.residual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
