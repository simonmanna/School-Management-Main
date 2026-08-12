import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, Building2, Banknote, Smartphone, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCashAccountTransactions, useCashFlowDeposit, useCashFlowWithdraw } from '@/features/accounting/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

const TYPE_CONFIG: Record<string, { icon: typeof Banknote; label: string; color: string; bg: string }> = {
  cash: { icon: Banknote, label: 'Cash', color: 'text-emerald-600', bg: 'bg-emerald-500' },
  bank: { icon: Building2, label: 'Bank', color: 'text-blue-600', bg: 'bg-blue-500' },
  mobile_money: { icon: Smartphone, label: 'Mobile Money', color: 'text-orange-600', bg: 'bg-orange-500' },
  petty_cash: { icon: Banknote, label: 'Petty Cash', color: 'text-purple-600', bg: 'bg-purple-500' },
};

export function CashAccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { data, isLoading } = useCashAccountTransactions(id, { page, pageSize });
  const deposit = useCashFlowDeposit();
  const withdraw = useCashFlowWithdraw();

  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [formAmount, setFormAmount] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const acct = data.account;
  const cfg = TYPE_CONFIG[acct.accountType] ?? { icon: Banknote, label: acct.accountType, color: '', bg: 'bg-slate-500' };

  const running = (idx: number) => {
    return data.data.slice(0, idx + 1).reduce((s, t) => s + Number(t.baseDebit) - Number(t.baseCredit), 0);
  };

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(formAmount);
    if (!amount || amount <= 0) return;
    setFormLoading(true);
    try {
      await deposit.mutateAsync({ accountId: id!, amount, description: formDesc });
      toast.success('Deposit recorded');
      setShowDeposit(false);
      setFormAmount('');
      setFormDesc('');
    } catch {
      toast.error('Deposit failed');
    } finally {
      setFormLoading(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(formAmount);
    if (!amount || amount <= 0) return;
    setFormLoading(true);
    try {
      await withdraw.mutateAsync({ accountId: id!, amount, description: formDesc });
      toast.success('Withdrawal recorded');
      setShowWithdraw(false);
      setFormAmount('');
      setFormDesc('');
    } catch {
      toast.error('Withdrawal failed');
    } finally {
      setFormLoading(false);
    }
  };

  const lastTransactionBalance = data.data.length > 0
    ? data.data.reduce((s, t) => s + Number(t.baseDebit) - Number(t.baseCredit), 0)
    : 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/accounts/cash-accounts')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className={cn('p-2 rounded-lg text-white shadow-inner text-lg', cfg.bg)}>
          {acct.accountType === 'mobile_money' ? '📱' : acct.accountType === 'petty_cash' ? '🪙' : acct.accountType === 'bank' ? '🏦' : '💵'}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{acct.name}</h1>
          <p className="text-sm text-muted-foreground">
            {acct.code} &middot; {cfg.label}
            {acct.accountType === 'bank' || acct.accountType === 'mobile_money' ? ` · ${acct.accountNumber || ''}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Current Balance</p>
          <p className={`text-2xl font-bold ${lastTransactionBalance < 0 ? 'text-red-600' : lastTransactionBalance > 0 ? 'text-green-600' : ''}`}>
            {Math.abs(lastTransactionBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowDeposit(true)}>
            <ArrowDownToLine className="h-4 w-4 mr-2" /> Deposit
          </Button>
          <Button variant="outline" onClick={() => setShowWithdraw(true)}>
            <ArrowUpFromLine className="h-4 w-4 mr-2" /> Withdraw
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transaction History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">In (Dr)</TableHead>
                <TableHead className="text-right">Out (Cr)</TableHead>
                <TableHead className="text-right">Running Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No transactions yet
                  </TableCell>
                </TableRow>
              ) : (
                data.data.map((t, idx) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(t.postingDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.entryNumber}</TableCell>
                    <TableCell className="max-w-[250px] truncate">{t.description}</TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(t.baseDebit) > 0 ? Number(t.baseDebit).toLocaleString('en-US', { minimumFractionDigits: 2 }) : ''}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(t.baseCredit) > 0 ? Number(t.baseCredit).toLocaleString('en-US', { minimumFractionDigits: 2 }) : ''}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      <span className={running(idx) < 0 ? 'text-red-600' : running(idx) > 0 ? 'text-green-600' : ''}>
                        {running(idx).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages} ({data.total} transactions)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog open={showDeposit} onOpenChange={setShowDeposit}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownToLine className="h-5 w-5" /> Deposit to {acct.name}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleDeposit} className="space-y-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" step="0.01" min="0.01" placeholder="0.00" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input placeholder="Source of funds" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={formLoading}>
              {formLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Record Deposit
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showWithdraw} onOpenChange={setShowWithdraw}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpFromLine className="h-5 w-5" /> Withdraw from {acct.name}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleWithdraw} className="space-y-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" step="0.01" min="0.01" placeholder="0.00" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input placeholder="Purpose of withdrawal" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={formLoading}>
              {formLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Record Withdrawal
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
