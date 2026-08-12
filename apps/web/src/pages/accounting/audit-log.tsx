import { useState } from 'react';
import { Search, History } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuditLogs, type AuditLogEntry } from '@/features/accounting/api';
import { format } from 'date-fns';

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
  restore: 'bg-purple-100 text-purple-800',
  post: 'bg-green-100 text-green-800',
  reverse: 'bg-amber-100 text-amber-800',
  approve: 'bg-indigo-100 text-indigo-800',
  reject: 'bg-rose-100 text-rose-800',
};

export function AuditLogPage() {
  const [entityFilter, setEntityFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAuditLogs({
    page,
    pageSize: 50,
    entity: entityFilter || undefined,
  });

  const logs = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="border-l-4 border-[#3b82f6] pl-4 space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500">
            Every create, update, delete, post, reverse, and restore action across all modules.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 p-3 bg-white border rounded-lg shadow-sm">
        <div className="space-y-1 min-w-[200px]">
          <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Entity</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by entity type..."
              value={entityFilter}
              onChange={(e) => { setEntityFilter(e.target.value); setPage(1); }}
              className="pl-8 h-9 text-xs"
            />
          </div>
        </div>
        <div className="flex-1 text-right text-xs text-muted-foreground">
          {meta && <span>{meta.total} event{meta.total !== 1 ? 's' : ''}</span>}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2 pt-4 px-5 bg-muted/30 border-b rounded-t-lg flex-row items-center justify-between">
          <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Activity Events
          </CardTitle>
          {meta && (
            <p className="text-[10px] font-medium text-muted-foreground">
              Page {page} of {meta.totalPages}
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">When</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Action</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Entity</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Entity ID</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase">Actor</TableHead>
                <TableHead className="text-[10px] font-bold text-muted-foreground uppercase hidden md:table-cell">IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={`s-${i}`}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="font-medium text-sm">No audit events found</p>
                    <p className="text-xs">{entityFilter ? 'Try a different entity filter.' : 'No activity recorded yet.'}</p>
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log: AuditLogEntry) => (
                  <TableRow key={log.id} className="hover:bg-muted/20">
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.createdAt), 'MMM d, HH:mm')}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] font-medium ${ACTION_COLORS[log.action] ?? 'bg-gray-100 text-gray-700'}`} variant="outline">
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-medium">{log.entity}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono max-w-[120px] truncate">
                      {log.entityId.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.actorId ? `${log.actorId.slice(0, 8)}…` : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground hidden md:table-cell">
                      {log.ipAddress ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{meta.total} total events</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-xs font-medium">Page {meta.page} of {meta.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
