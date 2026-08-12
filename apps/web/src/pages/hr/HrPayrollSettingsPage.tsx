import { useMemo, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useHrPayrollComponents, useCreateHrPayrollComponent, useUpdateHrPayrollComponent, useDeleteHrPayrollComponent, useHrTaxTables, useCreateHrTaxTable, useUpdateHrTaxTable, useDeleteHrTaxTable } from '@/features/hr/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const fmtPct = (r: number | null) => (r === null ? '—' : `${r * 100}%`);

export function HrPayrollSettingsPage() {
  const [tab, setTab] = useState('components');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const { data: comps } = useHrPayrollComponents();
  const { data: tables } = useHrTaxTables();
  const createC = useCreateHrPayrollComponent();
  const updateC = useUpdateHrPayrollComponent();
  const deleteC = useDeleteHrPayrollComponent();
  const createT = useCreateHrTaxTable();
  const updateT = useUpdateHrTaxTable();
  const deleteT = useDeleteHrTaxTable();

  const compRows = useMemo(() => comps?.rows ?? [], [comps]);
  const tableRows = useMemo(() => tables?.rows ?? [], [tables]);

  const openCompCreate = () => { setEditing(null); setForm({ componentType: 'ALLOWANCE', calcMethod: 'FIXED', isTaxable: true, isRecurring: true, appliesTo: '', isActive: true }); setOpen(true); };
  const openCompEdit = (c: any) => {
    setEditing(c);
    setForm({
      code: c.code, name: c.name, componentType: c.componentType, calcMethod: c.calcMethod,
      amount: c.amount ?? '', rate: c.rate ?? '', isTaxable: c.isTaxable, isRecurring: c.isRecurring,
      appliesTo: c.appliesTo ?? '', isActive: c.isActive,
    });
    setOpen(true);
  };
  const submitComp = async () => {
    const payload: any = {
      code: form.code, name: form.name, componentType: form.componentType, calcMethod: form.calcMethod,
      isTaxable: form.isTaxable, isRecurring: form.isRecurring, isActive: form.isActive,
      appliesTo: form.appliesTo || null,
    };
    if (form.amount !== '' && form.amount !== null) payload.amount = Number(form.amount);
    if (form.rate !== '' && form.rate !== null) payload.rate = Number(form.rate);
    if (editing) await updateC.mutateAsync({ id: editing.id, dto: payload });
    else await createC.mutateAsync(payload);
    setOpen(false);
  };

  const openTableCreate = () => { setEditing(null); setForm({ taxType: 'PAYE', effectiveFrom: new Date().toISOString().slice(0, 10), isActive: true }); setOpen(true); };
  const openTableEdit = (t: any) => {
    setEditing(t);
    setForm({ code: t.code, name: t.name, countryCode: t.countryCode ?? '', taxType: t.taxType, effectiveFrom: t.effectiveFrom?.slice(0, 10) ?? '', isActive: t.isActive });
    setOpen(true);
  };
  const submitTable = async () => {
    const payload: any = {
      code: form.code, name: form.name, taxType: form.taxType, effectiveFrom: new Date(form.effectiveFrom).toISOString(),
      isActive: form.isActive, countryCode: form.countryCode || null,
    };
    if (editing) await updateT.mutateAsync({ id: editing.id, dto: payload });
    else await createT.mutateAsync(payload);
    setOpen(false);
  };

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Payroll settings</h1>
        <p className="text-sm text-muted-foreground">Allowance/deduction components and tax tables.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="taxes">Tax tables</TabsTrigger>
        </TabsList>

        <TabsContent value="components" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCompCreate}>New component</Button>
          </div>
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-sm">{compRows.length} components</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {compRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No components yet — add housing, transport, insurance, etc.</p>}
                {compRows.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                    <div className="flex items-center gap-3">
                      <Settings2 className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{c.code} · {c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.componentType === 'ALLOWANCE' ? '+' : '−'}{' '}
                          {c.calcMethod === 'FIXED' ? `Rp ${Number(c.amount ?? 0).toLocaleString('id-ID')}` : fmtPct(c.rate)}
                          {c.isTaxable ? ' · taxable' : ' · non-taxable'} · {c.isRecurring ? 'recurring' : 'one-off'}
                          {c.appliesTo ? ` · ${c.appliesTo.replace(/_/g, ' ')}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!c.isActive && <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>}
                      <button onClick={() => openCompEdit(c)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60">Edit</button>
                      <button onClick={() => { if (confirm(`Delete component ${c.name}?`)) deleteC.mutate(c.id); }}
                        className="rounded-md border px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="taxes" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={openTableCreate}>New tax table</Button>
          </div>
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg">
              <CardTitle className="text-sm">{tableRows.length} tax tables</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {tableRows.length === 0 && <p className="p-6 text-sm text-muted-foreground">No tax tables yet — add PAYE brackets so payroll can withhold.</p>}
                {tableRows.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/40">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{t.code} · {t.name} · {t.taxType.replace(/_/g, ' ')}</p>
                      <p className="text-xs text-muted-foreground">
                        Effective {t.effectiveFrom?.slice(0, 10)}{t.countryCode ? ` · ${t.countryCode}` : ''} ·{' '}
                        {(t.brackets ?? []).map((b: any) => `Rp ${Number(b.fromAmount).toLocaleString('id-ID')}–${b.toAmount ? 'Rp ' + Number(b.toAmount).toLocaleString('id-ID') : '∞'} @ ${b.rate * 100}%`).join(' · ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!t.isActive && <Badge variant="outline" className="bg-muted text-muted-foreground">Inactive</Badge>}
                      <button onClick={() => openTableEdit(t)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted/60">Edit</button>
                      <button onClick={() => { if (confirm(`Delete tax table ${t.name}?`)) deleteT.mutate(t.id); }}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? tab === 'components' ? 'Edit component' : 'Edit tax table'
                : tab === 'components' ? 'New component' : 'New tax table'}
            </DialogTitle>
          </DialogHeader>
          {tab === 'components' ? (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Code *</Label>
                  <Input value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                </div>
                <div>
                  <Label>Name *</Label>
                  <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <select value={form.componentType} onChange={(e) => setForm({ ...form, componentType: e.target.value })}
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    <option value="ALLOWANCE">Allowance</option>
                    <option value="DEDUCTION">Deduction</option>
                  </select>
                </div>
                <div>
                  <Label>Calc method</Label>
                  <select value={form.calcMethod} onChange={(e) => setForm({ ...form, calcMethod: e.target.value })}
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    <option value="FIXED">Fixed amount</option>
                    <option value="PERCENTAGE">Percentage of base</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{form.calcMethod === 'FIXED' ? 'Amount' : 'Rate (0.05 = 5%)'}</Label>
                  <Input type="number" step="0.0001" value={form.amount ?? (form.calcMethod === 'PERCENTAGE' ? '' : form.amount ?? '')}
                    onChange={(e) => setForm({ ...form, [form.calcMethod === 'FIXED' ? 'amount' : 'rate']: e.target.value })} />
                </div>
                <div>
                  <Label>Applies to</Label>
                  <select value={form.appliesTo ?? ''} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })}
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    <option value="">Everyone</option>
                    <option value="ALL">All employees</option>
                    <option value="FULL_TIME">Full-time only</option>
                    <option value="CONTRACT">Contract only</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1"><input type="checkbox" checked={form.isTaxable} onChange={(e) => setForm({ ...form, isTaxable: e.target.checked })} /> Taxable</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={form.isRecurring} onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })} /> Recurring</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
              </div>
              <Button onClick={submitComp} disabled={!form.code || !form.name || createC.isPending || updateC.isPending}>
                {editing ? 'Save changes' : 'Create component'}
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Code *</Label>
                  <Input value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                </div>
                <div>
                  <Label>Name *</Label>
                  <Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tax type</Label>
                  <select value={form.taxType} onChange={(e) => setForm({ ...form, taxType: e.target.value })}
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                    <option value="PAYE">PAYE</option>
                    <option value="PENSION">Pension</option>
                    <option value="SOCIAL_SECURITY">Social security</option>
                    <option value="LOCAL">Local</option>
                  </select>
                </div>
                <div>
                  <Label>Effective from *</Label>
                  <Input type="date" value={form.effectiveFrom ?? ''} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Country code</Label>
                <Input value={form.countryCode ?? ''} onChange={(e) => setForm({ ...form, countryCode: e.target.value })} placeholder="ID" />
              </div>
              <p className="text-xs text-muted-foreground">Brackets are managed through the API — the payroll engine applies the top-most active table of each type.</p>
              <Button onClick={submitTable} disabled={!form.code || !form.name || !form.effectiveFrom || createT.isPending || updateT.isPending}>
                {editing ? 'Save changes' : 'Create tax table'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
