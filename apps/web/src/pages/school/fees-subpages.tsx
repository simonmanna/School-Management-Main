import { useState } from 'react';
import { HandCoins, ChevronRight, ChevronLeft, Check, Layers, Wand2, Plus, Play, Eraser, Trash2, Printer } from 'lucide-react';
import {
  useCollectPayment,
  useStudents,
  useStudent,
  useStudentStatement,
  useSchoolProfile,
  useTerms,
  useWaiverCategories,
  useCreateWaiverCategory,
  useUpdateWaiverCategory,
  useDeleteWaiverCategory,
  useWaivers,
  useCreateWaiver,
  useApplyWaiver,
  useFeeDefaulters,
  useBadDebtors,
  useWriteOffBadDebt,
  useBudgets,
  useCreateBudget,
  useDeleteBudget,
  type WaiverCategory,
  type CollectResult,
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { money, sel, Stat } from './fees-shared';

/* ───────────────────────── Fee Receipt (printable) ───────────────────────── */

function FeeReceipt({ result, student, statement, profile, termName }: {
  result: CollectResult;
  student: any;
  statement: any;
  profile: any;
  termName?: string;
}) {
  const cur = profile?.currencyCode || 'UGX';
  const fmt = (n: number | string) => `${cur} ${Number(n).toLocaleString()}`;
  const allocationRows = result.allocations.map((a) => {
    const inv = statement?.invoices?.find((i: any) => i.id === a.documentId);
    return { doc: inv?.documentNumber ?? a.documentId.slice(0, 8), amount: a.amount };
  });
  const totalPaid = result.allocations.reduce((s, a) => s + Number(a.amount), 0);
  const balance = statement?.balance ?? 0;

  return (
    <div className="print-receipt mx-auto my-6 max-w-md border p-6 text-sm">
      <div className="text-center">
        <div className="text-lg font-bold">{profile?.name ?? 'School Receipt'}</div>
        {profile?.phone && <div className="text-xs">Tel: {profile.phone}</div>}
        {profile?.address && <div className="text-xs">{profile.address}</div>}
        <div className="mt-2 text-base font-bold underline">FEES PAYMENT RECEIPT</div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-y-1 text-xs">
        <div><span className="text-muted-foreground">Name:</span> {student?.partner?.name ?? '—'}</div>
        <div><span className="text-muted-foreground">Reg No:</span> {student?.admissionNo ?? '—'}</div>
        <div><span className="text-muted-foreground">Gender:</span> {student?.gender ?? '—'}</div>
        <div><span className="text-muted-foreground">Class:</span> {student?.currentClass?.name ?? '—'}</div>
        <div><span className="text-muted-foreground">Term:</span> {termName ?? '—'}</div>
        <div />
        <div><span className="text-muted-foreground">Receipt No.:</span> {result.payment?.paymentNumber ?? result.payment?.id?.slice(0, 12) ?? '—'}</div>
        <div><span className="text-muted-foreground">Mode:</span> {result.payment?.paymentMethod ?? '—'}</div>
        <div><span className="text-muted-foreground">Date:</span> {result.payment?.paymentDate ? new Date(result.payment.paymentDate).toLocaleDateString() : '—'}</div>
      </div>

      <table className="mt-4 w-full border text-sm">
        <thead>
          <tr className="border bg-muted/40"><th className="px-2 py-1 text-left">#</th><th className="px-2 py-1 text-left">Description</th><th className="px-2 py-1 text-right">Amount Paid</th></tr>
        </thead>
        <tbody>
          {allocationRows.map((r, i) => (
            <tr key={i} className="border">
              <td className="px-2 py-1">{i + 1}</td>
              <td className="px-2 py-1">Fee payment · {r.doc}</td>
              <td className="px-2 py-1 text-right">{fmt(r.amount)}</td>
            </tr>
          ))}
          {allocationRows.length === 0 && (
            <tr className="border"><td className="px-2 py-1">1</td><td className="px-2 py-1">Fee payment</td><td className="px-2 py-1 text-right">{fmt(totalPaid)}</td></tr>
          )}
        </tbody>
      </table>

      <div className="mt-3 text-right text-sm">
        <div><span className="text-muted-foreground">Total Paid:</span> <b>{fmt(totalPaid)}</b></div>
        <div><span className="text-muted-foreground">Fees Balance:</span> <b>{fmt(balance)}</b></div>
      </div>

      <div className="mt-4 text-center text-sm font-medium text-emerald-600">Thank you for your payment!</div>
    </div>
  );
}

/* ───────────────────────── Collect (3-step wizard) ───────────────────────── */

type Step = 'details' | 'allocation' | 'confirmation';

const STEPPER: { key: Step; label: string }[] = [
  { key: 'details', label: 'Payment Details' },
  { key: 'allocation', label: 'Allocation' },
  { key: 'confirmation', label: 'Confirmation' },
];

const PAYMENT_MODES: Array<{ value: 'cash' | 'bank' | 'mobile_money' | 'card'; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'bank', label: 'Bank' },
  { value: 'card', label: 'Card' },
];

