import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Eye, FolderOpen, Plus, Search } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  useAccountCategories, useAccountTree,
  type Account, type AccountTreeNode,
} from '@/features/accounting/api';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Sections come from each account's category (`reportSection`) — the same source
 * the balance sheet and P&L use. This page previously carried its own hardcoded
 * account-type-to-section map, which drifted from the server's.
 */
const SECTION_LABELS: Record<string, string> = {
  current_assets: 'Current Assets',
  non_current_assets: 'Non-current Assets',
  current_liabilities: 'Current Liabilities',
  long_term_liabilities: 'Long-term Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  contra_revenue: 'Sales Discounts & Returns',
  cogs: 'Cost of Sales',
  operating_expense: 'Operating Expenses',
  other_income: 'Other Income',
  other_expense: 'Other Expenses',
  off_balance: 'Off Balance Sheet',
  uncategorized: 'Uncategorized',
};

const SECTION_ORDER = [
  'current_assets', 'non_current_assets',
  'current_liabilities', 'long_term_liabilities', 'equity',
  'revenue', 'contra_revenue', 'cogs', 'operating_expense',
  'other_income', 'other_expense', 'off_balance', 'uncategorized',
];

const ALL = '__all__';

interface FlatRow extends AccountTreeNode {
  depth: number;
  hasChildren: boolean;
}

/** Depth-first flatten, descending only into expanded nodes. */
function flatten(nodes: AccountTreeNode[], expanded: Set<string>, depth = 0): FlatRow[] {
  const out: FlatRow[] = [];
  for (const n of nodes) {
    out.push({ ...n, depth, hasChildren: n.children.length > 0 });
    if (n.children.length > 0 && expanded.has(n.id)) {
      out.push(...flatten(n.children, expanded, depth + 1));
    }
  }
  return out;
}

/** Keep a node when it matches, or when any descendant does. */
function filterTree(nodes: AccountTreeNode[], predicate: (n: AccountTreeNode) => boolean): AccountTreeNode[] {
  const out: AccountTreeNode[] = [];
  for (const n of nodes) {
    const children = filterTree(n.children, predicate);
    if (predicate(n) || children.length > 0) out.push({ ...n, children });
  }
  return out;
}

