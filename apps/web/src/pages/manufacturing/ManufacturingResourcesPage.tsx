import { useState } from 'react';
import { Plus, Factory } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuthStore } from '@/stores/auth.store';
import { notify } from '@/lib/notify';
import { useCreateMaster, useResources, useWorkCenters } from '@/features/manufacturing/api';

export function ManufacturingResourcesPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission(PERMISSIONS.resource.create);

  const { data: workCenters } = useWorkCenters();
  const { data: resources } = useResources();
  const createWc = useCreateMaster('work-centers');
  const createRes = useCreateMaster('resources');

  const [wcOpen, setWcOpen] = useState(false);
  const [wcCode, setWcCode] = useState('');
  const [wcName, setWcName] = useState('');

  const [resOpen, setResOpen] = useState(false);
  const [resName, setResName] = useState('');
  const [resKind, setResKind] = useState<'machine' | 'labour' | 'space'>('machine');
  const [resWc, setResWc] = useState('');
  const [resCost, setResCost] = useState('0');
  const [resCap, setResCap] = useState('');

  const run = async (fn: () => Promise<unknown>, ok: string, close: () => void) => {
    try { await fn(); notify.success(ok); close(); } catch (e: any) { notify.error('Failed', e?.response?.data?.message ?? e?.message); }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Factory className="h-6 w-6" /> Work Centres & Resources</h1>
        <p className="text-sm text-muted-foreground">Machines, people and spaces that execute production operations.</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Work Centres</CardTitle>
          {canManage && <Button size="sm" variant="outline" onClick={() => setWcOpen(true)}><Plus className="mr-1 h-3 w-3" /> Add</Button>}
        </CardHeader>
        <CardContent>
          {!workCenters?.length ? <p className="text-sm text-muted-foreground">None yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead className="text-right">Resources</TableHead></TableRow></TableHeader>
              <TableBody>
                {workCenters.map((w: any) => (
                  <TableRow key={w.id}><TableCell className="font-mono text-xs">{w.code}</TableCell><TableCell>{w.name}</TableCell><TableCell className="text-right">{w.resources?.length ?? 0}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Resources</CardTitle>
          {canManage && <Button size="sm" variant="outline" onClick={() => setResOpen(true)}><Plus className="mr-1 h-3 w-3" /> Add</Button>}
        </CardHeader>
        <CardContent>
          {!resources?.length ? <p className="text-sm text-muted-foreground">None yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Kind</TableHead><TableHead>Work centre</TableHead><TableHead className="text-right">Cost/hr</TableHead></TableRow></TableHeader>
              <TableBody>
                {resources.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell><Badge variant="outline">{r.kind}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.workCenter?.name ?? '—'}</TableCell>
                    <TableCell className="text-right">{Number(r.costPerHour).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={wcOpen} onOpenChange={setWcOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Work Centre</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Code</Label><Input value={wcCode} onChange={(e) => setWcCode(e.target.value)} placeholder="OVEN-A" /></div>
            <div className="space-y-1"><Label>Name</Label><Input value={wcName} onChange={(e) => setWcName(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWcOpen(false)}>Cancel</Button>
            <Button onClick={() => run(() => createWc.mutateAsync({ code: wcCode, name: wcName }), 'Work centre created.', () => { setWcOpen(false); setWcCode(''); setWcName(''); })}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resOpen} onOpenChange={setResOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Resource</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Name</Label><Input value={resName} onChange={(e) => setResName(e.target.value)} placeholder="Deck Oven / Head Baker" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Kind</Label>
                <Select value={resKind} onValueChange={(v) => setResKind(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="machine">Machine</SelectItem><SelectItem value="labour">Labour</SelectItem><SelectItem value="space">Space</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Work centre</Label>
                <Select value={resWc} onValueChange={setResWc}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{(workCenters ?? []).map((w: any) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Cost / hour</Label><Input type="number" value={resCost} onChange={(e) => setResCost(e.target.value)} /></div>
              <div className="space-y-1"><Label>Capacity (min/day)</Label><Input type="number" value={resCap} onChange={(e) => setResCap(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResOpen(false)}>Cancel</Button>
            <Button onClick={() => run(() => createRes.mutateAsync({ name: resName, kind: resKind, workCenterId: resWc || undefined, costPerHour: Number(resCost) || 0, capacityMinsPerDay: resCap ? Number(resCap) : undefined }), 'Resource created.', () => { setResOpen(false); setResName(''); setResCost('0'); setResCap(''); setResWc(''); })}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ManufacturingResourcesPage;
