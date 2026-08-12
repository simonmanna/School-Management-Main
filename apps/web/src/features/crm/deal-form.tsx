import { useEffect, useState } from 'react';
import { Loader2, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuthStore } from '@/stores/auth.store';
import { notify } from '@/lib/notify';
import { api } from '@/lib/api';
import { useCreateDeal, useCrmPartners, useCrmUsers, useUpdateDeal, DEAL_STAGES, type CrmDeal, type DealStage } from './api';

interface DealFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this deal instead of creating a new one. */
  deal?: CrmDeal | null;
  /** Pre-selected partner (used from the partner 360 tab). */
  presetPartnerId?: string;
  onSaved?: (dealId: string) => void;
}

const ORG_CURRENCY = 'IDR';

export function DealFormDialog({ open, onOpenChange, deal, presetPartnerId, onSaved }: DealFormDialogProps) {
  const org = useAuthStore((s) => s.organization);
  const currency = org?.currencyCode ?? ORG_CURRENCY;

  const [name, setName] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [amount, setAmount] = useState('');
  const [stage, setStage] = useState<DealStage>('lead');
  const [expectedClose, setExpectedClose] = useState('');
  const [notes, setNotes] = useState('');
  const [ownerId, setOwnerId] = useState('');
  // partner quick-create
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: partners, isLoading: partnersLoading } = useCrmPartners(search);
  const { data: users } = useCrmUsers();
  const createDeal = useCreateDeal();
  const updateDeal = useUpdateDeal();

  // Reset + hydrate when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(deal?.name ?? '');
    setPartnerId(deal?.partnerId ?? presetPartnerId ?? '');
    setAmount(deal ? String(deal.amount) : '');
    setStage(deal?.stage ?? 'lead');
    setExpectedClose(deal?.expectedClose ? deal.expectedClose.slice(0, 10) : '');
    setNotes(deal?.notes ?? '');
    setOwnerId(deal?.ownerId ?? '');
    setSearch('');
    setShowQuickCreate(false);
    setQuickName('');
  }, [open, deal, presetPartnerId]);

  const partnerRows = partners?.data ?? [];

  const submit = async () => {
    if (!name.trim()) return notify.error('Deal name is required');
    let pid = partnerId;
    if (!pid && quickName.trim()) {
      // inline quick-create: reuse the standard partners endpoint
      try {
        const res = await api.post('/partners', {
          name: quickName.trim(),
          isCustomer: true,
          isSupplier: false,
        });
        const created = res.data as { id: string };
        pid = created.id;
      } catch {
        return notify.error('Could not create the partner — check your partner permissions');
      }
    }
    if (!pid) return notify.error('Pick a partner or enter a new partner name');

    const payload = {
      name: name.trim(),
      partnerId: pid,
      amount: amount ? Number(amount) : 0,
      currencyCode: currency,
      stage,
      ...(expectedClose ? { expectedClose: `${expectedClose}T00:00:00.000Z` } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(ownerId ? { ownerId } : {}),
    };

    setSubmitting(true);
    try {
      if (deal) {
        await updateDeal.mutateAsync({ id: deal.id, data: payload });
        notify.success('Deal updated');
        onOpenChange(false);
      } else {
        const created = await createDeal.mutateAsync(payload);
        notify.success('Deal created');
        onOpenChange(false);
        onSaved?.(created.id);
      }
    } catch {
      /* interceptor already notified */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{deal ? `Edit deal — ${deal.name}` : 'New Deal'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="deal-name">Deal name *</Label>
            <Input id="deal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Corporate catering — Q3" autoFocus />
          </div>

          {/* Partner picker */}
          <div className="space-y-1.5">
            <Label>Customer / Partner *</Label>
            {!showQuickCreate ? (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search customers…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Button type="button" variant="outline" size="icon" title="Quick-create partner" onClick={() => setShowQuickCreate(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input placeholder="New partner name" value={quickName} onChange={(e) => setQuickName(e.target.value)} autoFocus />
                <Button type="button" variant="ghost" onClick={() => setShowQuickCreate(false)}>Cancel</Button>
              </div>
            )}

            {partnerId && !showQuickCreate ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1.5 w-full justify-start font-normal"
                onClick={() => setPartnerId('')}
              >
                {partnerRows.find((p) => p.id === partnerId)?.name ?? 'Selected partner'} ✕
              </Button>
            ) : null}

            {!partnerId && !showQuickCreate && (
              <div className="max-h-40 overflow-y-auto rounded-md border">
                {partnersLoading ? (
                  <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                  </div>
                ) : partnerRows.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No customers found{search ? ` for “${search}”` : ''}. Use the + button to create one inline.
                  </div>
                ) : (
                  partnerRows.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => setPartnerId(p.id)}
                    >
                      <span className="font-medium">{p.name}</span>
                      {p.code && <code className="text-xs text-muted-foreground">{p.code}</code>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="deal-amount">Expected value ({currency})</Label>
              <Input id="deal-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Stage</Label>
              <Select value={stage} onValueChange={(v) => setStage(v as DealStage)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEAL_STAGES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="deal-close">Expected close</Label>
              <Input id="deal-close" type="date" value={expectedClose} onChange={(e) => setExpectedClose(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Owner</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {users?.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deal-notes">Notes</Label>
            <Textarea id="deal-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Context, next steps…" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {deal ? 'Save changes' : 'Create deal'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
