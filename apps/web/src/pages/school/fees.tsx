import { useMemo, useState } from 'react';
import { Plus, Play, HandCoins, TrendingDown, Trash2 } from 'lucide-react';
import {
  useFeeStructures,
  useCreateFeeStructure,
  useFeeSchedules,
  useCreateFeeSchedule,
  useServiceProducts,
  useAcademicYears,
  useTerms,
  useClasses,
  useGenerateBilling,
  useCollectPayment,
  useStudents,
  useStudentStatement,
  useArrearsByClass,
  useDailyCollections,
  type FeeComponent,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { notify } from '@/lib/notify';

const money = (n: number | string) => `UGX ${Number(n).toLocaleString()}`;
const sel = 'w-full rounded-md border bg-card px-3 py-2 text-sm';

export function SchoolFeesPage() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Fees &amp; Billing</h1>
        <p className="text-sm text-muted-foreground">Fee structures, term billing, collection and arrears.</p>
      </div>
      <Tabs defaultValue="collect">
        <TabsList>
          <TabsTrigger value="collect">Collect payment</TabsTrigger>
          <TabsTrigger value="billing">Billing run</TabsTrigger>
          <TabsTrigger value="structures">Fee structures</TabsTrigger>
          <TabsTrigger value="arrears">Arrears</TabsTrigger>
        </TabsList>
        <TabsContent value="collect" className="pt-4"><CollectTab /></TabsContent>
        <TabsContent value="billing" className="pt-4"><BillingTab /></TabsContent>
        <TabsContent value="structures" className="pt-4"><StructuresTab /></TabsContent>
        <TabsContent value="arrears" className="pt-4"><ArrearsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ─────────────── Collect payment ─────────────── */

function CollectTab() {
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank' | 'mobile_money' | 'card'>('cash');
  const [reference, setReference] = useState('');
  const { data: students } = useStudents({ search: search || undefined, pageSize: 20 });
  const { data: statement } = useStudentStatement(studentId || undefined);
  const collect = useCollectPayment();

  const submit = async () => {
    try {
      const res = await collect.mutateAsync({
        studentProfileId: studentId,
        amount: Number(amount),
        paymentMethod: method,
        reference: reference || undefined,
      });
      if (res.replayed) notify.success('Payment already recorded (idempotent replay)');
      else notify.success(`Collected ${money(amount)} · ${res.allocations.length} invoice(s) settled`);
      setAmount('');
      setReference('');
    } catch {
      notify.error('Could not collect payment');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Record a fee payment</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Find student</Label>
            <input className={sel} placeholder="Search name or admission no…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className={sel} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">Select student…</option>
              {(students?.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.partner?.name} · {s.admissionNo}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Amount</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Method</Label>
              <select className={sel} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reference (e.g. mobile-money txn id)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional" />
          </div>
          <Button onClick={submit} disabled={!studentId || !amount || Number(amount) <= 0 || collect.isPending}>
            <HandCoins className="h-4 w-4" /> Collect &amp; allocate
          </Button>
          <p className="text-xs text-muted-foreground">
            Posts a receipt, allocates oldest-first to open fee invoices, and (for cash on an open session) records the drawer movement.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Statement</CardTitle></CardHeader>
        <CardContent>
          {!studentId && <p className="text-sm text-muted-foreground">Select a student to see their fee balance.</p>}
          {statement && (
            <>
              <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm">
                <Stat label="Billed" value={money(statement.totalBilled)} />
                <Stat label="Paid" value={money(statement.totalPaid)} />
                <Stat label="Balance" value={money(statement.balance)} tone={statement.balance > 0 ? 'rose' : 'emerald'} />
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground"><tr><th className="py-1">Invoice</th><th>Total</th><th>Residual</th><th>Status</th></tr></thead>
                <tbody>
                  {statement.invoices.map((inv) => (
                    <tr key={inv.id} className="border-t">
                      <td className="py-1 font-mono text-xs">{inv.documentNumber}</td>
                      <td>{money(inv.totalAmount)}</td>
                      <td>{money(inv.amountResidual)}</td>
                      <td><Badge>{inv.paymentStatus}</Badge></td>
                    </tr>
                  ))}
                  {statement.invoices.length === 0 && <tr><td colSpan={4} className="py-3 text-muted-foreground">No fee invoices.</td></tr>}
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>
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

/* ─────────────── Fee structures ─────────────── */

function StructuresTab() {
  const { data: structures } = useFeeStructures();
  const { data: schedules } = useFeeSchedules();
  const { data: years } = useAcademicYears();
  const { data: terms } = useTerms();
  const { data: classes } = useClasses();
  const { data: products } = useServiceProducts();
  const createStructure = useCreateFeeStructure();
  const createSchedule = useCreateFeeSchedule();

  const [name, setName] = useState('');
  const [academicYearId, setYear] = useState('');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [components, setComponents] = useState<FeeComponent[]>([{ code: 'TUITION', productId: '', amount: 0 }]);

  const [schedStructure, setSchedStructure] = useState('');
  const [schedTerm, setSchedTerm] = useState('');
  const [schedDue, setSchedDue] = useState('');

  const productName = useMemo(
    () => Object.fromEntries((products?.data ?? []).map((p) => [p.id, p.name])),
    [products],
  );

  const addComponent = () => setComponents([...components, { code: '', productId: '', amount: 0 }]);
  const setComp = (i: number, patch: Partial<FeeComponent>) =>
    setComponents(components.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const rmComp = (i: number) => setComponents(components.filter((_, idx) => idx !== i));

  const saveStructure = async () => {
    try {
      await createStructure.mutateAsync({
        name,
        academicYearId,
        components: components.filter((c) => c.code && c.productId && c.amount > 0),
        applicableTo: classIds.length ? { classIds } : undefined,
      });
      notify.success('Fee structure created');
      setName(''); setComponents([{ code: 'TUITION', productId: '', amount: 0 }]); setClassIds([]);
    } catch {
      notify.error('Could not create fee structure');
    }
  };

  const saveSchedule = async () => {
    try {
      await createSchedule.mutateAsync({ feeStructureId: schedStructure, termId: schedTerm, dueDate: schedDue });
      notify.success('Schedule created — the structure now applies to that term');
      setSchedStructure(''); setSchedTerm(''); setSchedDue('');
    } catch {
      notify.error('Could not create schedule');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">New fee structure</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard Term Fees" /></div>
            <div className="space-y-1">
              <Label className="text-xs">Academic year</Label>
              <select className={sel} value={academicYearId} onChange={(e) => setYear(e.target.value)}>
                <option value="">Select…</option>
                {(years?.data ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Applies to classes (leave blank = all)</Label>
            <select multiple className={`${sel} h-24`} value={classIds}
              onChange={(e) => setClassIds(Array.from(e.target.selectedOptions, (o) => o.value))}>
              {(classes?.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Components</Label>
            {components.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.4fr_1fr_auto] items-center gap-2">
                <Input placeholder="CODE" value={c.code} onChange={(e) => setComp(i, { code: e.target.value.toUpperCase() })} />
                <select className={sel} value={c.productId} onChange={(e) => setComp(i, { productId: e.target.value })}>
                  <option value="">Product…</option>
                  {(products?.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <Input type="number" placeholder="amount" value={c.amount || ''} onChange={(e) => setComp(i, { amount: Number(e.target.value) })} />
                <Button variant="ghost" size="sm" onClick={() => rmComp(i)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={addComponent}><Plus className="h-4 w-4" /> Add component</Button>
          </div>
          <Button onClick={saveStructure} disabled={!name || !academicYearId || createStructure.isPending}>Create structure</Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Schedule a structure to a term</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <select className={sel} value={schedStructure} onChange={(e) => setSchedStructure(e.target.value)}>
              <option value="">Fee structure…</option>
              {(structures?.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <select className={sel} value={schedTerm} onChange={(e) => setSchedTerm(e.target.value)}>
                <option value="">Term…</option>
                {(terms?.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <Input type="date" value={schedDue} onChange={(e) => setSchedDue(e.target.value)} />
            </div>
            <Button onClick={saveSchedule} disabled={!schedStructure || !schedTerm || !schedDue || createSchedule.isPending}>Create schedule</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Existing structures</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(structures?.data ?? []).length === 0 && <p className="text-muted-foreground">None yet.</p>}
            {(structures?.data ?? []).map((s) => (
              <div key={s.id} className="rounded-md border p-2">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">
                  {(s.components ?? []).map((c) => `${c.code} ${money(c.amount)}${c.productId && productName[c.productId] ? '' : ''}`).join(' · ')}
                </div>
                <div className="mt-1 text-xs">
                  {(schedules?.data ?? []).filter((sc) => sc.feeStructureId === s.id).map((sc) => (
                    <Badge key={sc.id} className="mr-1">term scheduled</Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'emerald' }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-semibold ${tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : ''}`}>{value}</div>
    </div>
  );
}
