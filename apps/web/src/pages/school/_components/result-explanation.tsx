import { Sigma } from 'lucide-react';
import { useResultExplanation } from '@/features/school/results-phase5-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Empty, num, selectClass } from './exam-ops-shared';

/**
 * Why is this pupil's subject percentage what it is?
 *
 * Every number here comes from the frozen `componentBreakdown` the run stored,
 * so this is the arithmetic that actually produced the published figure — not a
 * fresh calculation that could quietly disagree with it.
 */
export function ResultExplanationPanel({
  resultSetId,
  students,
  studentProfileId,
  onStudent,
}: {
  resultSetId: string;
  students: Array<{ studentProfileId: string; name: string }>;
  studentProfileId: string;
  onStudent: (id: string) => void;
}) {
  const { data, isLoading, isError } = useResultExplanation(resultSetId || undefined, studentProfileId || undefined);

  if (!resultSetId) return <Empty>Pick a result version on the Result runs tab first.</Empty>;

  return (
    <div className="space-y-4">
      <select className={`${selectClass} max-w-md`} value={studentProfileId} onChange={(e) => onStudent(e.target.value)}>
        <option value="">Choose a pupil…</option>
        {students.map((s) => <option key={s.studentProfileId} value={s.studentProfileId}>{s.name}</option>)}
      </select>

      {!studentProfileId && <Empty>Choose a pupil to see how each subject percentage was worked out.</Empty>}
      {studentProfileId && isLoading && <Empty>Loading…</Empty>}
      {studentProfileId && isError && <Empty>This pupil has no result in this version.</Empty>}

      {data && (
        <>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2"><Sigma className="h-4 w-4" /> Overall</CardTitle>
              <div className="flex flex-wrap gap-1 text-xs">
                <Badge variant="secondary">Version {data.resultSet.revision}</Badge>
                <Badge variant="secondary">{data.resultSet.gradingSystem ?? 'grading'}</Badge>
                <Badge variant="secondary">rounding: {data.resultSet.roundingMode.replace('_', ' ')}</Badge>
                {data.resultSet.outputChecksum && (
                  <Badge variant="secondary" title="Output checksum">#{data.resultSet.outputChecksum.slice(0, 8)}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Average" value={data.term.meanPercent != null ? `${num(data.term.meanPercent)}%` : '—'} />
              <Stat label="GPA" value={num(data.term.gpa)} />
              <Stat label="Aggregate" value={data.term.aggregate != null ? String(data.term.aggregate) : '—'} />
              <Stat label="Division" value={data.term.division ?? '—'} />
              <Stat label="Position" value={data.term.classRank != null ? String(data.term.classRank) : '—'} />
              <Stat label="Subjects" value={String(data.term.subjectsCount)} />
            </CardContent>
          </Card>

          {data.subjects.map((s) => (
            <Card key={s.subjectId}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{s.subjectName ?? 'Subject'}{s.subjectCode ? ` (${s.subjectCode})` : ''}</CardTitle>
                <div className="flex flex-wrap gap-1 text-xs">
                  <Badge>{s.finalPercent != null ? `${num(s.finalPercent)}%` : '—'}</Badge>
                  {s.grade && <Badge variant="secondary">Grade {s.grade}</Badge>}
                  {s.points != null && <Badge variant="secondary">{s.points} point(s)</Badge>}
                  {s.subjectRank != null && <Badge variant="secondary">Position {s.subjectRank}</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">How the percentage was built</p>
                  {s.componentBreakdown.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No weighting breakdown was recorded for this subject — the run had no policy components to apply.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Component</TableHead><TableHead>Weight</TableHead>
                          <TableHead>Scored</TableHead><TableHead>Contributes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {s.componentBreakdown.map((c, i) => (
                          <TableRow key={`${c.componentId}-${i}`}>
                            <TableCell className="text-sm capitalize">{c.kind.replace(/_/g, ' ')}</TableCell>
                            <TableCell className="text-sm">{num(c.weight)}%</TableCell>
                            <TableCell className="text-sm">{c.componentPercent != null ? `${num(c.componentPercent)}%` : '—'}</TableCell>
                            <TableCell className="text-sm font-medium">{num(c.contribution)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
                          <TableCell colSpan={3} className="text-right text-sm font-medium">Final</TableCell>
                          <TableCell className="text-sm font-medium">{s.finalPercent != null ? `${num(s.finalPercent)}%` : '—'}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  )}
                </div>

                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">The work behind it</p>
                  {s.evidence.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No assessments were recorded for this subject in this term.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Assessment</TableHead><TableHead>Type</TableHead>
                          <TableHead>Mark</TableHead><TableHead>Participation</TableHead><TableHead>Counted</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {s.evidence.map((e) => (
                          <TableRow key={e.assessmentId}>
                            <TableCell className="text-sm">{e.title}</TableCell>
                            <TableCell className="text-xs capitalize">{e.kind.replace(/_/g, ' ')}</TableCell>
                            <TableCell className="text-sm">
                              {e.score != null ? `${num(e.score)} / ${num(e.maxScore)}` : '—'}
                            </TableCell>
                            <TableCell className="text-xs capitalize">{e.participation.replace(/_/g, ' ')}</TableCell>
                            <TableCell>
                              {e.counted
                                ? <Badge variant="secondary">counted</Badge>
                                : <Badge variant="secondary" title="Left out of the average — not scored zero">left out</Badge>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-medium">{value}</p>
    </div>
  );
}
