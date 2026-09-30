import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search, X } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { compareCellValues } from '@/lib/table-sort';

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  render?: (row: T) => ReactNode;
  /**
   * Value the column sorts by. Defaults to `row[key]` when that is a plain
   * value; a column with neither (an actions column, say) is not sortable.
   */
  sortValue?: (row: T) => unknown;
  /** Set false to keep a column out of sorting even when it has a value. */
  sortable?: boolean;
}

type SortDir = 'asc' | 'desc';

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: ReactNode;
  getRowId?: (row: T) => string;
  className?: string;
  compact?: boolean;
  cellClassName?: string;
  headerRowClassName?: string;
  /** Show the row filter. Defaults to on once there is more than a handful of rows. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Rows per page before the table pages itself. 0 turns paging off. */
  pageSize?: number;
  /** Extra controls rendered at the right of the toolbar. */
  toolbar?: ReactNode;
  initialSort?: { key: string; dir: SortDir };
}

const SEARCH_MIN_ROWS = 6;
const PAGE_SIZES = [25, 50, 100, 250];

function isPlain(v: unknown): boolean {
  return v === null || ['string', 'number', 'boolean', 'bigint'].includes(typeof v) || v instanceof Date;
}

/** Every plain value on the row (and one level down), joined for matching. */
function haystack(row: unknown, depth = 0): string {
  if (row === null || row === undefined) return '';
  if (isPlain(row)) return String(row);
  if (depth > 2 || typeof row !== 'object') return '';
  const parts: string[] = [];
  for (const v of Object.values(row as Record<string, unknown>)) {
    const s = haystack(v, depth + 1);
    if (s) parts.push(s);
  }
  return parts.join(' ');
}

/** Presentational data table with a row filter, column sorting and client paging. */
export function DataTable<T>({
  columns,
  data,
  loading = false,
  emptyMessage = 'No records found.',
  getRowId,
  className = '',
  compact = false,
  cellClassName = '',
  headerRowClassName = '',
  searchable,
  searchPlaceholder,
  pageSize: initialPageSize = 50,
  toolbar,
  initialSort,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(initialSort ?? null);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [page, setPage] = useState(0);

  const sortGetter = (c: Column<T>): ((row: T) => unknown) | null => {
    if (c.sortable === false) return null;
    if (c.sortValue) return c.sortValue;
    const sample = data.find((r) => (r as Record<string, unknown>)?.[c.key] !== undefined);
    if (!sample || !isPlain((sample as Record<string, unknown>)[c.key])) return null;
    return (row) => (row as Record<string, unknown>)[c.key];
  };

  const index = useMemo(() => data.map((row) => haystack(row).toLowerCase()), [data]);

  const filtered = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return data;
    return data.filter((_, i) => tokens.every((t) => index[i].includes(t)));
  }, [data, index, query]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    const get = col ? sortGetter(col) : null;
    if (!get) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return filtered
      .map((row, i) => ({ row, i, v: get(row) }))
      .sort((a, b) => compareCellValues(a.v, b.v, dir) || a.i - b.i)
      .map((x) => x.row);
    // sortGetter only reads columns and data, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, columns, data]);

  useEffect(() => setPage(0), [query, sort, pageSize, data.length]);

  const paged = pageSize > 0 && sorted.length > pageSize;
  const pageCount = paged ? Math.ceil(sorted.length / pageSize) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const rows = paged ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted;

  const showSearch = searchable ?? data.length >= SEARCH_MIN_ROWS;
  const showToolbar = !loading && (showSearch || toolbar);

  const toggleSort = (key: string) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));

  return (
    <div className={cn('dt-shell', className)}>
      {showToolbar && (
        <div className="dt-toolbar">
          {showSearch && (
            <label className="dt-search">
              <Search aria-hidden className="dt-search-icon" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder ?? `Search ${data.length} rows…`}
                aria-label="Search table"
              />
              {query && (
                <button type="button" className="dt-clear" onClick={() => setQuery('')} aria-label="Clear search">
                  <X aria-hidden />
                </button>
              )}
            </label>
          )}
          {showSearch && (
            <span className="dt-count" aria-live="polite">
              {query ? `${filtered.length} of ${data.length}` : `${data.length} ${data.length === 1 ? 'row' : 'rows'}`}
            </span>
          )}
          {toolbar && <div className="ml-auto flex items-center gap-2">{toolbar}</div>}
        </div>
      )}
      <Table data-enhance="off">
        <TableHeader>
          <TableRow className={headerRowClassName}>
            {columns.map((c) => {
              const canSort = !loading && sortGetter(c) !== null;
              const active = sort?.key === c.key ? sort.dir : null;
              return (
                <TableHead
                  key={c.key}
                  className={cn(compact && 'h-8 py-1.5', c.className)}
                  aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : canSort ? 'none' : undefined}
                >
                  {canSort ? (
                    <button type="button" className="dt-sort-btn" data-active={active ?? undefined} onClick={() => toggleSort(c.key)}>
                      <span>{c.header}</span>
                      {active === 'asc' ? (
                        <ArrowUp aria-hidden className="dt-sort-icon" />
                      ) : active === 'desc' ? (
                        <ArrowDown aria-hidden className="dt-sort-icon" />
                      ) : (
                        <ChevronsUpDown aria-hidden className="dt-sort-icon dt-sort-idle" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={`s-${i}`}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={compact ? 'p-1.5' : ''}>
                    <Skeleton className="h-3.5 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : data.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className={`${compact ? 'p-3' : 'h-28'} text-center text-muted-foreground`}>
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="h-28 text-center text-muted-foreground">
                No rows match “{query}”.{' '}
                <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setQuery('')}>
                  Clear search
                </button>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, i) => (
              <TableRow key={getRowId ? getRowId(row) : i}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={cn(compact && 'p-1.5 text-sm leading-tight', c.className, cellClassName)}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {paged && (
        <div className="dt-pager">
          <label className="flex items-center gap-2">
            <span>Rows per page</span>
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="dt-select">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span className="tabular-nums">
            {safePage * pageSize + 1}–{Math.min(sorted.length, (safePage + 1) * pageSize)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" className="dt-page-btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} aria-label="Previous page">
              <ChevronLeft aria-hidden />
            </button>
            <button type="button" className="dt-page-btn" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} aria-label="Next page">
              <ChevronRight aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
