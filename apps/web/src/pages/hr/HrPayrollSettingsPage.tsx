import { useMemo, useState } from 'react';
import { Plus, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  useHrPayrollComponents, useCreateHrPayrollComponent, useUpdateHrPayrollComponent, useDeleteHrPayrollComponent,
  useHrTaxTables, useCreateHrTaxTable, useUpdateHrTaxTable, useDeleteHrTaxTable,
  useHrStatutory, useCreateHrStatutory, useUpdateHrStatutory, useDeleteHrStatutory,
} from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMoneyFormatter } from '@/lib/format';

/**
 * Rate conventions differ by table, and the UI must say which:
 *  - component `rate` is a PERCENT (5 = 5%);
 *  - tax bracket and statutory `rate` are FRACTIONS in the API (0.05 = 5%).
 * This page always takes percentages from the user and converts fractions.
 */
const pct = (fraction: number | string | null | undefined) =>
  fraction === null || fraction === undefined || fraction === '' ? '—' : `${+(Number(fraction) * 100).toFixed(4)}%`;
const toFraction = (percent: string | number) => Number(percent) / 100;

const DEDUCTION_CATEGORIES: Array<[string, string]> = [
  ['', 'Auto (from code)'],
  ['PENSION', 'Pension → pension payable'],
  ['SOCIAL_SECURITY', 'Social security → SSF payable'],
  ['INSURANCE', 'Insurance → insurance payable'],
  ['OTHER_PAYABLE', 'Owed to a third party (union, SACCO)'],
  ['RECOVERY', 'Recovered by the school (shop, damage)'],
];

/** `appliesTo` is `key:value`; a bare value used to be ignored and applied to everyone. */
const APPLIES_TO: Array<[string, string]> = [
  ['', 'Everyone'],
  ['employmentType:FULL_TIME', 'Full-time only'],
  ['employmentType:PART_TIME', 'Part-time only'],
  ['employmentType:CONTRACT', 'Contract only'],
  ['employmentType:CASUAL', 'Casual only'],
];

const onError = (e: any) => toast.error(e?.response?.data?.message ?? 'Request failed');

type BracketRow = { fromAmount: string; toAmount: string; ratePct: string; fixedAmount: string };

