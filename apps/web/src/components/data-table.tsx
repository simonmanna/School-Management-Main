import { type ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  render?: (row: T) => ReactNode;
}

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
}

/** Reusable, presentational data table. Pagination/search live in the page. */
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
}: DataTableProps<T>) {
  return (
    <div className={`rounded-md border ${className}`}>
      <Table>
        <TableHeader>
          <TableRow className={headerRowClassName}>
            {columns.map((c) => (
              <TableHead key={c.key} className={compact ? 'h-7 py-1.5 text-xs' : c.className}>{c.header}</TableHead>
            ))}
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
            <TableRow>
               <TableCell colSpan={columns.length} className={`${compact ? 'p-1.5' : 'h-24'} text-center text-muted-foreground`}>
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            data.map((row, i) => (
              <TableRow key={getRowId ? getRowId(row) : i}>
                {columns.map((c) => (
                   <TableCell key={c.key} className={`${compact ? 'p-1.5 text-sm leading-tight' : ''} ${c.className ?? ''} ${cellClassName}`}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
