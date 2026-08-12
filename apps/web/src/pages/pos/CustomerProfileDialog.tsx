import { useAuthStore } from '@/stores/auth.store';
const orgCur = () => useAuthStore.getState().organization?.currencyCode ?? 'IDR';
/**
 * POS P7 — Customer profile dialog (loyalty + store credit + tab).
 *
 * Shows the customer's points balance, store credit, and open tab — and
 * lets the cashier redeem points, issue/redeem store credit, or
 * open/charge/settle a tab. Triggered from the customer's name pill in
 * the OrderPanel.
 */
import React, { useState } from 'react';
import { Star, BookOpen, Plus, X, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  partnerId: string | null;
  partnerName?: string;
  onClose: () => void;
}

const fmt = (n: number | string) => `${orgCur()} ${Number(n || 0).toLocaleString()}`;

interface BalanceResp { points: number; expiringSoon: number; programId: string | null; }
interface CreditResp { balance: number; expiresAt: string | null; }
interface TabResp { id: string; balance: number; creditLimit: number; isOpen: boolean; openedAt: string; }

export const CustomerProfileDialog: React.FC<Props> = ({ open, partnerId, partnerName, onClose }) => {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'loyalty' | 'credit' | 'tab'>('overview');
  const [redeemPoints, setRedeemPoints] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [tabPayAmount, setTabPayAmount] = useState('');

  const { data: balance, isLoading: balLoading } = useQuery({
    queryKey: ['pos-loyalty-balance', partnerId],
    queryFn: async () => (await api.get<BalanceResp>(`/pos/loyalty/balance/${partnerId}`)).data,
    enabled: !!partnerId,
    refetchInterval: 30_000,
  });
  const { data: credit } = useQuery({
    queryKey: ['pos-credit', partnerId],
    queryFn: async () => (await api.get<CreditResp>(`/pos/loyalty/credit/${partnerId}`)).data,
    enabled: !!partnerId,
  });
  const { data: tabRow } = useQuery({
    queryKey: ['pos-tab', partnerId],
    queryFn: async () => (await api.get<TabResp | null>(`/pos/loyalty/tab/${partnerId}`)).data,
    enabled: !!partnerId,
  });

  const ensureProgram = useMutation({
    mutationFn: async () => (await api.post('/pos/loyalty/program/ensure')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-loyalty-balance', partnerId] }),
  });
  const redeem = useMutation({
    mutationFn: async (body: { points: number }) => (await api.post('/pos/loyalty/redeem', { partnerId, ...body })).data,
    onSuccess: (r: any) => {
      toast.success(`Redeemed ${r.redeemed} points → ${fmt(r.ugxValue)} off`);
      qc.invalidateQueries({ queryKey: ['pos-loyalty-balance', partnerId] });
      setRedeemPoints('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Redemption failed'),
  });
  const issueCredit = useMutation({
    mutationFn: async (body: { amount: number; source: string }) => (await api.post('/pos/loyalty/credit/issue', { partnerId, ...body })).data,
    onSuccess: (r: any) => {
      toast.success(`Issued ${fmt(body_credit_amount)} credit. New balance: ${fmt(r.balance)}`);
      qc.invalidateQueries({ queryKey: ['pos-credit', partnerId] });
      setCreditAmount('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Issuance failed'),
  });
  const openTab = useMutation({
    mutationFn: async () => (await api.post('/pos/loyalty/tab/open', { partnerId })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pos-tab', partnerId] }),
  });
  const settleTab = useMutation({
    mutationFn: async (body: { amount: number }) => (await api.post('/pos/loyalty/tab/settle', { partnerId, ...body })).data,
    onSuccess: (r: any, vars: any) => {
      toast.success(`Tab payment of ${fmt(vars.amount)} received. New balance: ${fmt(r.balance)}`);
      qc.invalidateQueries({ queryKey: ['pos-tab', partnerId] });
      setTabPayAmount('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Payment failed'),
  });

  if (!partnerId) return null;
  const body_credit_amount = Number(creditAmount);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" />
            {partnerName ?? 'Customer'}
          </DialogTitle>
          <DialogDescription>Loyalty, store credit, and open tab.</DialogDescription>
        </DialogHeader>

        <div className="pos-reports-tabs">
          <button className={'pos-reports-tab' + (tab === 'overview' ? ' active' : '')} onClick={() => setTab('overview')}>Overview</button>
          <button className={'pos-reports-tab' + (tab === 'loyalty' ? ' active' : '')} onClick={() => setTab('loyalty')}>Loyalty</button>
          <button className={'pos-reports-tab' + (tab === 'credit' ? ' active' : '')} onClick={() => setTab('credit')}>Store Credit</button>
          <button className={'pos-reports-tab' + (tab === 'tab' ? ' active' : '')} onClick={() => setTab('tab')}>Tab</button>
        </div>

        {tab === 'overview' ? (
          <div className="pos-report-grid">
            <div className="pos-report-card">
              <h3>Loyalty points</h3>
              <div className="big text-amber-600">{balLoading ? '…' : (balance?.points ?? 0)}</div>
              {balance?.expiringSoon ? <p className="text-xs text-slate-500 mt-1">{balance.expiringSoon} expiring soon</p> : null}
            </div>
            <div className="pos-report-card">
              <h3>Store credit</h3>
              <div className="big text-emerald-600">{fmt(credit?.balance ?? 0)}</div>
            </div>
            <div className="pos-report-card">
              <h3>Open tab</h3>
              <div className={'big ' + (Number(tabRow?.balance ?? 0) > 0 ? 'text-rose-600' : 'text-slate-500')}>
                {tabRow ? fmt(tabRow.balance) : '—'}
              </div>
              {tabRow?.creditLimit ? <p className="text-xs text-slate-500 mt-1">limit {fmt(tabRow.creditLimit)}</p> : null}
            </div>
          </div>
        ) : null}

        {tab === 'loyalty' ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-center justify-between">
              <span className="font-bold text-amber-900">Current balance</span>
              <span className="text-2xl font-extrabold text-amber-900">{balance?.points ?? 0} pts</span>
            </div>
            {!balance?.programId ? (
              <Button onClick={() => ensureProgram.mutate()} className="w-full" disabled={ensureProgram.isPending}>
                <Plus className="h-4 w-4 mr-1" /> Activate loyalty program
              </Button>
            ) : null}
            <div>
              <Label>Redeem points (1 point = {orgCur()} {balance?.programId ? '100' : '—'})</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={redeemPoints}
                  onChange={(e) => setRedeemPoints(e.target.value)}
                  placeholder="e.g. 50"
                />
                <Button
                  onClick={() => redeem.mutate({ points: Number(redeemPoints) })}
                  disabled={redeem.isPending || !redeemPoints}
                  style={{ background: '#f59e0b' }}
                >
                  <Check className="h-4 w-4 mr-1" /> Redeem
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'credit' ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 flex items-center justify-between">
              <span className="font-bold text-emerald-900">Available credit</span>
              <span className="text-2xl font-extrabold text-emerald-900">{fmt(credit?.balance ?? 0)}</span>
            </div>
            <div>
              <Label>Issue credit (gift card / promo / refund-to-credit)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  placeholder="e.g. 10000"
                />
                <Button
                  onClick={() => issueCredit.mutate({ amount: body_credit_amount, source: 'gift_card' })}
                  disabled={issueCredit.isPending || !body_credit_amount}
                  style={{ background: '#16a34a' }}
                >
                  <Plus className="h-4 w-4 mr-1" /> Issue
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'tab' ? (
          <div className="space-y-3">
            {tabRow ? (
              <>
                <div className={'rounded-lg p-3 flex items-center justify-between ' + (Number(tabRow.balance) > 0 ? 'bg-rose-50 border border-rose-200' : 'bg-slate-50 border border-slate-200')}>
                  <span className="font-bold">Tab balance owed</span>
                  <span className={'text-2xl font-extrabold ' + (Number(tabRow.balance) > 0 ? 'text-rose-700' : 'text-slate-700')}>
                    {fmt(tabRow.balance)}
                  </span>
                </div>
                <div>
                  <Label>Record a payment against the tab</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={tabPayAmount}
                      onChange={(e) => setTabPayAmount(e.target.value)}
                      placeholder="e.g. 50000"
                    />
                    <Button
                      onClick={() => settleTab.mutate({ amount: Number(tabPayAmount) })}
                      disabled={settleTab.isPending || !tabPayAmount}
                      style={{ background: '#0f172a' }}
                    >
                      <Check className="h-4 w-4 mr-1" /> Settle
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-center">
                <BookOpen className="h-8 w-8 mx-auto mb-2 text-slate-400" />
                <p className="text-sm text-slate-600 mb-3">No open tab for this customer.</p>
                <Button onClick={() => openTab.mutate()} disabled={openTab.isPending} className="w-full">
                  <Plus className="h-4 w-4 mr-1" /> Open new tab
                </Button>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}><X className="h-4 w-4 mr-1" /> Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};