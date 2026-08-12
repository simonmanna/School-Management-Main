import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { formatMoney } from '@/lib/format';

interface PO {
  id: string; orderNumber: string; status: string;
  totalAmount: number; totalPaid: number | null;
  currencyCode: string; paymentType: string; paymentStatus: string | null;
}

export function PurchaseOrderPayPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');

  const po = useQuery<PO>({
    queryKey: ['purchase-order', id],
    queryFn: async () => (await api.get<PO>(`/procurement/purchase-orders/${id}`)).data,
    enabled: !!id,
  });

  const payMut = useMutation({
    mutationFn: async () =>
      (await api.post(`/procurement/purchase-orders/${id}/pay`, {
        amount: amount ? Number(amount) : undefined,
        reference: reference || undefined,
      })).data,
    onSuccess: () => {
      notify.success('Payment recorded');
      qc.invalidateQueries({ queryKey: ['purchase-order', id] });
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      navigate(`/procurement/purchase-orders/${id}`);
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });

  if (po.isLoading) return <Skeleton className="h-96 w-full" />;
  if (po.error || !po.data) return <Card><CardContent className="p-8 text-center text-destructive">Not found</CardContent></Card>;

  const data = po.data;
  if (data.paymentType !== 'credit') {
    return (
      <Card><CardContent className="p-8 text-center">
        This is a cash purchase — payment is auto-settled on receive. No manual payment needed.
        <div className="mt-4"><Button onClick={() => navigate(-1)}>Go back</Button></div>
      </CardContent></Card>
    );
  }

  const totalPaid = Number(data.totalPaid ?? 0);
  const totalAmount = Number(data.totalAmount);
  const remaining = totalAmount - totalPaid;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Register Payment</h1>
          <p className="text-sm text-muted-foreground">{data.orderNumber}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-bold">{formatMoney(totalAmount, data.currencyCode)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Already Paid</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-bold text-emerald-600">{formatMoney(totalPaid, data.currencyCode)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Remaining</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-bold text-amber-600">{formatMoney(remaining, data.currencyCode)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Payment details</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-sm font-medium">
              Amount <span className="text-muted-foreground">(default: full remaining)</span>
            </label>
            <Input
              type="number"
              min={0.01}
              max={remaining}
              step="0.01"
              className="mt-1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`${remaining.toFixed(2)}`}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Reference</label>
            <Input
              className="mt-1"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional (e.g. receipt #)"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
        <Button
          onClick={() => payMut.mutate()}
          disabled={payMut.isPending}
        >
          <Save className="mr-2 h-4 w-4" />
          {payMut.isPending ? 'Recording…' : `Pay ${amount ? formatMoney(Number(amount)) : formatMoney(remaining)}`}
        </Button>
      </div>
    </div>
  );
}
