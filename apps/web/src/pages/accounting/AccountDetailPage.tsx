import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Save, Loader2, BookOpen, Settings, Activity, BarChart3, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  useAccount, useAccountCategories, useAccounts, useCreateAccount, useUpdateAccount,
  type Account, type AccountCategory,
} from '@/features/accounting/api';
import { notify } from '@/lib/notify';

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Radix Select treats "" as "no value", so an empty-string SelectItem throws.
 * A sentinel keeps "None" selectable; it is mapped back to null on submit.
 */
const NONE = '__none__';

const CASH_FLOW_OPTIONS = [
  { value: 'operating', label: 'Operating' },
  { value: 'investing', label: 'Investing' },
  { value: 'financing', label: 'Financing' },
  { value: 'none', label: 'Excluded' },
] as const;

const CLASSIFICATION_LABELS: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Income',
  expense: 'Expenses',
  off_balance: 'Off Balance Sheet',
};

const CLASSIFICATION_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense', 'off_balance'];

/** Tri-state behavior override: inherit the category default, or force on/off. */
const OVERRIDE_OPTIONS = [
  { value: 'inherit', label: 'Inherit from category' },
  { value: 'yes', label: 'Always allow' },
  { value: 'no', label: 'Never allow' },
] as const;

type OverrideValue = 'inherit' | 'yes' | 'no';

const toOverride = (v: boolean | null | undefined): OverrideValue =>
  v === null || v === undefined ? 'inherit' : v ? 'yes' : 'no';
const fromOverride = (v: OverrideValue): boolean | null =>
  v === 'inherit' ? null : v === 'yes';

function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');
}

// ── Schema ──────────────────────────────────────────────────────────────────

const accountSchema = z.object({
  code: z.string().min(1, 'Required'),
  name: z.string().min(1, 'Required'),
  categoryId: z.string().min(1, 'Required'),
  isGroup: z.boolean(),
  isControlAccount: z.boolean(),
  parentAccountId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  cashFlowCategory: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  accountNumber: z.string().optional().nullable(),
  allowReconciliation: z.enum(['inherit', 'yes', 'no']),
  allowManualPosting: z.enum(['inherit', 'yes', 'no']),
  allowBudgeting: z.enum(['inherit', 'yes', 'no']),
});

type AccountFormValues = z.infer<typeof accountSchema>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start py-2.5 gap-4 border-b border-muted/20 last:border-b-0">
      <dt className="w-36 flex-shrink-0 text-xs text-muted-foreground font-semibold pt-0.5 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm flex-1">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function DialogInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/** Category picker, grouped by classification so the list stays readable. */
