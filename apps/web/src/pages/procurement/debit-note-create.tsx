import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

interface Partner { id: string; name: string; code: string }
interface Product { id: string; name: string; code: string; salesPrice?: number; costPrice?: number; taxId?: string }
interface Location { id: string; name: string; code: string; type?: string }

interface Line { productId?: string; description: string; quantity: number; unitPrice: number; taxId?: string }

export function DebitNoteCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [direction, setDirection] = useState<'outbound' | 'inbound'>('outbound');
  const [partnerId, setPartnerId] = useState('');
  const [reason, setReason] = useState('correction');
  const [notes, setNotes] = useState('');
  const [locationId, setLocationId] = useState('');
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: 1, unitPrice: 0 }]);

  // A return-to-vendor (inbound + returned goods) ships stock back, so it needs
  // to know which warehouse the goods leave from.
  const isRtv = direction === 'inbound' && reason === 'returned_goods';

  const partners = useQuery<Partner[]>({
    queryKey: ['partners-all'],
    queryFn: async () => (await api.get<Partner[]>('/partners?pageSize=200')).data,
  });
  const products = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => (await api.get<Product[]>('/products?pageSize=200')).data,
  });
  const locations = useQuery<Location[]>({
    queryKey: ['inventory-locations'],
    queryFn: async () => (await api.get<{ data: Location[] }>('/inventory/locations')).data.data ?? [],
  });

  const create = useMutation({
    mutationFn: async () =>
      (await api.post('/procurement/debit-notes', {
        direction,
        partnerId,
        reason,
        notes,
        ...(isRtv && locationId ? { locationId } : {}),
        lines: lines.filter((l) => l.description && l.quantity > 0),
      })).data,
    onSuccess: (data: any) => {
      notify.success(`Debit note ${data.noteNumber} created`);
      qc.invalidateQueries({ queryKey: ['debit-notes'] });
      navigate('/procurement/debit-notes');
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);

  const addLine = () => setLines([...lines, { description: '', quantity: 1, unitPrice: 0 }]);
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));
  const pickProduct = (idx: number, productId: string) => {
    const product = products.data?.find((p) => p.id === productId);
    if (!product) return;
    const next = [...lines];
    next[idx] = {
      productId,
      description: product.name,
      quantity: next[idx].quantity || 1,
      unitPrice: Number(product.salesPrice ?? product.costPrice ?? 0),
      taxId: product.taxId,
    };
    setLines(next);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New Debit Note</h1>

      <Card>
        <CardHeader>
          <CardTitle>Direction & partner</CardTitle>
          <CardDescription>
            Outbound = we send to a customer (increases their AR). Inbound = supplier sends us one (increases our AP).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Direction</label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as any)}
              className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
            >
              <option value="outbound">Outbound (to customer)</option>
              <option value="inbound">Inbound (from supplier)</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Partner</label>
            <select
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
            >
              <option value="">Select partner…</option>
              {partners.data?.map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
            >
              <option value="price_adjustment">Price adjustment</option>
              <option value="returned_goods">Returned goods</option>
              <option value="overcharge">Overcharge</option>
              <option value="correction">Correction</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Notes</label>
            <Input className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {isRtv && (
            <div>
              <label className="text-sm font-medium">Return from warehouse</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
              >
                <option value="">Default warehouse</option>
                {locations.data?.filter((l) => l.type === 'warehouse').map((l) => (
                  <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Returned goods leave this warehouse and their value is reversed out of stock when the note is posted.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Lines</CardTitle>
            <Button size="sm" variant="outline" onClick={addLine}><Plus className="mr-2 h-3 w-3" />Add line</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {lines.map((ln, idx) => (
              <div key={idx} className="grid gap-2 md:grid-cols-12 items-center">
                <div className="md:col-span-4">
                  <select
                    className="w-full rounded border bg-background px-2 py-1 text-sm"
                    onChange={(e) => pickProduct(idx, e.target.value)}
                    defaultValue=""
                  >
                    <option value="">Pick product…</option>
                    {products.data?.map((p) => (
                      <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-4">
                  <Input
                    placeholder="Description"
                    value={ln.description}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...next[idx], description: e.target.value };
                      setLines(next);
                    }}
                  />
                </div>
                <div className="md:col-span-1">
                  <Input
                    type="number" step="0.01" min="0"
                    value={ln.quantity}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                      setLines(next);
                    }}
                  />
                </div>
                <div className="md:col-span-2">
                  <Input
                    type="number" step="0.01" min="0"
                    value={ln.unitPrice}
                    onChange={(e) => {
                      const next = [...lines];
                      next[idx] = { ...next[idx], unitPrice: Number(e.target.value) };
                      setLines(next);
                    }}
                  />
                </div>
                <div className="md:col-span-1 text-right text-sm tabular-nums">
                  {(ln.quantity * ln.unitPrice).toFixed(2)}
                </div>
                <Button size="icon" variant="ghost" onClick={() => removeLine(idx)} aria-label="Remove">
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t pt-3">
            <span className="text-sm font-medium">Total</span>
            <span className="text-lg font-bold tabular-nums">{total.toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
        <Button onClick={() => create.mutate()} disabled={!partnerId || lines.length === 0 || create.isPending}>
          <Save className="mr-2 h-4 w-4" />Save draft
        </Button>
      </div>
    </div>
  );
}
