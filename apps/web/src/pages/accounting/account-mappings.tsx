import { useMemo, useState } from 'react';
import { AlertTriangle, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable, type Column } from '@/components/data-table';
import {
  useAccountMappingRegistry,
  useAccountMappings,
  useAccounts,
  useMissingAccountMappings,
  useUpdateAccountMapping,
  type Account,
  type AccountMappingDef,
} from '@/features/accounting/api';
import { PERMISSIONS } from '@erp/shared';
import { useAuthStore } from '@/stores/auth.store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const GROUP_LABELS: Record<string, string> = {
  ar_ap: 'Receivables & Payables',
  sales: 'Sales & Revenue',
  tax: 'Tax',
  treasury: 'Cash & Treasury',
  inventory: 'Inventory',
  fixed_assets: 'Fixed Assets',
  fx: 'Foreign Exchange',
  system: 'System',
};

const GROUP_ORDER = ['ar_ap', 'sales', 'tax', 'treasury', 'inventory', 'fixed_assets', 'fx', 'system'];

/** One row per registry key, whether or not the org has mapped it yet. */
interface MappingRow {
  key: string;
  label: string;
  group: string;
  expectedCategories: string[];
  required: boolean;
  description?: string;
  accountId: string | null;
}

function AccountMappingsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead = hasPermission(PERMISSIONS.accountMapping.read);
  const canUpdate = hasPermission(PERMISSIONS.accountMapping.update);

  // Hooks must run unconditionally — an early return above them would change the
  // hook order between renders.
  const { data: mappings, isLoading: mappingsLoading } = useAccountMappings();
  const { data: registry, isLoading: registryLoading } = useAccountMappingRegistry();
  const { data: missing } = useMissingAccountMappings();
  const { data: accountsData, isLoading: accountsLoading } = useAccounts();
  const updateMutation = useUpdateAccountMapping();

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  const allAccounts = (accountsData?.data ?? []) as Account[];
  const accountMap = useMemo(() => new Map(allAccounts.map((a) => [a.id, a])), [allAccounts]);

  const rows: MappingRow[] = useMemo(() => {
    const assigned = new Map((mappings ?? []).map((m) => [m.key, m.accountId]));
    const defs: AccountMappingDef[] = registry ?? [];
    const known = new Set(defs.map((d) => d.key));
    const fromRegistry = defs.map((d) => ({
      key: d.key,
      label: d.label,
      group: d.group,
      expectedCategories: d.expectedCategories,
      required: d.required,
      description: d.description,
      accountId: assigned.get(d.key) ?? null,
    }));
    // Any stored key the registry does not know about — surfaced rather than hidden.
    const orphans = (mappings ?? [])
      .filter((m) => !known.has(m.key))
      .map((m) => ({
        key: m.key,
        label: m.key,
        group: 'system',
        expectedCategories: [] as string[],
        required: false,
        accountId: m.accountId,
      }));
    return [...fromRegistry, ...orphans].sort(
      (a, b) =>
        GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
        a.label.localeCompare(b.label),
    );
  }, [mappings, registry]);

  const editingDef = rows.find((r) => r.key === editingKey) ?? null;

  /**
   * Only accounts of a category the key expects. The API enforces the same rule;
   * filtering here means an invalid choice is never offered in the first place.
   */
  const eligibleAccounts = useMemo(() => {
    const postable = allAccounts.filter(
      (a) => !a.isGroup && a.isActive && !a.deprecatedAt,
    );
    if (!editingDef || editingDef.expectedCategories.length === 0) return postable;
    return postable.filter(
      (a) => a.category?.key && editingDef.expectedCategories.includes(a.category.key),
    );
  }, [allAccounts, editingDef]);

  const isLoading = mappingsLoading || accountsLoading || registryLoading;

  function handleOpenEdit(row: MappingRow) {
    setEditingKey(row.key);
    setSelectedAccountId(row.accountId ?? '');
  }

  async function handleSave() {
    if (!editingKey || !selectedAccountId) return;
    await updateMutation.mutateAsync({ key: editingKey, accountId: selectedAccountId });
    const linked = accountMap.get(selectedAccountId);
    toast.success(`Mapped "${editingDef?.label ?? editingKey}" → ${linked?.code} ${linked?.name}`);
    setEditingKey(null);
  }

  const columns: Column<MappingRow>[] = [
    {
      key: 'key',
      header: 'Key',
      render: (m) => <code className="text-xs bg-slate-100 px-2 py-0.5 rounded">{m.key}</code>,
    },
    {
      key: 'label',
      header: 'Label',
      render: (m) => (
        <div>
          <div className="flex items-center gap-1.5">
            {m.label}
            {m.required && !m.accountId && (
              <Badge variant="destructive" className="text-[10px]">Unmapped</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{GROUP_LABELS[m.group] ?? m.group}</div>
        </div>
      ),
    },
    {
      key: 'account',
      header: 'Linked Account',
      render: (m) => {
        if (!m.accountId) return <span className="text-slate-400">Not configured</span>;
        const acc = accountMap.get(m.accountId);
        if (!acc) return <span className="text-slate-400">—</span>;
        return (
          <span>
            <span className="font-mono text-sm">{acc.code}</span>
            {' — '}
            <span className={cn(acc.isActive ? '' : 'text-slate-400 line-through')}>{acc.name}</span>
          </span>
        );
      },
    },
    {
      key: 'category',
      header: 'Category',
      render: (m) => {
        const acc = m.accountId ? accountMap.get(m.accountId) : undefined;
        if (!acc?.category) {
          return (
            <span className="text-xs text-slate-400">
              {m.expectedCategories.length > 0 ? `expects ${m.expectedCategories.join(' / ')}` : '—'}
            </span>
          );
        }
        const mismatched =
          m.expectedCategories.length > 0 && !m.expectedCategories.includes(acc.category.key);
        return (
          <div className="flex items-center gap-1.5">
            <Badge variant={mismatched ? 'destructive' : 'secondary'}>{acc.category.name}</Badge>
            {mismatched && (
              <span
                className="text-xs text-destructive"
                title={`Expected ${m.expectedCategories.join(' or ')}`}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'action',
      header: '',
      className: 'text-right',
      render: (m) => (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleOpenEdit(m)}
            disabled={!canUpdate}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  if (!canRead) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Account Mappings</h1>
        <p className="text-sm text-muted-foreground">
          Which account the posting engine uses for each kind of transaction. Modules resolve
          accounts through these keys rather than by name or code.
        </p>
      </div>

      {missing && missing.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium text-destructive">
              {missing.length} required mapping{missing.length === 1 ? '' : 's'} not configured
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Posting will fail when one of these is needed: {missing.join(', ')}
            </p>
          </div>
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        getRowId={(m) => m.key}
        emptyMessage="No account mappings found."
      />

      <Dialog open={!!editingKey} onOpenChange={(open) => !open && setEditingKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Linked Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Mapping</Label>
              <div className="text-sm font-medium">{editingDef?.label ?? editingKey}</div>
              <code className="text-xs text-slate-500">{editingKey}</code>
              {editingDef?.description && (
                <p className="text-xs text-muted-foreground">{editingDef.description}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Linked Account</Label>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an account…" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleAccounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      <span className="font-mono">{acc.code}</span>
                      {' — '}
                      <span>{acc.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">
                {editingDef && editingDef.expectedCategories.length > 0
                  ? `Showing postable ${editingDef.expectedCategories.join(' / ')} accounts.`
                  : 'Only postable (non-group, active) accounts are shown.'}
              </p>
              {eligibleAccounts.length === 0 && (
                <p className="text-xs text-destructive">
                  No account matches this mapping. Create one under Chart of Accounts first.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingKey(null)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={!selectedAccountId || updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { AccountMappingsPage };
export default AccountMappingsPage;
