import { useState } from 'react';
import { FileText, Send, ShieldCheck, ShieldAlert, XCircle, RefreshCw } from 'lucide-react';
import {
  useGenerateReportDocuments, usePublishReportDocuments, useReportDocument,
  useReportDocuments, useVoidReportDocument,
} from '@/features/school/results-phase5-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { notify } from '@/lib/notify';
import { Empty, apiMessage, fmtDateTime } from './exam-ops-shared';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  generated: 'Issued, not released',
  published: 'Released to families',
  superseded: 'Replaced by a newer copy',
  void: 'Withdrawn',
};

/**
 * Phase 5 — report cards as reproducible documents.
 *
 * Every row records which result set, which revision and which template version
 * produced it, plus a checksum of the payload. A correction issues a new
 * revision and marks the old one superseded, so the copy a parent already holds
 * can still be shown exactly as it was given.
 */
export function ReportDocumentsPanel({
  termId,
  resultSetId,
  published,
}: {
  termId: string;
  resultSetId: string;
  published: boolean;
}) {
  const { data: documents } = useReportDocuments({ termId, resultSetId: resultSetId || undefined });
  const generate = useGenerateReportDocuments();
  const publish = usePublishReportDocuments();
  const voidDoc = useVoidReportDocument();
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState('');
  const [reason, setReason] = useState('');
  const { data: detail } = useReportDocument(open || undefined);

  const rows = documents ?? [];
  const releasable = rows.filter((d) => ['draft', 'generated'].includes(d.status));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  if (!resultSetId) return <Empty>Pick a result version on the Result runs tab first.</Empty>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Report documents</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!published || generate.isPending}
              title={published ? undefined : 'Release the results first — a document made from a draft calculation can still change'}
              onClick={async () => {
                try {
                  const out = await generate.mutateAsync({ resultSetId });
                  notify.success(`${out.issued} report document(s) issued`, {
                    description: out.skipped.length ? `${out.skipped.length} skipped — ${out.skipped[0].reason}` : 'Release them when you are ready.',
                  });
                } catch (e) {
                  notify.error('Could not issue report documents', { description: apiMessage(e, 'Try again.') });
                }
              }}
            >
              <FileText className="h-4 w-4" /> Issue for this result version
            </Button>
            <Button
              size="sm" variant="outline"
              disabled={!published || !reason.trim() || generate.isPending}
              onClick={async () => {
                try {
                  const out = await generate.mutateAsync({ resultSetId, reissue: true, reason });
                  setReason('');
                  notify.success(`${out.issued} document(s) reissued`, { description: 'The previous copies are kept and marked as replaced.' });
                } catch (e) {
                  notify.error('Could not reissue', { description: apiMessage(e, 'Try again.') });
                }
              }}
            >
              <RefreshCw className="h-4 w-4" /> Reissue
            </Button>
            <Input className="w-56" placeholder="Reason, to reissue" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button
              size="sm"
              disabled={!selected.length || publish.isPending}
              onClick={async () => {
                try {
                  const out = await publish.mutateAsync({ documentIds: selected });
                  setSelected([]);
                  notify.success(`${out.published} report card(s) released`, { description: 'Families can now see them in the portal.' });
                } catch (e) {
                  notify.error('Could not release these documents', { description: apiMessage(e, 'Try again.') });
                }
              }}
            >
              <Send className="h-4 w-4" /> Release {selected.length || ''}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!published && (
            <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              These results have not been released yet. Report documents are issued from released results so the card and the result can never disagree.
            </p>
          )}
          {rows.length === 0 ? (
            <Empty>Nothing issued for this result version yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      checked={releasable.length > 0 && selected.length === releasable.length}
                      onChange={(e) => setSelected(e.target.checked ? releasable.map((d) => d.id) : [])}
                    />
                  </TableHead>
                  <TableHead>Pupil</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>From results</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => (
                  <TableRow key={d.id} className={open === d.id ? 'bg-accent' : undefined}>
                    <TableCell>
                      <input
                        type="checkbox"
                        disabled={!['draft', 'generated'].includes(d.status)}
                        checked={selected.includes(d.id)}
                        onChange={() => toggle(d.id)}
                      />
                    </TableCell>
                    <TableCell className="text-sm">
                      {d.studentName ?? '—'}
                      <div className="text-xs text-muted-foreground">{d.admissionNo ?? ''}</div>
                    </TableCell>
                    <TableCell className="text-sm">rev {d.revision}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      version {d.resultSetRevision ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {d.templateKey ?? 'custom'}
                      <div className="font-mono">{d.templateVersionId?.slice(0, 8) ?? '—'}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={d.status === 'published' ? 'default' : 'secondary'}>{STATUS_LABEL[d.status] ?? d.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setOpen(d.id === open ? '' : d.id)}>Provenance</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {detail && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              {detail.studentName ?? 'Pupil'} — revision {detail.revision}
            </CardTitle>
            <Badge variant={detail.checksumVerified ? 'secondary' : 'destructive'}>
              {detail.checksumVerified
                ? <><ShieldCheck className="mr-1 h-3 w-3" /> Reproduces exactly</>
                : <><ShieldAlert className="mr-1 h-3 w-3" /> Payload changed since it was issued</>}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="grid gap-2 sm:grid-cols-2">
              <Row label="Which results produced it">
                {detail.resultSet
                  ? `Version ${detail.resultSet.revision}, ${detail.resultSet.status}${detail.resultSet.publishedAt ? ` (released ${fmtDateTime(detail.resultSet.publishedAt)})` : ''}`
                  : 'No result set recorded'}
              </Row>
              <Row label="Which template produced it">{detail.templateKey ?? 'custom'} · {detail.templateVersionId?.slice(0, 16) ?? '—'}</Row>
              <Row label="Issued">{fmtDateTime(detail.generatedAt)}</Row>
              <Row label="Released">{detail.publishedAt ? fmtDateTime(detail.publishedAt) : 'Not released'}</Row>
              <Row label="Payload checksum"><span className="font-mono text-xs">{detail.payloadChecksum.slice(0, 32)}</span></Row>
              <Row label="Superseded by">{detail.supersededById ? `revision ${detail.revision + 1}` : 'Nothing — this is the current copy'}</Row>
            </dl>

            {detail.supersedes.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Earlier copies</p>
                <ul className="space-y-1 text-xs">
                  {detail.supersedes.map((s) => (
                    <li key={s.id} className="flex justify-between rounded border p-2">
                      <span>Revision {s.revision} · {STATUS_LABEL[s.status] ?? s.status}</span>
                      <span className="text-muted-foreground">{fmtDateTime(s.generatedAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {detail.status !== 'void' && detail.status !== 'superseded' && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <Input className="w-64" placeholder="Reason for withdrawing" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button
                  size="sm" variant="ghost"
                  disabled={!reason.trim() || voidDoc.isPending}
                  onClick={async () => {
                    try {
                      await voidDoc.mutateAsync({ id: detail.id, reason });
                      setReason('');
                      notify.success('Document withdrawn', { description: 'It stays on the record, marked void with your reason.' });
                    } catch (e) {
                      notify.error('Could not withdraw the document', { description: apiMessage(e, 'Try again.') });
                    }
                  }}
                >
                  <XCircle className="h-4 w-4" /> Withdraw
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
