import { Download, ExternalLink, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SafeHtml } from '@/components/ui/safe-html';
import { FileList, downloadLmsFile, formatBytes } from '../file-upload';
import type { ActivityUiPlugin, ActivityViewProps } from './shared';
import { iconFor } from './shared';

/**
 * Content activities — mod_page, mod_label, mod_resource, mod_url, mod_folder.
 *
 * Non-gradable and identical for both audiences, so each exports one view used
 * for student and teacher alike. These replaced the raw `JSON.stringify(view)`
 * fallback the activity page used to print for every unrecognised type.
 */

function PageBody({ view }: ActivityViewProps) {
  const inst = view.body?.instance ?? view.body ?? {};
  const html = inst.content ?? inst.intro ?? '';
  if (!html) return <Empty>This page has no content yet.</Empty>;
  return (
    <Card>
      <CardContent className="py-5">
        <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={html} />
      </CardContent>
    </Card>
  );
}

function LabelBody({ view }: ActivityViewProps) {
  const inst = view.body?.instance ?? view.body ?? {};
  return (
    <Card>
      <CardContent className="py-4">
        <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={inst.content ?? ''} />
      </CardContent>
    </Card>
  );
}

function ResourceBody({ view }: ActivityViewProps) {
  const inst = view.body?.instance ?? {};
  const file = view.body?.file ?? null;
  return (
    <Card>
      <CardContent className="space-y-3 py-5">
        {inst.intro && <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={inst.intro} />}
        <div className="flex items-center gap-3 rounded-md border p-3">
          <FileText className="h-8 w-8 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file?.filename ?? view.module.name}</p>
            <p className="text-xs text-muted-foreground">
              {file ? `${file.contentType} · ${formatBytes(file.byteSize)}` : 'No file attached yet'}
            </p>
          </div>
          <Button
            size="sm" variant="outline" disabled={!file}
            onClick={() => file && downloadLmsFile(file.id, file.filename)}
          >
            <Download className="mr-1 h-4 w-4" />Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function UrlBody({ view }: ActivityViewProps) {
  const inst = view.body?.instance ?? view.body ?? {};
  const href: string = inst.externalUrl ?? '';
  return (
    <Card>
      <CardContent className="space-y-3 py-5">
        {inst.intro && <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={inst.intro} />}
        {href ? (
          <a
            href={href}
            target={inst.display === 'embed' ? undefined : '_blank'}
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="break-all">{href}</span>
          </a>
        ) : (
          <Empty>No link set.</Empty>
        )}
      </CardContent>
    </Card>
  );
}

function FolderBody({ view }: ActivityViewProps) {
  const inst = view.body?.instance ?? {};
  const files = view.body?.files ?? [];
  return (
    <Card>
      <CardContent className="space-y-3 py-5">
        {inst.intro && <SafeHtml className="prose prose-sm dark:prose-invert max-w-none" html={inst.intro} />}
        <FileList files={files} empty="This folder is empty." />
      </CardContent>
    </Card>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

function both(type: string, label: string, Body: (p: ActivityViewProps) => JSX.Element): ActivityUiPlugin {
  return { type, label, icon: iconFor(type), StudentView: Body, TeacherView: Body };
}

export const CONTENT_PLUGINS: ActivityUiPlugin[] = [
  both('page', 'Page', PageBody),
  both('label', 'Text', LabelBody),
  both('resource', 'File', ResourceBody),
  both('url', 'URL', UrlBody),
  both('folder', 'Folder', FolderBody),
];
