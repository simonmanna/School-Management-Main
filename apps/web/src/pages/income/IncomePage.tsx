// src/pages/income/IncomePage.tsx
import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Pencil,
  Ban,
  UploadCloud,
  FileText,
  Tag,
  Coins,
  RefreshCw,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { incomeApi, incomeHeadsApi } from '@/lib/api/income';
import type { Income, IncomeHead, Account } from '@/types/income';
import { useOrgCurrency, money } from '@/lib/format';

// ─── Constants ──────────────────────────────────────────────────────────────
const PAY_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'MTN_MOBILE_MONEY', label: 'MTN Mobile Money' },
  { value: 'AIRTEL_MONEY', label: 'Airtel Money' },
  { value: 'CHEQUE', label: 'Cheque' },
];

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  RECEIVED: { label: 'Received', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  POSTED: { label: 'Posted', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-UG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function headDisplay(i: Income): string {
  return i.incomeHeadName ?? i.incomeHead?.name ?? '—';
}

// ─── Main page ──────────────────────────────────────────────────────────────
export default function IncomePage() {
  const currency = useOrgCurrency();
  const [rows, setRows] = useState<Income[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(100);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [headFilter, setHeadFilter] = useState<string>('all');
  const [heads, setHeads] = useState<IncomeHead[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);
  const [headsOpen, setHeadsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Income | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Income | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await incomeApi.getAll({
        page,
        limit,
        search: search || undefined,
        incomeHeadId: headFilter === 'all' ? undefined : headFilter,
      });
      setRows(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, headFilter]);

  const loadMeta = useCallback(async () => {
    const [h, a] = await Promise.all([incomeHeadsApi.getAll(), incomeApi.receiptAccounts()]);
    setHeads(h);
    setAccounts(a);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const pageCount = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Other Revenue / Income</h1>
            <p className="text-sm text-slate-500">
              Record non-fee money received — fines, donations, grants, interest, canteen, etc.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setHeadsOpen(true)}>
              <Tag className="mr-2 h-4 w-4" /> Income Heads
            </Button>
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Add Income
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* ── Add / Edit Income form ── */}
          <div className="rounded-lg border border-b bg-white">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-3">
              <Coins className="h-4 w-4 text-slate-600" />
              <h2 className="text-sm font-semibold text-slate-700">
                {editing ? 'Edit Income' : 'Add Income'}
              </h2>
            </div>
            <div className="p-4">
              <IncomeForm
                key={editing?.id ?? 'new'}
                heads={heads}
                accounts={accounts}
                currency={currency}
                editing={editing}
                onSaved={async () => {
                  setFormOpen(false);
                  setEditing(null);
                  await load();
                }}
                onCancel={() => { setFormOpen(false); setEditing(null); }}
              />
            </div>
          </div>

          {/* ── Income List table ── */}
          <div className="rounded-lg border border-b bg-white">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-3">
              <FileText className="h-4 w-4 text-slate-600" />
              <h2 className="text-sm font-semibold text-slate-700">Income List</h2>
            </div>
            <div className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    placeholder="Search..."
                    className="pl-8"
                  />
                </div>
                <Select value={headFilter} onValueChange={(v) => { setHeadFilter(v); setPage(1); }}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All heads" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All heads</SelectItem>
                    {heads.map((h) => (
                      <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => load()} title="Refresh">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-slate-500">
                      <th className="px-2 py-2">Name</th>
                      <th className="px-2 py-2">Invoice #</th>
                      <th className="px-2 py-2">Date</th>
                      <th className="px-2 py-2">Head</th>
                      <th className="px-2 py-2 text-right">Amount</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="px-2 py-10 text-center text-slate-400">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-2 py-10 text-center">
                          <p className="text-sm font-medium text-rose-500">No data available in table</p>
                          <p className="mt-1 flex items-center justify-center gap-1 text-xs text-emerald-600">
                            <ChevronLeft className="h-3 w-3" />
                            Add new record or search with different criteria.
                          </p>
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => (
                        <tr key={r.id} className="border-b hover:bg-slate-50">
                          <td className="px-2 py-2 font-medium text-slate-700">{r.name}</td>
                          <td className="px-2 py-2 text-slate-500">{r.invoiceNumber ?? '—'}</td>
                          <td className="px-2 py-2 text-slate-500">{fmtDate(r.incomeDate)}</td>
                          <td className="px-2 py-2 text-slate-500">{headDisplay(r)}</td>
                          <td className="px-2 py-2 text-right font-mono">
                            {money(r.amount, currency)}
                          </td>
                          <td className="px-2 py-2">
                            <span className={`inline-flex rounded border px-2 py-0.5 text-xs ${STATUS_CONFIG[r.status]?.cls ?? ''}`}>
                              {STATUS_CONFIG[r.status]?.label ?? r.status}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={r.status === 'CANCELLED'}
                                onClick={() => { setEditing(r); setFormOpen(true); }}
                                title="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={r.status === 'CANCELLED'}
                                onClick={() => setCancelTarget(r)}
                                title="Cancel"
                              >
                                <Ban className="h-4 w-4 text-amber-600" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={r.status === 'CANCELLED'}
                                onClick={() => setDeleteTarget(r)}
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4 text-rose-600" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>
                  Records: {rows.length === 0 ? 0 : (page - 1) * limit + 1} to{' '}
                  {Math.min(page * limit, total)} of {total}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span>
                    {page} / {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={page >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) { setFormOpen(false); setEditing(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Income' : 'Add Income'}</DialogTitle>
            <DialogDescription>
              Record other revenue received. Fields marked * are required.
            </DialogDescription>
          </DialogHeader>
          <IncomeForm
            key={editing?.id ?? 'new-modal'}
            heads={heads}
            accounts={accounts}
            currency={currency}
            editing={editing}
            onSaved={async () => { setFormOpen(false); setEditing(null); await load(); }}
            onCancel={() => { setFormOpen(false); setEditing(null); }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={headsOpen} onOpenChange={setHeadsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Income Heads</DialogTitle>
            <DialogDescription>
              Manage the categories of other revenue (fine, donation, grant, etc.).
            </DialogDescription>
          </DialogHeader>
          <IncomeHeadsManager
            heads={heads}
            onChange={async () => { await loadMeta(); await load(); }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete income?</DialogTitle>
            <DialogDescription>
              This removes the receipt <b>{deleteTarget?.incomeCode}</b> ({deleteTarget?.name}).
              Posted receipts must be cancelled first.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Keep</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleteTarget) return;
                await incomeApi.delete(deleteTarget.id);
                setDeleteTarget(null);
                await load();
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel income?</DialogTitle>
            <DialogDescription>
              Reverses the GL entry (if posted) and marks{' '}
              <b>{cancelTarget?.incomeCode}</b> as cancelled.
            </DialogDescription>
          </DialogHeader>
          <CancelForm
            onConfirm={async (reason) => {
              if (!cancelTarget) return;
              await incomeApi.cancel(cancelTarget.id, { cancelReason: reason });
              setCancelTarget(null);
              await load();
            }}
            onCancel={() => setCancelTarget(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Income form ────────────────────────────────────────────────────────────
interface IncomeFormProps {
  heads: IncomeHead[];
  accounts: Account[];
  currency: string;
  editing: Income | null;
  onSaved: () => void;
  onCancel: () => void;
}

function IncomeForm({ heads, accounts, currency, editing, onSaved, onCancel }: IncomeFormProps) {
  const [saving, setSaving] = useState(false);
  const [fileId, setFileId] = useState<string | null>(editing?.attachmentId ?? null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const form = useForm({
    defaultValues: {
      incomeHeadId: editing?.incomeHeadId ?? '',
      name: editing?.name ?? '',
      invoiceNumber: editing?.invoiceNumber ?? '',
      incomeDate: editing ? editing.incomeDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      amount: editing ? String(editing.amount) : '',
      paymentMethod: editing?.paymentMethod ?? 'CASH',
      accountId: editing?.accountId ?? '',
      description: editing?.description ?? '',
    },
  });

  const isBank = form.watch('paymentMethod') !== 'CASH';

  const onSubmit = form.handleSubmit(async (values: any) => {
    if (editing && editing.journalEntryId) {
      alert('This income is already posted to the ledger and cannot be edited. Cancel it and re-enter.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: values.name,
        invoiceNumber: values.invoiceNumber || undefined,
        incomeDate: values.incomeDate,
        amount: Number(values.amount),
        incomeHeadId: values.incomeHeadId || undefined,
        paymentMethod: values.paymentMethod,
        accountId: values.accountId || undefined,
        description: values.description || undefined,
        attachmentId: fileId || undefined,
      };
      if (editing) await incomeApi.update(editing.id, body);
      else await incomeApi.create({ ...body, receivedById: undefined });
      onSaved();
    } catch (e: any) {
      alert(e?.response?.data?.message || e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('ownerType', 'income');
      const token = localStorage.getItem('token') || '';
      const res = await fetch('/api/v1/files/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const json = await res.json();
      setFileId(json.id);
      setFileName(f.name);
    } catch {
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-3">
        <FormField
          control={form.control}
          name="incomeHeadId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Income Head *</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {heads.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-slate-400">No heads — add one in “Income Heads”</div>
                  )}
                  {heads.map((h) => (
                    <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="name"
          rules={{ required: 'Name is required' }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name *</FormLabel>
              <FormControl>
                <Input placeholder="e.g. PTA donation Q3" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="invoiceNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Invoice Number</FormLabel>
              <FormControl>
                <Input placeholder="Optional reference #" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="incomeDate"
            rules={{ required: 'Date is required' }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date *</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="amount"
            rules={{ required: 'Amount is required', min: 0.01 }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount ({currency}) *</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" min="0" placeholder="0.00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="paymentMethod"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Payment Method</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PAY_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {isBank && (
            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Receive Into</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select account" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <div>
          <FormLabel>Attach Document</FormLabel>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
            <UploadCloud className="h-6 w-6 text-slate-400" />
            {uploading ? (
              <span className="text-xs text-slate-500">Uploading…</span>
            ) : fileName ? (
              <span className="text-xs text-slate-600">{fileName}</span>
            ) : (
              <span className="text-xs text-slate-400">Drag and drop a file here or click</span>
            )}
            <input type="file" className="hidden" onChange={onFile} />
          </label>
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea rows={3} placeholder="Optional notes" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ─── Cancel form ──────────────────────────────────────────────────────────────
function CancelForm({ onConfirm, onCancel }: { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3">
      <Textarea
        rows={3}
        placeholder="Reason for cancellation *"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Keep</Button>
        <Button variant="destructive" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
          Cancel Income
        </Button>
      </div>
    </div>
  );
}

// ─── Income Heads manager ─────────────────────────────────────────────────────
function IncomeHeadsManager({ heads, onChange }: { heads: IncomeHead[]; onChange: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      await incomeHeadsApi.create({ name: n });
      setName('');
      await onChange();
    } catch (e: any) {
      alert(e?.response?.data?.message || e.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this income head? Existing income keeps its snapshot name.')) return;
    setBusy(true);
    try {
      await incomeHeadsApi.delete(id);
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="New head (e.g. Donation)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button onClick={add} disabled={busy || !name.trim()}>
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {heads.length === 0 && <p className="text-sm text-slate-400">No heads yet.</p>}
        {heads.map((h) => (
          <div key={h.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
            <span>
              <Tag className="mr-2 inline h-3.5 w-3.5 text-slate-400" />
              {h.name}
              {h.ledgerAccount && (
                <span className="ml-2 text-xs text-slate-400">→ {h.ledgerAccount.name}</span>
              )}
            </span>
            <Button variant="ghost" size="icon" onClick={() => remove(h.id)}>
              <Trash2 className="h-4 w-4 text-rose-600" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
