import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Ban, CheckCircle } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import type { InventoryMovementType } from '@erp/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DataTable, type Column } from '@/components/data-table';
import { notify } from '@/lib/notify';
import { useAuthStore } from '@/stores/auth.store';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface PostingRule {
  id: string;
  movementType: InventoryMovementType;
  lineIndex: number;
  debitOrCredit: 'debit' | 'credit';
  accountSource: string;
  accountMappingKey: string | null;
  literalAccountId: string | null;
  productId: string | null;
  categoryId: string | null;
  isActive: boolean;
}

interface Account {
  id: string;
  code: string;
  name: string;
}

interface MovementTypeEntry {
  code: string;
  label: string;
}

const ACCOUNT_SOURCES = [
  { value: 'account_mapping', label: 'Account Mapping key (org default)' },
  { value: 'literal', label: 'Direct account selection' },
  { value: 'category_field', label: 'Product Category field' },
  { value: 'product_field', label: 'Product Override field' },
] as const;

const ACCOUNT_MAPPING_KEYS = [
  { value: 'stock_valuation', label: 'Stock Valuation (1400)' },
  { value: 'cogs', label: 'Cost of Goods Sold (5100)' },
  { value: 'grni_accrued', label: 'GRNI Accrued (2150)' },
  { value: 'stock_adjustment_income', label: 'Adj. Income (4200)' },
  { value: 'stock_adjustment_expense', label: 'Adj. Expense (5300)' },
  { value: 'sales_revenue', label: 'Sales Revenue (4100)' },
  { value: 'accounts_receivable', label: 'Accounts Receivable (1300)' },
  { value: 'accounts_payable', label: 'Accounts Payable (2100)' },
  { value: 'default_cash', label: 'Default Cash (1100)' },
] as const;

