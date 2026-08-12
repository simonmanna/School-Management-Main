import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Wrench, CheckCircle2, X, FileText, ArrowRight, User, Package,
  ClipboardList, History, Paperclip, CreditCard, Stethoscope, BadgeCheck,
} from 'lucide-react';
import {
  useRepairOrder, useTransitionRepairOrder, useAssignTechnician, useAddRepairItem,
  useRemoveRepairItem, useCreateDiagnosis, useCreateRepairQuotation, useApproveQuotation,
  useRejectQuotation, useCreateRepairJob, useStartJob, useCompleteJob, useTestJob,
  useReservePart, useIssuePart, useDeletePart, useBillRepair, useRepairTechnicians,
  useRepairLabourTypes, useAddRepairAttachment, useRemoveRepairAttachment,
} from '@/features/repair/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { date } from '@/lib/format';

const fmt = (n: number | string) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;

const STATUS_STYLES: Record<string, string> = {
  received: 'bg-blue-100 text-blue-800',
  diagnosis: 'bg-violet-100 text-violet-800',
  waiting_approval: 'bg-amber-100 text-amber-800',
  approved: 'bg-cyan-100 text-cyan-800',
  repairing: 'bg-emerald-100 text-emerald-800',
  testing: 'bg-teal-100 text-teal-800',
  ready_pickup: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-sky-100 text-sky-800',
  closed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

export function RepairOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading } = useRepairOrder(id);
  const transition = useTransitionRepairOrder();
  const bill = useBillRepair();

  const [run, setRun] = useState<{ label: string; fn: () => Promise<any> } | null>(null);
  const exec = async (label: string, fn: () => Promise<any>) => {
    setRun({ label, fn });
    try { await fn(); } finally { setRun(null); }
  };

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!order) return <div className="p-6 text-sm text-muted-foreground">Repair order not found.</div>;

  const active = !['closed', 'cancelled'].includes(order.status);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link to="/repair/orders" className="hover:text-foreground">Repair</Link>
        <span>/</span>
        <span className="text-foreground">{order.repairNumber}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Wrench className="h-5 w-5 text-primary" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{order.repairNumber}</h1>
              <Badge variant="outline" className={STATUS_STYLES[order.status] ?? ''}>{order.status.replace(/_/g, ' ')}</Badge>
              <Badge variant="outline">{order.orderType.replace(/_/g, ' ')} · {order.priority}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {order.itemType ?? 'Item'}{order.brand ? ` · ${order.brand} ${order.model ?? ''}` : ''}
              {order.serialNumber ? ` · SN ${order.serialNumber}` : ''}
              {order.imei ? ` · IMEI ${order.imei}` : ''}
              {order.plateNumber ? ` · Plate ${order.plateNumber}` : ''}
              {order.vin ? ` · VIN ${order.vin}` : ''}
              {' · '}{order.partner?.name ?? 'Walk-in'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {active && (
            <>
              {order.status === 'received' && (
                <Button size="sm" onClick={() => exec('Moved to diagnosis', () => transition.mutateAsync({ id: order.id, dto: { status: 'diagnosis' } }))}>
                  <ArrowRight className="h-4 w-4" /> Start diagnosis
                </Button>
              )}
              {order.status === 'approved' && (
                <Button size="sm" onClick={() => exec('Started repair', () => transition.mutateAsync({ id: order.id, dto: { status: 'repairing' } }))}>
                  <Wrench className="h-4 w-4" /> Start repair
                </Button>
              )}
              {order.status === 'repairing' && (
                <Button size="sm" onClick={() => exec('Moved to testing', () => transition.mutateAsync({ id: order.id, dto: { status: 'testing' } }))}>
                  <ClipboardList className="h-4 w-4" /> Send to testing
                </Button>
              )}
              {order.status === 'testing' && (
                <Button size="sm" onClick={() => exec('Ready for pickup', () => transition.mutateAsync({ id: order.id, dto: { status: 'ready_pickup' } }))}>
                  <CheckCircle2 className="h-4 w-4" /> Mark ready
                </Button>
              )}
              {order.status === 'ready_pickup' && !order.invoiceId && (
                <Button size="sm" onClick={() => exec('Billed', () => bill.mutateAsync({ id: order.id }))}>
                  <CreditCard className="h-4 w-4" /> Bill customer
                </Button>
              )}
              {order.status === 'ready_pickup' && order.invoiceId && (
                <Button size="sm" onClick={() => exec('Delivered', () => transition.mutateAsync({ id: order.id, dto: { status: 'delivered' } }))}>
                  <BadgeCheck className="h-4 w-4" /> Deliver
                </Button>
              )}
              {order.status === 'delivered' && (
                <Button size="sm" onClick={() => exec('Closed', () => transition.mutateAsync({ id: order.id, dto: { status: 'closed' } }))}>
                  <CheckCircle2 className="h-4 w-4" /> Close
                </Button>
              )}
              {!['closed', 'cancelled'].includes(order.status) && order.status !== 'delivered' && (
                <Button size="sm" variant="destructive" onClick={() => exec('Cancelled', () => transition.mutateAsync({ id: order.id, dto: { status: 'cancelled' } }))}>
                  <X className="h-4 w-4" /> Cancel
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <OrderTabs order={order} exec={exec} running={run?.label} />
    </div>
  );
}

// Hooks must be called at top level of the component that renders the tabs —
// they're called here (a component) so query keys stay stable.
function OrderTabs({ order, exec, running }: { order: any; exec: (l: string, fn: () => Promise<any>) => void; running?: string }) {
  const assign = useAssignTechnician();
  const addItem = useAddRepairItem();
  const removeItem = useRemoveRepairItem();
  const createDiagnosis = useCreateDiagnosis();
  const createQuotation = useCreateRepairQuotation();
  const approveQuotation = useApproveQuotation();
  const rejectQuotation = useRejectQuotation();
  const createJob = useCreateRepairJob();
  const startJob = useStartJob();
  const completeJob = useCompleteJob();
  const testJob = useTestJob();
  const reservePart = useReservePart();
  const issuePart = useIssuePart();
  const deletePart = useDeletePart();
  const addAttachment = useAddRepairAttachment();
  const removeAttachment = useRemoveRepairAttachment();
  const { data: technicians } = useRepairTechnicians();
  const { data: labourTypes } = useRepairLabourTypes();

  const [itemForm, setItemForm] = useState({ itemType: '', brand: '', model: '', serialNumber: '', problemDescription: '' });
  const [techForm, setTechForm] = useState({ technicianId: '', note: '' });
  const [diagForm, setDiagForm] = useState({ symptoms: '', rootCause: '', faults: '', estimatedCost: '', estimatedTimeHours: '', riskNotes: '' });
  const [quotationLines, setQuotationLines] = useState<any[]>([{ kind: 'labour', description: '', quantity: 1, unitPrice: '' }]);
  const [jobForm, setJobForm] = useState({ technicianId: '', priority: 'medium', deadline: '', estimatedHours: '', instructions: '' });
  const [partForm, setPartForm] = useState({ productId: '', quantity: 1, unitCost: '' });
  const [attachForm, setAttachForm] = useState({ kind: 'before', caption: '', fileId: '' });

  const items = order.items ?? [];
  const quotation = order.quotation;
  const diagnosis = order.diagnosis;
  const jobs = order.jobs ?? [];
  const parts = order.parts ?? [];
  const history = order.history ?? [];
  const attachments = order.attachments ?? [];

  const setItem = (k: string, v: string) => setItemForm((f) => ({ ...f, [k]: v }));
  const setDiag = (k: string, v: string) => setDiagForm((f) => ({ ...f, [k]: v }));
  const setJob = (k: string, v: string) => setJobForm((f) => ({ ...f, [k]: v }));
  const setPart = (k: string, v: string) => setPartForm((f) => ({ ...f, [k]: v }));
  const setAttach = (k: string, v: string) => setAttachForm((f) => ({ ...f, [k]: v }));
  const setLine = (i: number, k: string, v: string) =>
    setQuotationLines((lines) => lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  const submitItem = () => exec('Item added', () => addItem.mutateAsync({ id: order.id, dto: itemForm }));
  const submitTech = () => exec('Technician assigned', () => assign.mutateAsync({ id: order.id, dto: techForm }));
  const submitDiagnosis = () =>
    exec('Diagnosis saved', () =>
      createDiagnosis.mutateAsync({
        id: order.id,
        dto: {
          ...diagForm,
          faults: diagForm.faults ? diagForm.faults.split('\n').map((s) => s.trim()).filter(Boolean) : [],
          estimatedCost: diagForm.estimatedCost ? Number(diagForm.estimatedCost) : undefined,
          estimatedTimeHours: diagForm.estimatedTimeHours ? Number(diagForm.estimatedTimeHours) : undefined,
        },
      }));
  const submitQuotation = () =>
    exec('Quotation created', () =>
      createQuotation.mutateAsync({
        id: order.id,
        dto: {
          lines: quotationLines.map((l, i) => ({
            kind: l.kind,
            description: l.description,
            quantity: Number(l.quantity) || 1,
            unitPrice: Number(l.unitPrice) || 0,
            lineNumber: i + 1,
          })),
        },
      }));
  const submitJob = () =>
    exec('Job created', () =>
      createJob.mutateAsync({
        id: order.id,
        dto: {
          ...jobForm,
          deadline: jobForm.deadline ? new Date(jobForm.deadline).toISOString() : undefined,
          estimatedHours: jobForm.estimatedHours ? Number(jobForm.estimatedHours) : undefined,
          technicianId: jobForm.technicianId || undefined,
        },
      }));
  const submitPart = () =>
    exec('Part reserved', () =>
      reservePart.mutateAsync({
        id: order.id,
        dto: { ...partForm, quantity: Number(partForm.quantity) || 1, unitCost: partForm.unitCost ? Number(partForm.unitCost) : undefined },
      }));
  const submitAttach = () => exec('Attachment added', () => addAttachment.mutateAsync({ id: order.id, dto: attachForm }));

  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="items">Items ({items.length})</TabsTrigger>
        <TabsTrigger value="diagnosis">Diagnosis</TabsTrigger>
        <TabsTrigger value="quotation">Quotation</TabsTrigger>
        <TabsTrigger value="jobs">Jobs ({jobs.length})</TabsTrigger>
        <TabsTrigger value="parts">Parts ({parts.length})</TabsTrigger>
        <TabsTrigger value="attachments">Photos ({attachments.length})</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>

      {/* ── Overview ─────────────────────────────────────────────── */}
      <TabsContent value="overview" className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Order details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Type</dt><dd className="text-right">{order.orderType.replace(/_/g, ' ')}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Priority</dt><dd className="text-right capitalize">{order.priority}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Due date</dt><dd className="text-right">{order.dueDate ? date(order.dueDate) : '—'}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Received</dt><dd className="text-right">{order.receivedAt ? date(order.receivedAt) : '—'}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Technician</dt><dd className="text-right">{order.technician?.name ?? '—'}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Quotation</dt><dd className="text-right">{order.quotation?.quotationNumber ?? '—'}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Invoice</dt><dd className="text-right">{order.invoiceId ? order.invoiceId.slice(0, 8) : '—'}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Item</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Item type</dt><dd className="text-right">{order.itemType ?? '—'}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Brand / model</dt><dd className="text-right">{order.brand ? `${order.brand} ${order.model ?? ''}` : '—'}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Serial</dt><dd className="text-right">{order.serialNumber ?? '—'}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">IMEI</dt><dd className="text-right">{order.imei ?? '—'}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Asset tag</dt><dd className="text-right">{order.assetTag ?? '—'}</dd>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Plate / VIN</dt><dd className="text-right">{order.plateNumber ?? order.vin ?? '—'}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Problem & totals</CardTitle></CardHeader>
            <CardContent className="space-y-3 p-4 text-sm">
              <p className="text-muted-foreground">{order.problemDescription ?? 'No problem description.'}</p>
              <div className="space-y-1 border-t pt-2">
                <div className="flex justify-between"><span className="text-muted-foreground">Labour</span><span>{fmt(order.labourTotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Parts</span><span>{fmt(order.partsTotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span>{fmt(order.taxTotal)}</span></div>
                <div className="flex justify-between font-semibold"><span>Total</span><span>{fmt(order.totalAmount)}</span></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Assign technician</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-52 flex-1">
              <Label>Technician</Label>
              <select value={techForm.technicianId} onChange={(e) => setTechForm((f) => ({ ...f, technicianId: e.target.value }))} className="w-full rounded-md border bg-card px-3 py-2 text-sm">
                <option value="">— Unassigned —</option>
                {(technicians?.items ?? technicians ?? []).map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <Button size="sm" onClick={submitTech} disabled={!!running || !techForm.technicianId}>
              <User className="h-4 w-4" /> Assign
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Items ────────────────────────────────────────────────── */}
      <TabsContent value="items" className="space-y-4">
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Devices / equipment on this order</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {items.length === 0 && <p className="p-6 text-sm text-muted-foreground">No items — the header item serves as the primary device.</p>}
              {items.map((it: any) => (
                <div key={it.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{it.itemType ?? 'Item'} {it.brand ? `· ${it.brand} ${it.model ?? ''}` : ''}</p>
                    <p className="text-xs text-muted-foreground">
                      {it.serialNumber ? `SN ${it.serialNumber} · ` : ''}{it.imei ? `IMEI ${it.imei} · ` : ''}{it.problemDescription ?? ''}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => exec('Item removed', () => removeItem.mutateAsync(it.id))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Add item</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-5">
            <Input placeholder="Type (phone, laptop…)" value={itemForm.itemType} onChange={(e) => setItem('itemType', e.target.value)} />
            <Input placeholder="Brand" value={itemForm.brand} onChange={(e) => setItem('brand', e.target.value)} />
            <Input placeholder="Model" value={itemForm.model} onChange={(e) => setItem('model', e.target.value)} />
            <Input placeholder="Serial" value={itemForm.serialNumber} onChange={(e) => setItem('serialNumber', e.target.value)} />
            <Button size="sm" onClick={submitItem} disabled={!!running}>Add</Button>
            <Input className="sm:col-span-5" placeholder="Problem description" value={itemForm.problemDescription} onChange={(e) => setItem('problemDescription', e.target.value)} />
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Diagnosis ────────────────────────────────────────────── */}
      <TabsContent value="diagnosis" className="space-y-4">
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Diagnosis {diagnosis ? `· updated ${date(diagnosis.updatedAt)}` : ''}</CardTitle></CardHeader>
          <CardContent className="space-y-3 p-4">
            {diagnosis ? (
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Symptoms</dt><dd>{diagnosis.symptoms ?? '—'}</dd>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Root cause</dt><dd>{diagnosis.rootCause ?? '—'}</dd>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Faults</dt><dd>{(diagnosis.faults ?? []).join(', ') || '—'}</dd>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Est. cost</dt><dd>{diagnosis.estimatedCost ? fmt(diagnosis.estimatedCost) : '—'}</dd>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Est. time</dt><dd>{diagnosis.estimatedTimeHours ? `${diagnosis.estimatedTimeHours} h` : '—'}</dd>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Risks</dt><dd>{diagnosis.riskNotes ?? '—'}</dd>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No diagnosis yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Record diagnosis</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
            <Input className="sm:col-span-3" placeholder="Symptoms" value={diagForm.symptoms} onChange={(e) => setDiag('symptoms', e.target.value)} />
            <Input className="sm:col-span-3" placeholder="Root cause" value={diagForm.rootCause} onChange={(e) => setDiag('rootCause', e.target.value)} />
            <textarea className="rounded-md border bg-card px-3 py-2 text-sm sm:col-span-3" rows={2} placeholder="Faults (one per line)" value={diagForm.faults} onChange={(e) => setDiag('faults', e.target.value)} />
            <Input type="number" placeholder="Est. cost (Rp)" value={diagForm.estimatedCost} onChange={(e) => setDiag('estimatedCost', e.target.value)} />
            <Input type="number" placeholder="Est. time (hours)" value={diagForm.estimatedTimeHours} onChange={(e) => setDiag('estimatedTimeHours', e.target.value)} />
            <Input placeholder="Risk notes" value={diagForm.riskNotes} onChange={(e) => setDiag('riskNotes', e.target.value)} />
            <div className="sm:col-span-3">
              <Button size="sm" onClick={submitDiagnosis} disabled={!!running}>
                <Stethoscope className="h-4 w-4" /> Save diagnosis
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Quotation ────────────────────────────────────────────── */}
      <TabsContent value="quotation" className="space-y-4">
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Quotation {quotation ? `· ${quotation.quotationNumber} rev ${quotation.revision}` : ''}</CardTitle></CardHeader>
          <CardContent className="p-0">
            {quotation ? (
              <>
                <div className="flex items-center justify-between px-4 py-3">
                  <Badge variant="outline" className={quotation.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : quotation.status === 'rejected' ? 'bg-red-100 text-red-800' : quotation.status === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-muted text-muted-foreground'}>
                    {quotation.status}
                  </Badge>
                  <div className="flex gap-2">
                    {quotation.status === 'pending' && (
                      <>
                        <Button size="sm" onClick={() => exec('Quotation approved', () => approveQuotation.mutateAsync({ id: quotation.id }))}>
                          <BadgeCheck className="h-4 w-4" /> Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => exec('Quotation rejected', () => rejectQuotation.mutateAsync({ id: quotation.id }))}>
                          <X className="h-4 w-4" /> Reject
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="divide-y border-t">
                  {(quotation.lines ?? []).map((l: any) => (
                    <div key={l.id} className="flex items-center justify-between px-4 py-2 text-sm">
                      <div>
                        <p className="font-medium">{l.description}</p>
                        <p className="text-xs text-muted-foreground uppercase">{l.kind} · qty {l.quantity}</p>
                      </div>
                      <span>{fmt(l.amount)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-6 border-t px-4 py-3 text-sm">
                  <span>Labour <b>{fmt(quotation.labourTotal)}</b></span>
                  <span>Parts <b>{fmt(quotation.partsTotal)}</b></span>
                  <span>Tax <b>{fmt(quotation.taxTotal)}</b></span>
                  <span className="font-semibold">Total <b>{fmt(quotation.totalAmount)}</b></span>
                </div>
              </>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">No quotation yet — build one below.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Create / revise quotation</CardTitle></CardHeader>
          <CardContent className="space-y-3 p-4">
            {quotationLines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <select
                  value={l.kind}
                  onChange={(e) => setLine(i, 'kind', e.target.value)}
                  className="col-span-2 rounded-md border bg-card px-2 py-2 text-sm"
                >
                  <option value="labour">Labour</option>
                  <option value="part">Part</option>
                </select>
                <input
                  className="col-span-5 rounded-md border bg-card px-3 py-2 text-sm"
                  placeholder={l.kind === 'labour' ? 'Description (or labour type)' : 'Description (or product name)'}
                  value={l.description}
                  onChange={(e) => setLine(i, 'description', e.target.value)}
                />
                <input
                  className="col-span-2 rounded-md border bg-card px-3 py-2 text-sm"
                  type="number"
                  placeholder="Qty"
                  value={l.quantity}
                  onChange={(e) => setLine(i, 'quantity', e.target.value)}
                />
                <input
                  className="col-span-3 rounded-md border bg-card px-3 py-2 text-sm"
                  type="number"
                  placeholder="Unit price"
                  value={l.unitPrice}
                  onChange={(e) => setLine(i, 'unitPrice', e.target.value)}
                />
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setQuotationLines((ls) => [...ls, { kind: 'labour', description: '', quantity: 1, unitPrice: '' }])}>
                + Line
              </Button>
              <Button size="sm" onClick={submitQuotation} disabled={!!running}>
                <FileText className="h-4 w-4" /> Create quotation
              </Button>
              {labourTypes?.items?.length > 0 && (
                <span className="self-center text-xs text-muted-foreground">
                  Labour types: {(labourTypes.items as any[]).map((t) => t.name).join(', ')}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Jobs ─────────────────────────────────────────────────── */}
      <TabsContent value="jobs" className="space-y-4">
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Work orders</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {jobs.length === 0 && <p className="p-6 text-sm text-muted-foreground">No jobs yet.</p>}
              {jobs.map((j: any) => (
                <div key={j.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{j.jobNumber} · {j.technician?.name ?? 'Unassigned'}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.status.replace(/_/g, ' ')}{j.priority ? ` · ${j.priority}` : ''}
                      {j.deadline ? ` · due ${date(j.deadline)}` : ''}
                      {j.actualHours != null ? ` · ${j.actualHours} h` : j.estimatedHours != null ? ` · est ${j.estimatedHours} h` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {j.status === 'pending' && (
                      <Button size="sm" variant="outline" onClick={() => exec('Job started', () => startJob.mutateAsync(j.id))}>Start</Button>
                    )}
                    {j.status === 'in_progress' && (
                      <Button size="sm" variant="outline" onClick={() => exec('Job to testing', () => testJob.mutateAsync(j.id))}>To testing</Button>
                    )}
                    {j.status === 'testing' && (
                      <Button size="sm" onClick={() => exec('Job completed', () => completeJob.mutateAsync({ id: j.id }))}>
                        <CheckCircle2 className="h-4 w-4" /> Complete
                      </Button>
                    )}
                    <Badge variant="outline">{j.status.replace(/_/g, ' ')}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Create job</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-4">
            <select value={jobForm.technicianId} onChange={(e) => setJob('technicianId', e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
              <option value="">— Technician —</option>
              {(technicians?.items ?? technicians ?? []).map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <select value={jobForm.priority} onChange={(e) => setJob('priority', e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
              <option value="low">Low</option><option value="medium">Medium</option>
              <option value="high">High</option><option value="urgent">Urgent</option>
            </select>
            <Input type="date" value={jobForm.deadline} onChange={(e) => setJob('deadline', e.target.value)} />
            <Input type="number" placeholder="Est. hours" value={jobForm.estimatedHours} onChange={(e) => setJob('estimatedHours', e.target.value)} />
            <Input className="sm:col-span-4" placeholder="Instructions" value={jobForm.instructions} onChange={(e) => setJob('instructions', e.target.value)} />
            <div className="sm:col-span-4">
              <Button size="sm" onClick={submitJob} disabled={!!running}>
                <ClipboardList className="h-4 w-4" /> Create job
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Parts ────────────────────────────────────────────────── */}
      <TabsContent value="parts" className="space-y-4">
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Parts reserved / issued</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {parts.length === 0 && <p className="p-6 text-sm text-muted-foreground">No parts yet.</p>}
              {parts.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{p.product?.name ?? p.productId.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">Qty {p.quantity} · {fmt(p.totalCost)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.status === 'reserved' && (
                      <Button size="sm" variant="outline" onClick={() => exec('Part issued', () => issuePart.mutateAsync({ id: p.id }))}>
                        <Package className="h-4 w-4" /> Issue
                      </Button>
                    )}
                    <Badge variant="outline">{p.status}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => exec('Part removed', () => deletePart.mutateAsync(p.id))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Reserve part</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-4">
            <Input className="sm:col-span-2" placeholder="Product ID" value={partForm.productId} onChange={(e) => setPart('productId', e.target.value)} />
            <Input type="number" placeholder="Qty" value={partForm.quantity} onChange={(e) => setPart('quantity', e.target.value)} />
            <Input type="number" placeholder="Unit cost (blank = product cost)" value={partForm.unitCost} onChange={(e) => setPart('unitCost', e.target.value)} />
            <div className="sm:col-span-4">
              <Button size="sm" onClick={submitPart} disabled={!!running || !partForm.productId}>
                <Package className="h-4 w-4" /> Reserve part
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── Attachments ──────────────────────────────────────────── */}
      <TabsContent value="attachments" className="space-y-4">
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Photos & documents</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {attachments.length === 0 && <p className="p-6 text-sm text-muted-foreground">No attachments.</p>}
              {attachments.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium capitalize">{a.kind.replace(/_/g, ' ')}{a.caption ? ` · ${a.caption}` : ''}</p>
                    <p className="text-xs text-muted-foreground">{a.fileId ?? 'No file linked'}</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => exec('Attachment removed', () => removeAttachment.mutateAsync(a.id))}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Add attachment</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-4">
            <select value={attachForm.kind} onChange={(e) => setAttach('kind', e.target.value)} className="rounded-md border bg-card px-3 py-2 text-sm">
              <option value="before">Before repair</option>
              <option value="after">After repair</option>
              <option value="damage">Damage</option>
              <option value="receipt">Receipt</option>
              <option value="warranty">Warranty</option>
              <option value="signature">Signature</option>
              <option value="invoice">Invoice</option>
            </select>
            <Input placeholder="Caption" value={attachForm.caption} onChange={(e) => setAttach('caption', e.target.value)} />
            <Input placeholder="File ID (uploads module)" value={attachForm.fileId} onChange={(e) => setAttach('fileId', e.target.value)} />
            <Button size="sm" onClick={submitAttach} disabled={!!running}>
              <Paperclip className="h-4 w-4" /> Add
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ── History ──────────────────────────────────────────────── */}
      <TabsContent value="history">
        <Card>
          <CardHeader className="bg-muted/30 border-b rounded-t-lg"><CardTitle className="text-sm">Status history</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {history.length === 0 && <p className="p-6 text-sm text-muted-foreground">No history.</p>}
              {[...history].reverse().map((h: any) => (
                <div key={h.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <History className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm">
                        {h.fromStatus ? `${h.fromStatus.replace(/_/g, ' ')} → ` : ''}
                        <b>{h.toStatus.replace(/_/g, ' ')}</b>
                        {h.action ? ` · ${h.action}` : ''}
                      </p>
                      {h.note && <p className="text-xs text-muted-foreground">{h.note}</p>}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{date(h.changedAt)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
