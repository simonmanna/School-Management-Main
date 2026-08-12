import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, Download } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { formatBytes } from '@/lib/format';

interface FileRecord {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  ownerType: string | null;
  ownerId: string | null;
  visibility: string;
  createdAt: string;
}

export function FilesPage() {
  const qc = useQueryClient();
  const [ownerType, setOwnerType] = useState('partner');
  const [ownerId, setOwnerId] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const list = useQuery<FileRecord[]>({
    queryKey: ['files', ownerType, ownerId],
    queryFn: async () => {
      const params = new URLSearchParams({ ownerType });
      if (ownerId) params.set('ownerId', ownerId);
      return (await api.get<FileRecord[]>(`/files?${params.toString()}`)).data;
    },
    enabled: false,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('ownerType', ownerType);
      fd.append('ownerId', ownerId);
      return (await api.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
    },
    onSuccess: () => {
      notify.success('Uploaded');
      qc.invalidateQueries({ queryKey: ['files'] });
      list.refetch();
    },
    onError: (e: any) => notify.error(e?.response?.data?.message ?? 'Failed'),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => await api.delete(`/files/${id}`),
    onSuccess: () => {
      notify.success('Removed');
      list.refetch();
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Files</h1>
        <p className="text-sm text-muted-foreground">Upload and manage attachments</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
          <CardDescription>Attach a file to a record (e.g. Partner, Expense)</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs">Owner type</label>
            <select
              value={ownerType}
              onChange={(e) => setOwnerType(e.target.value)}
              className="mt-1 block rounded border bg-background px-2 py-1 text-sm"
            >
              <option value="partner">Partner</option>
              <option value="expense">Expense</option>
              <option value="product">Product</option>
              <option value="invoice">Invoice</option>
              <option value="payment">Payment</option>
            </select>
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="text-xs">Owner ID</label>
            <input
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              placeholder="uuid"
              className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
            />
          </div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
            }}
          />
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={!ownerId || upload.isPending}
          >
            <Upload className="mr-2 h-4 w-4" />
            {upload.isPending ? 'Uploading…' : 'Choose file'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stored files</CardTitle>
          <Button size="sm" variant="outline" onClick={() => list.refetch()}>
            {list.isFetching ? 'Loading…' : 'List files'}
          </Button>
        </CardHeader>
        <CardContent>
          {list.isLoading && <Skeleton className="h-16 w-full" />}
          {list.data && list.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No files for this owner.</p>
          )}
          {list.data?.map((f) => (
            <div key={f.id} className="flex items-center justify-between border-b py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{f.filename}</div>
                <div className="text-xs text-muted-foreground">
                  {f.contentType} · {formatBytes(f.byteSize)} · {new Date(f.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      const { data } = await api.post<{ url: string }>(`/files/${f.id}/signed-url`);
                      window.open(data.url, '_blank');
                    } catch {
                      notify.error('Could not generate URL');
                    }
                  }}
                >
                  <Download className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(f.id)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
