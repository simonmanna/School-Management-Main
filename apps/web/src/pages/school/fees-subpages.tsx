import { useState } from 'react';
import { Plus, Play, HandCoins, Eraser, Trash2 } from 'lucide-react';
import {
  useCollectPayment,
  useStudents,
  useStudentStatement,
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
} from '@/features/school/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { money, sel, Stat } from './fees-shared';

/* ───────────────────────── Collect ───────────────────────── */

export function SchoolFeesCollectPage() {
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
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Collect Fees</h1>
        <p className="text-sm text-muted-foreground">Record a fee payment, allocate it to open invoices, and print a receipt.</p>
      </div>
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