export function InventoryPostingRulesPage() {
  const [rules, setRules] = useState<PostingRule[]>([]);
  const [movementTypes, setMovementTypes] = useState<MovementTypeEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMt, setFilterMt] = useState('');

  // Edit state
  const [editRule, setEditRule] = useState<PostingRule | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editSource, setEditSource] = useState('account_mapping');
  const [editMappingKey, setEditMappingKey] = useState('stock_valuation');
  const [editLitAccount, setEditLitAccount] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);

  // Create state
  const [createOpen, setCreateOpen] = useState(false);
  const [createMt, setCreateMt] = useState('');
  const [createLineIdx, setCreateLineIdx] = useState(0);
  const [createDoc, setCreateDoc] = useState<'debit' | 'credit'>('debit');
  const [createSource, setCreateSource] = useState('account_mapping');
  const [createMappingKey, setCreateMappingKey] = useState('stock_valuation');

  // Delete state
  const [deleting, setDeleting] = useState<PostingRule | null>(null);

  const hasPerm = useAuthStore((s) => s.hasPermission);
  const canRead = hasPerm(PERMISSIONS.inventoryPostingRule.read);
  const canUpdate = hasPerm(PERMISSIONS.inventoryPostingRule.update);
  const canCreate = hasPerm(PERMISSIONS.inventoryPostingRule.create);
  const canDelete = hasPerm(PERMISSIONS.inventoryPostingRule.delete);

  const fetchData = async () => {
    try {
      const [rulesRes, mtRes, acctsRes] = await Promise.all([
        api.get('/inventory/posting-rules', { params: filterMt ? { movementType: filterMt } : {} }),
        api.get('/inventory/posting-rules/movement-types'),
        api.get('/accounts', { params: { limit: 200 } }),
      ]);
      setRules(rulesRes.data ?? []);
      setMovementTypes(mtRes.data ?? []);
      setAccounts(acctsRes.data?.data ?? acctsRes.data ?? []);
    } catch (err: any) {
      notify.error(err?.response?.data?.message ?? 'Failed to load posting rules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (canRead) fetchData(); }, [filterMt, canRead]);

  const openEdit = (rule: PostingRule) => {
    setEditRule(rule);
    setEditSource(rule.accountSource);
    setEditMappingKey(rule.accountMappingKey ?? 'stock_valuation');
    setEditLitAccount(rule.literalAccountId ?? '');
    setEditIsActive(rule.isActive);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editRule) return;
    try {
      await api.patch(`/inventory/posting-rules/${editRule.id}`, {
        accountSource: editSource,
        accountMappingKey: editSource === 'account_mapping' ? editMappingKey : undefined,
        literalAccountId: editSource === 'literal' ? editLitAccount || undefined : undefined,
        isActive: editIsActive,
      });
      notify.success('Rule updated');
      setEditOpen(false);
      fetchData();
    } catch (err: any) {
      notify.error(err?.response?.data?.message ?? 'Update failed');
    }
  };

  const createRule = async () => {
    if (!createMt) { notify.error('Select a movement type'); return; }
    try {
      await api.post('/inventory/posting-rules', {
        movementType: createMt,
        lineIndex: createLineIdx,
        debitOrCredit: createDoc,
        accountSource: createSource,
        accountMappingKey: createSource === 'account_mapping' ? createMappingKey : undefined,
      });
      notify.success('Rule created');
      setCreateOpen(false);
      setCreateMt('');
      fetchData();
    } catch (err: any) {
      notify.error(err?.response?.data?.message ?? 'Create failed');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.delete(`/inventory/posting-rules/${deleting.id}`);
      notify.success('Rule removed');
      setDeleting(null);
      fetchData();
    } catch (err: any) {
      notify.error(err?.response?.data?.message ?? 'Delete failed');
    }
  };

  const columns: Column<PostingRule>[] = [
    {
      key: 'movementType',
      header: 'Movement Type',
      render: (r) => (
        <span className="font-mono text-xs">{r.movementType}</span>
      ),
    },
    { key: 'lineIndex', header: 'Line' },
    {
      key: 'debitOrCredit',
      header: 'Side',
      render: (r) => (
        <Badge variant={r.debitOrCredit === 'debit' ? 'default' : 'secondary'}>
          {r.debitOrCredit.toUpperCase()}
        </Badge>
      ),
    },
    {
      key: 'accountSource',
      header: 'Source',
      render: (r) => {
        const label = ACCOUNT_SOURCES.find((s) => s.value === r.accountSource)?.label ?? r.accountSource;
        return <span className="text-xs">{label}</span>;
      },
    },
    {
      key: 'accountMappingKey',
      header: 'Mapping / Account',
      render: (r) => {
        if (r.accountSource === 'account_mapping')
          return <span className="font-mono text-xs">{r.accountMappingKey}</span>;
        if (r.accountSource === 'literal') {
          const acct = accounts.find((a) => a.id === r.literalAccountId);
          return <span className="text-xs">{acct ? `${acct.code} — ${acct.name}` : r.literalAccountId}</span>;
        }
        if (r.accountSource === 'category_field')
          return <span className="text-xs text-muted-foreground">Category: {r.accountMappingKey}</span>;
        if (r.accountSource === 'product_field')
          return <span className="text-xs text-muted-foreground">Product: {r.accountMappingKey}</span>;
        return '—';
      },
    },
    {
      key: 'scope',
      header: 'Scope',
      render: (r) => {
        if (r.productId) return <Badge variant="outline">Product</Badge>;
        if (r.categoryId) return <Badge variant="outline">Category</Badge>;
        return <Badge variant="secondary">Default</Badge>;
      },
    },
    {
      key: 'isActive',
      header: 'Active',
      render: (r) => (
        r.isActive
          ? <CheckCircle className="h-4 w-4 text-green-600" />
          : <Ban className="h-4 w-4 text-red-400" />
      ),
    },
    {
      key: 'actions' as any,
      header: '',
      render: (r: PostingRule) => (
        <div className="flex gap-1">
          {canUpdate && !r.productId && !r.categoryId && (
            <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && !r.productId && !r.categoryId && (
            <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
              <Trash2 className="h-4 w-4 text-destructive/70" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (!canRead) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Inventory Posting Rules</h1>
        <p className="text-sm text-muted-foreground">You do not have permission to view posting rules.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Inventory Posting Rules</h1>
          <p className="text-sm text-gray-500">
            Configure which accounts are debited/credited per inventory movement type.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Rule
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterMt} onValueChange={setFilterMt}>
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="All movement types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All movement types</SelectItem>
            {movementTypes.map((mt) => (
              <SelectItem key={mt.code} value={mt.code}>{mt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <DataTable columns={columns} data={rules} />
      )}

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 space-y-2">
        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Resolution Chain</p>
        <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
          <li><strong>Product override</strong> — rule with productId set (configured per product)</li>
          <li><strong>Category default</strong> — rule with categoryId set (configured per category)</li>
          <li><strong>Movement type default</strong> — org-wide rule (no productId/categoryId)</li>
          <li><strong>Account Mapping</strong> — fallback at Accounting &gt; Account Mapping</li>
        </ol>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Posting Rule</DialogTitle>
            <DialogDescription>
              {editRule?.movementType} — Line {editRule?.lineIndex} ({editRule?.debitOrCredit?.toUpperCase()})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Account Source</Label>
              <Select value={editSource} onValueChange={setEditSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_SOURCES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {editSource === 'account_mapping' && (
              <div className="space-y-2">
                <Label>Account Mapping Key</Label>
                <Select value={editMappingKey} onValueChange={setEditMappingKey}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_MAPPING_KEYS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Account determined by {editMappingKey} in Account Mapping.</p>
              </div>
            )}

            {editSource === 'literal' && (
              <div className="space-y-2">
                <Label>Account</Label>
                <Select value={editLitAccount} onValueChange={setEditLitAccount}>
                  <SelectTrigger><SelectValue placeholder="Select an account..." /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.code} — {a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="rounded"
                checked={editIsActive}
                onChange={(e) => setEditIsActive(e.target.checked)}
              />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Posting Rule</DialogTitle>
            <DialogDescription>
              Create a new movement-type default rule. Product/category overrides can be set from the product page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Movement Type</Label>
              <Select value={createMt} onValueChange={setCreateMt}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {movementTypes.map((mt) => (
                    <SelectItem key={mt.code} value={mt.code}>{mt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Line Index</Label>
                <Input type="number" min={0} value={createLineIdx} onChange={(e) => setCreateLineIdx(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Side</Label>
                <Select value={createDoc} onValueChange={(v) => setCreateDoc(v as 'debit' | 'credit')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debit">Debit</SelectItem>
                    <SelectItem value="credit">Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Account Source</Label>
              <Select value={createSource} onValueChange={setCreateSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCOUNT_SOURCES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {createSource === 'account_mapping' && (
              <div className="space-y-2">
                <Label>Account Mapping Key</Label>
                <Select value={createMappingKey} onValueChange={setCreateMappingKey}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_MAPPING_KEYS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createRule}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Posting Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove the {deleting?.movementType} line {deleting?.lineIndex} ({deleting?.debitOrCredit?.toUpperCase()}) rule?
              The next resolution level (category or org default) will apply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
