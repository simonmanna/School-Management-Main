import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Wallet, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useCashAccounts, useCashFlowDeposit, useCashFlowWithdraw,
  useTreasuryTransfer, useCreateCashAccount, useUpdateCashAccount,
} from '@/features/accounting/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type AccountType = 'cash' | 'bank' | 'mobile_money' | 'petty_cash';

const ACCOUNT_TYPES: AccountType[] = ['cash', 'bank', 'mobile_money', 'petty_cash'];

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: 'Cash',
  bank: 'Bank',
  mobile_money: 'Mobile Money',
  petty_cash: 'Petty Cash',
};

const ACCOUNT_TYPE_ICONS: Record<AccountType, string> = {
  cash: '💵',
  bank: '🏦',
  mobile_money: '📱',
  petty_cash: '🪙',
};

const ACCOUNT_TYPE_THEMES: Record<AccountType, { card: string; icon: string; text: string }> = {
  cash: { card: 'border-t-emerald-500', icon: 'bg-emerald-500', text: 'text-emerald-600' },
  bank: { card: 'border-t-blue-500', icon: 'bg-blue-500', text: 'text-blue-600' },
  mobile_money: { card: 'border-t-orange-500', icon: 'bg-orange-500', text: 'text-orange-600' },
  petty_cash: { card: 'border-t-purple-500', icon: 'bg-purple-500', text: 'text-purple-600' },
};

const defaultForm = {
  name: '',
  code: '',
  type: 'cash' as AccountType,
  currency: '',
  bankName: '',
  accountNumber: '',
  isDefault: false,
};

