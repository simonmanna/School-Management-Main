import { useMemo, useState } from 'react';
import { Plus, Trash2, CheckCircle2 } from 'lucide-react';
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
import { useActivateBom, useBoms, useCreateBom } from '@/features/manufacturing/api';
import { useProductOptions } from '@/features/manufacturing/options';
import type { Bom, BomStatus } from '@/features/manufacturing/types';

const STATUS_VARIANT: Record<BomStatus, 'default' | 'secondary' | 'outline'> = {
  draft: 'secondary',
  active: 'default',
  archived: 'outline',
};

interface DraftLine {
  componentProductId: string;
  quantity: string;
}

export function BomsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.bom.create);
  const canActivate = hasPermission(PERMISSIONS.bom.activate);

  const { data: boms, isLoading } = useBoms();
  const { data: products } = useProductOptions();
  const createBom = useCreateBom();
  const activateBom = useActivateBom();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [outputProductId, setOutputProductId] = useState('');
  const [outputQuantity, setOutputQuantity] = useState('1');
  const [expectedYieldPct, setExpectedYieldPct] = useState('100');
  const [lines, setLines] = useState<DraftLine[]>([{ componentProductId: '', quantity: '' }]);

  const productName = useMemo(() => {
    const m = new Map((products ?? []).map((p) => [p.id, `${p.code} · ${p.name}`]));
    return (id: string) => m.get(id) ?? id;
  }, [products]);

  const reset = () => {
    setName('');
    setOutputProductId('');
    setOutputQuantity('1');
    setExpectedYieldPct('100');
    setLines([{ componentProductId: '', quantity: '' }]);
  };

  const submit = async () => {
    const cleanLines = lines
      .filter((l) => l.componentProductId && Number(l.quantity) > 0)
      .map((l) => ({ componentProductId: l.componentProductId, quantity: Number(l.quantity) }));
    if (!name || !outputProductId || !(Number(outputQuantity) > 0) || cleanLines.length === 0) {
      notify.error('Name, output product, a positive batch size, and at least one ingredient are required.');
      return;
    }
    try {
      await createBom.mutateAsync({
        name,
        outputProductId,
        outputQuantity: Number(outputQuantity),
        expectedYieldPct: Number(expectedYieldPct),
        lines: cleanLines,
      });
      notify.success('BOM created as a draft. Activate it to use in production.');
      setOpen(false);
      reset();
    } catch (e: any) {
      notify.error('Could not create BOM', e?.response?.data?.message ?? e?.message);
    }
  };

  const activate = async (bom: Bom) => {
    try {
      await activateBom.mutateAsync(bom.id);
      notify.success(`BOM ${bom.code} activated.`);
    } catch (e: any) {
      notify.error('Could not activate BOM', e?.response?.data?.message ?? e?.message);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Bills of Materials</h1>
          <p className="text-sm text-muted-foreground">Recipes keyed on the finished product. Activate a draft to produce against it.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New BOM
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recipes</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !boms?.length ? (
            <p className="text-sm text-muted-foreground">No BOMs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Output</TableHead>
                  <TableHead className="text-right">Batch</TableHead>
                  <TableHead className="text-center">Ver</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boms.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.code}</TableCell>
                    <TableCell>{b.name}</TableCell>
                    <TableCell className="text-sm">{productName(b.outputProductId)}</TableCell>
                    <TableCell className="text-right">{Number(b.outputQuantity)}</TableCell>
                    <TableCell className="text-center">{b.version}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[b.status]}>{b.status}</Badge>
                      {b.isDefault && <Badge variant="outline" className="ml-1">default</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      {canActivate && b.status === 'draft' && (
                        <Button size="sm" variant="outline" onClick={() => activate(b)}>
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Activate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New BOM</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Chocolate Cake" />
              </div>
              <div className="space-y-1">
                <Label>Output product</Label>
                <Select value={outputProductId} onValueChange={setOutputProductId}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {(products ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.code} · {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Batch size (units made per run)</Label>
                <Input type="number" value={outputQuantity} onChange={(e) => setOutputQuantity(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Expected yield %</Label>
                <Input type="number" value={expectedYieldPct} onChange={(e) => setExpectedYieldPct(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Ingredients (per batch)</Label>
                <Button size="sm" variant="outline" onClick={() => setLines((l) => [...l, { componentProductId: '', quantity: '' }])}>
                  <Plus className="mr-1 h-3 w-3" /> Add
                </Button>
              </div>
              {lines.map((line, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={line.componentProductId} onValueChange={(v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, componentProductId: v } : l)))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Ingredient…" /></SelectTrigger>
                    <SelectContent>
                      {(products ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.code} · {p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    className="w-28"
                    placeholder="Qty"
                    value={line.quantity}
                    onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))}
                  />
                  <Button size="icon" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
            <Button onClick={submit} disabled={createBom.isPending}>Create draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default BomsPage;
