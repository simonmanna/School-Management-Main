import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Save, Receipt, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

interface ReceiptSettings {
  businessName: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  taxId: string;
  footerMessage: string;
}

export function ReceiptSettingsPage() {
  const [s, setS] = useState<ReceiptSettings>({
    businessName: '', addressLine1: '', addressLine2: '',
    phone: '', taxId: '', footerMessage: 'Thank you!',
  });

  const q = useQuery({
    queryKey: ['receipt-settings'] as const,
    queryFn: async (): Promise<ReceiptSettings> => {
      const [headerRes, footerRes] = await Promise.all([
        api.get('/settings/receipt.header').catch(() => null),
        api.get('/settings/receipt.footer').catch(() => null),
      ]);
      const header = ((headerRes as any)?.data?.value ?? {}) as Record<string, string>;
      const footer = ((footerRes as any)?.data?.value ?? {}) as Record<string, string>;
      return {
        businessName: header.businessName ?? '',
        addressLine1: header.addressLine1 ?? '',
        addressLine2: header.addressLine2 ?? '',
        phone: header.phone ?? '',
        taxId: header.taxId ?? '',
        footerMessage: footer.message ?? 'Thank you!',
      };
    },
  });

  useEffect(() => {
    if (q.data) setS(q.data);
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => (await api.patch('/pos/settings/receipt', s)).data,
    onSuccess: () => notify.success('Receipt settings saved'),
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Save failed'),
  });

  const update = (field: keyof ReceiptSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setS(prev => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Receipt className="h-6 w-6" /> Receipt Settings
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Receipt Header</CardTitle>
          <CardDescription>Printed on every customer receipt and bill.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {q.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div>
                <Label htmlFor="rs-biz">Business name</Label>
                <Input id="rs-biz" value={s.businessName} onChange={update('businessName')} placeholder="My Cafe" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="rs-addr1">Address line 1</Label>
                <Input id="rs-addr1" value={s.addressLine1} onChange={update('addressLine1')} placeholder="123 Main Street" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="rs-addr2">Address line 2</Label>
                <Input id="rs-addr2" value={s.addressLine2} onChange={update('addressLine2')} placeholder="Kampala, Uganda" className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="rs-phone">Phone</Label>
                  <Input id="rs-phone" value={s.phone} onChange={update('phone')} placeholder="+256 700 000 000" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="rs-tax">Tax ID (TIN)</Label>
                  <Input id="rs-tax" value={s.taxId} onChange={update('taxId')} placeholder="TIN-0000000000" className="mt-1" />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Receipt Footer</CardTitle>
          <CardDescription>Closing message on every customer receipt.</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div>
              <Label htmlFor="rs-footer">Footer message</Label>
              <Input id="rs-footer" value={s.footerMessage} onChange={update('footerMessage')} placeholder="Thank you!" className="mt-1" />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending || q.isLoading}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save receipt settings
        </Button>
      </div>
    </div>
  );
}
