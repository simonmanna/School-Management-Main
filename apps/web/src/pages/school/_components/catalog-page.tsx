import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Printer, FileSpreadsheet, FileText, Search, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { exportCSV } from '@/lib/export-csv';

/**
 * The shared shell every fees catalog screen (Fee Categories, Fee Structures,
 * …) renders through, so they are the same screen with different columns
 * rather than two hand-rolled layouts that drift apart. It owns the toolbar
 * (Print / Excel / CSV / search / Add), the table, the modal form and the
 * delete confirmation; the page supplies only its columns, its form body and
 * its mutations.
 */

export const selectCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export interface CatalogColumn<T> {
  key: string;
  label: string;
  /** Rendered cell. Falls back to `String(row[key])`. */
  render?: (row: T) => React.ReactNode;
  /** Plain-text value for CSV/Excel export. Falls back to the raw field. */
  exportValue?: (row: T) => string;
  className?: string;
}

export interface CatalogPageProps<T> {
  title: string;
  subtitle?: string;
  rows: T[];
  columns: CatalogColumn<T>[];
  rowKey: (row: T) => string;
  /** Fields matched by the toolbar search box. */
  searchFields: (row: T) => string[];
  addLabel: string;
  onAdd: () => void;
  onEdit: (row: T) => void;
  onDelete: (row: T) => void | Promise<void>;
  /** Human label for the row in the delete confirmation. */
  deleteLabel: (row: T) => string;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Filter controls rendered between the toolbar and the table. */
  filters?: React.ReactNode;
  /** Extra buttons rendered next to Add (e.g. "Invoice Students"). */
  toolbarExtra?: React.ReactNode;
  /** Extra per-row buttons, rendered before Edit (e.g. "Publish"). */
  rowActions?: (row: T) => React.ReactNode;
  exportFilename: string;
}

export function CatalogPage<T>({
  title,
  subtitle,
  rows,
  columns,
  rowKey,
  searchFields,
  addLabel,
  onAdd,
  onEdit,
  onDelete,
  deleteLabel,
  isLoading,
  emptyMessage = 'Nothing here yet.',
  filters,
  toolbarExtra,
  rowActions,
  exportFilename,
}: CatalogPageProps<T>) {
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<T | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      searchFields(r).some((f) => (f ?? '').toLowerCase().includes(q)),
    );
  }, [rows, query, searchFields]);

  const exportRows = () =>
    filtered.map((r) =>
      columns.map((c) => (c.exportValue ? c.exportValue(r) : String((r as Record<string, unknown>)[c.key] ?? ''))),
    );

  const doCsv = (ext: 'csv' | 'xls') =>
    exportCSV(`${exportFilename}.${ext}`, columns.map((c) => c.label), exportRows());

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDelete(pendingDelete);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbarExtra}
          <Button onClick={onAdd}>
            <Plus className="h-4 w-4" /> {addLabel}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="h-4 w-4" /> Print
              </Button>
              <Button variant="outline" size="sm" onClick={() => doCsv('xls')}>
                <FileSpreadsheet className="h-4 w-4" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => doCsv('csv')}>
                <FileText className="h-4 w-4" /> CSV
              </Button>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={`Search ${title.toLowerCase()}…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {filters}

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => (
                    <TableHead key={c.key} className={c.className}>
                      {c.label}
                    </TableHead>
                  ))}
                  <TableHead className="w-28 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={columns.length + 1} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length + 1} className="py-8 text-center text-sm text-muted-foreground">
                      {query ? `No match for "${query}".` : emptyMessage}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  filtered.map((r) => (
                    <TableRow key={rowKey(r)}>
                      {columns.map((c) => (
                        <TableCell key={c.key} className={c.className}>
                          {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '')}
                        </TableCell>
                      ))}
                      <TableCell className="text-right whitespace-nowrap">
                        {rowActions?.(r)}
                        <Button variant="ghost" size="sm" onClick={() => onEdit(r)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setPendingDelete(r)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-xs text-muted-foreground">
            {filtered.length} of {rows.length} record(s)
          </p>
        </CardContent>
      </Card>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete ? deleteLabel(pendingDelete) : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it from the catalog. Records that already reference it are kept, and the delete is refused if
              anything still depends on it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The modal both catalog screens put their create/edit form inside. */
export function CatalogDialog({
  open,
  onOpenChange,
  title,
  description,
  onSave,
  saving,
  saveLabel = 'Save',
  wide,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onSave: () => void;
  saving?: boolean;
  saveLabel?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={wide ? 'max-h-[90vh] overflow-y-auto sm:max-w-3xl' : 'max-h-[90vh] overflow-y-auto'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">{children}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Labelled form field, so both catalog forms line up identically. */
export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
