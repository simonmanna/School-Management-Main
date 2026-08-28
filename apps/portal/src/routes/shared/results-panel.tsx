import { useState } from 'react';
import { Award, FileBadge, Download, FileText } from 'lucide-react';
import type { StudentDashboard } from '@/lib/portal-api';
import { useReportCards, downloadReportCard } from '@/lib/portal-api';
import { apiErrorMessage } from '@/lib/api';
import { notify } from '@/lib/notify';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge, Empty, Stat, Skeleton } from '@/components/ui';

/**
 * Published results, report cards and certificates.
 *
 * Shared by the pupil's own screen and the guardian's view of it, because they
 * are the same thing seen by two people rather than two features.
 *
 * Note what is NOT here: raw marks. `publishedResults` reads the result spine
 * filtered to `status = 'published'`, and report cards are filtered to those with
 * a `publishedAt`. A mark still being entered, moderated or appealed never
 * reaches this page — a family seeing a draft mark that a teacher then changes is
 * an argument the school should never have had.
 */
export function ResultsPanel({
  data,
  studentProfileId,
}: {
  data: StudentDashboard;
  studentProfileId?: string;
}) {
  const results = data.publishedResults ?? [];
  const latest = results[0];
  const certificates = data.certificates ?? [];

  return (
    <div className="space-y-4">
      {latest ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Average"
              value={latest.meanPercent != null ? `${Math.round(Number(latest.meanPercent))}%` : '—'}
            />
            <Stat label="Position in class" value={latest.classRank ?? '—'} />
          </div>

          {(latest.division || latest.aggregate != null || latest.gpa) && (
            <div className="flex flex-wrap gap-2">
              {latest.division && <Badge variant="secondary">Division {latest.division}</Badge>}
              {latest.aggregate != null && <Badge variant="secondary">Aggregate {latest.aggregate}</Badge>}
              {latest.gpa && <Badge variant="secondary">GPA {latest.gpa}</Badge>}
            </div>
          )}

          {latest.promotionRecommendation && (
            <Card>
              <CardContent className="flex items-center gap-3">
                <Award className="h-5 w-5 text-primary" />
                <div>
                  <div className="text-sm font-medium">End-of-year recommendation</div>
                  <Badge variant="secondary" className="mt-1">{latest.promotionRecommendation}</Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {results.length > 1 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Earlier terms</CardTitle></CardHeader>
              <CardContent className="space-y-2 pt-0">
                {results.slice(1).map((r) => (
                  <div key={`${r.termId}-${r.resultSetRevision}`} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                    <div className="flex-1">
                      {r.meanPercent != null ? `${Math.round(Number(r.meanPercent))}% average` : 'Result published'}
                    </div>
                    {r.classRank != null && <Badge variant="outline">position {r.classRank}</Badge>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Empty
          title="No results published yet"
          hint="Marks appear here only after the school has approved and released them."
        />
      )}

      {studentProfileId && <ReportCards studentProfileId={studentProfileId} />}

      {certificates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileBadge className="h-4 w-4" /> Certificates
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {certificates.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.title}</div>
                  {c.code && <div className="truncate font-mono text-xs text-muted-foreground">{c.code}</div>}
                </div>
                <Badge variant={c.status === 'issued' ? 'success' : 'secondary'}>{c.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Released report cards, downloadable as the school's own PDF. */
function ReportCards({ studentProfileId }: { studentProfileId: string }) {
  const { data, isLoading } = useReportCards(studentProfileId);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!data || data.length === 0) return null;

  const download = async (id: string, termName: string | null) => {
    setBusyId(id);
    try {
      const safeTerm = (termName ?? 'report').replace(/[^\w-]+/g, '-').toLowerCase();
      await downloadReportCard(id, `report-card-${safeTerm}.pdf`);
    } catch (e) {
      notify.error(apiErrorMessage(e, 'Could not download that report card.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" /> Report cards
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {data.map((rc) => (
          <div key={rc.id} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{rc.termName ?? 'Report card'}</div>
                <div className="text-xs text-muted-foreground">
                  Released {rc.publishedAt ? new Date(rc.publishedAt).toLocaleDateString() : '—'}
                </div>
              </div>
              <Button size="sm" variant="outline" disabled={busyId === rc.id} onClick={() => download(rc.id, rc.termName)}>
                <Download className="h-4 w-4" /> {busyId === rc.id ? 'Preparing…' : 'PDF'}
              </Button>
            </div>
            {(rc.classTeacherComment || rc.principalComment) && (
              <div className="space-y-1 pt-2 text-sm text-muted-foreground">
                {rc.classTeacherComment && <p>“{rc.classTeacherComment}”</p>}
                {rc.principalComment && <p>“{rc.principalComment}”</p>}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
