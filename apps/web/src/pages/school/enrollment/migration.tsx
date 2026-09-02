import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, Loader2, PlayCircle, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { notify } from '@/lib/notify';
import { useAcademicYears } from '@/features/school/api';
import {
  errorMessage,
  useMigrationExceptions,
  useReconciliation,
  useResolveMigrationException,
  useRollbackMigration,
  useRunBackfill,
} from '@/features/school/enrollment-api';
import { formatDate, NONE, toId } from './_shared';

/**
 * Enrollment migration — legacy `Enrollment` rows into the canonical spine.
 *
 * Three rules from the Phase 0.5 plan are visible on this screen because an
 * operator has to be able to see them hold:
 *
 *  1. Nothing is written until you press Apply — the default is a dry run.
 *  2. Nothing is discarded — rows that cannot be mapped land in a queue.
 *  3. A run can be undone by its run id, and only the rows it wrote.
 */
export function SchoolEnrollmentMigrationPage() {
  const { data: years } = useAcademicYears();
  const [yearId, setYearId] = useState<string>(NONE);
  const [lastRunId, setLastRunId] = useState<string>('');
  const [rollbackId, setRollbackId] = useState('');

  useEffect(() => {
    if (yearId === NONE && years?.data?.length) setYearId(years.data.find((y) => y.isCurrent)?.id ?? NONE);
  }, [years, yearId]);

  const backfill = useRunBackfill();
  const rollback = useRollbackMigration();
  const { data: report, isFetching, refetch } = useReconciliation(toId(yearId));
  const { data: exceptions } = useMigrationExceptions({ resolved: false });
  const resolveMut = useResolveMigrationException();

  const run = async (dryRun: boolean) => {
    try {
      const res = await backfill.mutateAsync({ dryRun, academicYearId: toId(yearId) });
      setLastRunId(res.migrationRunId);
      if (!dryRun) setRollbackId(res.migrationRunId);
      notify.success(
        `${dryRun ? 'Dry run' : 'Applied'} · ${res.candidates} legacy rows considered, ` +
          `${res.enrollmentsCreated} memberships and ${res.placementsCreated} placements ${dryRun ? 'would be' : ''} created, ` +
          `${res.exceptions.length} could not be mapped.`,
      );
      refetch();
    } catch (err) {
      notify.error(errorMessage(err, 'The backfill failed.'));
    }
  };

  const undo = async () => {
    try {
      const res = await rollback.mutateAsync(rollbackId.trim());
      notify.success(`Removed ${res.deletedPlacements} placements and ${res.deletedEnrollments} memberships.`);
      refetch();
    } catch (err) {
      notify.error(errorMessage(err, 'Rollback refused.'));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Enrollment migration</h1>
        <p className="text-sm text-muted-foreground">
          Moves the school's old per-term enrollment records onto the canonical membership and placement history. Run
          the dry run first, read the reconciliation, then apply.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Backfill</CardTitle>
          <CardDescription>
            Each legacy row is mapped exactly once, tagged with a run id, and re-running is safe. A row that cannot be
            mapped — usually a class whose grade level belongs to no programme — goes to the queue below instead of
            being dropped.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56 space-y-1.5">
              <Label>Academic year</Label>
              <Select value={yearId} onValueChange={setYearId}>
                <SelectTrigger><SelectValue placeholder="All years" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>All years</SelectItem>
                  {(years?.data ?? []).map((y) => (
                    <SelectItem key={y.id} value={y.id}>{y.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => run(true)} disabled={backfill.isPending}>
              {backfill.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Dry run
            </Button>
            <Button onClick={() => run(false)} disabled={backfill.isPending}>
              <PlayCircle className="mr-1.5 h-4 w-4" /> Apply
            </Button>
            {lastRunId && <Badge variant="outline">Run id: {lastRunId}</Badge>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Reconciliation</CardTitle>
            <CardDescription>
              Every legacy row must be mapped, and every mapped row must match on class, section, stream, term and roll
              number. A non-zero difference blocks the cutover.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!report && <p className="text-sm text-muted-foreground">Loading…</p>}
          {report && (
            <>
              <div className="flex items-center gap-2">
                {report.clean ? (
                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Clean
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <AlertTriangle className="mr-1 h-3.5 w-3.5" /> Not reconciled
                  </Badge>
                )}
                <span className="text-sm text-muted-foreground">
                  {report.mappedRows} of {report.legacyRows} legacy rows mapped
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Legacy rows" value={report.legacyRows} />
                <Stat label="Unmapped" value={report.unmappedRows} tone={report.unmappedRows ? 'bad' : 'good'} />
                <Stat label="Differences" value={report.differenceCount} tone={report.differenceCount ? 'bad' : 'good'} />
                <Stat label="Memberships" value={report.canonicalEnrollments} />
                <Stat label="Placements" value={report.canonicalPlacements} />
                <Stat
                  label="Duplicate open"
                  value={report.duplicateOpenPlacements.length}
                  tone={report.duplicateOpenPlacements.length ? 'bad' : 'good'}
                />
              </div>

              {report.differences.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Legacy row</TableHead>
                      <TableHead>Field</TableHead>
                      <TableHead>Old value</TableHead>
                      <TableHead>New value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.differences.map((d, i) => (
                      <TableRow key={`${d.legacyEnrollmentId}-${d.field}-${i}`}>
                        <TableCell className="font-mono text-xs">{d.legacyEnrollmentId}</TableCell>
                        <TableCell>{d.field}</TableCell>
                        <TableCell className="text-muted-foreground">{String(d.legacy ?? '—')}</TableCell>
                        <TableCell className="text-muted-foreground">{String(d.canonical ?? '—')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exception queue</CardTitle>
          <CardDescription>
            Legacy rows the migration could not map. Nothing here was deleted — fix the underlying data and re-run, or
            record why the row is not being migrated.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Raised</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Why</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(exceptions ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    Nothing outstanding.
                  </TableCell>
                </TableRow>
              )}
              {(exceptions ?? []).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-muted-foreground">{formatDate(e.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.sourceEntity} · {e.sourceId}
                  </TableCell>
                  <TableCell>{e.reason}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const note = window.prompt('Why is this row not being migrated?');
                        if (!note) return;
                        try {
                          await resolveMut.mutateAsync({ id: e.id, resolutionNote: note });
                          notify.success('Exception closed.');
                        } catch (err) {
                          notify.error(errorMessage(err));
                        }
                      }}
                    >
                      Resolve
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roll back a run</CardTitle>
          <CardDescription>
            Removes only the rows a given run wrote. It refuses once real movements have been recorded on those
            enrollments — at that point the recovery is the pre-migration backup, not a delete.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-80 space-y-1.5">
            <Label>Migration run id</Label>
            <Input value={rollbackId} onChange={(e) => setRollbackId(e.target.value)} placeholder="p1-enrollment-…" />
          </div>
          <Button variant="destructive" onClick={undo} disabled={!rollbackId.trim() || rollback.isPending}>
            {rollback.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Undo2 className="mr-1.5 h-4 w-4" />}
            Roll back
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          tone === 'bad' && value > 0
            ? 'text-xl font-semibold text-destructive'
            : tone === 'good'
              ? 'text-xl font-semibold text-emerald-600 dark:text-emerald-400'
              : 'text-xl font-semibold'
        }
      >
        {value}
      </div>
    </div>
  );
}

export default SchoolEnrollmentMigrationPage;
