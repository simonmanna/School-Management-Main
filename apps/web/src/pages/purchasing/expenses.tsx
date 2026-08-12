import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useExpenses, usePostExpense, useVoidExpense } from '@/features/invoicing/api';
import { money, date } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/stores/auth.store';
import { PERMISSIONS } from '@erp/shared';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
    draft: { label: 'Draft', variant: 'secondary' },
    posted: { label: 'Posted', variant: 'default' },
    cancelled: { label: 'Cancelled', variant: 'destructive' },
  };
  const s = map[status] ?? { label: status, variant: 'secondary' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function ExpensesPage() {
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canView = hasPermission(PERMISSIONS.expense.read);
  const canCreate = hasPermission(PERMISSIONS.expense.create);
  const canPost = hasPermission(PERMISSIONS.expense.post);
  const canVoid = hasPermission(PERMISSIONS.expense.cancel);

  const { data, isLoading } = useExpenses({
    page,
    pageSize: limit,
    search: search || undefined,
  });

  const postExpense = usePostExpense();
  const voidExpense = useVoidExpense();

  useEffect(() => { setLoading(isLoading); }, [isLoading]);

  const handleSearch = (val: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1); }, 400);
  };

  const total = data?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const handlePost = async (id: string) => {
    if (!confirm('Post this bill? This will create journal entries and cannot be undone.')) return;
    await postExpense.mutateAsync(id);
  };

  const handleVoid = async (id: string) => {
    if (!confirm('Void this bill? This will reverse the journal entry and cannot be undone.')) return;
    await voidExpense.mutateAsync(id);
  };

  if (!canView) {
    return (
      <div className="space-y-4 p-6">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
          <h1 className="text-2xl font-semibold text-destructive">Access Denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">You do not have permission to view expenses.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Expenses</h1>
          <p className="text-sm text-gray-500">Manage vendor bills and expenses</p>
        </div>
        {canCreate && (
          <Button asChild className="gap-2 bg-[#0066aa] hover:bg-[#005599] text-white">
            <Link to="/expenses/new"><Plus className="h-4 w-4" /> New Expense</Link>
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            className="pl-9 h-10 border-gray-200"
            placeholder="Search expenses..."
            onChange={(e) => handleSearch(e.target.value)}
          />
          {search && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => { setSearch(''); setPage(1); }}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="ml-auto text-sm text-muted-foreground">
          {data?.meta ? `${data.meta.total} record(s)` : ''}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[180px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}</TableRow>
                ))
              ) : (data?.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No expenses found.
                  </TableCell>
                </TableRow>
              ) : (
                (data?.data ?? []).map((exp) => (
                  <TableRow key={exp.id} className="cursor-pointer">
                    <TableCell className="font-mono text-xs">
                      <Link to={`/expenses/${exp.id}`} className="font-medium text-primary hover:underline">{exp.documentNumber}</Link>
                    </TableCell>
                    <TableCell className="font-medium">{exp.partner?.name ?? '-'}</TableCell>
                    <TableCell className="text-right font-medium">{money(Number(exp.totalAmount))}</TableCell>
                    <TableCell>{date(exp.issueDate)}</TableCell>
                    <TableCell><StatusBadge status={exp.status} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/expenses/${exp.id}`}>View</Link>
                        </Button>
                        {exp.status === 'draft' && canPost && (
                          <Button variant="ghost" size="sm" className="text-green-600" onClick={() => handlePost(exp.id)} disabled={postExpense.isPending}>
                            Post
                          </Button>
                        )}
                        {exp.status === 'posted' && Number(exp.amountPaid) <= 0 && canVoid && (
                          <Button variant="ghost" size="sm" className="text-red-600" onClick={() => handleVoid(exp.id)} disabled={voidExpense.isPending}>
                            Void
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Showing {(data?.data?.length ?? 0) === 0 ? 0 : (page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
            .map((p, idx, arr) => (
              <span key={p} className="flex items-center">
                {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1">...</span>}
                <Button variant={page === p ? 'default' : 'outline'} size="sm" className="h-8 w-8 p-0" onClick={() => setPage(p)}>
                  {p}
                </Button>
              </span>
            ))}
          <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