export function SchoolFeesCollectPage() {
  const [step, setStep] = useState<Step>('details');
  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank' | 'mobile_money' | 'card'>('cash');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  // allocations: invoiceId -> amount typed by the user
  const [alloc, setAlloc] = useState<Record<string, number>>({});

  const { data: students } = useStudents({ search: search || undefined, pageSize: 20 });
  const { data: statement } = useStudentStatement(studentId || undefined);
  const { data: profile } = useSchoolProfile();
  const { data: terms } = useTerms();
  const { data: student } = useStudent(studentId || undefined);
  const collect = useCollectPayment();
  const [receipt, setReceipt] = useState<CollectResult | null>(null);

  const number = Number(amount) || 0;
  const openInvoices = statement?.invoices?.filter((i: any) => Number(i.amountResidual) > 0) ?? [];
  const allocated = Object.values(alloc).reduce((s, n) => s + (Number(n) || 0), 0);
  const unallocated = Math.max(0, number - allocated);

  const reset = () => {
    setStep('details'); setStudentId(''); setAmount(''); setReference('');
    setMethod('cash'); setPaymentDate(new Date().toISOString().slice(0, 10)); setAlloc({}); setSearch('');
  };

  const setAllocFor = (id: string, value: number) => {
    const residual = Number(openInvoices.find((i: any) => i.id === id)?.amountResidual ?? 0);
    const capped = Math.min(Math.max(0, value || 0), residual);
    setAlloc((prev) => ({ ...prev, [id]: capped }));
  };

  const applyAutomatic = () => {
    // Oldest-first fill up to the unallocated tender, capped per residual.
    const next: Record<string, number> = { ...alloc };
    let remaining = unallocated;
    for (const inv of openInvoices) {
      if (remaining <= 0) break;
      const residual = Number(inv.amountResidual);
      const already = next[inv.id] ?? 0;
      const room = Math.max(0, residual - already);
      const take = Math.min(remaining, room);
      if (take > 0) { next[inv.id] = already + take; remaining -= take; }
    }
    setAlloc(next);
  };

  const allocList = Object.entries(alloc)
    .filter(([, amt]) => (amt ?? 0) > 0)
    .map(([documentId, amt]) => ({ documentId, amount: Number(amt) }));

  const submit = async () => {
    try {
      const res = await collect.mutateAsync({
        studentProfileId: studentId,
        amount: number,
        paymentMethod: method,
        paymentDate,
        reference: reference || undefined,
        allocations: allocList.length ? allocList : undefined,
      });
      if (res.replayed) notify.success('Payment already recorded (idempotent replay)');
      else notify.success(`Collected ${money(amount)} · ${res.allocations.length} invoice(s) settled`);
      setReceipt(res);
      reset();
    } catch {
      notify.error('Could not collect payment');
    }
  };

  const detailsValid = !!studentId && number > 0 && !!paymentDate && !!method;
  const allocationValid = number > 0 && unallocated === 0 && allocList.length > 0;

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Record Fee Payments</h1>
        <p className="text-sm text-muted-foreground">
          Record a payment and allocate it to specific unsettled invoices, then print a receipt.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPPER.map((s, idx) => {
          const active = s.key === step;
          const done = STEPPER.findIndex((x) => x.key === step) > idx;
          return (
            <div key={s.key} className="flex items-center gap-2">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium ${active ? 'border-primary bg-primary text-primary-foreground' : done ? 'border-primary bg-primary/10 text-primary' : 'border-muted-foreground/30 text-muted-foreground'}`}>
                {done ? <Check className="h-4 w-4" /> : idx + 1}
              </div>
              <span className={`text-sm ${active ? 'font-medium' : 'text-muted-foreground'}`}>{s.label}</span>
              {idx < STEPPER.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT: wizard */}
        <Card>
          <CardHeader><CardTitle className="text-base">
            {step === 'details' && 'Step 1 — Payment details'}
            {step === 'allocation' && 'Step 2 — Allocate to invoices'}
            {step === 'confirmation' && 'Step 3 — Confirm & record'}
          </CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {step === 'details' && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Find student</Label>
                  <input className={sel} placeholder="Search name or admission no…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <select className={sel} value={studentId} onChange={(e) => { setStudentId(e.target.value); setAlloc({}); }}>
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
                    <Label className="text-xs">Payment date</Label>
                    <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Payment mode</Label>
                  <select className={sel} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                    {PAYMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Reference (e.g. mobile-money txn id)</Label>
                  <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="optional" />
                </div>
                <Button onClick={() => detailsValid && setStep('allocation')} disabled={!detailsValid} className="w-full">
                  Next <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </>
            )}

            {step === 'allocation' && (
              <>
                <div className="grid grid-cols-3 gap-2 rounded-md border bg-muted/30 p-3 text-center text-sm">
                  <div><div className="font-semibold text-emerald-600">{money(number)}</div><div className="text-xs text-muted-foreground">Total payment</div></div>
                  <div><div className="font-semibold">{money(allocated)}</div><div className="text-xs text-muted-foreground">Allocated</div></div>
                  <div><div className={`font-semibold ${unallocated > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{money(unallocated)}</div><div className="text-xs text-muted-foreground">Unallocated</div></div>
                </div>

                {openInvoices.length === 0 && (
                  <p className="text-sm text-muted-foreground">This student has no unsettled invoices — the payment will be recorded as an unallocated credit. Use <b>Automatic</b> is unavailable here.</p>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Apply to specific unpaid invoices</Label>
                    {openInvoices.length > 0 && (
                      <Button size="sm" variant="outline" onClick={applyAutomatic} disabled={unallocated <= 0}>
                        <Wand2 className="mr-1 h-3.5 w-3.5" /> Automatic — apply remaining {money(unallocated)}
                      </Button>
                    )}
                  </div>
                  {openInvoices.map((inv: any) => (
                    <div key={inv.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <div className="flex-1">
                        <div className="font-mono text-xs">{inv.documentNumber}</div>
                        <div className="text-xs text-muted-foreground">Residual {money(inv.amountResidual)} · <Badge variant="secondary" className="text-[10px]">{inv.paymentStatus}</Badge></div>
                      </div>
                      <Input
                        type="number"
                        className="w-32"
                        placeholder="0"
                        value={alloc[inv.id] ?? ''}
                        onChange={(e) => setAllocFor(inv.id, Number(e.target.value))}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep('details')}><ChevronLeft className="mr-1 h-4 w-4" /> Back</Button>
                  <Button onClick={() => allocationValid && setStep('confirmation')} disabled={!allocationValid} className="flex-1">
                    Next <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </>
            )}

            {step === 'confirmation' && (
              <>
                <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                  <div><span className="text-muted-foreground">Student: </span>{(students?.data ?? []).find((s: any) => s.id === studentId)?.partner?.name ?? '—'}</div>
                  <div><span className="text-muted-foreground">Amount: </span>{money(number)}</div>
                  <div><span className="text-muted-foreground">Date: </span>{paymentDate}</div>
                  <div><span className="text-muted-foreground">Mode: </span>{PAYMENT_MODES.find((m) => m.value === method)?.label}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Allocations</div>
                  {allocList.length === 0 && <p className="text-sm text-muted-foreground">No specific invoices — will settle oldest-first.</p>}
                  {allocList.map((a) => {
                    const inv = openInvoices.find((i: any) => i.id === a.documentId);
                    return (
                      <div key={a.documentId} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                        <span className="font-mono text-xs">{inv?.documentNumber ?? a.documentId.slice(0, 8)}</span>
                        <span className="font-medium">{money(a.amount)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep('allocation')}><ChevronLeft className="mr-1 h-4 w-4" /> Back</Button>
                  <Button onClick={submit} disabled={collect.isPending} className="flex-1">
                    <HandCoins className="mr-1 h-4 w-4" /> {collect.isPending ? 'Recording…' : 'Record payment'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* RIGHT: Statement (kept visible) */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4" /> Statement</CardTitle></CardHeader>
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
                        <td className={Number(inv.amountResidual) > 0 ? 'font-medium text-rose-600' : ''}>{money(inv.amountResidual)}</td>
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

      {receipt && (
        <div className="no-print space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Receipt</h2>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setReceipt(null)}>Close</Button>
              <Button onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" /> Print Receipt</Button>
            </div>
          </div>
          <FeeReceipt
            result={receipt}
            student={student}
            statement={statement}
            profile={profile}
            termName={terms?.data?.find((t: any) => t.isCurrent)?.name}
          />
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Waiver Categories ───────────────────────── */

export function SchoolWaiverCategoriesPage() {
  const { data: cats, isLoading } = useWaiverCategories();
  const create = useCreateWaiverCategory();
  const update = useUpdateWaiverCategory();
  const del = useDeleteWaiverCategory();
  const [form, setForm] = useState<Partial<WaiverCategory>>({ code: '', name: '', type: 'percentage', value: 0, isActive: true });

  const add = async () => {
    if (!form.code || !form.name) { notify.error('Code and name required'); return; }
    try {
      await create.mutateAsync(form);
      notify.success('Waiver category added');
      setForm({ code: '', name: '', type: 'percentage', value: 0, isActive: true });
    } catch { notify.error('Failed to add category'); }
  };
  const toggleActive = async (c: WaiverCategory) => {
    try { await update.mutateAsync({ id: c.id, isActive: !c.isActive }); } catch { notify.error('Update failed'); }
  };
  const remove = async (id: string) => {
    try { await del.mutateAsync(id); notify.success('Category deleted'); } catch { notify.error('Delete failed'); }
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Waiver Categories</h1>
        <p className="text-sm text-muted-foreground">Org-scoped templates used when creating individual waivers. Pick a category on a waiver to pre-fill the amount/name.</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Fee Waiver Categories</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div><Label>Code</Label><Input className="w-32" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. SIBLING" /></div>
            <div><Label>Name</Label><Input className="w-56" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sibling Discount" /></div>
            <div><Label>Type</Label>
              <select className={sel} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'percentage' | 'fixed' })}>
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed amount</option>
              </select>
            </div>
            <div><Label>{form.type === 'percentage' ? 'Percent %' : 'Amount'}</Label><Input className="w-28" type="number" value={form.value ?? 0} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} /></div>
            <div className="flex-1"><Label>Description</Label><Input className="w-full" value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <Button size="sm" onClick={add} disabled={create.isPending}><Plus className="mr-1 h-4 w-4" />Add</Button>
          </div>

          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Active</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(cats ?? []).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.code}</TableCell>
                    <TableCell>{c.name}{c.description ? <span className="block text-xs text-muted-foreground">{c.description}</span> : null}</TableCell>
                    <TableCell className="capitalize">{c.type}</TableCell>
                    <TableCell>{c.type === 'percentage' ? `${c.value}%` : money(c.value)}</TableCell>
                    <TableCell><Badge variant={c.isActive ? 'default' : 'secondary'}>{c.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" className="mr-1" onClick={() => toggleActive(c)}>{c.isActive ? 'Deactivate' : 'Activate'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(cats ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="p-2 text-muted-foreground">No waiver categories yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────── Waivers ───────────────────────── */

export function SchoolWaiversPage() {
  const students = useStudents();
  const { data: waivers, isLoading } = useWaivers();
  const create = useCreateWaiver();
  const apply = useApplyWaiver();
  const [studentProfileId, setStudentProfileId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const studentOptions = (students.data?.data ?? []).map((s: any) => ({ value: s.id, label: s.admissionNo ? `${s.admissionNo} · ${s.firstName} ${s.lastName}` : s.id }));

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Fee Waivers</h1>
        <p className="text-sm text-muted-foreground">A waiver forgives an amount the school will not collect — posted Dr Waiver Expense / Cr Accounts Receivable. Distinct from a discount (which reduces the billed amount).</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Eraser className="h-4 w-4" /> Waivers</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <select className={sel} value={studentProfileId} onChange={(e) => setStudentProfileId(e.target.value)}>
              <option value="">Student</option>
              {studentOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code e.g. WV-001" />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" type="number" />
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
          </div>
          <Button disabled={!studentProfileId || !amount || create.isPending} onClick={() => create.mutate({ studentProfileId, code, name, amount: Number(amount), reason }, { onSuccess: () => { setCode(''); setName(''); setAmount(''); setReason(''); } })}>
            <Plus className="h-4 w-4 mr-1" /> Create waiver
          </Button>
          <div className="space-y-2 text-sm">
            {isLoading && <p className="text-muted-foreground">Loading…</p>}
            {(waivers?.data ?? []).length === 0 && <p className="text-muted-foreground">No waivers yet.</p>}
            {(waivers?.data ?? []).map((w) => (
              <div key={w.id} className="flex items-center justify-between rounded-md border p-2">
                <div>
                  <div className="font-medium">{w.name} <span className="text-xs text-muted-foreground">({w.code})</span></div>
                  <div className="text-xs text-muted-foreground">{money(w.amount)} {w.applied ? '· applied' : '· pending'}</div>
                </div>
                {!w.applied && (
                  <Button size="sm" variant="outline" disabled={apply.isPending} onClick={() => apply.mutate(w.id)}>
                    <Play className="h-4 w-4 mr-1" /> Apply
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────── Fee Defaulters ───────────────────────── */

export function SchoolFeeDefaultersPage() {
  const [min, setMin] = useState('0');
  const { data, isLoading } = useFeeDefaulters(undefined, Number(min) || 0);
  const rows = data?.rows ?? [];
  const total = rows.reduce((s, r) => s + Number(r.totalBalance), 0);
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Fee Defaulters</h1>
        <p className="text-sm text-muted-foreground">Students with an outstanding fee balance, filtered by a minimum threshold.</p>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Fee Defaulters</CardTitle>
          <div className="flex items-center gap-2 text-sm">
            <Label>Min balance</Label>
            <Input className="w-32" type="number" value={min} onChange={(e) => setMin(e.target.value)} />
            <span className="text-muted-foreground">Students: {rows.length} · Outstanding: {money(total)}</span>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Student</TableHead><TableHead>Adm No</TableHead><TableHead>Class</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="text-right">Invoices</TableHead><TableHead className="text-right">Max Days Overdue</TableHead><TableHead>Oldest Due</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.studentProfileId}>
                    <TableCell className="font-medium">{r.studentName}</TableCell>
                    <TableCell>{r.admissionNo ?? '—'}</TableCell>
                    <TableCell>{r.className}</TableCell>
                    <TableCell className="text-right font-semibold">{money(r.totalBalance)}</TableCell>
                    <TableCell className="text-right">{r.invoiceCount}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={r.maxDaysOverdue > 90 ? 'destructive' : r.maxDaysOverdue > 30 ? 'default' : 'secondary'}>{r.maxDaysOverdue}</Badge>
                    </TableCell>
                    <TableCell>{r.oldestDueDate ? new Date(r.oldestDueDate).toLocaleDateString() : '—'}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={7} className="p-2 text-muted-foreground">No fee defaulters.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────── Bad Debtors ───────────────────────── */

export function SchoolBadDebtorsPage() {
  const [threshold, setThreshold] = useState('90');
  const { data, isLoading } = useBadDebtors(undefined, Number(threshold) || 90);
  const writeOff = useWriteOffBadDebt();
  const rows = data?.rows ?? [];
  const total = rows.reduce((s, r) => s + Number(r.totalBalance), 0);
  const doWriteOff = async (studentProfileId: string, name: string) => {
    if (!confirm(`Write off all outstanding fees for ${name} as bad debt? This applies a waiver and posts GL (Waiver Expense / AR).`)) return;
    try { await writeOff.mutateAsync({ studentProfileId }); notify.success(`Bad debt written off for ${name}`); }
    catch (e: any) { notify.error(e?.response?.data?.message ?? 'Write-off failed'); }
  };
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Bad Debtors</h1>
        <p className="text-sm text-muted-foreground">Chronic defaulters whose oldest overdue fee invoice exceeds the age threshold. Write-off forgives the balance (posts Dr Waiver Expense / Cr AR).</p>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Bad Debtors</CardTitle>
          <div className="flex items-center gap-2 text-sm">
            <Label>Age threshold (days)</Label>
            <Input className="w-24" type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            <span className="text-muted-foreground">Chronic defaulters: {rows.length} · Balance: {money(total)}</span>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">Students whose oldest overdue fee invoice exceeds {threshold} days. Use Write-off to forgive the balance (posts Dr Waiver Expense / Cr AR).</p>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Student</TableHead><TableHead>Adm No</TableHead><TableHead>Class</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="text-right">Max Days Overdue</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.studentProfileId}>
                    <TableCell className="font-medium">{r.studentName}</TableCell>
                    <TableCell>{r.admissionNo ?? '—'}</TableCell>
                    <TableCell>{r.className}</TableCell>
                    <TableCell className="text-right font-semibold">{money(r.totalBalance)}</TableCell>
                    <TableCell className="text-right"><Badge variant="destructive">{r.maxDaysOverdue}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="destructive" onClick={() => doWriteOff(r.studentProfileId, r.studentName)} disabled={writeOff.isPending}>Write off</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={6} className="p-2 text-muted-foreground">No bad debtors above {threshold} days.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────────────── Budgeting ───────────────────────── */

export function SchoolBudgetingPage() {
  const budgets = useBudgets();
  const create = useCreateBudget();
  const del = useDeleteBudget();
  const [category, setCategory] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const add = async () => {
    if (!category || !name || !amount) { notify.error('Category, name and amount required'); return; }
    try {
      await create.mutateAsync({ category, name, amount: Number(amount) });
      notify.success('Budget added'); setCategory(''); setName(''); setAmount('');
    } catch { notify.error('Failed to add budget'); }
  };
  const total = (budgets.data ?? []).reduce((s, b) => s + Number(b.amount), 0);
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">School Budget</h1>
        <p className="text-sm text-muted-foreground">Plan the school's budget by category. Used for variance reporting against actual collections and spend.</p>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">School Budget</CardTitle>
          <span className="text-sm text-muted-foreground">Total planned: {money(total)}</span>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input className="w-40" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
            <Input className="w-48" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input className="w-36" type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Button size="sm" onClick={add}><Plus className="mr-1 h-4 w-4" />Add budget</Button>
          </div>
          <ul className="space-y-2 text-sm">
            {(budgets.data ?? []).map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded border p-2">
                <span className="font-medium">{b.name}</span>
                <span className="flex items-center gap-3">
                  <span className="text-muted-foreground">{b.category} · {b.status} · {money(b.amount)}</span>
                  <Button size="sm" variant="outline" onClick={() => del.mutate(b.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </span>
              </li>
            ))}
            {budgets.data && budgets.data.length === 0 && <li className="text-muted-foreground">No budgets yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
