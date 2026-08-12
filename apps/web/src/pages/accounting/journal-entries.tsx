import { useState, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, X } from 'lucide-react';
import { PERMISSIONS } from '@erp/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, type Column } from '@/components/data-table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { date } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import {
  useJournalEntries, useJournals,
  type JournalEntryRow,
} from '@/features/accounting/api';

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  posted: 'default',
  draft: 'secondary',
  reversed: 'destructive',
};

export function JournalEntriesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  // Filters from URL
  const filterJournalCode = searchParams.get('journalCode') || '';
  const filterStatus = searchParams.get('status') || '';
  const filterFrom = searchParams.get('from') || '';
  const filterTo = searchParams.get('to') || '';
  const filterSearch = searchParams.get('search') || '';

  const [page, setPage] = useState(1);
  const { data: journalsData } = useJournals();
  const { data, isLoading } = useJournalEntries({ page, pageSize: 15, search: filterSearch || undefined });

  const journals = journalsData?.data ?? [];
  const entries = useMemo(() => {
    let result = data?.data ?? [];
    if (filterJournalCode) result = result.filter((e) => e.journal?.code === filterJournalCode);
    if (filterStatus) result = result.filter((e) => e.status === filterStatus);
    if (filterFrom) {
      const from = new Date(filterFrom);
      result = result.filter((e) => new Date(e.postingDate) >= from);
    }
    if (filterTo) {
      const to = new Date(filterTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter((e) => new Date(e.postingDate) <= to);
    }
    return result;
  }, [data?.data, filterJournalCode, filterStatus, filterFrom, filterTo]);

  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    setSearchParams(params, { replace: true });
    setPage(1);
  };

  const clearFilters = () => {
    setSearchParams({}, { replace: true });
    setPage(1);
  };

  const hasActiveFilters = filterJournalCode || filterStatus || filterFrom || filterTo || filterSearch;

  const columns: Column<JournalEntryRow>[] = [
    {
      key: 'entryNumber',
      header: 'Entry #',
      render: (e) => (
        <Link to={`/journal-entries/${e.id}`} className="font-medium text-primary hover:underline">
          {e.entryNumber}
        </Link>
      ),
    },
    { key: 'postingDate', header: 'Date', render: (e) => date(e.postingDate) },
    { key: 'journal', header: 'Journal', render: (e) => (
      <span className="inline-flex items-center gap-1">
        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">{e.journal?.code ?? '-'}</Badge>
        <span className="text-xs text-muted-foreground">{e.journal?.name ?? ''}</span>
      </span>
    )},
    { key: 'description', header: 'Description', render: (e) => (
      <span className="text-sm max-w-[200px] truncate block">{e.description ?? '-'}</span>
    )},
    { key: 'lines', header: 'Lines', render: (e) => e._count?.lines ?? '-' },
    {
      key: 'status',
      header: 'Status',
      render: (e) => <Badge variant={statusVariant[e.status] ?? 'secondary'} className="text-xs font-semibold">{e.status.toUpperCase()}</Badge>,
    },
  ];

  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Journal Entries</h1>
          <p className="text-sm text-gray-500">Every posting — from invoices, payments, inventory adjustments and manual entries.</p>
        </div>
        {hasPermission(PERMISSIONS.journalEntry.post) && (
          <Button onClick={() => navigate('/journal-entries/new')}>
            <Plus className="h-4 w-4" /> New Entry
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-white border rounded-lg shadow-sm">
        {/* Journal */}
        <div className="min-w-[180px]">
          <Select value={filterJournalCode} onValueChange={(v) => setFilter('journalCode', v === '_all' ? '' : v)}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All Journals" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Journals</SelectItem>
              {journals.map((j) => (
                <SelectItem key={j.id} value={j.code}>{j.code} — {j.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Status */}
        <div className="min-w-[130px]">
          <Select value={filterStatus} onValueChange={(v) => setFilter('status', v === '_all' ? '' : v)}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="posted">Posted</SelectItem>
              <SelectItem value="reversed">Reversed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* From date */}
        <div className="min-w-[150px]">
          <Input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilter('from', e.target.value)}
            className="h-9 text-xs"
            placeholder="From date"
          />
        </div>

        {/* To date */}
        <div className="min-w-[150px]">
          <Input
            type="date"
            value={filterTo}
            onChange={(e) => setFilter('to', e.target.value)}
            className="h-9 text-xs"
            placeholder="To date"
          />
        </div>

        {/* Search */}
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search entry number / description..."
            value={filterSearch}
            onChange={(e) => setFilter('search', e.target.value)}
            className="h-9 pl-8 text-xs"
          />
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-xs gap-1">
            <X className="h-3 w-3" /> Clear
          </Button>
        )}
      </div>

      {/* Entries table */}
      <DataTable columns={columns} data={entries} loading={isLoading} getRowId={(e) => e.id} />

      {meta && entries.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{entries.length} of {meta.total} entries</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-xs font-medium">
              Page {meta.page} of {meta.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