export function HrPayrollSettingsPage() {
  const fmt = useMoneyFormatter();
  const [tab, setTab] = useState('components');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [brackets, setBrackets] = useState<BracketRow[]>([]);
  const { data: comps } = useHrPayrollComponents();
  const { data: tables } = useHrTaxTables();
  const { data: statutory } = useHrStatutory();
  const createC = useCreateHrPayrollComponent();
  const updateC = useUpdateHrPayrollComponent();
  const deleteC = useDeleteHrPayrollComponent();
  const createT = useCreateHrTaxTable();
  const updateT = useUpdateHrTaxTable();
  const deleteT = useDeleteHrTaxTable();
  const createS = useCreateHrStatutory();
  const updateS = useUpdateHrStatutory();
  const deleteS = useDeleteHrStatutory();

  const compRows = useMemo(() => comps?.rows ?? [], [comps]);
  const tableRows = useMemo(() => tables?.rows ?? [], [tables]);
  const statRows = useMemo(() => statutory?.rows ?? [], [statutory]);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setOpen(false);
    } catch (e) {
      onError(e);
    }
  };

  // ── Components ──────────────────────────────────────────────────────────
  const openCompCreate = () => {
    setEditing(null);
    setForm({ componentType: 'ALLOWANCE', calcMethod: 'FIXED', isTaxable: true, isRecurring: true, appliesTo: '', deductionCategory: '', isActive: true });
    setOpen(true);
  };
  const openCompEdit = (c: any) => {
    setEditing(c);
    setForm({
      code: c.code, name: c.name, componentType: c.componentType, calcMethod: c.calcMethod,
      amount: c.amount ?? '', rate: c.rate ?? '', isTaxable: c.isTaxable, isRecurring: c.isRecurring,
      appliesTo: c.appliesTo ?? '', deductionCategory: c.deductionCategory ?? '', isActive: c.isActive,
    });
    setOpen(true);
  };
  const submitComp = () => run(async () => {
    const payload: any = {
      name: form.name, componentType: form.componentType, calcMethod: form.calcMethod,
      isTaxable: form.isTaxable, isRecurring: form.isRecurring, isActive: form.isActive,
      appliesTo: form.appliesTo ?? '',
    };
    if (form.componentType === 'DEDUCTION' && form.deductionCategory) payload.deductionCategory = form.deductionCategory;
    if (form.calcMethod === 'FIXED' && form.amount !== '') payload.amount = Number(form.amount);
    if (form.calcMethod === 'PERCENTAGE' && form.rate !== '') payload.rate = Number(form.rate); // PERCENT
    if (editing) await updateC.mutateAsync({ id: editing.id, dto: payload });
    else await createC.mutateAsync({ ...payload, code: form.code });
  });

  // ── Tax tables ──────────────────────────────────────────────────────────
  const openTableCreate = () => {
    setEditing(null);
    setForm({ taxType: 'PAYE', effectiveFrom: new Date().toISOString().slice(0, 10), isActive: true, contributionsDeductible: false, collectionMonths: '' });
    setBrackets([{ fromAmount: '0', toAmount: '', ratePct: '0', fixedAmount: '' }]);
    setOpen(true);
  };
  const openTableEdit = (t: any) => {
    setEditing(t);
    setForm({
      code: t.code, name: t.name, countryCode: t.countryCode ?? '', taxType: t.taxType,
      effectiveFrom: t.effectiveFrom?.slice(0, 10) ?? '', isActive: t.isActive,
      contributionsDeductible: !!t.contributionsDeductible, collectionMonths: t.collectionMonths ?? '',
    });
    setBrackets((t.brackets ?? []).map((b: any) => ({
      fromAmount: String(Number(b.fromAmount)),
      toAmount: b.toAmount === null ? '' : String(Number(b.toAmount)),
      ratePct: String(+(Number(b.rate) * 100).toFixed(4)),
      fixedAmount: b.fixedAmount === null || b.fixedAmount === undefined ? '' : String(Number(b.fixedAmount)),
    })));
    setOpen(true);
  };
  const submitTable = () => run(async () => {
    const payload: any = {
      name: form.name, taxType: form.taxType, effectiveFrom: new Date(form.effectiveFrom).toISOString(),
      isActive: form.isActive, countryCode: form.countryCode || undefined,
      contributionsDeductible: !!form.contributionsDeductible,
      brackets: brackets
        .filter((b) => b.fromAmount !== '')
        .map((b) => ({
          fromAmount: Number(b.fromAmount),
          ...(b.toAmount !== '' ? { toAmount: Number(b.toAmount) } : {}),
          rate: b.ratePct === '' ? 0 : toFraction(b.ratePct),
          ...(b.fixedAmount !== '' ? { fixedAmount: Number(b.fixedAmount) } : {}),
        })),
    };
    if (form.taxType === 'LOCAL' && form.collectionMonths) payload.collectionMonths = form.collectionMonths;
    if (editing) await updateT.mutateAsync({ id: editing.id, dto: payload });
    else await createT.mutateAsync({ ...payload, code: form.code });
  });
  const setBracket = (i: number, patch: Partial<BracketRow>) =>
    setBrackets(brackets.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  // ── Statutory contributions ─────────────────────────────────────────────
  const openStatCreate = () => {
    setEditing(null);
    setForm({ configType: 'SOCIAL_SECURITY', contributionBase: 'GROSS', effectiveFrom: new Date().toISOString().slice(0, 10), isActive: true, ratePct: '', employerRatePct: '', ceiling: '' });
    setOpen(true);
  };
  const openStatEdit = (c: any) => {
    setEditing(c);
    setForm({
      code: c.code, name: c.name, configType: c.configType, contributionBase: c.contributionBase ?? 'GROSS',
      effectiveFrom: c.effectiveFrom?.slice(0, 10) ?? '', isActive: c.isActive,
      ratePct: c.rate === null ? '' : String(+(Number(c.rate) * 100).toFixed(4)),
      employerRatePct: c.employerRate === null ? '' : String(+(Number(c.employerRate) * 100).toFixed(4)),
      ceiling: c.ceiling === null || c.ceiling === undefined ? '' : String(Number(c.ceiling)),
    });
    setOpen(true);
  };
  const submitStat = () => run(async () => {
    const payload: any = {
      name: form.name, configType: form.configType, contributionBase: form.contributionBase,
      effectiveFrom: new Date(form.effectiveFrom).toISOString(), isActive: form.isActive,
    };
    if (form.ratePct !== '') payload.rate = toFraction(form.ratePct);
    if (form.employerRatePct !== '') payload.employerRate = toFraction(form.employerRatePct);
    if (form.ceiling !== '') payload.ceiling = Number(form.ceiling);
    if (editing) await updateS.mutateAsync({ id: editing.id, dto: payload });
    else await createS.mutateAsync({ ...payload, code: form.code });
  });

  const title = { components: 'component', taxes: 'tax table', statutory: 'statutory contribution' }[tab] ?? '';

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Payroll settings</h1>
        <p className="text-sm text-muted-foreground">
          Components, tax tables (PAYE, local service tax) and statutory contributions (NSSF / pension). Rates change by
          adding a new version with a later effective date — never by editing the one past runs used.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="taxes">Tax tables</TabsTrigger>
          <TabsTrigger value="statutory">Statutory contributions</TabsTrigger>
        </TabsList>

        <TabsContent value="components" className="space-y-4">
          <div className="flex justify-end"><Button onClick={openCompCreate}>New component</Button></div>
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{compRows.length} components</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {compRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No components yet — add housing, transport, insurance, etc.</p>}
                {compRows.map((c: any) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/40">
                    <div className="flex items-center gap-3">
                      <Settings2 className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{c.code} · {c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.componentType === 'ALLOWANCE' ? '+' : '−'}{' '}
                          {c.calcMethod === 'FIXED' ? fmt(c.amount ?? 0) : `${Number(c.rate ?? 0)}% of base`}
                          {c.isTaxable ? ' · taxable' : ' · non-taxable'} · {c.isRecurring ? 'recurring' : 'one-off'}
                          {c.deductionCategory ? ` · ${c.deductionCategory.replace(/_/g, ' ').toLowerCase()}` : ''}
                          {c.appliesTo ? ` · ${APPLIES_TO.find(([v]) => v === c.appliesTo)?.[1] ?? c.appliesTo}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!c.isActive && <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>}
                      <button onClick={() => openCompEdit(c)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60">Edit</button>
                      <button onClick={() => { if (confirm(`Delete component ${c.name}?`)) deleteC.mutate(c.id, { onError }); }}
                        className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="taxes" className="space-y-4">
          <div className="flex justify-end"><Button onClick={openTableCreate}>New tax table</Button></div>
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{tableRows.length} tax tables</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {tableRows.length === 0 && (
                  <p className="p-6 text-sm text-muted-foreground">No tax tables yet. Payroll refuses to calculate without an active PAYE table — add one (a single 0% band if staff are exempt).</p>
                )}
                {tableRows.map((t: any) => (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{t.code} · {t.name} · {t.taxType.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">
                        Effective {t.effectiveFrom?.slice(0, 10)}{t.countryCode ? ` · ${t.countryCode}` : ''}
                        {t.taxType === 'PAYE' ? (t.contributionsDeductible ? ' · contributions deductible' : ' · contributions NOT deductible') : ''}
                        {t.collectionMonths ? ` · collected in months ${t.collectionMonths}` : ''}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        {(t.brackets ?? []).map((b: any) =>
                          `${fmt(b.fromAmount)}–${b.toAmount ? fmt(b.toAmount) : '∞'} @ ${b.fixedAmount ? `${fmt(b.fixedAmount)}/yr` : pct(b.rate)}`,
                        ).join(' · ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!t.isActive && <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>}
                      <button onClick={() => openTableEdit(t)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60">Edit</button>
                      <button onClick={() => { if (confirm(`Delete tax table ${t.name}?`)) deleteT.mutate(t.id, { onError }); }}
                        className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statutory" className="space-y-4">
          <div className="flex justify-end"><Button onClick={openStatCreate}>New contribution</Button></div>
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">{statRows.length} statutory configs</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {statRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No statutory contributions — add NSSF (Uganda: 5% employee, 10% employer, on gross).</p>}
                {statRows.map((c: any) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/40">
                    <div>
                      <p className="text-sm font-medium">{c.code} · {c.name} · {c.configType.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">
                        Employee {pct(c.rate)} · employer {pct(c.employerRate)} · on {c.contributionBase?.toLowerCase() ?? 'gross'}
                        {c.ceiling ? ` · capped at ${fmt(c.ceiling)}/month` : ''} · from {c.effectiveFrom?.slice(0, 10)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!c.isActive && <Badge variant="outline" className="bg-muted text-muted-foreground">Retired</Badge>}
                      <button onClick={() => openStatEdit(c)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60">Edit</button>
                      <button onClick={() => { if (confirm(`Delete ${c.name}?`)) deleteS.mutate(c.id, { onError }); }}
                        className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Edit ${title}` : `New ${title}`}</DialogTitle></DialogHeader>

          {tab === 'components' && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Code *</Label><Input value={form.code ?? ''} disabled={!!editing} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                <div><Label>Name *</Label><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <select value={form.componentType} onChange={(e) => setForm({ ...form, componentType: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    <option value="ALLOWANCE">Allowance</option>
                    <option value="DEDUCTION">Deduction</option>
                  </select>
                </div>
                <div>
                  <Label>Calc method</Label>
                  <select value={form.calcMethod} onChange={(e) => setForm({ ...form, calcMethod: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    <option value="FIXED">Fixed amount per month</option>
                    <option value="PERCENTAGE">Percentage of basic pay</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{form.calcMethod === 'FIXED' ? 'Amount' : 'Rate (%) — 5 means 5%'}</Label>
                  <Input
                    type="number" step="0.0001"
                    value={form.calcMethod === 'FIXED' ? form.amount ?? '' : form.rate ?? ''}
                    onChange={(e) => setForm({ ...form, [form.calcMethod === 'FIXED' ? 'amount' : 'rate']: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Applies to</Label>
                  <select value={form.appliesTo ?? ''} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    {APPLIES_TO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>
              {form.componentType === 'DEDUCTION' && (
                <div>
                  <Label>What it is (where it posts)</Label>
                  <select value={form.deductionCategory ?? ''} onChange={(e) => setForm({ ...form, deductionCategory: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    {DEDUCTION_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">Configure NSSF / pension under Statutory contributions, not here.</p>
                </div>
              )}
              <div className="flex flex-wrap gap-4 text-sm">
                {form.componentType === 'ALLOWANCE' && (
                  <label className="flex items-center gap-1"><input type="checkbox" checked={form.isTaxable} onChange={(e) => setForm({ ...form, isTaxable: e.target.checked })} /> Taxable</label>
                )}
                <label className="flex items-center gap-1"><input type="checkbox" checked={form.isRecurring} onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })} /> Recurring</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
              </div>
              <Button onClick={submitComp} disabled={!form.code || !form.name || createC.isPending || updateC.isPending}>
                {editing ? 'Save changes' : 'Create component'}
              </Button>
            </div>
          )}

          {tab === 'taxes' && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Code *</Label><Input value={form.code ?? ''} disabled={!!editing} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
                <div><Label>Name *</Label><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Tax type</Label>
                  <select value={form.taxType} onChange={(e) => setForm({ ...form, taxType: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    <option value="PAYE">PAYE</option>
                    <option value="LOCAL">Local service tax</option>
                  </select>
                </div>
                <div><Label>Effective from *</Label><Input type="date" value={form.effectiveFrom ?? ''} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></div>
                <div><Label>Country</Label><Input value={form.countryCode ?? ''} onChange={(e) => setForm({ ...form, countryCode: e.target.value })} placeholder="UG" /></div>
              </div>
              {form.taxType === 'PAYE' ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!form.contributionsDeductible} onChange={(e) => setForm({ ...form, contributionsDeductible: e.target.checked })} />
                  Employee pension / social-security contributions reduce taxable pay (Uganda: no · Kenya: yes)
                </label>
              ) : (
                <div>
                  <Label>Collection months</Label>
                  <Input value={form.collectionMonths ?? ''} onChange={(e) => setForm({ ...form, collectionMonths: e.target.value })} placeholder="7,8,9,10" />
                </div>
              )}
              <div className="rounded-md border">
                <div className="flex items-center justify-between bg-muted/30 border-b px-3 py-2 text-xs text-muted-foreground">
                  <span>{form.taxType === 'PAYE' ? 'Bands on ANNUAL taxable pay (monthly band × 12)' : 'Bands on MONTHLY gross; fixed amount is the ANNUAL charge'}</span>
                  <button className="flex items-center gap-1 hover:text-foreground" onClick={() => setBrackets([...brackets, { fromAmount: '', toAmount: '', ratePct: '0', fixedAmount: '' }])}>
                    <Plus className="h-3 w-3" /> Band
                  </button>
                </div>
                <div className="space-y-2 p-3">
                  <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-xs text-muted-foreground">
                    <span>From</span><span>To (blank = above)</span><span>Rate %</span><span>{form.taxType === 'LOCAL' ? 'Fixed / yr' : ''}</span><span />
                  </div>
                  {brackets.map((b, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2">
                      <Input type="number" value={b.fromAmount} onChange={(e) => setBracket(i, { fromAmount: e.target.value })} />
                      <Input type="number" value={b.toAmount} onChange={(e) => setBracket(i, { toAmount: e.target.value })} />
                      <Input type="number" step="0.01" value={b.ratePct} onChange={(e) => setBracket(i, { ratePct: e.target.value })} />
                      {form.taxType === 'LOCAL'
                        ? <Input type="number" value={b.fixedAmount} onChange={(e) => setBracket(i, { fixedAmount: e.target.value })} />
                        : <span />}
                      <button aria-label="Remove band" onClick={() => setBrackets(brackets.filter((_, j) => j !== i))} className="px-1 text-rose-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <Button onClick={submitTable} disabled={!form.code || !form.name || !form.effectiveFrom || createT.isPending || updateT.isPending}>
                {editing ? 'Save changes' : 'Create tax table'}
              </Button>
            </div>
          )}

          {tab === 'statutory' && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Code *</Label><Input value={form.code ?? ''} disabled={!!editing} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="UG-NSSF" /></div>
                <div><Label>Name *</Label><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <select value={form.configType} onChange={(e) => setForm({ ...form, configType: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    <option value="SOCIAL_SECURITY">Social security (NSSF)</option>
                    <option value="PENSION">Pension</option>
                  </select>
                </div>
                <div>
                  <Label>Applies to</Label>
                  <select value={form.contributionBase} onChange={(e) => setForm({ ...form, contributionBase: e.target.value })} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    <option value="GROSS">Gross pay</option>
                    <option value="BASIC">Basic pay</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Employee %</Label><Input type="number" step="0.01" value={form.ratePct ?? ''} onChange={(e) => setForm({ ...form, ratePct: e.target.value })} placeholder="5" /></div>
                <div><Label>Employer %</Label><Input type="number" step="0.01" value={form.employerRatePct ?? ''} onChange={(e) => setForm({ ...form, employerRatePct: e.target.value })} placeholder="10" /></div>
                <div><Label>Monthly cap</Label><Input type="number" value={form.ceiling ?? ''} onChange={(e) => setForm({ ...form, ceiling: e.target.value })} placeholder="none" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Effective from *</Label><Input type="date" value={form.effectiveFrom ?? ''} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></div>
                <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
              </div>
              <Button onClick={submitStat} disabled={!form.code || !form.name || !form.effectiveFrom || createS.isPending || updateS.isPending}>
                {editing ? 'Save changes' : 'Create contribution'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