function CategorySelect({
  categories,
  value,
  onChange,
  id,
}: {
  categories: AccountCategory[];
  value: string;
  onChange: (v: string) => void;
  id?: string;
}) {
  const grouped = useMemo(() => {
    const byClass = new Map<string, AccountCategory[]>();
    for (const c of categories) {
      if (!c.isActive) continue;
      const list = byClass.get(c.classification) ?? [];
      list.push(c);
      byClass.set(c.classification, list);
    }
    return CLASSIFICATION_ORDER.filter((k) => byClass.has(k)).map((k) => ({
      classification: k,
      label: CLASSIFICATION_LABELS[k] ?? k,
      items: byClass.get(k)!,
    }));
  }, [categories]);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}><SelectValue placeholder="Select category" /></SelectTrigger>
      <SelectContent>
        {grouped.map((g) => (
          <div key={g.classification}>
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {g.label}
            </div>
            {g.items.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id; // /accounts/new has no :id param; /accounts/:id always has one

  const account = useAccount(isNew ? undefined : id);
  const allAccounts = useAccounts();
  const categories = useAccountCategories();
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('general');

  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      code: '', name: '', categoryId: '', isGroup: false, isControlAccount: false,
      parentAccountId: null, description: null,
      cashFlowCategory: null, bankName: null, accountNumber: null,
      allowReconciliation: 'inherit', allowManualPosting: 'inherit', allowBudgeting: 'inherit',
    },
  });

  const { reset, register, watch, setValue, formState: { errors } } = form;
  const watchCategoryId = watch('categoryId') || '';

  const categoryList = categories.data ?? [];
  const selectedCategory = categoryList.find((c) => c.id === watchCategoryId);

  // Populate form when editing
  useEffect(() => {
    if (account.data && !isNew) {
      reset({
        code: account.data.code,
        name: account.data.name,
        categoryId: account.data.categoryId ?? '',
        isGroup: account.data.isGroup,
        isControlAccount: account.data.isControlAccount ?? false,
        parentAccountId: account.data.parentAccountId ?? null,
        description: account.data.description ?? null,
        cashFlowCategory: account.data.cashFlowCategory ?? null,
        bankName: account.data.bankName ?? null,
        accountNumber: account.data.accountNumber ?? null,
        allowReconciliation: toOverride(account.data.allowReconciliation),
        allowManualPosting: toOverride(account.data.allowManualPosting),
        allowBudgeting: toOverride(account.data.allowBudgeting),
      });
    }
  }, [account.data, isNew, reset]);

  const allAccountList = (allAccounts.data?.data ?? []) as Account[];
  /**
   * A parent must be a group account of the same classification — the same rule
   * the API enforces, mirrored here so the picker cannot offer an invalid choice.
   */
  const parentOptions = allAccountList.filter(
    (p) =>
      p.id !== id &&
      p.isGroup &&
      (!selectedCategory || p.category?.classification === selectedCategory.classification),
  );

  const isPending = createAccount.isPending || updateAccount.isPending;

  const onSubmit = form.handleSubmit(async (values) => {
    const behavior = {
      allowReconciliation: fromOverride(values.allowReconciliation),
      allowManualPosting: fromOverride(values.allowManualPosting),
      allowBudgeting: fromOverride(values.allowBudgeting),
    };
    try {
      if (isNew) {
        await createAccount.mutateAsync({
          code: values.code,
          name: values.name,
          categoryId: values.categoryId,
          isGroup: values.isGroup,
          isControlAccount: values.isControlAccount,
          parentAccountId: values.parentAccountId || undefined,
          description: values.description || undefined,
          cashFlowCategory: values.cashFlowCategory || undefined,
          ...behavior,
        });
        navigate('/accounts');
      } else if (id) {
        await updateAccount.mutateAsync({
          id,
          name: values.name,
          categoryId: values.categoryId,
          isGroup: values.isGroup,
          isControlAccount: values.isControlAccount,
          parentAccountId: values.parentAccountId || null,
          description: values.description || null,
          cashFlowCategory: values.cashFlowCategory || undefined,
          bankName: values.bankName || null,
          accountNumber: values.accountNumber || null,
          ...behavior,
        });
      }
    } catch { /* handled in mutation */ }
  });

  const handleDelete = async () => {
    if (!id || isNew) return;
    try {
      await updateAccount.mutateAsync({ id, isActive: !account.data?.isActive });
      setDeleteOpen(false);
      notify.success(account.data?.isActive ? 'Account deactivated' : 'Account activated');
    } catch { /* handled */ }
  };

  const a = account.data;

  return (
    <div className="space-y-6">

      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={() => navigate('/accounts')} className="hover:text-foreground transition-colors">Chart of Accounts</button>
        <span>/</span>
        <span className="text-foreground font-medium">
          {isNew ? 'New Account' : a ? `${a.code} — ${a.name}` : 'Loading...'}
        </span>
      </div>

      {/* ── Header bar ── */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/accounts')} className="h-9 w-9">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-sm">
              <BookOpen className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">
                  {isNew ? 'New Account' : a?.name ?? 'Account'}
                </h1>
                {!isNew && a && (
                  <>
                    <Badge variant="secondary" className="font-mono text-xs">{a.code}</Badge>
                    <Badge variant={a.isActive ? 'default' : 'secondary'} className="text-xs">
                      {a.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    {a.isGroup && (
                      <Badge variant="outline" className="text-xs">Group</Badge>
                    )}
                    {a.isControlAccount && (
                      <Badge variant="outline" className="text-xs border-sky-300 text-sky-700">Control</Badge>
                    )}
                    {a.deprecatedAt && (
                      <Badge variant="outline" className="text-xs border-orange-300 text-orange-700">Deprecated</Badge>
                    )}
                    {a.isSystem && (
                      <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">System</Badge>
                    )}
                  </>
                )}
              </div>
              {a && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {a.category?.name ?? 'Uncategorized'} · {humanize(a.normalBalance)}-normal
                  {a.parent && <> · Parent: {a.parent.code} — {a.parent.name}</>}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/accounts')}>
            Discard
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={isPending || account.isLoading}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {isNew ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>

      {isNew ? (
        /* ── New Account Form ── */
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Account Information</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="code">Code *</Label>
                    <Input id="code" placeholder="e.g. 1100" {...register('code')} />
                    {errors.code && <p className="text-sm text-destructive">{errors.code.message as string}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="categoryId">Category *</Label>
                    <CategorySelect
                      id="categoryId"
                      categories={categoryList}
                      value={watchCategoryId}
                      onChange={(v) => setValue('categoryId', v, { shouldValidate: true })}
                    />
                    {errors.categoryId && <p className="text-sm text-destructive">{errors.categoryId.message as string}</p>}
                  </div>
                </div>
                {selectedCategory && (
                  <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                    <p>
                      <span className="font-medium text-foreground">{humanize(selectedCategory.normalBalance)}-normal</span>
                      {' · '}{CLASSIFICATION_LABELS[selectedCategory.classification] ?? selectedCategory.classification}
                      {' · '}reported under {humanize(selectedCategory.reportSection)}
                    </p>
                    {selectedCategory.description && <p>{selectedCategory.description}</p>}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input id="name" placeholder="e.g. Cash on Hand" {...register('name')} />
                  {errors.name && <p className="text-sm text-destructive">{errors.name.message as string}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="parentAccountId">Parent Account</Label>
                  <Select
                    value={watch('parentAccountId') ?? NONE}
                    onValueChange={(v) => setValue('parentAccountId', v === NONE ? null : v)}
                  >
                    <SelectTrigger id="parentAccountId"><SelectValue placeholder="None (top-level)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None (top-level)</SelectItem>
                      {parentOptions.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Hierarchy is for reporting and navigation only. A parent must be a group
                    account with the same classification.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 rounded border-input" {...register('isGroup')} />
                  <span>Group account (cannot post journal lines directly)</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 rounded border-input" {...register('isControlAccount')} />
                  <span>Control account (backed by a subledger, e.g. AR / AP / stock)</span>
                </label>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Description</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea placeholder="What this account is used for…" rows={5} {...register('description')} />
                </div>
              </CardContent>
            </Card>
          </div>
        </form>
      ) : account.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : a ? (
        /* ── Existing Account — Tabbed View ── */
        <>
          {/* Gradient Tab Bar */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="bg-gradient-to-r from-indigo-50 via-white to-purple-50 rounded-lg border p-1">
              <TabsList className="bg-transparent h-auto p-0 gap-0">
                <TabsTrigger value="general" className="data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-md px-4 py-2 text-sm gap-1.5">
                  <Settings className="h-4 w-4" /> General
                </TabsTrigger>
                <TabsTrigger value="details" className="data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-md px-4 py-2 text-sm gap-1.5">
                  <Activity className="h-4 w-4" /> Details
                </TabsTrigger>
                <TabsTrigger value="cashflow" className="data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-md px-4 py-2 text-sm gap-1.5">
                  <BarChart3 className="h-4 w-4" /> Behavior
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── General Tab ── */}
            <TabsContent value="general" className="mt-4 space-y-4">
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base">Account Details</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <dl className="divide-y divide-muted/20">
                      <InfoRow label="Code" value={<span className="font-mono">{a.code}</span>} />
                      <InfoRow label="Name" value={<Input className="h-8 text-sm" {...register('name')} />} />
                      <InfoRow label="Category" value={
                        <CategorySelect
                          categories={categoryList}
                          value={watchCategoryId}
                          onChange={(v) => setValue('categoryId', v, { shouldValidate: true })}
                        />
                      } />
                      <InfoRow label="Parent" value={a.parent ? `${a.parent.code} — ${a.parent.name}` : '—'} />
                      <InfoRow label="Children" value={a.children?.length ? `${a.children.length} sub-account(s)` : '—'} />
                      <InfoRow label="Group" value={a.isGroup ? 'Yes — summary account' : 'No — postable account'} />
                      <InfoRow label="Status" value={
                        <Badge variant={a.isActive ? 'default' : 'secondary'} className="text-xs">
                          {a.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      } />
                      <InfoRow label="Protected" value={a.isProtected ? 'Yes' : 'No'} />
                    </dl>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base">Accounting Treatment</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground mb-3">
                      Derived from the category. These drive how the engine posts and reports
                      this account, so they cannot be set per account.
                    </p>
                    <dl className="divide-y divide-muted/20">
                      <InfoRow label="Classification" value={CLASSIFICATION_LABELS[a.category?.classification ?? ''] ?? humanize(a.category?.classification)} />
                      <InfoRow label="Normal Balance" value={humanize(a.normalBalance)} />
                      <InfoRow label="Report Section" value={humanize(a.category?.reportSection)} />
                      <InfoRow label="Contra Account" value={a.category?.isContra ? 'Yes' : 'No'} />
                      <InfoRow label="Cash Equivalent" value={a.category?.isCashEquivalent ? 'Yes' : 'No'} />
                      <InfoRow label="Control Account" value={a.isControlAccount ? 'Yes' : 'No'} />
                      <InfoRow label="Default Account" value={a.isDefault ? 'Yes' : 'No'} />
                      <InfoRow label="System Account" value={a.isSystem ? 'Yes' : 'No'} />
                    </dl>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ── Details Tab ── */}
            <TabsContent value="details" className="mt-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">Additional Information</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 max-w-lg">
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea rows={3} {...register('description')} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Bank Name</Label>
                      <Input placeholder="Bank name" {...register('bankName')} />
                    </div>
                    <div className="space-y-2">
                      <Label>Account Number</Label>
                      <Input placeholder="Account/phone number" {...register('accountNumber')} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Parent Account</Label>
                    <Select
                      value={watch('parentAccountId') ?? NONE}
                      onValueChange={(v) => setValue('parentAccountId', v === NONE ? null : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="None (top-level)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>None (top-level)</SelectItem>
                        {parentOptions.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer pt-2">
                    <input type="checkbox" className="h-4 w-4 rounded border-input" {...register('isGroup')} />
                    <span>Group account (cannot post journal lines directly)</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 rounded border-input" {...register('isControlAccount')} />
                    <span>Control account (backed by a subledger)</span>
                  </label>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Behavior Tab ── */}
            <TabsContent value="cashflow" className="mt-4">
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base">Cash Flow Classification</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 max-w-md">
                    <p className="text-sm text-muted-foreground">
                      Which section of the cash flow statement this account's movements appear
                      in. Leave unset to inherit{' '}
                      <span className="font-medium">{humanize(a.category?.cashFlowClass)}</span>{' '}
                      from the category.
                    </p>
                    <div className="space-y-2">
                      <Label>Cash Flow Category</Label>
                      <Select
                        value={watch('cashFlowCategory') ?? NONE}
                        onValueChange={(v) => setValue('cashFlowCategory', v === NONE ? null : v)}
                      >
                        <SelectTrigger><SelectValue placeholder="Inherit from category" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Inherit from category</SelectItem>
                          {CASH_FLOW_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base">Permissions</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 max-w-md">
                    <p className="text-sm text-muted-foreground">
                      Each defaults to the category setting. Override only when this one account
                      needs to differ.
                    </p>
                    {([
                      ['allowManualPosting', 'Manual journal entries', a.category?.allowManualPosting],
                      ['allowReconciliation', 'Reconciliation', a.category?.allowReconciliation],
                      ['allowBudgeting', 'Budgeting', a.category?.allowBudgeting],
                    ] as const).map(([field, label, inherited]) => (
                      <div key={field} className="space-y-2">
                        <Label>{label}</Label>
                        <Select
                          value={watch(field)}
                          onValueChange={(v) => setValue(field, v as OverrideValue)}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {OVERRIDE_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.value === 'inherit'
                                  ? `${o.label} (${inherited ? 'allowed' : 'not allowed'})`
                                  : o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>

          {/* ── Deactivate / Activate ── */}
          <div className="flex items-center gap-3 border-t pt-6">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => setDeleteOpen(true)}
            >
              <AlertCircle className="h-4 w-4 mr-1" />
              {a.isActive ? 'Deactivate Account' : 'Activate Account'}
            </Button>
            {a.isActive && (
              <p className="text-xs text-muted-foreground">
                Deactivating hides this account from selection lists. Existing journal lines remain unchanged.
              </p>
            )}
          </div>

          {/* ── Deactivate/Activate confirm dialog ── */}
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{a.isActive ? 'Deactivate Account' : 'Activate Account'}</DialogTitle>
                <DialogDescription>
                  {a.isActive
                    ? `"${a.code} — ${a.name}" will be deactivated. It won't appear in selection lists for new transactions.`
                    : `"${a.code} — ${a.name}" will be reactivated and available for use.`
                  }
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg bg-muted/30 p-3 space-y-1 text-xs">
                <DialogInfoRow label="Code" value={a.code} />
                <DialogInfoRow label="Name" value={a.name} />
                <DialogInfoRow label="Category" value={a.category?.name ?? '—'} />
                <DialogInfoRow label="Current Status" value={a.isActive ? 'Active' : 'Inactive'} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
                <Button
                  variant={a.isActive ? 'destructive' : 'default'}
                  disabled={updateAccount.isPending}
                  onClick={handleDelete}
                >
                  {updateAccount.isPending ? 'Saving…' : a.isActive ? 'Deactivate' : 'Activate'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <div className="text-center py-16 text-muted-foreground">Account not found.</div>
      )}
    </div>
  );
}
