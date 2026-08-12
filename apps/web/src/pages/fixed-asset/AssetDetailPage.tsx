import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ArrowLeft, Plus } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthStore } from '@/stores/auth.store';
import { notify } from '@/lib/notify';
import { formatCurrency } from '@/lib/utils';
import { useAsset, useAllAssetCategories, useAssetAssignments, useCreateAssignment, useAssetTransfers, useCreateTransfer, useAssetMaintenance, useCreateMaintenance, useAssetWarranties, useCreateWarranty, useAssetDisposal, useCreateDisposal, useAssetAcquisition, useUpsertAcquisition, useAssetDepreciation } from '@/features/fixed-asset/api';
import type { Asset } from '@/features/fixed-asset/types';

const statusColor: Record<string, string> = { active: 'bg-green-100 text-green-800', under_maintenance: 'bg-yellow-100 text-yellow-800', disposed: 'bg-red-100 text-red-800', lost_stolen: 'bg-red-100 text-red-800', in_repair: 'bg-orange-100 text-orange-800', reserved: 'bg-blue-100 text-blue-800' };

export function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: asset, isLoading } = useAsset(id!);
  const { data: categories } = useAllAssetCategories();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission(PERMISSIONS.fixedAsset.update);
  const canDispose = hasPermission(PERMISSIONS.fixedAsset.dispose);
  const [tab, setTab] = useState('overview');

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  if (!asset) return <div className="p-8 text-center text-muted-foreground">Asset not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/fixed-assets')}><ArrowLeft className="h-5 w-5" /></Button>
        <div>
          <h1 className="text-2xl font-bold">{asset.name}</h1>
          <p className="text-sm text-muted-foreground">{asset.assetCode} {asset.serialNumber && `· ${asset.serialNumber}`}</p>
        </div>
        <Badge className={statusColor[asset.status] ?? ''}>{asset.status.replace(/_/g, ' ')}</Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="acquisition">Acquisition</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="transfers">Transfers</TabsTrigger>
          <TabsTrigger value="depreciation">Depreciation</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="warranty">Warranty</TabsTrigger>
          <TabsTrigger value="disposal">Disposal</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <OverviewTab asset={asset} categories={categories ?? []} />
        </TabsContent>
        <TabsContent value="acquisition"><AcquisitionTab assetId={asset.id} /></TabsContent>
        <TabsContent value="assignments"><AssignmentsTab assetId={asset.id} /></TabsContent>
        <TabsContent value="transfers"><TransfersTab assetId={asset.id} canCreate={canEdit} /></TabsContent>
        <TabsContent value="depreciation"><DepreciationTab assetId={asset.id} /></TabsContent>
        <TabsContent value="maintenance"><MaintenanceTab assetId={asset.id} canCreate={canEdit} /></TabsContent>
        <TabsContent value="warranty"><WarrantyTab assetId={asset.id} canCreate={canEdit} /></TabsContent>
        <TabsContent value="disposal"><DisposalTab assetId={asset.id} assetName={asset.name} canDispose={canDispose} /></TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab({ asset, categories }: { asset: Asset; categories: any[] }) {
  const catName = categories.find((c: any) => c.id === asset.categoryId)?.name ?? asset.category?.name ?? '-';
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card><CardHeader><CardTitle className="text-sm font-medium">Purchase Cost</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatCurrency(asset.purchaseCost ?? '0')}</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm font-medium">Current Value</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatCurrency(asset.currentValue ?? '0')}</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm font-medium">Salvage Value</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatCurrency(asset.salvageValue ?? '0')}</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm font-medium">Useful Life</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{asset.usefulLife ?? 60} months</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm font-medium">Category</CardTitle></CardHeader><CardContent><p className="text-lg">{catName}</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-sm font-medium">Location</CardTitle></CardHeader><CardContent><p className="text-lg">{asset.location ?? '-'}</p></CardContent></Card>
      <div className="md:col-span-3">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {asset.description && <><dt className="text-muted-foreground">Description</dt><dd>{asset.description}</dd></>}
              {asset.brand && <><dt className="text-muted-foreground">Brand</dt><dd>{asset.brand}</dd></>}
              {asset.model && <><dt className="text-muted-foreground">Model</dt><dd>{asset.model}</dd></>}
              {asset.manufacturer && <><dt className="text-muted-foreground">Manufacturer</dt><dd>{asset.manufacturer}</dd></>}
              {asset.serialNumber && <><dt className="text-muted-foreground">Serial #</dt><dd>{asset.serialNumber}</dd></>}
              {asset.barcode && <><dt className="text-muted-foreground">Barcode</dt><dd>{asset.barcode}</dd></>}
              {asset.department && <><dt className="text-muted-foreground">Department</dt><dd>{asset.department}</dd></>}
              {asset.purchaseDate && <><dt className="text-muted-foreground">Purchase Date</dt><dd>{new Date(asset.purchaseDate).toLocaleDateString()}</dd></>}
              {asset.supplierId && <><dt className="text-muted-foreground">Supplier</dt><dd>{asset.supplierId}</dd></>}
              {asset.invoiceNumber && <><dt className="text-muted-foreground">Invoice #</dt><dd>{asset.invoiceNumber}</dd></>}
              <dt className="text-muted-foreground">Acquisition Method</dt><dd className="capitalize">{asset.acquisitionMethod?.replace(/_/g, ' ') ?? '-'}</dd>
              {asset.notes && <><dt className="text-muted-foreground">Notes</dt><dd>{asset.notes}</dd></>}
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AcquisitionTab({ assetId }: { assetId: string }) {
  const { data, isLoading } = useAssetAcquisition(assetId);
  const upsert = useUpsertAcquisition();
  const [open, setOpen] = useState(false);
  const form = useForm({ defaultValues: { vendor: '', taxes: '', freight: '', installationCost: '', otherCosts: '', capitalizedCost: '', acquisitionDate: '', notes: '' } });
  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  const acq = data;
  return (
    <div>
      <div className="flex justify-between mb-4"><h3 className="text-lg font-semibold">Acquisition Details</h3><Button size="sm" onClick={() => { form.reset({ vendor: acq?.vendor ?? '', taxes: acq?.taxes ?? '', freight: acq?.freight ?? '', installationCost: acq?.installationCost ?? '', otherCosts: acq?.otherCosts ?? '', capitalizedCost: acq?.capitalizedCost ?? '', acquisitionDate: acq?.acquisitionDate?.split('T')[0] ?? '', notes: acq?.notes ?? '' }); setOpen(true); }}><Plus className="mr-2 h-4 w-4" />{acq ? 'Edit' : 'Add'}</Button></div>
      {acq ? (
        <Card><CardContent className="pt-6">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Vendor</dt><dd>{acq.vendor ?? '-'}</dd>
            <dt className="text-muted-foreground">Taxes</dt><dd>{acq.taxes ? formatCurrency(acq.taxes) : '-'}</dd>
            <dt className="text-muted-foreground">Freight</dt><dd>{acq.freight ? formatCurrency(acq.freight) : '-'}</dd>
            <dt className="text-muted-foreground">Installation Cost</dt><dd>{acq.installationCost ? formatCurrency(acq.installationCost) : '-'}</dd>
            <dt className="text-muted-foreground">Capitalized Cost</dt><dd className="font-bold">{acq.capitalizedCost ? formatCurrency(acq.capitalizedCost) : '-'}</dd>
            <dt className="text-muted-foreground">Date</dt><dd>{acq.acquisitionDate ? new Date(acq.acquisitionDate).toLocaleDateString() : '-'}</dd>
            {acq.notes && <><dt className="text-muted-foreground">Notes</dt><dd>{acq.notes}</dd></>}
          </dl>
        </CardContent></Card>
      ) : <p className="text-muted-foreground">No acquisition record.</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Acquisition Details</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(async (v) => {
            try { await upsert.mutateAsync({ assetId, data: { ...v, taxes: v.taxes ? Number(v.taxes) : undefined, freight: v.freight ? Number(v.freight) : undefined, installationCost: v.installationCost ? Number(v.installationCost) : undefined, otherCosts: v.otherCosts ? Number(v.otherCosts) : undefined, capitalizedCost: v.capitalizedCost ? Number(v.capitalizedCost) : undefined, acquisitionDate: v.acquisitionDate || undefined } }); notify.success('Saved'); setOpen(false); } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Error'); }
          })} className="space-y-3">
            <div className="grid grid-cols-2 gap-3"><div><Label>Vendor</Label><Input {...form.register('vendor')} /></div><div><Label>Date</Label><Input type="date" {...form.register('acquisitionDate')} /></div></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Taxes</Label><Input type="number" step="0.01" {...form.register('taxes')} /></div><div><Label>Freight</Label><Input type="number" step="0.01" {...form.register('freight')} /></div></div>
            <div className="grid grid-cols-2 gap-3"><div><Label>Installation Cost</Label><Input type="number" step="0.01" {...form.register('installationCost')} /></div><div><Label>Other Costs</Label><Input type="number" step="0.01" {...form.register('otherCosts')} /></div></div>
            <div><Label>Capitalized Cost</Label><Input type="number" step="0.01" {...form.register('capitalizedCost')} /></div>
            <div><Label>Notes</Label><Input {...form.register('notes')} /></div>
            <DialogFooter><Button type="submit">Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AssignmentsTab({ assetId }: { assetId: string }) {
  const { data, isLoading } = useAssetAssignments(assetId);
  const create = useCreateAssignment();
  const [open, setOpen] = useState(false);
  const form = useForm({ defaultValues: { assignedToId: '', assignedToType: '', assignedToName: '', assignedDate: new Date().toISOString().split('T')[0], notes: '' } });
  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  return (
    <div>
      <div className="flex justify-between mb-4"><h3 className="text-lg font-semibold">Assignments</h3><Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Assign</Button></div>
      {data?.length ? data.map((a: any) => (
        <Card key={a.id} className="mb-2"><CardContent className="pt-4 flex justify-between">
          <div><p className="font-medium">{a.assignedToName ?? a.assignedToId ?? 'Unknown'}</p><p className="text-sm text-muted-foreground">{a.assignedToType?.replace(/_/g, ' ') ?? ''} · {new Date(a.assignedDate).toLocaleDateString()}{a.returnedDate ? ` → ${new Date(a.returnedDate).toLocaleDateString()}` : ' (Active)'}</p></div>
          {a.conditionBefore && <Badge variant="outline">{a.conditionBefore}</Badge>}
        </CardContent></Card>
      )) : <p className="text-muted-foreground">No assignments.</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign Asset</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(async (v) => { try { await create.mutateAsync({ assetId, data: { ...v, assignedDate: v.assignedDate || undefined } }); notify.success('Assigned'); setOpen(false); form.reset(); } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Error'); } })} className="space-y-3">
            <div><Label>Assign To (ID)</Label><Input {...form.register('assignedToId')} /></div>
            <div><Label>Type</Label><Select value={form.watch('assignedToType')} onValueChange={(v) => form.setValue('assignedToType', v)}><SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger><SelectContent>{['employee', 'teacher', 'student', 'department', 'branch', 'room', 'vehicle', 'clinic', 'store'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Name</Label><Input {...form.register('assignedToName')} /></div>
            <div><Label>Date</Label><Input type="date" {...form.register('assignedDate')} /></div>
            <div><Label>Notes</Label><Input {...form.register('notes')} /></div>
            <DialogFooter><Button type="submit">Assign</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TransfersTab({ assetId, canCreate }: { assetId: string; canCreate: boolean }) {
  const { data, isLoading } = useAssetTransfers(assetId);
  const create = useCreateTransfer();
  const [open, setOpen] = useState(false);
  const form = useForm({ defaultValues: { toLocation: '', reason: '', notes: '' } });
  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  return (
    <div>
      <div className="flex justify-between mb-4"><h3 className="text-lg font-semibold">Transfers</h3>{canCreate && <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Transfer</Button>}</div>
      {data?.length ? data.map((t: any) => (
        <Card key={t.id} className="mb-2"><CardContent className="pt-4">
          <div className="flex justify-between"><p className="font-medium">{t.fromLocation ?? '?'} → {t.toLocation ?? '?'}</p><span className="text-sm text-muted-foreground">{new Date(t.transferDate).toLocaleDateString()}</span></div>
          {t.reason && <p className="text-sm text-muted-foreground">{t.reason}</p>}
        </CardContent></Card>
      )) : <p className="text-muted-foreground">No transfers.</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transfer Asset</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(async (v) => { try { await create.mutateAsync({ assetId, data: v }); notify.success('Transferred'); setOpen(false); form.reset(); } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Error'); } })} className="space-y-3">
            <div><Label>To Location</Label><Input {...form.register('toLocation')} /></div>
            <div><Label>Reason</Label><Input {...form.register('reason')} /></div>
            <div><Label>Notes</Label><Input {...form.register('notes')} /></div>
            <DialogFooter><Button type="submit">Transfer</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DepreciationTab({ assetId }: { assetId: string }) {
  const { data, isLoading } = useAssetDepreciation(assetId);
  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Depreciation Schedule</h3>
      {data?.length ? (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-4 text-sm font-medium text-muted-foreground px-2">
            <span>Period</span><span className="text-right">Amount</span><span className="text-right">Accumulated</span><span className="text-right">Book Value</span>
          </div>
          {data.map((d: any) => (
            <div key={d.id} className="grid grid-cols-4 gap-4 text-sm bg-card border rounded-lg px-3 py-2">
              <span>{d.period}{d.isPosted && <Badge className="ml-2 bg-green-100 text-green-800" variant="outline">Posted</Badge>}</span>
              <span className="text-right">{formatCurrency(d.depreciationAmount)}</span>
              <span className="text-right">{formatCurrency(d.accumulatedDepr)}</span>
              <span className="text-right font-medium">{formatCurrency(d.bookValue)}</span>
            </div>
          ))}
        </div>
      ) : <p className="text-muted-foreground">No depreciation entries. Run depreciation from the dashboard.</p>}
    </div>
  );
}

function MaintenanceTab({ assetId, canCreate }: { assetId: string; canCreate: boolean }) {
  const { data, isLoading } = useAssetMaintenance(assetId);
  const create = useCreateMaintenance();
  const [open, setOpen] = useState(false);
  const form = useForm({ defaultValues: { title: '', maintenanceType: 'preventive', scheduledDate: '', cost: '', notes: '' } });
  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  return (
    <div>
      <div className="flex justify-between mb-4"><h3 className="text-lg font-semibold">Maintenance</h3>{canCreate && <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Schedule</Button>}</div>
      {data?.length ? data.map((m: any) => (
        <Card key={m.id} className="mb-2"><CardContent className="pt-4 flex justify-between items-center">
          <div><p className="font-medium">{m.title}</p><p className="text-sm text-muted-foreground">{m.maintenanceType.replace(/_/g, ' ')} · {m.scheduledDate ? new Date(m.scheduledDate).toLocaleDateString() : ''}{m.cost ? ` · ${formatCurrency(m.cost)}` : ''}</p></div>
          <Badge>{m.status?.replace(/_/g, ' ')}</Badge>
        </CardContent></Card>
      )) : <p className="text-muted-foreground">No maintenance records.</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule Maintenance</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(async (v) => { try { await create.mutateAsync({ assetId, data: { ...v, cost: v.cost ? Number(v.cost) : undefined, scheduledDate: v.scheduledDate || undefined } }); notify.success('Scheduled'); setOpen(false); form.reset(); } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Error'); } })} className="space-y-3">
            <div><Label>Title *</Label><Input {...form.register('title')} /></div>
            <div><Label>Type</Label><Select value={form.watch('maintenanceType')} onValueChange={(v) => form.setValue('maintenanceType', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['preventive', 'corrective', 'emergency', 'scheduled', 'calibration'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Date</Label><Input type="date" {...form.register('scheduledDate')} /></div>
            <div><Label>Cost</Label><Input type="number" step="0.01" {...form.register('cost')} /></div>
            <div><Label>Notes</Label><Input {...form.register('notes')} /></div>
            <DialogFooter><Button type="submit">Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WarrantyTab({ assetId, canCreate }: { assetId: string; canCreate: boolean }) {
  const { data, isLoading } = useAssetWarranties(assetId);
  const create = useCreateWarranty();
  const [open, setOpen] = useState(false);
  const form = useForm({ defaultValues: { warrantyStart: '', warrantyEnd: '', vendor: '', coverage: '', notes: '' } });
  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  return (
    <div>
      <div className="flex justify-between mb-4"><h3 className="text-lg font-semibold">Warranties</h3>{canCreate && <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Add Warranty</Button>}</div>
      {data?.length ? data.map((w: any) => (
        <Card key={w.id} className="mb-2"><CardContent className="pt-4">
          <div className="flex justify-between"><p className="font-medium">{w.vendor ?? 'Warranty'}</p><span className="text-sm text-muted-foreground">{new Date(w.warrantyStart).toLocaleDateString()} - {new Date(w.warrantyEnd).toLocaleDateString()}</span></div>
          {w.coverage && <p className="text-sm text-muted-foreground">{w.coverage}</p>}
        </CardContent></Card>
      )) : <p className="text-muted-foreground">No warranties.</p>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Warranty</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(async (v) => { try { await create.mutateAsync({ assetId, data: v }); notify.success('Saved'); setOpen(false); form.reset(); } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Error'); } })} className="space-y-3">
            <div className="grid grid-cols-2 gap-3"><div><Label>Start *</Label><Input type="date" {...form.register('warrantyStart')} /></div><div><Label>End *</Label><Input type="date" {...form.register('warrantyEnd')} /></div></div>
            <div><Label>Vendor</Label><Input {...form.register('vendor')} /></div>
            <div><Label>Coverage</Label><Input {...form.register('coverage')} /></div>
            <div><Label>Notes</Label><Input {...form.register('notes')} /></div>
            <DialogFooter><Button type="submit">Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DisposalTab({ assetId, assetName, canDispose }: { assetId: string; assetName: string; canDispose: boolean }) {
  const { data, isLoading } = useAssetDisposal(assetId);
  const create = useCreateDisposal();
  const [open, setOpen] = useState(false);
  const form = useForm({ defaultValues: { disposalMethod: 'sold', disposalDate: new Date().toISOString().split('T')[0], disposalValue: '', reason: '', notes: '' } });
  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;
  if (data) return (
    <Card><CardContent className="pt-6">
      <p className="text-lg font-semibold text-red-600">Disposed ({data.disposalMethod?.replace(/_/g, ' ')})</p>
      <p className="text-sm text-muted-foreground">{new Date(data.disposalDate).toLocaleDateString()}{data.disposalValue ? ` · Value: ${formatCurrency(data.disposalValue)}` : ''}{data.gainLoss ? ` · Gain/Loss: ${formatCurrency(data.gainLoss)}` : ''}</p>
      {data.reason && <p className="text-sm mt-2">{data.reason}</p>}
    </CardContent></Card>
  );
  return (
    <div>
      <p className="text-muted-foreground mb-4">This asset is not disposed.</p>
      {canDispose && <Button variant="destructive" onClick={() => setOpen(true)}>Dispose Asset</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Dispose "{assetName}"</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(async (v) => { try { await create.mutateAsync({ assetId, data: { ...v, disposalValue: v.disposalValue ? Number(v.disposalValue) : undefined } }); notify.success('Disposed'); setOpen(false); } catch (e: any) { notify.error(e?.response?.data?.message ?? 'Error'); } })} className="space-y-3">
            <div><Label>Method</Label><Select value={form.watch('disposalMethod')} onValueChange={(v) => form.setValue('disposalMethod', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['sold', 'scrapped', 'donated', 'lost', 'stolen', 'destroyed'].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>Date</Label><Input type="date" {...form.register('disposalDate')} /></div>
            <div><Label>Disposal Value</Label><Input type="number" step="0.01" {...form.register('disposalValue')} /></div>
            <div><Label>Reason</Label><Input {...form.register('reason')} /></div>
            <div><Label>Notes</Label><Input {...form.register('notes')} /></div>
            <DialogFooter><Button type="submit" variant="destructive">Dispose</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