function CurrencyDisplay({ value }: { value: string }) {
  const num = Number(value);
  const abs = Math.abs(num);
  return (
    <span className={num < 0 ? 'text-red-600' : num > 0 ? 'text-green-600' : ''}>
      {num < 0 ? '-' : ''}{abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

export function CashAccountsPage() {
  const { data: accounts = [], isLoading } = useCashAccounts();
  const create = useCreateCashAccount();
  const update = useUpdateCashAccount();
  const deposit = useCashFlowDeposit();
  const withdraw = useCashFlowWithdraw();
  const transfer = useTreasuryTransfer();
  const navigate = useNavigate();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  // Cash flow modals
  const [cfModal, setCfModal] = useState<'deposit' | 'withdraw' | 'transfer' | null>(null);
  const [cfAcct, setCfAcct] = useState('');
  const [cfToAcct, setCfToAcct] = useState('');
  const [cfAmount, setCfAmount] = useState('');
  const [cfDesc, setCfDesc] = useState('');
  const [cfLoading, setCfLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const allAccounts = (accounts ?? []) as any[];

  const filtered = useMemo(() => {
    let list = allAccounts;
    if (typeFilter !== 'all') list = list.filter((a: any) => a.accountType === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a: any) =>
        a.name.toLowerCase().includes(q) ||
        a.code.toLowerCase().includes(q) ||
        (a.bankName || '').toLowerCase().includes(q) ||
        (a.accountNumber || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [allAccounts, search, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const grouped = ACCOUNT_TYPES.reduce<Record<string, any[]>>((acc, type) => {
    acc[type] = paged.filter((a: any) => a.accountType === type);
    return acc;
  }, {} as any);

  const openCreate = () => {
    setEditingId(null);
    setForm(defaultForm);
    setDialogOpen(true);
  };

  const openEdit = (acc: any) => {
    setEditingId(acc.id);
    setForm({
      name: acc.name,
      code: acc.code,
      type: acc.accountType,
      currency: acc.currencyId ?? '',
      bankName: acc.bankName ?? '',
      accountNumber: acc.accountNumber ?? '',
      isDefault: acc.isDefault,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error('Account name and code are required');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await update.mutateAsync({
          id: editingId,
          name: form.name,
          bankName: form.bankName || undefined,
          accountNumber: form.accountNumber || undefined,
          isDefault: form.isDefault,
        });
        toast.success('Account updated');
      } else {
        await create.mutateAsync({
          code: form.code,
          name: form.name,
          accountType: form.type,
          bankName: form.bankName || undefined,
          accountNumber: form.accountNumber || undefined,
          isDefault: form.isDefault,
        });
        toast.success('Account created');
      }
      setDialogOpen(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const doCashFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(cfAmount);
    if (!amount || amount <= 0) return;
    setCfLoading(true);
    try {
      if (cfModal === 'deposit') {
        await deposit.mutateAsync({ accountId: cfAcct, amount, description: cfDesc });
        toast.success('Deposit recorded');
      } else if (cfModal === 'withdraw') {
        await withdraw.mutateAsync({ accountId: cfAcct, amount, description: cfDesc });
        toast.success('Withdrawal recorded');
      } else if (cfModal === 'transfer') {
        await transfer.mutateAsync({
          fromAccountId: cfAcct, toAccountId: cfToAcct, amount,
          date: new Date().toISOString().split('T')[0], reference: cfDesc || undefined,
        });
        toast.success('Transfer completed');
      }
      setCfModal(null);
      setCfAcct(''); setCfToAcct(''); setCfAmount(''); setCfDesc('');
    } catch { toast.error('Transaction failed'); }
    finally { setCfLoading(false); }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="p-6 space-y-8 bg-slate-50 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 tracking-tight">FINANCIAL ACCOUNTS</h1>
          <p className="text-slate-500 text-sm font-medium">Accounts &amp; payment modes used on receipts and payments</p>
        </div>
        <Button onClick={openCreate} className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200">
          <Plus className="mr-2 h-4 w-4" /> Add Account
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name, code, bank or account number..."
            className="pl-9 bg-white border-slate-200"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(['all', ...ACCOUNT_TYPES] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTypeFilter(t); setPage(1); }}
              className={cn(
                'px-3 py-1.5 text-xs font-bold rounded-lg uppercase tracking-wider transition-colors',
                typeFilter === t
                  ? t === 'all' ? 'bg-slate-800 text-white' : `${ACCOUNT_TYPE_THEMES[t as AccountType]?.icon ?? 'bg-slate-800'} text-white`
                  : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
              )}
            >
              {t === 'all' ? `All (${allAccounts.length})` : `${ACCOUNT_TYPE_LABELS[t]} (${allAccounts.filter(a => a.accountType === t).length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {ACCOUNT_TYPES.map(type => {
          const typeAccounts = grouped[type];
          if (typeAccounts.length === 0) return null;
          const theme = ACCOUNT_TYPE_THEMES[type];

          return (
            <div key={type} className="space-y-2">
              <div className="flex items-center gap-2">
                <div className={cn('h-8 w-1 rounded-full', theme.icon)} />
                <h3 className="font-black text-slate-700 uppercase tracking-wider text-sm">
                  {ACCOUNT_TYPE_LABELS[type]}
                </h3>
                <Badge variant="outline" className="bg-white text-slate-500 border-slate-200">
                  {typeAccounts.length} Accounts
                </Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {typeAccounts.map((acc: any) => {
                  const t = acc.accountType as AccountType;
                  const theme2 = ACCOUNT_TYPE_THEMES[t] ?? ACCOUNT_TYPE_THEMES.cash;
                  return (
                    <div
                      key={acc.id}
                      className={cn(
                        'relative bg-white rounded-lg shadow-sm border-t-4 transition-all hover:shadow-md cursor-pointer',
                        theme2.card,
                      )}
                      onClick={() => navigate(`/accounts/cash-accounts/${acc.id}`)}
                    >
                      <div className="p-5">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-3">
                            <div className={cn('p-2 rounded-lg text-white shadow-inner text-lg', theme2.icon)}>
                              {ACCOUNT_TYPE_ICONS[t]}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-slate-800 leading-none">{acc.name}</h4>
                                {acc.isDefault && (
                                  <span className="bg-slate-100 text-slate-500 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase">Main</span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-400 font-mono mt-1 uppercase tracking-tighter">
                                {acc.bankName || ACCOUNT_TYPE_LABELS[t]} {acc.currencyId ? `· ${acc.currencyId}` : ''}
                              </p>
                              {acc.cashRegister && (
                                <p className="text-[10px] text-slate-400 mt-0.5">
                                  Register: {acc.cashRegister.name}
                                </p>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); openEdit(acc); }}
                            className="h-8 w-8 text-slate-400 hover:bg-slate-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                          Code: {acc.code}
                        </span>
                        <span className={cn('font-bold text-sm', theme2.text)}>
                          <CurrencyDisplay value={acc.balance} />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="bg-white rounded-lg border border-slate-100 p-12 text-center text-slate-400">
            {search || typeFilter !== 'all' ? 'No accounts match your search.' : 'No accounts yet. Click "Add Account" to create one.'}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-lg border border-slate-100 px-4 py-3">
          <span className="text-xs text-slate-500 font-medium">{filtered.length} account{filtered.length !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={cn(
                  'h-8 w-8 rounded-lg text-xs font-bold transition-colors',
                  p === page ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'
                )}
              >
                {p}
              </button>
            ))}
            <Button variant="ghost" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="h-8 w-8">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md p-0 overflow-hidden border-none rounded-2xl">
          <div className="bg-indigo-600 p-6 text-white">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <div className="bg-white/20 p-2 rounded-lg"><Wallet className="h-5 w-5 text-white" /></div>
                {editingId ? 'Edit Account' : 'New Account'}
              </DialogTitle>
              <p className="text-indigo-100 text-xs mt-1">Accounts and modes shown on receipts &amp; payments.</p>
            </DialogHeader>
          </div>

          <div className="p-6 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-500 uppercase">Account Name</Label>
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                placeholder="e.g. Main Operations Bank"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-500 uppercase">Code</Label>
                <Input
                  value={form.code}
                  onChange={e => setForm({ ...form, code: e.target.value })}
                  className="bg-slate-50 border-slate-200 focus:bg-white transition-colors font-mono"
                  placeholder="e.g. BANK-01"
                  disabled={!!editingId}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-500 uppercase">Type</Label>
                <Select
                  value={form.type}
                  onValueChange={(v: string) => setForm({ ...form, type: v as AccountType })}
                  disabled={!!editingId}
                >
                  <SelectTrigger className="bg-slate-50 border-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-500 uppercase">Bank / Provider (optional)</Label>
              <Input
                value={form.bankName}
                onChange={e => setForm({ ...form, bankName: e.target.value })}
                className="bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                placeholder="e.g. Stanbic, MTN"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-500 uppercase">Account / Phone Number (optional)</Label>
              <Input
                value={form.accountNumber}
                onChange={e => setForm({ ...form, accountNumber: e.target.value })}
                className="bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                placeholder="e.g. 9030001234567"
              />
            </div>

            <div className="flex items-center justify-between p-4 bg-indigo-50/50 rounded-xl border border-indigo-100">
              <div className="space-y-0.5">
                <Label className="text-indigo-900 font-bold text-sm">Default Account</Label>
                <p className="text-[10px] text-indigo-600 font-medium">Primary source for {form.type === 'cash' ? 'cash' : form.type === 'bank' ? 'bank' : form.type === 'mobile_money' ? 'mobile money' : 'petty cash'} transactions</p>
              </div>
              <input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} className="h-5 w-5 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500" />
            </div>
          </div>

          <DialogFooter className="p-6 bg-slate-50 flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => setDialogOpen(false)} className="text-slate-500 font-bold">CANCEL</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 px-6 font-bold shadow-md">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingId ? 'UPDATE ACCOUNT' : 'SAVE ACCOUNT'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cfModal} onOpenChange={(v: boolean) => { if (!v) setCfModal(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {cfModal === 'deposit' && <><ArrowDownToLine className="h-5 w-5" /> Cash Deposit</>}
              {cfModal === 'withdraw' && <><ArrowUpFromLine className="h-5 w-5" /> Cash Withdrawal</>}
              {cfModal === 'transfer' && <><ArrowRightLeft className="h-5 w-5" /> Transfer Between Accounts</>}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={doCashFlow} className="space-y-4">
            <div className="space-y-2">
              <Label>{cfModal === 'transfer' ? 'From Account' : 'Account'}</Label>
              <Select value={cfAcct} onValueChange={setCfAcct} required>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {allAccounts.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name} ({a.accountType}) — Bal: {Number(a.balance).toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {cfModal === 'transfer' && (
              <div className="space-y-2">
                <Label>To Account</Label>
                <Select value={cfToAcct} onValueChange={setCfToAcct} required>
                  <SelectTrigger><SelectValue placeholder="Select destination account" /></SelectTrigger>
                  <SelectContent>
                    {allAccounts.filter((a: any) => a.id !== cfAcct).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} ({a.accountType}) — Bal: {Number(a.balance).toLocaleString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" step="0.01" min="0.01" placeholder="0.00" value={cfAmount} onChange={(e) => setCfAmount(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input placeholder="Reason for transaction" value={cfDesc} onChange={(e) => setCfDesc(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={cfLoading}>
              {cfLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {cfModal === 'deposit' ? 'Record Deposit' : cfModal === 'withdraw' ? 'Record Withdrawal' : 'Transfer'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
