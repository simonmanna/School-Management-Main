import { useRef, useState } from 'react';
import { Download, FileText, Loader2, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

export interface LmsFileRef {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
}

/** "1.4 MB" */
export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Download a course file (L2.1).
 *
 * Always goes through `POST school/lms/files/:id/url`, never the kernel signer:
 * the kernel checks only the tenant, so signing an LMS file directly would let
 * anyone in the organization pull another course's — or another pupil's — files.
 * The URL it returns is short-lived and single-purpose.
 */
export async function downloadLmsFile(fileId: string, filename?: string): Promise<void> {
  try {
    const { data } = await api.post<{ url: string; filename: string }>(`/school/lms/files/${fileId}/url`);
    const a = document.createElement('a');
    a.href = data.url;
    a.download = filename ?? data.filename ?? '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e: any) {
    notify.error(e?.response?.data?.message ?? 'You do not have access to this file');
  }
}

/** A read-only list of attachments with working download buttons. */
export function FileList({ files, empty = 'No files.' }: { files: LmsFileRef[]; empty?: string }) {
  if (!files || files.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="divide-y rounded-md border">
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-3 p-2.5 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{f.filename}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(f.byteSize)}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => downloadLmsFile(f.id, f.filename)}>
            <Download className="h-4 w-4" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Pick files and upload them, returning the new file ids.
 *
 * Two steps by design: the kernel takes the bytes (`POST /files/upload`), then the
 * LMS re-homes the file into a course area, which is what applies the access rule.
 * A file that is uploaded but never attached is inert — it belongs to no course.
 */
export function FileUpload({
  onUploaded, disabled, accept, max = 5, label = 'Attach files',
}: {
  onUploaded: (files: LmsFileRef[]) => void;
  disabled?: boolean;
  accept?: string;
  max?: number;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [staged, setStaged] = useState<LmsFileRef[]>([]);

  const pick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    if (staged.length + list.length > max) {
      notify.error(`At most ${max} file(s)`);
      return;
    }
    setBusy(true);
    const added: LmsFileRef[] = [];
    try {
      for (const file of Array.from(list)) {
        const form = new FormData();
        form.append('file', file);
        const { data } = await api.post<any>('/files/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        added.push({
          id: data.id, filename: data.filename ?? file.name,
          contentType: data.contentType ?? file.type, byteSize: data.byteSize ?? file.size,
        });
      }
      const next = [...staged, ...added];
      setStaged(next);
      onUploaded(next);
    } catch (e: any) {
      notify.error(e?.response?.data?.message ?? 'Upload failed');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const drop = (id: string) => {
    const next = staged.filter((f) => f.id !== id);
    setStaged(next);
    onUploaded(next);
  };

  return (
    <div className="space-y-2">
      <input
        ref={input} type="file" multiple accept={accept} className="hidden"
        onChange={(e) => pick(e.target.files)}
      />
      <Button
        type="button" size="sm" variant="outline"
        disabled={disabled || busy || staged.length >= max}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1 h-4 w-4" />}
        {busy ? 'Uploading…' : label}
      </Button>

      {staged.length > 0 && (
        <ul className="divide-y rounded-md border">
          {staged.map((f) => (
            <li key={f.id} className="flex items-center gap-3 p-2.5 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{f.filename}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(f.byteSize)}</span>
              </span>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => drop(f.id)}>
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