function countNodes(nodes: AccountTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

export function ChartOfAccountsPage() {
  const navigate = useNavigate();
  const tree = useAccountTree({ includeInactive: true });
  const categories = useAccountCategories();
  const auth = useAuthStore();

  const canCreate = auth.hasPermission(PERMISSIONS.account.create);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const roots = tree.data?.nodes ?? [];
  const totalAccounts = useMemo(() => countNodes(roots), [roots]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q && categoryFilter === ALL) return roots;
    return filterTree(roots, (n) => {
      if (categoryFilter !== ALL && n.categoryKey !== categoryFilter) return false;
      if (!q) return true;
      return n.name.toLowerCase().includes(q) || n.code.toLowerCase().includes(q);
    });
  }, [roots, search, categoryFilter]);

  // Expand everything while searching so matches deep in the tree are visible.
  const effectiveExpanded = useMemo(() => {
    if (!search.trim() && categoryFilter === ALL) return expanded;
    const all = new Set<string>();
    const walk = (nodes: AccountTreeNode[]) => {
      for (const n of nodes) {
        all.add(n.id);
        walk(n.children);
      }
    };
    walk(filtered);
    return all;
  }, [expanded, search, categoryFilter, filtered]);

  const flatRows = useMemo(
    () => flatten(filtered, effectiveExpanded),
    [filtered, effectiveExpanded],
  );

  const sectioned = useMemo(() => {
    const groups: Record<string, FlatRow[]> = {};
    for (const row of flatRows) {
      (groups[row.reportSection ?? 'uncategorized'] ??= []).push(row);
    }
    return groups;
  }, [flatRows]);

  // Expand the top-level groups once the tree arrives.
  useEffect(() => {
    if (roots.length > 0 && expanded.size === 0) {
      setExpanded(new Set(roots.filter((r) => r.children.length > 0).map((r) => r.id)));
    }
    // Intentionally keyed on roots only: re-running on `expanded` would fight
    // the user collapsing every group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSection = (section: string) =>
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  const isLoading = tree.isLoading || categories.isLoading;

  return (
    <div className="space-y-0">
      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Chart of Accounts</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {totalAccounts} accounts · grouped by financial statement section
        </p>
      </div>

      {/* ── Search / Filter / New bar ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search accounts..."
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-9 w-56 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Categories</SelectItem>
              {(categories.data ?? []).map((c) => (
                <SelectItem key={c.id} value={c.key}>
                  {c.name} ({c.accountCount ?? 0})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate('/accounts/categories')}>
            Categories
          </Button>
          {canCreate && (
            <Button size="sm" onClick={() => navigate('/accounts/new')}>
              <Plus className="h-4 w-4 mr-1" /> New
            </Button>
          )}
        </div>
      </div>

      {/* ── Tree list ── */}
      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : totalAccounts === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No accounts yet</p>
          <p className="text-sm">Create your first account to start building your chart of accounts.</p>
          {canCreate && (
            <Button className="mt-4" size="sm" onClick={() => navigate('/accounts/new')}>
              <Plus className="h-4 w-4 mr-1" /> New Account
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border bg-white overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-12 gap-0 border-b bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <div className="col-span-5 px-4 py-2.5">Code</div>
            <div className="col-span-4 px-4 py-2.5">Name</div>
            <div className="col-span-2 px-4 py-2.5 text-center">Category</div>
            <div className="col-span-1 px-2 py-2.5 text-right">Action</div>
          </div>

          {SECTION_ORDER.filter((s) => sectioned[s]?.length).map((section) => (
            <div key={section} className="border-b last:border-b-0">
              <button
                onClick={() => toggleSection(section)}
                className="flex items-center gap-2 w-full px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted/20 transition-colors border-b border-muted/50"
              >
                {collapsedSections.has(section)
                  ? <ChevronRight className="h-3 w-3" />
                  : <ChevronDown className="h-3 w-3" />}
                {SECTION_LABELS[section] ?? section.replace(/_/g, ' ')}
                <span className="ml-1 font-normal normal-case">({sectioned[section].length})</span>
              </button>

              {!collapsedSections.has(section) && sectioned[section].map((a) => (
                <div
                  key={a.id}
                  className="grid grid-cols-12 gap-0 items-center hover:bg-muted/10 transition-colors border-b border-muted/20 last:border-b-0"
                  style={{ paddingLeft: `${a.depth * 1.25 + 1}rem` }}
                >
                  {/* Code */}
                  <div className="col-span-5 px-3 py-2 flex items-center gap-1.5">
                    {a.hasChildren ? (
                      <button
                        onClick={() => toggleExpand(a.id)}
                        className="flex-shrink-0 p-0.5 hover:bg-muted/30 rounded"
                        aria-label={effectiveExpanded.has(a.id) ? 'Collapse' : 'Expand'}
                      >
                        {effectiveExpanded.has(a.id)
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                      </button>
                    ) : (
                      <span className="w-5 flex-shrink-0" />
                    )}
                    <span className={`text-sm font-mono ${a.isGroup ? 'font-bold' : ''}`}>
                      {a.code}
                    </span>
                  </div>

                  {/* Name */}
                  <div className="col-span-4 px-3 py-2 flex items-center gap-2">
                    <span className={`text-sm ${a.isGroup ? 'font-semibold' : ''}`}>{a.name}</span>
                    {!a.isActive && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Inactive</Badge>
                    )}
                    {a.deprecatedAt && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-300 text-orange-700">
                        Deprecated
                      </Badge>
                    )}
                    {a.isGroup && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
                        Group
                      </Badge>
                    )}
                    {a.isControlAccount && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-sky-300 text-sky-700">
                        Control
                      </Badge>
                    )}
                  </div>

                  {/* Category */}
                  <div className="col-span-2 px-3 py-2 text-center">
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      {a.categoryName ?? 'Uncategorized'}
                    </Badge>
                  </div>

                  {/* Action */}
                  <div className="col-span-1 px-2 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => navigate(`/accounts/${a.id}`)}
                      title="View account details"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type { Account };
